/**
 * arena-lifecycle.test.js — Agentic Arena E2E on anvil.
 * Run: cd e2e && npm run test:arena
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { startAnvil, ANVIL_KEYS } from '../helpers/anvil.js';
import { httpGet } from '../helpers/http.js';
import { startServer } from '../helpers/server.js';
import { getJwt, connectSocket, emit, waitForEvent } from '../helpers/auth.js';
import {
  deployArenaStack,
  arenaCreateBot,
  arenaCreateGame,
  arenaJoinGame,
} from '../helpers/arena.js';

describe('Agentic Arena — E2E (anvil)', () => {
  let anvil;
  let stack;
  let server;
  let owner1;
  let owner2;
  let jwt1;
  let jwt2;
  let bot1;
  let bot2;
  let gameId;

  before(async () => {
    anvil = await startAnvil();
    owner1 = new ethers.NonceManager(anvil.wallets.player1);
    owner2 = new ethers.NonceManager(anvil.wallets.player2);

    stack = await deployArenaStack(anvil);

    const port = 15000 + Math.floor(Math.random() * 1000);
    server = await startServer({
      port,
      signerPrivKey: ANVIL_KEYS[1],
      anvilUrl: anvil.anvilUrl,
      usdcAddress: await anvil.usdc.getAddress(),
      arena: {
        arenaAddress: await stack.arena.getAddress(),
        botFactoryAddress: await stack.factory.getAddress(),
        rankingsV2Address: await stack.rankings.getAddress(),
        chips1155Address: await stack.chips.getAddress(),
      },
    });

    jwt1 = await getJwt(owner1, server);
    jwt2 = await getJwt(owner2, server);

    bot1 = await arenaCreateBot(owner1, stack.arena, anvil.usdc, 'ipfs://e2e/bot1');
    bot2 = await arenaCreateBot(owner2, stack.arena, anvil.usdc, 'ipfs://e2e/bot2');
    gameId = await arenaCreateGame(owner1, stack.arena, anvil.usdc, bot1, 0);
    await arenaJoinGame(owner2, stack.arena, anvil.usdc, gameId, bot2, 0);
  });

  after(() => {
    try { server?.stop(); } catch {}
    try { anvil?.stop(); } catch {}
  });

  async function joinArena(jwt, bot) {
    const socket = connectSocket(jwt, server);
    await waitForEvent(socket, 'connect', 8_000);
    await emit(socket, 'leaveTable', {}).catch(() => {});
    const ack = await emit(socket, 'joinArenaTable', {
      gameId: gameId.toString(),
      tier: 'unranked',
      botAddress: bot.toLowerCase(),
    });
    assert.ok(ack?.state, `joinArenaTable failed: ${ack?.error || 'no state'}`);
    assert.equal(ack.mode, 'arena');
    return socket;
  }

  it('health + arena status', async () => {
    const health = await httpGet(`${server.baseUrl}/health`);
    assert.equal(health.status, 200);
    const h = health.json();
    assert.equal(h.arenaEnabled, true);
    assert.equal(h.dbBackend, 'memory');

    const status = await httpGet(`${server.baseUrl}/api/arena/status`);
    assert.equal(status.status, 200);
    const s = status.json();
    assert.equal(s.enabled, true);
    assert.ok(s.contracts?.arena);
  });

  it('full flow: join → start → gameOver → settleGame (no vault)', async () => {
    const sock1 = await joinArena(jwt1, bot1);
    const sock2 = await joinArena(jwt2, bot2);
    const p1 = (await owner1.getAddress()).toLowerCase();

    const handStarted = waitForEvent(sock1, 'handStarted', 10_000);
    const startAck = await emit(sock1, 'startGame', {});
    assert.ok(!startAck?.error, `startGame: ${startAck?.error}`);
    await handStarted;

    const gameOver = waitForEvent(sock1, 'gameOver', 120_000);

    for (let hand = 0; hand < 30; hand++) {
      for (let step = 0; step < 20; step++) {
        const ack = await emit(sock1, 'getState', {}).catch(() => null);
        if (!ack?.state || ack.state.stage === 'waiting') break;
        const state = ack.state;
        const activeAddr = state.players[state.actionIdx]?.id?.toLowerCase();
        if (!activeAddr) break;
        const activeSock = activeAddr === p1 ? sock1 : sock2;
        const acting = state.players[state.actionIdx];
        const totalIfAllIn = (acting.bet ?? 0) + acting.chips;
        const action = totalIfAllIn > state.currentBet ? 'raise' : 'call';
        await emit(activeSock, 'playerAction', { action, amount: 999_999 }).catch(() => {});
      }
      const next = await Promise.race([
        waitForEvent(sock1, 'handStarted', 8_000).then(() => 'hand'),
        gameOver.then(() => 'over'),
      ]).catch(() => 'timeout');
      if (next === 'over' || next === 'timeout') break;
    }

    const over = await gameOver;
    assert.equal(over.mode, 'arena');
    assert.ok(over.winner);

    await new Promise((r) => setTimeout(r, 5_000));

    const tokenId = await stack.chips.gameTokenId(gameId, 0);
    assert.equal(await stack.chips.balanceOf(bot1, tokenId), 0n);
    assert.equal(await stack.chips.balanceOf(bot2, tokenId), 0n);

    const vg = await anvil.vault.getGame(gameId);
    assert.equal(Number(vg.playerCount), 0);
    assert.equal(vg.finished, false);

    sock1.disconnect();
    sock2.disconnect();
  });
});
