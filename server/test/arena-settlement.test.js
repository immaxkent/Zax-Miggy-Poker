import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toUtf8Bytes } from 'ethers';
import { hashArenaSettlement } from '../src/arena/settlement.js';

describe('arena settlement hash', () => {
  it('matches AgenticArenaTypes.t.sol sample payload', () => {
    const payload = {
      schemaVersion: 1n,
      gameId: 7n,
      tier: 1,
      handCount: 15n,
      startedAt: 100n,
      endedAt: 200n,
      tableConfigHash: '0x290decd9548b62a8d60345a98757389e825caede9bdddf2593f9af793be5748',
      handSummaryRoot: '0x7948d5a85ef1147e65786a08d34d6f4ef6d7a0c72e8424e6f712cb96f52f1a1e',
      nonce: 3n,
      players: [
        {
          bot: '0x000000000000000000000000000000000000000A',
          seat: 0,
          winner: true,
          handsWon: 5,
          chipsStart: 1000n,
          chipsEnd: 1200n,
          preGameScore: 500n,
        },
        {
          bot: '0x000000000000000000000000000000000000000B',
          seat: 1,
          winner: false,
          handsWon: 2,
          chipsStart: 1000n,
          chipsEnd: 800n,
          preGameScore: 600n,
        },
      ],
    };

    payload.tableConfigHash = keccak256(toUtf8Bytes('table'));
    payload.handSummaryRoot = keccak256(toUtf8Bytes('root'));

    const SAMPLE_SETTLEMENT_HASH =
      '0x178ac64e4871e08e48ba49d9b01efbaaa5dcd084ab3e85bf46c2a3cc2b855702';

    const hash = hashArenaSettlement(payload);
    assert.equal(hash, SAMPLE_SETTLEMENT_HASH);
    assert.equal(hash, hashArenaSettlement(payload));
  });

  it('changes when nonce changes', () => {
    const base = {
      schemaVersion: 1n,
      gameId: 1n,
      tier: 0,
      handCount: 1n,
      startedAt: 1n,
      endedAt: 2n,
      tableConfigHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      handSummaryRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      nonce: 1n,
      players: [
        {
          bot: '0x0000000000000000000000000000000000000001',
          seat: 0,
          winner: true,
          handsWon: 1,
          chipsStart: 1000n,
          chipsEnd: 1500n,
          preGameScore: 0n,
        },
        {
          bot: '0x0000000000000000000000000000000000000002',
          seat: 1,
          winner: false,
          handsWon: 0,
          chipsStart: 1000n,
          chipsEnd: 0n,
          preGameScore: 0n,
        },
      ],
    };
    const h1 = hashArenaSettlement(base);
    const h2 = hashArenaSettlement({ ...base, nonce: 2n });
    assert.notEqual(h1, h2);
  });
});
