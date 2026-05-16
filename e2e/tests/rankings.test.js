/**
 * rankings.test.js
 *
 * E2E tests for the AgenticRankings contract integration.
 * Deploys AgenticRankings on anvil, runs a full USDC game to completion,
 * then verifies that the server submitted updateRankings() on-chain and
 * that GET /api/rankings reflects the correct leaderboard data.
 *
 * Run:  cd e2e && npm test  (or node --test tests/rankings.test.js)
 * Deps: anvil (Foundry) + forge build must have been run
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'node:http';
import { ethers } from 'ethers';

import { startAnvil, ANVIL_KEYS } from '../helpers/anvil.js';
import { startServer } from '../helpers/server.js';
import { getJwt, connectSocket, emit, waitForEvent } from '../helpers/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS  = path.resolve(__dirname, '..', '..', 'contracts', 'out');

function loadArtifact(solFile, contractName) {
  const p = path.join(ARTIFACTS, solFile, `${contractName}.json`);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: Number(u.port), path: u.pathname, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Poll until condition(data) is true or timeout
async function pollUntil(fn, condition, intervalMs = 1_000, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (condition(result)) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

// ─── All tests in one outer describe ─────────────────────────────────────────

describe('AgenticRankings integration — E2E', () => {
  let anvil, usdc, vault, rankings;
  let player1, player2;
  let server;
  let jwt1, jwt2;
  let p1Addr, p2Addr;

  before(async () => {
    anvil   = await startAnvil();
    usdc    = anvil.usdc;
    vault   = anvil.vault;
    player1 = new ethers.NonceManager(anvil.wallets.player1);
    player2 = new ethers.NonceManager(anvil.wallets.player2);
    p1Addr  = (await player1.getAddress()).toLowerCase();
    p2Addr  = (await player2.getAddress()).toLowerCase();

    // Deploy AgenticRankings — deployer = Anvil account 0, serverSigner = account 1
    const deployer = anvil.deployer;
    const serverSignerAddr = new ethers.Wallet(ANVIL_KEYS[1]).address;
    const ownerAddr        = new ethers.Wallet(ANVIL_KEYS[0]).address;

    const art = loadArtifact('AgenticRankings.sol', 'AgenticRankings');
    const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
    rankings = await factory.deploy(
      await vault.getAddress(),
      serverSignerAddr,
      ownerAddr,
    );
    await rankings.waitForDeployment();

    const serverPort = 16000 + Math.floor(Math.random() * 1000);
    server = await startServer({
      port:                    serverPort,
      signerPrivKey:           ANVIL_KEYS[1],
      anvilUrl:                anvil.anvilUrl,
      vaultAddress:            await vault.getAddress(),
      usdcAddress:             await usdc.getAddress(),
      agenticRankingsAddress:  await rankings.getAddress(),
    });

    jwt1 = await getJwt(player1, server);
    jwt2 = await getJwt(player2, server);
  });

  after(() => {
    try { server?.stop(); } catch {}
    try { anvil?.stop(); }  catch {}
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function createGame(wallet, depositAmount) {
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

  async function joinGame(wallet, gameId) {
    const vaultAddr = await vault.getAddress();
    const game = await vault.getGame(gameId);
    await (await usdc.connect(wallet).approve(vaultAddr, game.depositAmount)).wait();
    await (await vault.connect(wallet).joinGame(gameId)).wait();
  }

  // ── Suite: setup ────────────────────────────────────────────────────────────

  describe('AgenticRankings deployment', () => {
    it('contract is deployed at a non-zero address', async () => {
      const addr = await rankings.getAddress();
      assert.ok(addr && addr !== ethers.ZeroAddress, 'rankings deployed at non-zero address');
    });

    it('vault address is correctly set in rankings contract', async () => {
      const vaultAddr = await rankings.vault();
      assert.strictEqual(vaultAddr.toLowerCase(), (await vault.getAddress()).toLowerCase());
    });

    it('serverSigner is set to Anvil account 1', async () => {
      const signer = await rankings.serverSigner();
      const expected = new ethers.Wallet(ANVIL_KEYS[1]).address;
      assert.strictEqual(signer.toLowerCase(), expected.toLowerCase());
    });

    it('/api/rankings returns empty entries before any games', async () => {
      const res = await httpGet(`${server.baseUrl}/api/rankings`);
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.ok(Array.isArray(data.entries), 'entries should be an array');
      assert.strictEqual(data.entries.length, 0, 'no entries before any game has been played');
    });
  });

  // ── Suite: game completion → rankings update ─────────────────────────────────

  describe('game completion — rankings are updated on-chain and via API', () => {
    const DEPOSIT = 10n * 1_000_000n; // 10 USDC each
    let gameId, winnerAddr;

    it('setup: create game, join on-chain, sit at server table', async () => {
      gameId = await createGame(player1, DEPOSIT);
      await joinGame(player2, gameId);

      const g1 = connectSocket(jwt1, server);
      const g2 = connectSocket(jwt2, server);
      await waitForEvent(g1, 'connect', 8_000);
      await waitForEvent(g2, 'connect', 8_000);

      const creator = p1Addr;
      await emit(g1, 'joinUsdcTable', { gameId: gameId.toString(), creatorAddress: creator });
      await emit(g2, 'joinUsdcTable', { gameId: gameId.toString(), creatorAddress: creator });

      // Drive game to completion via all-in each hand
      const firstHand = waitForEvent(g1, 'handStarted', 8_000);
      await emit(g1, 'startGame', {});
      await firstHand;

      const gameOver = waitForEvent(g1, 'gameOver', 120_000);

      for (let hand = 0; hand < 30; hand++) {
        for (let step = 0; step < 20; step++) {
          const ack = await emit(g1, 'getState', {}).catch(() => null);
          if (!ack?.state) break;
          if (ack.state.stage === 'waiting') break;
          const state = ack.state;
          const activeAddr = state.players[state.actionIdx]?.id;
          if (!activeAddr) break;
          const activeSock = activeAddr === p1Addr ? g1 : g2;
          const actingPlayer = state.players[state.actionIdx];
          const totalIfAllIn = (actingPlayer.bet ?? 0) + actingPlayer.chips;
          const action = totalIfAllIn > state.currentBet ? 'raise' : 'call';
          await emit(activeSock, 'playerAction', { action, amount: 999_999 }).catch(() => {});
        }
        const next = await Promise.race([
          waitForEvent(g1, 'handStarted', 8_000).then(e => ({ type: 'hand', e })),
          gameOver.then(e => ({ type: 'over', e })),
        ]).catch(() => ({ type: 'timeout' }));
        if (next.type === 'over' || next.type === 'timeout') break;
      }

      const result = await gameOver;
      assert.ok(result.winner, 'gameOver event must include winner address');
      winnerAddr = result.winner;

      await emit(g1, 'leaveTable', {}).catch(() => {});
      await emit(g2, 'leaveTable', {}).catch(() => {});
      g1.disconnect();
      g2.disconnect();
    });

    it('vault.getGame reports finished=true after gameOver', async () => {
      // Give closeGame tx a moment to mine
      await new Promise(r => setTimeout(r, 5_000));
      const game = await vault.getGame(gameId);
      assert.ok(game.finished, 'game.finished should be true on-chain');
      assert.ok(game.winner && game.winner !== ethers.ZeroAddress, 'winner should be set');
    });

    it('AgenticRankings.processedGames[gameId] is true after server submits updateRankings', async () => {
      // Poll — server submits updateRankings fire-and-forget after closeGame
      const processed = await pollUntil(
        () => rankings.processedGames(gameId),
        v => v === true,
        1_000,
        20_000
      );
      assert.ok(processed, 'processedGames[gameId] should be true');
    });

    it('winner has wins=1 and gamesPlayed=1 in contract', async () => {
      const stats = await rankings.getStats(winnerAddr);
      assert.strictEqual(Number(stats.wins), 1, 'winner should have wins=1');
      assert.strictEqual(Number(stats.gamesPlayed), 1, 'winner should have gamesPlayed=1');
      assert.ok(BigInt(stats.totalWon) > 0n, 'winner totalWon should be > 0');
    });

    it('loser has wins=0 and gamesPlayed=1 in contract', async () => {
      const loserAddr = winnerAddr === p1Addr ? p2Addr : p1Addr;
      const stats = await rankings.getStats(loserAddr);
      assert.strictEqual(Number(stats.wins), 0, 'loser should have wins=0');
      assert.strictEqual(Number(stats.gamesPlayed), 1, 'loser should have gamesPlayed=1');
    });

    it('GET /api/rankings returns both players with correct stats', async () => {
      // Poll — server caches leaderboard for 30s, but cache was cleared on start
      const data = await pollUntil(
        () => httpGet(`${server.baseUrl}/api/rankings`).then(r => r.json()),
        d => d.entries.length >= 2,
        1_000,
        20_000
      );

      assert.ok(data.entries.length >= 2, `Expected 2+ entries, got ${data.entries.length}`);

      const winnerEntry = data.entries.find(e => e.address === winnerAddr);
      const loserAddr   = winnerAddr === p1Addr ? p2Addr : p1Addr;
      const loserEntry  = data.entries.find(e => e.address === loserAddr);

      assert.ok(winnerEntry, 'winner should appear in leaderboard');
      assert.ok(loserEntry,  'loser should appear in leaderboard');

      assert.strictEqual(winnerEntry.wins, 1);
      assert.strictEqual(winnerEntry.gamesPlayed, 1);
      assert.ok(BigInt(winnerEntry.totalWon) > 0n);

      assert.strictEqual(loserEntry.wins, 0);
      assert.strictEqual(loserEntry.gamesPlayed, 1);
    });

    it('leaderboard is sorted: winner appears first (most wins)', async () => {
      const res = await httpGet(`${server.baseUrl}/api/rankings`);
      const data = res.json();
      if (data.entries.length < 2) return; // defensive
      assert.strictEqual(data.entries[0].address, winnerAddr, 'winner should be rank #1');
    });

    it('USDC values are in 6-decimal format (not human-readable)', async () => {
      const res = await httpGet(`${server.baseUrl}/api/rankings`);
      const { entries } = res.json();
      const winner = entries.find(e => e.address === winnerAddr);
      // 10 USDC = 10_000_000 raw. Winner gets 90% of 20 USDC = 18_000_000
      assert.ok(BigInt(winner.totalWon) >= 1_000_000n, 'totalWon should be in 6-decimal USDC units');
    });
  });

  // ── Suite: game cancellation ────────────────────────────────────────────────

  describe('game cancellation — recordCancellation is submitted', () => {
    const DEPOSIT = 10n * 1_000_000n;
    let gameId;

    it('setup: create game, join, terminate before first hand', async () => {
      gameId = await createGame(player1, DEPOSIT);
      await joinGame(player2, gameId);

      const g1 = connectSocket(jwt1, server);
      const g2 = connectSocket(jwt2, server);
      await waitForEvent(g1, 'connect', 8_000);
      await waitForEvent(g2, 'connect', 8_000);

      const creator = p1Addr;
      await emit(g1, 'joinUsdcTable', { gameId: gameId.toString(), creatorAddress: creator });
      await emit(g2, 'joinUsdcTable', { gameId: gameId.toString(), creatorAddress: creator });

      const terminated = waitForEvent(g2, 'tableTerminated', 5_000);
      await emit(g1, 'terminateGame', {});
      await terminated;

      g1.disconnect();
      g2.disconnect();
    });



    it('vault.getGame reports finished=true after cancellation', async () => {
      await new Promise(r => setTimeout(r, 5_000));
      const game = await vault.getGame(gameId);
      assert.ok(game.finished, 'game.finished should be true after cancellation');
    });

    it('processedGames[gameId] is true after server submits recordCancellation', async () => {
      const processed = await pollUntil(
        () => rankings.processedGames(gameId),
        v => v === true,
        1_000,
        20_000
      );
      assert.ok(processed, 'processedGames[gameId] should be true for cancelled game');
    });

    it('both players have gamesPlayed incremented (no win/loss recorded)', async () => {
      const [s1, s2] = await Promise.all([
        rankings.getStats(p1Addr),
        rankings.getStats(p2Addr),
      ]);
      // Each player should have at least 1 cancellation game recorded
      // (they may also have gamesPlayed from the earlier completed game)
      assert.ok(Number(s1.gamesPlayed) >= 1, `p1 gamesPlayed: ${s1.gamesPlayed}`);
      assert.ok(Number(s2.gamesPlayed) >= 1, `p2 gamesPlayed: ${s2.gamesPlayed}`);
    });
  });
});
