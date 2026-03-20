/**
 * poker-engine.js
 *
 * Complete Texas Hold'em engine:
 *  - Deck, dealing, community cards
 *  - Betting rounds (preflop → flop → turn → river → showdown)
 *  - Hand evaluation (7-card best-5)
 *  - Side pot calculation
 *  - Provably fair commit/reveal RNG
 */

import crypto from 'crypto';

// ─── Card constants ───────────────────────────────────────────────────────────
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['s','h','d','c']; // spades, hearts, diamonds, clubs

export function cardToIndex(rank, suit) {
  return RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit);
}

export function indexToCard(i) {
  return { rank: RANKS[Math.floor(i / 4)], suit: SUITS[i % 4], index: i };
}

// ─── Provably Fair RNG ────────────────────────────────────────────────────────
export class ProvablyFairDeck {
  constructor(serverSeed) {
    this.serverSeed   = serverSeed   || crypto.randomBytes(32).toString('hex');
    this.serverHash   = crypto.createHash('sha256').update(this.serverSeed).digest('hex');
    this.clientSeed   = null;
    this.shuffleNonce = 0;
  }

  setClientSeed(seed) { this.clientSeed = seed; }

  /** Returns ordered deck indices 0-51 using Fisher-Yates + deterministic PRNG */
  shuffle() {
    const combined = `${this.serverSeed}:${this.clientSeed || ''}:${this.shuffleNonce++}`;
    const hash     = crypto.createHash('sha256').update(combined).digest('hex');

    const deck = Array.from({ length: 52 }, (_, i) => i);
    let   seed = BigInt('0x' + hash);

    for (let i = 51; i > 0; i--) {
      const j = Number(seed % BigInt(i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
      seed = (seed >> 8n) | ((seed & 0xFFn) << 248n); // rotate
    }

    this.cards = deck.map(indexToCard);
    this.dealt = 0;
    return this;
  }

  deal() { return this.cards[this.dealt++]; }

  verifyInfo() {
    return {
      serverHash:   this.serverHash,
      serverSeed:   this.serverSeed, // revealed at showdown
      clientSeed:   this.clientSeed,
      shuffleNonce: this.shuffleNonce - 1,
    };
  }
}

// ─── Hand Evaluator ───────────────────────────────────────────────────────────
// Returns { rank, name, cards } where rank is higher = better

const HAND_NAMES = [
  'High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind',
  'Straight Flush','Royal Flush'
];

function rankValue(r) { return RANKS.indexOf(r); }

export function evaluateBest5(sevenCards) {
  let best = null;

  // Generate all C(7,5) = 21 combinations
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five = sevenCards.filter((_, k) => k !== i && k !== j);
      const score = evaluate5(five);
      if (!best || compareScores(score, best) > 0) {
        best = score;
      }
    }
  }
  return best;
}

function evaluate5(cards) {
  const ranks  = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);
  const suits  = cards.map(c => c.suit);
  const isFlush = new Set(suits).size === 1;

  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const groups = Object.entries(rankCounts)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([r, c]) => ({ rank: Number(r), count: c }));

  // Straight check (including A-2-3-4-5 wheel)
  let isStraight = false;
  let straightHigh = ranks[0];
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) {
      isStraight = true;
    } else if (ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0) {
      // Wheel
      isStraight = true;
      straightHigh = 3;
    }
  }

  const category = (isFlush && isStraight) ? (straightHigh === 12 ? 9 : 8)
    : groups[0].count === 4 ? 7
    : groups[0].count === 3 && groups[1].count === 2 ? 6
    : isFlush    ? 5
    : isStraight ? 4
    : groups[0].count === 3 ? 3
    : groups[0].count === 2 && groups[1].count === 2 ? 2
    : groups[0].count === 2 ? 1
    : 0;

  return {
    category,
    name:     HAND_NAMES[category],
    kickers:  groups.map(g => g.rank),
    cards,
  };
}

function compareScores(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const d = (a.kickers[i] || -1) - (b.kickers[i] || -1);
    if (d !== 0) return d;
  }
  return 0;
}

// ─── Side Pot Calculator ──────────────────────────────────────────────────────
export function calculatePots(players) {
  // players: [{ id, totalBet, folded }]
  const sorted  = [...players].sort((a, b) => a.totalBet - b.totalBet);
  const pots    = [];
  let   covered = 0;

  for (let i = 0; i < sorted.length; i++) {
    const level = sorted[i].totalBet;
    if (level <= covered) continue;
    const contribution = level - covered;
    const pot = {
      amount:     contribution * sorted.length,
      eligible:   players.filter(p => !p.folded && p.totalBet >= level).map(p => p.id),
    };
    // Adjust for players who are in but bet less
    pot.amount = players.reduce((sum, p) => sum + Math.min(p.totalBet, level) - covered, 0);
    pots.push(pot);
    covered = level;
  }

  return pots;
}

// ─── Game State Machine ───────────────────────────────────────────────────────
export const STAGES = ['waiting','preflop','flop','turn','river','showdown'];

export class PokerTable {
  constructor(tableConfig, tableId) {
    this.id         = tableId;
    this.config     = tableConfig;
    this.stage      = 'waiting';
    this.players    = [];    // [{ id, address, chips, cards, bet, totalBet, folded, allIn, connected }]
    this.community  = [];
    this.pot        = 0;
    this.currentBet = 0;
    this.dealerIdx  = -1;
    this.actionIdx  = -1;
    this.handNumber = 0;
    this.deck       = null;
    this.history    = [];    // hand history for this table
    this.firstToActIdx = -1; // first to act this betting round (must get back to them to end round)
  }

  // ── Seat management ─────────────────────────────────────────────────────────
  canSit()     { return this.players.length < this.config.maxSeats; }
  canStart()   { return this.players.length >= this.config.minPlayers; }
  activePlayers() { return this.players.filter(p => !p.folded && !p.sitOut); }

  sitDown(player) {
    if (!this.canSit()) throw new Error('Table full');
    if (this.players.find(p => p.id === player.id)) throw new Error('Already seated');
    this.players.push({
      id:         player.id,
      address:    player.address,
      chips:      player.chips,
      cards:      [],
      bet:        0,
      totalBet:   0,
      folded:     false,
      allIn:      false,
      sitOut:     false,
      connected:  true,
    });
    return this.toPublicState(player.id);
  }

  standUp(playerId) {
    const id = (playerId || '').toLowerCase();
    const idx = this.players.findIndex(p => (p.id || '').toLowerCase() === id);
    if (idx === -1) return 0;
    const chips = this.players[idx].chips;
    this.players.splice(idx, 1);
    return chips; // return remaining chips to player account
  }

  // ── Hand lifecycle ──────────────────────────────────────────────────────────
  startHand(clientSeed) {
    if (!this.canStart()) throw new Error('Not enough players');
    if (this.stage !== 'waiting') throw new Error('Hand in progress');

    this.handNumber++;
    this.stage      = 'preflop';
    this.community  = [];
    this.pot        = 0;
    this.currentBet = 0;

    // Reset player hand state
    this.players.forEach(p => {
      p.cards    = [];
      p.bet      = 0;
      p.totalBet = 0;
      p.folded   = false;
      p.allIn    = false;
    });

    // Rotate dealer
    this.dealerIdx  = (this.dealerIdx + 1) % this.players.length;
    const sbIdx     = (this.dealerIdx + 1) % this.players.length;
    const bbIdx     = (this.dealerIdx + 2) % this.players.length;

    // Shuffle
    this.deck = new ProvablyFairDeck();
    this.deck.setClientSeed(clientSeed || crypto.randomBytes(16).toString('hex'));
    this.deck.shuffle();

    // Deal 2 hole cards each
    for (let r = 0; r < 2; r++) {
      for (let p = 0; p < this.players.length; p++) {
        this.players[p].cards.push(this.deck.deal());
      }
    }

    // Post blinds
    this._postBlind(sbIdx, this.config.smallBlind);
    this._postBlind(bbIdx, this.config.bigBlind);
    this.currentBet = this.config.bigBlind;

    // Action starts left of BB (or UTG heads-up = dealer)
    this.actionIdx = (bbIdx + 1) % this.players.length;
    this.firstToActIdx = this.actionIdx; // so we only end preflop when action returns to UTG and all have matched

    return {
      handNumber:  this.handNumber,
      dealerIdx:   this.dealerIdx,
      sbIdx,
      bbIdx,
      serverHash:  this.deck.serverHash, // Commit before reveal
    };
  }

  _postBlind(idx, amount) {
    const p   = this.players[idx];
    const bet = Math.min(amount, p.chips);
    p.chips   -= bet;
    p.bet     += bet;
    p.totalBet += bet;
    p.allIn    = p.chips === 0;
    this.pot  += bet;
  }

  // ── Player actions ──────────────────────────────────────────────────────────
  // Rule: every player still in the hand must have a chance to act each betting round.
  // We only advance to the next street when (1) everyone has matched the current bet (or folded/all-in),
  // and (2) action has returned to the first-to-act (so everyone has had at least one turn).
  applyAction(playerId, action, amount = 0) {
    const id = (playerId || '').toLowerCase();
    const pIdx  = this.players.findIndex(p => (p.id || '').toLowerCase() === id);
    if (pIdx !== this.actionIdx) throw new Error('Not your turn');

    const p     = this.players[pIdx];
    if (p.folded) throw new Error('Already folded');

    switch (action) {
      case 'fold':
        p.folded = true;
        break;

      case 'check':
        if (p.bet < this.currentBet) throw new Error('Must call or raise');
        break;

      case 'call': {
        const toCall = Math.min(this.currentBet - p.bet, p.chips);
        p.chips   -= toCall;
        p.bet     += toCall;
        p.totalBet += toCall;
        p.allIn    = p.chips === 0;
        this.pot  += toCall;
        break;
      }

      case 'raise': {
        const minRaise = this.currentBet + this.config.bigBlind;
        if (amount < minRaise) throw new Error(`Min raise is ${minRaise}`);
        const toRaise = Math.min(amount - p.bet, p.chips);
        p.chips   -= toRaise;
        p.bet     += toRaise;
        p.totalBet += toRaise;
        p.allIn    = p.chips === 0;
        this.currentBet = p.bet;
        this.pot  += toRaise;
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Advance action pointer
    this._advanceAction();
    return this.toPublicState(playerId);
  }

  _advanceAction() {
    // "Active" = can still act this round (not folded, not all-in)
    const active = this.players.filter(p => !p.folded && !p.allIn);
    const roundComplete = this._bettingRoundComplete();

    // Everyone else folded → advance to next street
    if (active.length <= 1 && roundComplete) {
      console.log(`[_advanceAction] at most one active and round complete, advancing stage`);
      this._nextStage();
      return;
    }
    // One player can still act (e.g. one all-in, one not) — give turn to that player
    if (active.length <= 1) {
      const onlyActive = this.players.findIndex(p => !p.folded && !p.allIn);
      if (onlyActive >= 0) {
        console.log(`[_advanceAction] one active player (${onlyActive}), giving them the turn`);
        this.actionIdx = onlyActive;
      }
      return;
    }

    // Multiple active: move to next player. End round only when everyone has matched AND action has returned to first-to-act (everyone had input).
    let next = (this.actionIdx + 1) % this.players.length;
    while (this.players[next].folded || this.players[next].allIn) {
      next = (next + 1) % this.players.length;
    }
    const backToFirst = next === this.firstToActIdx;
    if (roundComplete && backToFirst) {
      console.log(`[_advanceAction] round complete, back to firstToAct=${this.firstToActIdx}, advancing stage`);
      this._nextStage();
    } else {
      console.log(`[_advanceAction] next=${next} (firstToAct=${this.firstToActIdx}, roundComplete=${roundComplete}), giving turn to player ${next}`);
      this.actionIdx = next;
    }
  }

  _bettingRoundComplete() {
    return this.players
      .filter(p => !p.folded && !p.allIn)
      .every(p => p.bet === this.currentBet);
  }

  _nextStage() {
    // Reset bets for new round
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;

    const stageOrder = ['preflop','flop','turn','river','showdown'];
    const nextIdx    = stageOrder.indexOf(this.stage) + 1;
    this.stage       = stageOrder[nextIdx] || 'showdown';

    switch (this.stage) {
      case 'flop':
        this.community.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
        break;
      case 'turn':
        this.community.push(this.deck.deal());
        break;
      case 'river':
        this.community.push(this.deck.deal());
        break;
      case 'showdown':
        return this._resolveShowdown();
    }

    // First to act post-flop = first active left of dealer
    const sbIdx = (this.dealerIdx + 1) % this.players.length;
    let   first = sbIdx;
    while (this.players[first].folded || this.players[first].allIn) {
      first = (first + 1) % this.players.length;
    }
    this.actionIdx = first;
    this.firstToActIdx = first; // so we only end this street when action returns here and all have matched
  }

  // ── Showdown ─────────────────────────────────────────────────────────────────
  _resolveShowdown() {
    const pots    = calculatePots(this.players.map(p => ({
      id:       p.id,
      totalBet: p.totalBet,
      folded:   p.folded,
    })));

    const results = {};
    this.players.forEach(p => { results[p.id] = { won: 0, hand: null }; });

    // Only 1 player left (everyone else folded)
    const contenders = this.players.filter(p => !p.folded);
    if (contenders.length === 1) {
      results[contenders[0].id].won = this.pot;
      contenders[0].chips += this.pot;
    } else {
      // Evaluate hands
      this.players.filter(p => !p.folded).forEach(p => {
        results[p.id].hand = evaluateBest5([...p.cards, ...this.community]);
      });

      // Distribute each side pot
      for (const pot of pots) {
        const eligible  = pot.eligible.filter(id => !this.players.find(p => p.id === id)?.folded);
        const winner    = eligible.reduce((best, id) => {
          if (!best) return id;
          return compareScores(results[id].hand, results[best].hand) > 0 ? id : best;
        }, null);

        if (winner) {
          results[winner].won += pot.amount;
          this.players.find(p => p.id === winner).chips += pot.amount;
        }
      }
    }

    // Record hand for history
    const record = {
      handNumber: this.handNumber,
      results,
      community:  this.community,
      holeCards: this.players.reduce((acc, p) => {
        acc[p.id] = p.cards;
        return acc;
      }, {}),
      verify:     this.deck.verifyInfo(),
    };
    this.history.push(record);

    this.stage = 'waiting';
    return record;
  }

  // ── Public state (hide hole cards of other players) ───────────────────────
  toPublicState(forPlayerId) {
    return {
      tableId:    this.id,
      stage:      this.stage,
      pot:        this.pot,
      currentBet: this.currentBet,
      community:  this.community,
      dealerIdx:  this.dealerIdx,
      actionIdx:  this.actionIdx,
      config:     this.config,
      players: this.players.map((p, idx) => ({
        id:        p.id,
        address:   p.address,
        chips:     p.chips,
        bet:       p.bet,
        totalBet:  p.totalBet,
        folded:    p.folded,
        allIn:     p.allIn,
        connected: p.connected,
        isDealer:  idx === this.dealerIdx,
        isAction:  idx === this.actionIdx,
        cardCount: p.cards.length,
        // Only reveal your own cards (+ showdown)
        cards:     ((p.id || '').toLowerCase() === (forPlayerId || '').toLowerCase() || this.stage === 'showdown') ? p.cards : null,
      })),
    };
  }
}
