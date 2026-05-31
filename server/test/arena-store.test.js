import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryArenaStore } from '../src/db/memory-arena-store.js';
import { tierFromPayload, onArenaTableJoin, onArenaGameOver } from '../src/arena/lifecycle.js';
import { PokerTable } from '../src/poker-engine.js';

describe('arena store (memory)', () => {
  it('tierFromPayload maps strings and numbers', () => {
    assert.equal(tierFromPayload('unranked'), 0);
    assert.equal(tierFromPayload('ranked'), 1);
    assert.equal(tierFromPayload('elite'), 2);
    assert.equal(tierFromPayload(2), 2);
  });

  it('createGame, join, finalize updates bot profile', async () => {
    const tableId = 'arena-42';
    const botA = '0x00000000000000000000000000000000000000A1';
    const botB = '0x00000000000000000000000000000000000000B2';
    const ownerA = '0x0000000000000000000000000000000000000AA1';
    const ownerB = '0x0000000000000000000000000000000000000BB2';

    await memoryArenaStore.upsertBot({
      botAddress: botA,
      ownerAddress: ownerA,
    });
    await memoryArenaStore.upsertBot({
      botAddress: botB,
      ownerAddress: ownerB,
    });

    await onArenaTableJoin({
      tableId,
      gameId: 42,
      tier: 'ranked',
      botAddress: botA,
      ownerAddress: ownerA,
      chipsStart: 1000,
    });
    await memoryArenaStore.addParticipant({ tableId, botAddress: botB, chipsStart: 1000 });

    const table = new PokerTable({
      name: 'Arena',
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 200,
      maxBuyIn: 1000,
      maxSeats: 6,
      minPlayers: 2,
    }, tableId);
    table.sitDown({ id: botA, address: botA, chips: 1500 });
    table.sitDown({ id: botB, address: botB, chips: 0 });
    table.players[0].startChips = 1000;
    table.players[1].startChips = 1000;
    table.handNumber = 5;

    await onArenaGameOver(table, tableId);

    const profile = await memoryArenaStore.getBotProfile(botA);
    assert.ok(profile);
    assert.equal(profile.games_played, 1);
    assert.equal(profile.games_won, 1);
    assert.equal(profile.ranked_games, 1);

    const game = await memoryArenaStore.getGameByTableId(tableId);
    assert.equal(game.status, 'settled');
  });

  it('listOpenGames filters by tier', async () => {
    await memoryArenaStore.createGame({
      onChainGameId: 1,
      tableId: 'arena-1',
      tier: 0,
      settingsHash: null,
    });
    await memoryArenaStore.createGame({
      onChainGameId: 2,
      tableId: 'arena-2',
      tier: 1,
      settingsHash: null,
    });
    const ranked = await memoryArenaStore.listOpenGames({ tier: 1 });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].table_id, 'arena-2');
  });
});
