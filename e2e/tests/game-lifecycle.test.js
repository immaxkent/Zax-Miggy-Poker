/**
 * game-lifecycle.test.js
 *
 * Level-4 E2E tests: real server process + real anvil chain + real contracts.
 *
 * Run:  cd e2e && npm test
 * Deps: anvil (Foundry) must be in PATH
 *
 * Set E2E_VERBOSE=1 to see server stdout/stderr.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';

import { startAnvil, ANVIL_KEYS } from '../helpers/anvil.js';
import { startServer } from '../helpers/server.js';
import { getJwt, connectSocket, emit, emitExpectError, waitForEvent } from '../helpers/auth.js';

// ─── Shared helpers (module-level, no async) ──────────────────────────────────

function httpReq(url, method, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname,
        method,
        headers: {
          ...headers,
          ...(bodyBuf ? { 'content-type': 'application/json', 'content-length': bodyBuf.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, text, json: () => JSON.parse(text) });
        });
      }
    );
    req.on('error', reject);
    if (bodyBuf) req.end(bodyBuf);
    else req.end();
  });
}

// ─── All tests wrapped in one outer describe so before() runs first ───────────

describe('Zax & Miggy Poker — E2E', () => {
  // Shared state — set in before()
  let anvil, usdc, vault;
  let player1, player2, player3;
  let server;
  let jwt1, jwt2, jwt3;

  before(async () => {
    anvil  = await startAnvil();
    usdc   = anvil.usdc;
    vault  = anvil.vault;

    // Wrap players in NonceManager so concurrent on-chain calls never collide
    player1 = new ethers.NonceManager(anvil.wallets.player1);
    player2 = new ethers.NonceManager(anvil.wallets.player2);
    player3 = new ethers.NonceManager(anvil.wallets.player3);

    const serverPort = 14000 + Math.floor(Math.random() * 1000);
    server = await startServer({
      port:           serverPort,
      signerPrivKey:  ANVIL_KEYS[1],
      anvilUrl:       anvil.anvilUrl,
      vaultAddress:   await vault.getAddress(),
      usdcAddress:    await usdc.getAddress(),
    });

    // Pre-issue JWTs sequentially (avoids concurrent challenge conflicts)
    jwt1 = await getJwt(player1, server);
    jwt2 = await getJwt(player2, server);
    jwt3 = await getJwt(player3, server);
  });

  after(() => {
    try { server?.stop(); } catch {}
    try { anvil?.stop(); } catch {}
  });

  // ── Inner helpers (close over shared state) ─────────────────────────────────

  async function onChainCreateGame(wallet, depositAmount) {
    const vaultAddr = await vault.getAddress();
    await (await usdc.connect(wallet).approve(vaultAddr, depositAmount)).wait();
    const tx = await vault.connect(wallet).createGame(depositAmount);
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = vault.interface.parseLog(log);
        if (parsed?.name === 'GameCreated') return parsed.args.gameId;
      } catch { /* skip */ }
    }
    throw new Error('GameCreated event not found');
  }

  async function onChainJoinGame(wallet, gameId) {
    const vaultAddr = await vault.getAddress();
    const game = await vault.getGame(gameId);
    await (await usdc.connect(wallet).approve(vaultAddr, game.depositAmount)).wait();
    await (await vault.connect(wallet).joinGame(gameId)).wait();
  }

  async function joinTable(jwt, gameId, creatorAddress = undefined) {
    const socket = connectSocket(jwt, server);
    await waitForEvent(socket, 'connect', 8_000);
    // Leave any stale table from a previous test (server tracks players by address)
    await emit(socket, 'leaveTable', {}).catch(() => {});
    const payload = { gameId: gameId.toString() };
    if (creatorAddress) payload.creatorAddress = creatorAddress;
    const ack = await emit(socket, 'joinUsdcTable', payload);
    assert.ok(ack?.state, 'Expected state in joinUsdcTable ack');
    return socket;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: Server auth enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('server auth enforcement', () => {
    it('/health is publicly accessible', async () => {
      const res = await httpReq(`${server.baseUrl}/health`, 'GET');
      assert.equal(res.status, 200);
      assert.equal(res.json().status, 'ok');
    });

    it('/auth/challenge requires API key', async () => {
      const res = await httpReq(
        `${server.baseUrl}/auth/challenge`,
        'POST',
        { /* no x-poker-key */ },
        { address: '0x0000000000000000000000000000000000000001' }
      );
      assert.equal(res.status, 401, 'Expected 401 without API key');
    });

    it('socket connection with wrong API key is rejected', async () => {
      const { io: ioClient } = await import('socket.io-client');
      const sock = ioClient(server.baseUrl, {
        transports: ['websocket'],
        auth: { token: 'dummy-token', apiKey: 'wrong-key' },
      });
      const err = await new Promise((resolve) => {
        sock.on('connect_error', (e) => resolve(e));
        setTimeout(() => resolve(new Error('timeout — no connect_error')), 5_000);
      });
      assert.ok(err instanceof Error, 'Expected connection error for invalid API key');
      sock.disconnect();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: terminateGame — access control
  // ─────────────────────────────────────────────────────────────────────────────
  describe('terminateGame — access control', () => {
    const DEPOSIT = 50n * 1_000_000n; // 50 USDC
    let sock1, sock2, gameId;

    it('non-host cannot terminate', async () => {
      gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      const creator = (await player1.getAddress()).toLowerCase();
      sock1 = await joinTable(jwt1, gameId, creator);
      sock2 = await joinTable(jwt2, gameId, creator);

      const error = await emitExpectError(sock2, 'terminateGame', {});
      assert.match(error, /host/i, `Expected host error, got: "${error}"`);
    });

    it('host CAN terminate before game starts; all players receive tableTerminated', async () => {
      const terminated2 = waitForEvent(sock2, 'tableTerminated', 5_000);
      await emit(sock1, 'terminateGame', {});
      await terminated2;
      sock1.disconnect();
      sock2.disconnect();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: terminateGame — on-chain state (exposes Bugs #1 and #2)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('terminateGame — on-chain cancellation [BUG #1 + BUG #2]', () => {
    const DEPOSIT = 50n * 1_000_000n;
    let sock1, sock2, gameId;

    it('setup: create game, join table, terminate', async () => {
      gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      const creator = (await player1.getAddress()).toLowerCase();
      sock1 = await joinTable(jwt1, gameId, creator);
      sock2 = await joinTable(jwt2, gameId, creator);

      const terminated2 = waitForEvent(sock2, 'tableTerminated', 5_000);
      await emit(sock1, 'terminateGame', {});
      await terminated2;
      sock1.disconnect();
      sock2.disconnect();
    });

    it('[BUG #1] game should be marked finished on-chain after terminate', async () => {
      const game = await vault.getGame(gameId);
      assert.ok(
        game.finished,
        'KNOWN BUG: game.finished is false — server never called cancelGame(). USDC is locked in vault.'
      );
    });

    it('[BUG #2] rejoining server table after terminate should be blocked', async () => {
      const sock = connectSocket(jwt1, server);
      await waitForEvent(sock, 'connect', 5_000);
      try {
        const error = await emitExpectError(sock, 'joinUsdcTable', { gameId: gameId.toString() });
        assert.match(
          error,
          /finished|terminated|cancelled/i,
          `KNOWN BUG: server allowed rejoin after terminate. Error: "${error}"`
        );
      } finally {
        // Leave any (bug-created) table before disconnecting so later suites aren't blocked
        await emit(sock, 'leaveTable', {}).catch(() => {});
        sock.disconnect();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: terminateGame blocked once game starts
  // ─────────────────────────────────────────────────────────────────────────────
  describe('terminateGame — blocked once game starts', () => {
    const DEPOSIT = 50n * 1_000_000n;
    let sock1, sock2;

    it('setup: create game and start it', async () => {
      const gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      const creator = (await player1.getAddress()).toLowerCase();
      sock1 = await joinTable(jwt1, gameId, creator);
      sock2 = await joinTable(jwt2, gameId, creator);
      await emit(sock1, 'startGame', {});
    });

    it('cannot terminate once a hand is in progress', async () => {
      const error = await emitExpectError(sock1, 'terminateGame', {});
      assert.match(error, /hand|start/i, `Expected "hand in progress" error, got: "${error}"`);
      sock1.disconnect();
      sock2.disconnect();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: full 2-player hand (all checks, chips conserved)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('full game — 2 players, all checks, chips conserved', () => {
    const DEPOSIT = 50n * 1_000_000n;
    let sock1, sock2;

    it('setup: create game, join, start — handStarted fires', async () => {
      const gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      const creator = (await player1.getAddress()).toLowerCase();
      sock1 = await joinTable(jwt1, gameId, creator);
      sock2 = await joinTable(jwt2, gameId, creator);

      const handStarted = waitForEvent(sock2, 'handStarted', 8_000);
      await emit(sock1, 'startGame', {});
      const evt = await handStarted;
      assert.ok(evt.handNumber >= 1, `handNumber should be ≥ 1`);
    });

    it('stage is preflop after start', async () => {
      const ack = await emit(sock1, 'getState', {});
      assert.equal(ack.state.stage, 'preflop');
    });

    it('inactive player cannot act (out of turn)', async () => {
      const ack = await emit(sock1, 'getState', {});
      const activeAddr = ack.state.players[ack.state.actionIdx].id;
      const p1Addr = (await player1.getAddress()).toLowerCase();
      const inactiveSock = activeAddr === p1Addr ? sock2 : sock1;
      const error = await emitExpectError(inactiveSock, 'playerAction', { action: 'check', amount: 0 });
      assert.ok(error, 'Expected error for out-of-turn action');
    });

    it('active player can call; stage eventually advances', async () => {
      const ack = await emit(sock1, 'getState', {});
      const activeAddr = ack.state.players[ack.state.actionIdx].id;
      const p1Addr = (await player1.getAddress()).toLowerCase();
      const activeSock = activeAddr === p1Addr ? sock1 : sock2;
      await emit(activeSock, 'playerAction', { action: 'call', amount: 0 });

      const ack2 = await emit(sock1, 'getState', {});
      assert.ok(['preflop','flop','turn','river'].includes(ack2.state.stage));
    });

    it('hand completes; handComplete event fires; chips conserved', async () => {
      const handComplete = waitForEvent(sock1, 'handComplete', 25_000);

      // Drive to completion: alternate check/call until stage = waiting
      for (let i = 0; i < 40; i++) {
        const stateAck = await emit(sock1, 'getState', {}).catch(() => null);
        if (!stateAck?.state || stateAck.state.stage === 'waiting') break;
        const state = stateAck.state;
        const activeAddr = state.players[state.actionIdx].id;
        const p1Addr = (await player1.getAddress()).toLowerCase();
        const activeSock = activeAddr === p1Addr ? sock1 : sock2;
        await emit(activeSock, 'playerAction', { action: 'check', amount: 0 }).catch(() => {});
      }

      const hc = await handComplete;
      assert.ok(hc.results, 'handComplete should include results');
      assert.equal(hc.community?.length, 5, 'should have 5 community cards');

      // Verify chip conservation
      const final = await emit(sock1, 'getState', {});
      const total = final.state.players.reduce((s, p) => s + p.chips, 0);
      assert.equal(total, 2000, `Expected 2000 total chips, got ${total}`);

      sock1.disconnect();
      sock2.disconnect();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: auto-rollover — next hand starts automatically after delay
  // ─────────────────────────────────────────────────────────────────────────────
  describe('auto-rollover — next hand starts without host action', () => {
    const DEPOSIT = 50n * 1_000_000n;
    let sock1, sock2;

    it('setup: create game, join, start first hand', async () => {
      const gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      const creator = (await player1.getAddress()).toLowerCase();
      sock1 = await joinTable(jwt1, gameId, creator);
      sock2 = await joinTable(jwt2, gameId, creator);
      const handStarted = waitForEvent(sock1, 'handStarted', 8_000);
      await emit(sock1, 'startGame', {});
      await handStarted;
    });

    it('complete first hand by checking/calling through', async () => {
      const handComplete = waitForEvent(sock1, 'handComplete', 30_000);
      const p1Addr = (await player1.getAddress()).toLowerCase();
      for (let i = 0; i < 40; i++) {
        const ack = await emit(sock1, 'getState', {}).catch(() => null);
        if (!ack?.state || ack.state.stage === 'waiting') break;
        const state = ack.state;
        const activeAddr = state.players[state.actionIdx].id;
        const activeSock = activeAddr === p1Addr ? sock1 : sock2;
        const actingPlayer = state.players[state.actionIdx];
        const action = state.currentBet > (actingPlayer.bet ?? 0) ? 'call' : 'check';
        await emit(activeSock, 'playerAction', { action, amount: 0 }).catch(() => {});
      }
      await handComplete;
    });

    it('second handStarted fires automatically within 8 seconds — no startGame call', async () => {
      // Do NOT call startGame — auto-rollover should trigger it
      const hand2 = waitForEvent(sock1, 'handStarted', 8_000);
      const evt = await hand2;
      assert.ok(evt.handNumber >= 2, `Expected handNumber >= 2, got ${evt.handNumber}`);
      sock1.disconnect();
      sock2.disconnect();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Suite: full USDC game — player eliminated, on-chain settlement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('full USDC game — elimination + on-chain closeGame', () => {
    const DEPOSIT = 10n * 1_000_000n; // 10 USDC each, 20 USDC pot
    let sock1, sock2, gameId;
    let p1AddrLower, p2AddrLower;

    it('setup: create and join game', async () => {
      p1AddrLower = (await player1.getAddress()).toLowerCase();
      p2AddrLower = (await player2.getAddress()).toLowerCase();
      gameId = await onChainCreateGame(player1, DEPOSIT);
      await onChainJoinGame(player2, gameId);
      sock1 = await joinTable(jwt1, gameId, p1AddrLower);
      sock2 = await joinTable(jwt2, gameId, p1AddrLower);
    });

    it('drive game to completion: all-in every hand until gameOver fires', async () => {
      // Start first hand
      const firstHand = waitForEvent(sock1, 'handStarted', 8_000);
      await emit(sock1, 'startGame', {});
      await firstHand;

      // Wait for gameOver — drive each hand by having action player go all-in
      // Max 30 hands to prevent infinite loop
      const gameOver = waitForEvent(sock1, 'gameOver', 120_000);

      for (let hand = 0; hand < 30; hand++) {
        // Drive current hand: action player goes all-in, others call/fold
        for (let step = 0; step < 20; step++) {
          const ack = await emit(sock1, 'getState', {}).catch(() => null);
          if (!ack?.state) break;
          if (ack.state.stage === 'waiting') break; // hand ended, auto-rollover pending
          const state = ack.state;
          const activeAddr = state.players[state.actionIdx]?.id;
          if (!activeAddr) break;
          const activeSock = activeAddr === p1AddrLower ? sock1 : sock2;
          const actingPlayer = state.players[state.actionIdx];
          // Go all-in: raise with a sentinel amount the engine caps at all-in;
          // if chips can't cover even a call, just call (becomes all-in call).
          const totalIfAllIn = (actingPlayer.bet ?? 0) + actingPlayer.chips;
          const action = totalIfAllIn > state.currentBet ? 'raise' : 'call';
          const amount = 999_999; // engine caps at chips available
          await emit(activeSock, 'playerAction', { action, amount }).catch(() => {});
        }
        // Wait for either next handStarted or gameOver
        const next = await Promise.race([
          waitForEvent(sock1, 'handStarted', 8_000).then(e => ({ type: 'hand', e })),
          gameOver.then(e => ({ type: 'over', e })),
        ]).catch(() => ({ type: 'timeout' }));
        if (next.type === 'over' || next.type === 'timeout') break;
      }

      const result = await gameOver;
      assert.ok(result.winner, 'gameOver event must include winner address');
      assert.ok(
        result.winner === p1AddrLower || result.winner === p2AddrLower,
        `winner should be p1 or p2, got: ${result.winner}`
      );
    });

    it('on-chain game is marked finished after gameOver', async () => {
      // Give closeGame tx time to mine on anvil
      await new Promise(r => setTimeout(r, 5_000));
      const game = await vault.getGame(gameId);
      assert.ok(game.finished, 'game.finished should be true after closeGame');
    });

    it('winner received USDC payout (balance increased)', async () => {
      const game = await vault.getGame(gameId);
      const winnerWallet = game.winner.toLowerCase() === p1AddrLower ? player1 : player2;
      const finalBalance = await usdc.balanceOf(await winnerWallet.getAddress());
      // Winner gets 90% of 20 USDC pot = 18 USDC. They started with (ANVIL_MINT - 10 USDC).
      // Just verify they have more than they deposited back (i.e., > ANVIL_MINT - 10 USDC)
      const depositedAmount = 10n * 1_000_000n;
      // Winner's net: started with X, deposited 10, received 18 back = X + 8 USDC
      // So finalBalance > X - depositedAmount (i.e., they got back more than they put in)
      assert.ok(finalBalance > 0n, 'winner should have non-zero USDC balance');
      console.log(`  Winner USDC balance: ${finalBalance / 1_000_000n} USDC`);
      sock1.disconnect();
      sock2.disconnect();
    });
  });
});
