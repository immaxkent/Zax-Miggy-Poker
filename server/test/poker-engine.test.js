/**
 * poker-engine.test.js
 *
 * Run: npm test  (from server/)
 * Uses Node's built-in test runner — no extra deps needed.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PokerTable,
  evaluateBest5,
  calculatePots,
  ProvablyFairDeck,
  cardToIndex,
} from '../src/poker-engine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(rank, suit) {
  return { rank, suit, index: cardToIndex(rank, suit) };
}

/** Create a table and seat n players, each starting with `chips`. */
function makeTable(numPlayers, chips = 1000, cfg = {}) {
  const table = new PokerTable({
    smallBlind: 5,
    bigBlind: 10,
    minBuyIn: 100,
    maxBuyIn: 10000,
    maxSeats: 9,
    minPlayers: 2,
    actionTimeoutSeconds: 30,
    ...cfg,
  }, 'test-table');
  for (let i = 0; i < numPlayers; i++) {
    table.sitDown({ id: `p${i}`, address: `p${i}`, chips });
  }
  return table;
}

/** Overwrite a player's hole cards after startHand() for deterministic showdown tests. */
function setHoleCards(table, playerIdx, c1, c2) {
  table.players[playerIdx].cards = [c1, c2];
}

/** Return the id of the player whose turn it is. */
function whoIsNext(table) {
  return table.players[table.actionIdx]?.id;
}

/** Act for every active player in sequence until the stage advances or maxIter reached. */
function checkAround(table) {
  const startStage = table.stage;
  let guard = 30;
  while (table.stage === startStage && guard-- > 0) {
    const p = table.players[table.actionIdx];
    if (!p) break;
    const action = p.bet < table.currentBet ? 'call' : 'check';
    table.applyAction(p.id, action);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hand Evaluator
// ─────────────────────────────────────────────────────────────────────────────

describe('Hand Evaluator', () => {
  test('Royal flush (A-K-Q-J-T suited)', () => {
    const hand = evaluateBest5([
      card('A','s'), card('K','s'), card('Q','s'), card('J','s'), card('T','s'),
      card('2','h'), card('3','d'),
    ]);
    assert.equal(hand.category, 9);
    assert.equal(hand.name, 'Royal Flush');
  });

  test('Straight flush beats four of a kind', () => {
    const sf = evaluateBest5([
      card('9','h'), card('8','h'), card('7','h'), card('6','h'), card('5','h'),
      card('A','s'), card('A','d'),
    ]);
    const quads = evaluateBest5([
      card('A','h'), card('A','c'), card('A','s'), card('A','d'), card('K','h'),
      card('2','c'), card('3','d'),
    ]);
    assert.equal(sf.category, 8);
    assert.equal(quads.category, 7);
    assert.ok(sf.category > quads.category);
  });

  test('Four of a kind beats full house', () => {
    const quads = evaluateBest5([
      card('K','h'), card('K','c'), card('K','s'), card('K','d'), card('2','h'),
      card('3','c'), card('4','d'),
    ]);
    const boat = evaluateBest5([
      card('A','h'), card('A','c'), card('A','s'), card('K','h'), card('K','c'),
      card('2','d'), card('3','h'),
    ]);
    assert.equal(quads.category, 7);
    assert.equal(boat.category, 6);
  });

  test('Full house beats flush', () => {
    const boat = evaluateBest5([
      card('T','h'), card('T','c'), card('T','s'), card('9','h'), card('9','c'),
      card('2','d'), card('3','s'),
    ]);
    const flush = evaluateBest5([
      card('A','h'), card('J','h'), card('9','h'), card('6','h'), card('2','h'),
      card('K','s'), card('Q','d'),
    ]);
    assert.equal(boat.category, 6);
    assert.equal(flush.category, 5);
  });

  test('Flush beats straight', () => {
    const flush = evaluateBest5([
      card('A','h'), card('J','h'), card('9','h'), card('6','h'), card('2','h'),
      card('K','s'), card('Q','d'),
    ]);
    const straight = evaluateBest5([
      card('9','s'), card('8','h'), card('7','d'), card('6','c'), card('5','s'),
      card('2','h'), card('3','d'),
    ]);
    assert.equal(flush.category, 5);
    assert.equal(straight.category, 4);
  });

  test('Straight beats three of a kind', () => {
    const straight = evaluateBest5([
      card('8','s'), card('7','h'), card('6','d'), card('5','c'), card('4','s'),
      card('2','h'), card('3','d'),
    ]);
    const trips = evaluateBest5([
      card('A','h'), card('A','c'), card('A','s'), card('K','h'), card('Q','c'),
      card('2','d'), card('3','s'),
    ]);
    assert.equal(straight.category, 4);
    assert.equal(trips.category, 3);
  });

  test('Three of a kind beats two pair', () => {
    const trips = evaluateBest5([
      card('Q','h'), card('Q','c'), card('Q','s'), card('K','h'), card('J','c'),
      card('2','d'), card('3','s'),
    ]);
    const twoPair = evaluateBest5([
      card('A','h'), card('A','c'), card('K','s'), card('K','h'), card('J','c'),
      card('2','d'), card('3','s'),
    ]);
    assert.equal(trips.category, 3);
    assert.equal(twoPair.category, 2);
  });

  test('Two pair beats one pair', () => {
    const twoPair = evaluateBest5([
      card('A','h'), card('A','c'), card('K','s'), card('K','h'), card('J','c'),
      card('2','d'), card('3','s'),
    ]);
    const onePair = evaluateBest5([
      card('A','h'), card('A','c'), card('K','s'), card('Q','h'), card('J','c'),
      card('2','d'), card('3','s'),
    ]);
    assert.equal(twoPair.category, 2);
    assert.equal(onePair.category, 1);
  });

  test('One pair beats high card', () => {
    const onePair = evaluateBest5([
      card('A','h'), card('A','c'), card('K','s'), card('Q','h'), card('J','c'),
      card('2','d'), card('3','s'),
    ]);
    const highCard = evaluateBest5([
      card('A','h'), card('K','c'), card('Q','s'), card('J','h'), card('9','c'),
      card('2','d'), card('3','s'),
    ]);
    assert.equal(onePair.category, 1);
    assert.equal(highCard.category, 0);
  });

  test('Wheel (A-2-3-4-5) is recognised as a straight', () => {
    const wheel = evaluateBest5([
      card('A','s'), card('2','h'), card('3','d'), card('4','c'), card('5','s'),
      card('K','h'), card('Q','d'),
    ]);
    assert.equal(wheel.category, 4);
    assert.equal(wheel.name, 'Straight');
  });

  test('Wheel (5-high) loses to 6-high straight', () => {
    const wheel = evaluateBest5([
      card('A','s'), card('2','h'), card('3','d'), card('4','c'), card('5','s'),
      card('K','h'), card('Q','d'),
    ]);
    const sixHigh = evaluateBest5([
      card('2','s'), card('3','h'), card('4','d'), card('5','c'), card('6','s'),
      card('K','h'), card('Q','d'),
    ]);
    // both straights; sixHigh kicker should be higher
    assert.equal(wheel.category, 4);
    assert.equal(sixHigh.category, 4);
    // sixHigh kickers[0] = 4 (index of 6), wheel straightHigh = 3 (index of 5)
    assert.ok(sixHigh.kickers[0] > wheel.kickers[0]);
  });

  test('Higher kicker breaks tie (pair of Aces, different kicker)', () => {
    // Cards chosen to avoid accidental straights/flushes
    const pairAceKing = evaluateBest5([
      card('A','h'), card('A','c'), card('K','s'), card('9','h'), card('3','d'),
      card('7','s'), card('J','c'),
    ]);
    const pairAceQueen = evaluateBest5([
      card('A','s'), card('A','d'), card('Q','s'), card('8','c'), card('3','h'),
      card('6','d'), card('T','c'),
    ]);
    assert.equal(pairAceKing.category, 1);
    assert.equal(pairAceQueen.category, 1);
    // King kicker (rank 11) beats Queen kicker (rank 10)
    assert.ok(pairAceKing.kickers[1] > pairAceQueen.kickers[1]);
  });

  test('Best 5 chosen correctly from 7 cards', () => {
    // Player has two pairs but community offers a flush — evaluator should pick flush
    const result = evaluateBest5([
      card('A','h'), card('A','c'),          // pair of aces (hole)
      card('K','h'), card('Q','h'), card('J','h'), card('T','h'), card('2','h'), // flush on board
    ]);
    // Best 5: A-K-Q-J-T of hearts = royal flush
    assert.equal(result.category, 9);
  });

  test('Tie correctly detected (identical best hands)', () => {
    // Both players would use the same 5 community cards
    const h1 = evaluateBest5([
      card('2','h'), card('3','c'),  // irrelevant hole cards
      card('A','s'), card('K','s'), card('Q','s'), card('J','s'), card('T','s'),
    ]);
    const h2 = evaluateBest5([
      card('4','h'), card('5','c'),  // also irrelevant
      card('A','s'), card('K','s'), card('Q','s'), card('J','s'), card('T','s'),
    ]);
    assert.equal(h1.category, h2.category);
    assert.deepEqual(h1.kickers, h2.kickers);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Side Pot Calculator
// ─────────────────────────────────────────────────────────────────────────────

describe('Side Pot Calculator', () => {
  test('No all-in: single pot, all players eligible', () => {
    const players = [
      { id: 'p0', totalBet: 100, folded: false },
      { id: 'p1', totalBet: 100, folded: false },
      { id: 'p2', totalBet: 100, folded: false },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 1);
    assert.equal(pots[0].amount, 300);
    assert.ok(pots[0].eligible.includes('p0'));
    assert.ok(pots[0].eligible.includes('p1'));
    assert.ok(pots[0].eligible.includes('p2'));
  });

  test('One all-in below others: main pot + side pot', () => {
    const players = [
      { id: 'p0', totalBet: 50,  folded: false }, // all-in short
      { id: 'p1', totalBet: 100, folded: false },
      { id: 'p2', totalBet: 100, folded: false },
    ];
    const pots = calculatePots(players);
    assert.equal(pots.length, 2);
    // Main pot: 50*3 = 150, all eligible
    assert.equal(pots[0].amount, 150);
    assert.ok(pots[0].eligible.includes('p0'));
    // Side pot: 50*2 = 100, only p1 and p2
    assert.equal(pots[1].amount, 100);
    assert.ok(!pots[1].eligible.includes('p0'));
    assert.ok(pots[1].eligible.includes('p1'));
    assert.ok(pots[1].eligible.includes('p2'));
  });

  test('Pot amounts sum to total chips committed', () => {
    const players = [
      { id: 'p0', totalBet: 30,  folded: false },
      { id: 'p1', totalBet: 80,  folded: false },
      { id: 'p2', totalBet: 100, folded: false },
    ];
    const pots = calculatePots(players);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    assert.equal(total, 30 + 80 + 100);
  });

  test('Folded players excluded from all pots', () => {
    const players = [
      { id: 'p0', totalBet: 100, folded: true  },
      { id: 'p1', totalBet: 100, folded: false },
      { id: 'p2', totalBet: 100, folded: false },
    ];
    const pots = calculatePots(players);
    pots.forEach(pot => {
      assert.ok(!pot.eligible.includes('p0'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Seat Management
// ─────────────────────────────────────────────────────────────────────────────

describe('Seat Management', () => {
  test('sitDown adds player and state reflects them', () => {
    const table = makeTable(0);
    table.sitDown({ id: 'p0', address: 'p0', chips: 500 });
    const state = table.toPublicState('p0');
    assert.equal(state.players.length, 1);
    assert.equal(state.players[0].id, 'p0');
    assert.equal(state.players[0].chips, 500);
  });

  test('sitDown throws when table is full', () => {
    const table = makeTable(9, 500, { maxSeats: 9 });
    assert.throws(() => table.sitDown({ id: 'extra', address: 'extra', chips: 500 }), /full/i);
  });

  test('sitDown throws if same player sits twice', () => {
    const table = makeTable(0);
    table.sitDown({ id: 'p0', address: 'p0', chips: 500 });
    assert.throws(() => table.sitDown({ id: 'p0', address: 'p0', chips: 500 }), /seated/i);
  });

  test('standUp removes player and returns chip count', () => {
    const table = makeTable(0);
    table.sitDown({ id: 'p0', address: 'p0', chips: 777 });
    const returned = table.standUp('p0');
    assert.equal(returned, 777);
    assert.equal(table.players.length, 0);
  });

  test('canStart false below minPlayers, true at minPlayers', () => {
    const table = makeTable(0, 500, { minPlayers: 2 });
    table.sitDown({ id: 'p0', address: 'p0', chips: 500 });
    assert.equal(table.canStart(), false);
    table.sitDown({ id: 'p1', address: 'p1', chips: 500 });
    assert.equal(table.canStart(), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Blinds & Dealer Rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('Blinds & Dealer Rotation', () => {
  test('3-player: dealer=0, SB=1, BB=2 on first hand', () => {
    const table = makeTable(3, 1000);
    const info = table.startHand();
    assert.equal(info.dealerIdx, 0);
    assert.equal(info.sbIdx, 1);
    assert.equal(info.bbIdx, 2);
  });

  test('SB and BB chip deductions correct', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    assert.equal(table.players[1].chips, 995); // SB posted 5
    assert.equal(table.players[2].chips, 990); // BB posted 10
  });

  test('Pot equals SB + BB after deal', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    assert.equal(table.pot, 15); // 5 + 10
  });

  test('Dealer rotates by 1 each hand', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    assert.equal(table.dealerIdx, 0);
    checkAround(table); // preflop
    checkAround(table); // flop
    checkAround(table); // turn
    checkAround(table); // river
    table.startHand();
    assert.equal(table.dealerIdx, 1);
  });

  test('Heads-up: dealer is SB (not BB)', () => {
    const table = makeTable(2, 1000);
    const info = table.startHand();
    // Dealer (p0) should post SB=5, other (p1) should post BB=10
    assert.equal(table.players[info.dealerIdx].chips, 995);
    assert.equal(table.players[(info.dealerIdx + 1) % 2].chips, 990);
  });

  test('Heads-up: preflop action starts with dealer (SB)', () => {
    const table = makeTable(2, 1000);
    const info = table.startHand();
    // SB/dealer acts first preflop in heads-up
    assert.equal(table.actionIdx, info.dealerIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pre-flop Action Order
// ─────────────────────────────────────────────────────────────────────────────

describe('Pre-flop Action Order', () => {
  test('3-player: action starts left of BB (UTG = p0)', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // dealer=0, sb=1, bb=2 → UTG = (2+1)%3 = 0
    assert.equal(whoIsNext(table), 'p0');
  });

  test('Acting out of turn throws', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // p0 is first to act, so p1 acting should throw
    assert.throws(() => table.applyAction('p1', 'call'), /not your turn/i);
  });

  test('BB gets option to raise when everyone limps', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // p0 calls, p1 calls, p2 (BB) should still have the option (still preflop)
    table.applyAction('p0', 'call');
    table.applyAction('p1', 'call');
    assert.equal(table.stage, 'preflop');
    assert.equal(whoIsNext(table), 'p2');
  });

  test('BB checking after limps advances to flop', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'call');
    table.applyAction('p1', 'call');
    table.applyAction('p2', 'check'); // BB checks → round over
    assert.equal(table.stage, 'flop');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Betting Actions
// ─────────────────────────────────────────────────────────────────────────────

describe('Betting Actions', () => {
  test('check succeeds when no bet outstanding', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // Advance to flop first (everyone calls preflop)
    checkAround(table);
    // On flop, first to act can check (currentBet = 0)
    const next = whoIsNext(table);
    assert.doesNotThrow(() => table.applyAction(next, 'check'));
  });

  test('check throws when there is an outstanding bet', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // p0 raises preflop
    table.applyAction('p0', 'raise', 30);
    // p1 tries to check when they owe 30 - current bet
    assert.throws(() => table.applyAction('p1', 'check'), /must call or raise/i);
  });

  test('call deducts correct amount from chips and adds to pot', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    const potBefore = table.pot;
    const chipsBefore = table.players[0].chips;
    table.applyAction('p0', 'call'); // call the BB (10), already put in 0
    assert.equal(table.players[0].chips, chipsBefore - 10);
    assert.equal(table.pot, potBefore + 10);
  });

  test('raise below minimum is rejected', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // currentBet = 10 (BB), min raise = 10 + 10 (bigBlind) = 20
    assert.throws(() => table.applyAction('p0', 'raise', 15), /min raise/i);
  });

  test('raise updates currentBet', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'raise', 30);
    assert.equal(table.currentBet, 30);
  });

  test('fold marks player folded and skips them', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'fold');
    assert.equal(table.players[0].folded, true);
    // Turn should skip p0
    assert.ok(whoIsNext(table) !== 'p0');
  });

  test('folding to one remaining player ends hand without showdown', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'fold');
    table.applyAction('p1', 'fold');
    // Only p2 left — hand should resolve immediately
    assert.equal(table.stage, 'waiting');
    assert.ok(table.pendingHandComplete !== null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Raise Reopens Action (Bug #4)
// ─────────────────────────────────────────────────────────────────────────────

describe('Raise reopens action', () => {
  test('player who called must act again after a raise', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // p0 calls, p1 calls, p2 (BB) raises
    table.applyAction('p0', 'call');
    table.applyAction('p1', 'call');
    table.applyAction('p2', 'raise', 30); // BB raises
    // p0 and p1 must act again — still preflop
    assert.equal(table.stage, 'preflop');
    assert.equal(whoIsNext(table), 'p0');
  });

  test('round ends correctly after re-action following a raise', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'call');
    table.applyAction('p1', 'call');
    table.applyAction('p2', 'raise', 30);
    table.applyAction('p0', 'call');
    table.applyAction('p1', 'call');
    // p2 already raised and everyone called — should advance to flop now
    assert.equal(table.stage, 'flop');
  });

  test('raiser does not get an extra unnecessary action', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'raise', 30); // p0 raises
    table.applyAction('p1', 'call');
    table.applyAction('p2', 'call');
    // Action should return to firstToAct (p0), and since everyone called, advance
    assert.equal(table.stage, 'flop');
  });

  test('post-flop raise reopens action correctly', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    checkAround(table); // complete preflop
    // Now on flop: p1 bets, p2 folds, p0 calls → over
    const first = whoIsNext(table);
    table.applyAction(first, 'check');
    const second = whoIsNext(table);
    table.applyAction(second, 'raise', 20);
    const third = whoIsNext(table);
    // first player must act again
    assert.equal(third, first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. All-In Scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('All-In Scenarios', () => {
  test('short-stack call goes all-in', () => {
    const table = makeTable(2, 1000);
    // Give p1 fewer chips than the raise
    table.players[1].chips = 8; // less than BB=10 they still need to pay
    table.startHand();
    // p0 is dealer/SB in heads-up; p1 posted BB but only had 8 chips
    // p1 should already be all-in from posting blind (chips < BB)
    assert.equal(table.players[1].allIn, true);
  });

  test('all-in player is skipped for subsequent action', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    // Force p1 all-in by giving them only enough for the blind they already posted
    table.players[1].chips = 0;
    table.players[1].allIn = true;
    table.applyAction('p0', 'call');
    // After p0 acts, next should be p2 (skipping all-in p1)
    assert.equal(whoIsNext(table), 'p2');
  });

  test('all remaining players all-in: hand runs to showdown without freezing (Bug #1)', () => {
    const table = makeTable(2, 1000);
    table.startHand();
    // Both go all-in
    table.applyAction(table.players[table.actionIdx].id, 'raise', 1000);
    table.applyAction(table.players[table.actionIdx].id, 'call');
    // Should reach showdown and resolve — not freeze
    assert.equal(table.stage, 'waiting');
    assert.ok(table.pendingHandComplete !== null);
    assert.equal(table.community.length, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Stage Transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('Stage Transitions', () => {
  test('preflop → flop deals 3 community cards', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    assert.equal(table.community.length, 0);
    checkAround(table);
    assert.equal(table.stage, 'flop');
    assert.equal(table.community.length, 3);
  });

  test('flop → turn deals 1 community card', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    checkAround(table); // preflop
    assert.equal(table.community.length, 3);
    checkAround(table); // flop
    assert.equal(table.stage, 'turn');
    assert.equal(table.community.length, 4);
  });

  test('turn → river deals 1 community card', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    checkAround(table); checkAround(table); checkAround(table); // pre→flop→turn
    assert.equal(table.community.length, 4);
    checkAround(table); // turn
    assert.equal(table.stage, 'river');
    assert.equal(table.community.length, 5);
  });

  test('bets reset to 0 at start of each new street', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'raise', 30);
    checkAround(table); // finish preflop
    assert.equal(table.stage, 'flop');
    table.players.forEach(p => {
      assert.equal(p.bet, 0, `${p.id} bet should be 0 at start of flop`);
    });
    assert.equal(table.currentBet, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Showdown & Winner Resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('Showdown & Winner Resolution', () => {
  test('best hand wins pot, chips credited', () => {
    const table = makeTable(2, 1000);
    table.startHand();

    // p0 gets a royal flush, p1 gets nothing special
    setHoleCards(table, 0, card('A','s'), card('K','s'));
    setHoleCards(table, 1, card('2','h'), card('7','d'));
    // Set community to complete royal flush for p0
    table.community = [card('Q','s'), card('J','s'), card('T','s'), card('3','c'), card('4','d')];
    table.stage = 'river';

    // Run river betting (both check)
    checkAround(table);

    assert.equal(table.stage, 'waiting');
    const result = table.pendingHandComplete;
    assert.ok(result !== null);
    assert.ok(result.results['p0'].won > 0);
    assert.equal(result.results['p1'].won, 0);
  });

  test('folded player wins nothing even with best cards', () => {
    const table = makeTable(3, 1000);
    table.startHand();

    // Give p0 a royal flush, but p0 folds immediately
    setHoleCards(table, 0, card('A','s'), card('K','s'));

    table.applyAction('p0', 'fold');
    checkAround(table); // finish preflop with p1 and p2

    // Run out remaining streets
    while (table.stage !== 'waiting') {
      checkAround(table);
    }

    const result = table.pendingHandComplete;
    assert.equal(result.results['p0'].won, 0);
  });

  test('tie: pot split equally between winners (Bug #2)', () => {
    const table = makeTable(2, 1000);
    table.startHand();

    // Give both players identical best hands — same board dominates
    setHoleCards(table, 0, card('2','h'), card('3','d')); // irrelevant
    setHoleCards(table, 1, card('2','c'), card('3','s')); // irrelevant
    // Board: royal flush — both players use board
    table.community = [card('A','s'), card('K','s'), card('Q','s'), card('J','s'), card('T','s')];
    table.stage = 'river';

    const totalPot = table.pot;
    checkAround(table);

    const result = table.pendingHandComplete;
    assert.ok(result !== null);
    // Both should win (split)
    assert.ok(result.results['p0'].won > 0, 'p0 should win their share');
    assert.ok(result.results['p1'].won > 0, 'p1 should win their share');
    assert.equal(result.results['p0'].won + result.results['p1'].won, totalPot);
  });

  test('pendingHandComplete contains community and holeCards', () => {
    const table = makeTable(2, 1000);
    table.startHand();
    while (table.stage !== 'waiting') checkAround(table);
    const result = table.pendingHandComplete;
    assert.ok(Array.isArray(result.community));
    assert.equal(result.community.length, 5);
    assert.ok(result.holeCards['p0']);
    assert.ok(result.holeCards['p1']);
  });

  test('stage resets to waiting after hand', () => {
    const table = makeTable(2, 1000);
    table.startHand();
    while (table.stage !== 'waiting') checkAround(table);
    assert.equal(table.stage, 'waiting');
  });

  test('chips conserved: total chips same before and after hand', () => {
    const table = makeTable(3, 1000);
    const totalBefore = table.players.reduce((s, p) => s + p.chips, 0);
    table.startHand();
    while (table.stage !== 'waiting') checkAround(table);
    const totalAfter = table.players.reduce((s, p) => s + p.chips, 0);
    assert.equal(totalAfter, totalBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Full Hand Integration
// ─────────────────────────────────────────────────────────────────────────────

describe('Full Hand Integration', () => {
  test('2-player hand completes preflop → showdown, chips conserved', () => {
    const table = makeTable(2, 1000);
    const totalBefore = table.players.reduce((s, p) => s + p.chips, 0);
    table.startHand();
    while (table.stage !== 'waiting') checkAround(table);
    const totalAfter = table.players.reduce((s, p) => s + p.chips, 0);
    assert.equal(totalAfter, totalBefore);
  });

  test('3-player: fold to one winner before showdown resolves correctly', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'fold');
    table.applyAction('p1', 'fold');
    // p2 wins uncontested
    assert.equal(table.stage, 'waiting');
    assert.ok(table.pendingHandComplete.results['p2'].won > 0);
    assert.equal(table.pendingHandComplete.results['p0'].won, 0);
    assert.equal(table.pendingHandComplete.results['p1'].won, 0);
  });

  test('multiple hands in sequence: dealer rotates, chips carry over', () => {
    const table = makeTable(3, 1000);

    table.startHand();
    assert.equal(table.dealerIdx, 0);
    while (table.stage !== 'waiting') checkAround(table);

    table.startHand();
    assert.equal(table.dealerIdx, 1);
    while (table.stage !== 'waiting') checkAround(table);

    table.startHand();
    assert.equal(table.dealerIdx, 2);
    while (table.stage !== 'waiting') checkAround(table);

    // Chips should still be conserved across all hands
    const total = table.players.reduce((s, p) => s + p.chips, 0);
    assert.equal(total, 3000);
  });

  test('hand with a raise forces re-action then completes cleanly', () => {
    const table = makeTable(3, 1000);
    table.startHand();
    table.applyAction('p0', 'raise', 30);
    table.applyAction('p1', 'call');
    table.applyAction('p2', 'call');
    assert.equal(table.stage, 'flop');
    while (table.stage !== 'waiting') checkAround(table);
    const total = table.players.reduce((s, p) => s + p.chips, 0);
    assert.equal(total, 3000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Provably Fair RNG
// ─────────────────────────────────────────────────────────────────────────────

describe('Provably Fair RNG', () => {
  test('same seed + nonce produces same shuffle', () => {
    const d1 = new ProvablyFairDeck('testseed');
    d1.setClientSeed('client1');
    d1.shuffle();

    const d2 = new ProvablyFairDeck('testseed');
    d2.setClientSeed('client1');
    d2.shuffle();

    assert.deepEqual(d1.cards.map(c => c.index), d2.cards.map(c => c.index));
  });

  test('different client seed produces different shuffle', () => {
    const d1 = new ProvablyFairDeck('testseed');
    d1.setClientSeed('client1');
    d1.shuffle();

    const d2 = new ProvablyFairDeck('testseed');
    d2.setClientSeed('client2');
    d2.shuffle();

    assert.notDeepEqual(d1.cards.map(c => c.index), d2.cards.map(c => c.index));
  });

  test('all 52 cards dealt exactly once (no duplicates)', () => {
    const deck = new ProvablyFairDeck('testseed');
    deck.setClientSeed('client1');
    deck.shuffle();

    const indices = deck.cards.map(c => c.index);
    const unique = new Set(indices);
    assert.equal(unique.size, 52);
    assert.equal(indices.length, 52);
  });

  test('SHA256(serverSeed) === serverHash', async () => {
    const { createHash } = await import('node:crypto');
    const deck = new ProvablyFairDeck('my-secret-seed');
    const info = deck.verifyInfo();
    const computed = createHash('sha256').update('my-secret-seed').digest('hex');
    assert.equal(info.serverHash, computed);
  });
});
