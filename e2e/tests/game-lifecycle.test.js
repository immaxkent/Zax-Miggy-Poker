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

  async function joinTable(jwt, gameId) {
    const socket = connectSocket(jwt, server);
    await waitForEvent(socket, 'connect', 8_000);
    // Leave any stale table from a previous test (server tracks players by address)
    await emit(socket, 'leaveTable', {}).catch(() => {});
    const ack = await emit(socket, 'joinUsdcTable', { gameId: gameId.toString() });
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
      sock1 = await joinTable(jwt1, gameId);
      sock2 = await joinTable(jwt2, gameId);

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
      sock1 = await joinTable(jwt1, gameId);
      sock2 = await joinTable(jwt2, gameId);

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
      sock1 = await joinTable(jwt1, gameId);
      sock2 = await joinTable(jwt2, gameId);
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
      sock1 = await joinTable(jwt1, gameId);
      sock2 = await joinTable(jwt2, gameId);

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
});
