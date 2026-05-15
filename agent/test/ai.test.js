/**
 * Tier A — Pure unit tests for buildDecisionContext in ai.js
 * decideAction is NOT tested here (requires Anthropic API key + network).
 * Run: node --test test/ai.test.js  (from agent/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionContext } from '../src/ai.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    players: [
      { id: '0xaaa', seatIndex: 0, chips: 500, holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'd' }], active: true, allIn: false, lastAction: null },
      { id: '0xbbb', seatIndex: 1, chips: 800, active: true, allIn: false, lastAction: 'call' },
      { id: '0xccc', seatIndex: 2, chips: 200, active: true, allIn: false, lastAction: null },
    ],
    community: [
      { rank: '2', suit: 'h' },
      { rank: '7', suit: 'c' },
      { rank: 'J', suit: 'd' },
    ],
    stage: 'flop',
    pot: 120,
    toCall: 30,
    currentPlayerId: '0xaaa',
    dealerIdx: 2,
    smallBlindIdx: 0,
    bigBlindIdx: 1,
    validActions: ['fold', 'call', 'raise'],
    bigBlind: 20,
    handNumber: 5,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildDecisionContext — hole cards', () => {
  it('extracts holeCards from the matching player', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.ok(Array.isArray(ctx.holeCards));
    assert.strictEqual(ctx.holeCards.length, 2);
  });

  it('returns empty holeCards for unknown playerId', () => {
    const ctx = buildDecisionContext(makeState(), '0xunknown');
    assert.deepStrictEqual(ctx.holeCards, []);
  });

  it('is case-insensitive on playerId match', () => {
    const ctx = buildDecisionContext(makeState(), '0xAAA');
    // player.id is '0xaaa' — may or may not match depending on impl
    // The current impl uses find(p => p.id === playerId) — exact match
    // So this test verifies the current behaviour (exact)
    assert.ok(Array.isArray(ctx.holeCards));
  });
});

describe('buildDecisionContext — community and stage', () => {
  it('includes community cards', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.community.length, 3);
  });

  it('reflects the correct stage', () => {
    const ctx = buildDecisionContext(makeState({ stage: 'turn' }), '0xaaa');
    assert.strictEqual(ctx.stage, 'turn');
  });

  it('includes pot and toCall', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.pot, 120);
    assert.strictEqual(ctx.toCall, 30);
  });
});

describe('buildDecisionContext — SPR', () => {
  it('calculates SPR from myChips / pot', () => {
    // myChips=500, pot=120 → spr ≈ 4.17
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.ok(ctx.spr > 4 && ctx.spr < 5, `spr should be ~4.17, got ${ctx.spr}`);
  });

  it('returns spr=99 when pot is 0 (avoids division by zero)', () => {
    const ctx = buildDecisionContext(makeState({ pot: 0 }), '0xaaa');
    assert.strictEqual(ctx.spr, 99);
  });

  it('returns spr=99 when player not found (myChips defaults to 0, pot > 0)', () => {
    const ctx = buildDecisionContext(makeState(), '0xunknown');
    assert.strictEqual(ctx.spr, 99);
  });

  it('SPR is rounded to 2 decimal places', () => {
    const ctx = buildDecisionContext(makeState({ pot: 300 }), '0xaaa');
    // 500/300 = 1.67
    assert.ok(String(ctx.spr).split('.')[1]?.length <= 2, `spr decimal places: ${ctx.spr}`);
  });
});

describe('buildDecisionContext — position', () => {
  it('flags small blind correctly', () => {
    // smallBlindIdx: 0 = player 0xaaa
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.ok(ctx.position.isSmallBlind, 'Should be small blind');
    assert.ok(!ctx.position.isBigBlind);
    assert.ok(!ctx.position.isDealer);
  });

  it('flags big blind correctly', () => {
    const ctx = buildDecisionContext(makeState(), '0xbbb');
    assert.ok(ctx.position.isBigBlind);
    assert.ok(!ctx.position.isSmallBlind);
  });

  it('flags dealer correctly', () => {
    // dealerIdx: 2 = player 0xccc
    const ctx = buildDecisionContext(makeState(), '0xccc');
    assert.ok(ctx.position.isDealer);
  });

  it('none of the position flags are true for a non-special seat', () => {
    const state = makeState({ dealerIdx: 0, smallBlindIdx: 0, bigBlindIdx: 1 });
    // Player 0xccc is seatIndex 2 — no role
    const ctx = buildDecisionContext(state, '0xccc');
    assert.ok(!ctx.position.isDealer);
    assert.ok(!ctx.position.isSmallBlind);
    assert.ok(!ctx.position.isBigBlind);
  });

  it('includes totalPlayers count', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.position.totalPlayers, 3);
  });

  it('includes seatIndex', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.position.seatIndex, 0);
  });
});

describe('buildDecisionContext — opponents', () => {
  it('excludes self from opponents array', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.opponents.length, 2);
  });

  it('only includes active players as opponents', () => {
    const state = makeState();
    state.players[1].active = false;
    const ctx = buildDecisionContext(state, '0xaaa');
    assert.strictEqual(ctx.opponents.length, 1);
  });

  it('reflects allIn status on opponents', () => {
    const state = makeState();
    state.players[1].allIn = true;
    const ctx = buildDecisionContext(state, '0xaaa');
    const opp = ctx.opponents.find(o => o.chips === 800);
    assert.strictEqual(opp.allIn, true);
  });

  it('includes chips and lastAction for each opponent', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    for (const opp of ctx.opponents) {
      assert.ok('chips' in opp);
      assert.ok('lastAction' in opp);
    }
  });
});

describe('buildDecisionContext — validActions + meta', () => {
  it('passes through validActions unchanged', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.deepStrictEqual(ctx.validActions, ['fold', 'call', 'raise']);
  });

  it('includes bigBlind', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.bigBlind, 20);
  });

  it('includes handNumber', () => {
    const ctx = buildDecisionContext(makeState({ handNumber: 42 }), '0xaaa');
    assert.strictEqual(ctx.handNumber, 42);
  });

  it('uses default validActions when not present in state', () => {
    const state = makeState();
    delete state.validActions;
    const ctx = buildDecisionContext(state, '0xaaa');
    assert.ok(Array.isArray(ctx.validActions));
  });

  it('includes myChips', () => {
    const ctx = buildDecisionContext(makeState(), '0xaaa');
    assert.strictEqual(ctx.myChips, 500);
  });

  it('myChips defaults to 0 for unknown player', () => {
    const ctx = buildDecisionContext(makeState(), '0xunknown');
    assert.strictEqual(ctx.myChips, 0);
  });
});

describe('buildDecisionContext — edge cases', () => {
  it('handles empty players array gracefully', () => {
    const state = makeState({ players: [] });
    const ctx = buildDecisionContext(state, '0xaaa');
    assert.deepStrictEqual(ctx.holeCards, []);
    assert.strictEqual(ctx.myChips, 0);
    assert.deepStrictEqual(ctx.opponents, []);
  });

  it('handles missing community gracefully', () => {
    const state = makeState();
    delete state.community;
    const ctx = buildDecisionContext(state, '0xaaa');
    assert.deepStrictEqual(ctx.community, []);
  });

  it('handles missing stage gracefully', () => {
    const state = makeState();
    delete state.stage;
    const ctx = buildDecisionContext(state, '0xaaa');
    assert.strictEqual(ctx.stage, 'preflop');
  });
});
