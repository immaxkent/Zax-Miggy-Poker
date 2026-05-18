let _client = null;

async function getClient(apiKey) {
  if (!_client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const PERSONA_WEIGHTS = {
  gto:        { check: 5, call: 4, raise: 3, fold: 1 },
  aggressive: { check: 2, call: 3, raise: 6, fold: 1 },
  rock:       { check: 6, call: 4, raise: 1, fold: 3 },
  maniac:     { check: 1, call: 2, raise: 8, fold: 1 },
  trappy:     { check: 5, call: 5, raise: 2, fold: 1 },
};

// Weighted random action when no API key is present (sim/dev mode)
function randomDecision(validActions, decisionCtx = {}) {
  const weights = PERSONA_WEIGHTS[decisionCtx.persona] ?? PERSONA_WEIGHTS.gto;
  const pool = validActions.flatMap(a => Array(weights[a] ?? 1).fill(a));
  const action = pool[Math.floor(Math.random() * pool.length)];
  let amount;
  if (action === 'raise') {
    const bigBlind   = decisionCtx.bigBlind ?? 20;
    const currentBet = decisionCtx.currentBet ?? 0;
    const toCall     = decisionCtx.toCall ?? 0;
    const myChips    = decisionCtx.myChips ?? 9999;
    // "raise to" level — engine expects the new total bet level, not chips-to-add
    const myCurrentBet = currentBet - toCall;   // chips already committed this street
    const allInLevel   = myCurrentBet + myChips; // max we can raise to
    const minRaise     = currentBet + bigBlind;  // engine minimum raise-to level
    if (allInLevel < minRaise) {
      // Can't meet minimum raise — downgrade to call or check
      const safe = validActions.includes('call') ? 'call' : (validActions.includes('check') ? 'check' : 'fold');
      return { action: safe, reasoning: 'random (no API key)' };
    }
    const extra = Math.ceil(Math.random() * 3) * bigBlind;
    amount = Math.min(minRaise + extra, allInLevel);
  }
  return { action, amount, reasoning: 'random (no API key)' };
}

/**
 * Ask Claude to decide the next poker action.
 *
 * @param {string} systemPrompt  Compiled strategy system prompt from strategy.js
 * @param {object} decisionCtx   Structured context about the current hand state
 * @param {string} apiKey        Anthropic API key
 * @returns {Promise<{action: string, amount?: number, reasoning: string}>}
 */
export async function decideAction(systemPrompt, decisionCtx, apiKey) {
  if (!apiKey) return randomDecision(decisionCtx.validActions ?? ['fold', 'call'], decisionCtx);

  const client = await getClient(apiKey);

  const userMessage = JSON.stringify(decisionCtx, null, 2);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',  // fast and cheap for poker decisions
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0]?.text ?? '';

  try {
    // Strip markdown code fences if Claude wraps the response
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch {
    console.error('[ai] Failed to parse Claude response:', text);
    // Safe fallback — fold rather than crash
    return { action: 'fold', reasoning: 'parse error' };
  }
}

/**
 * Build the decision context object from the current game state.
 * Extracts only what Claude needs — keeps the prompt tight.
 *
 * @param {object} gameState   Full gameState from socket
 * @param {string} playerId    Our wallet address (socket player ID)
 * @returns {object}
 */
export function buildDecisionContext(gameState, playerId) {
  const pid = (playerId || '').toLowerCase();
  const me = gameState.players?.find(p => (p.id || '').toLowerCase() === pid);
  const opponents = gameState.players?.filter(p => (p.id || '').toLowerCase() !== pid && p.active) ?? [];

  // Compute effective SPR (stack-to-pot ratio) for stack depth awareness
  const myChips = me?.chips ?? 0;
  const pot = gameState.pot ?? 1;
  const spr = (!me || pot === 0) ? 99 : +(myChips / pot).toFixed(2);

  return {
    holeCards: me?.cards ?? [],
    community: gameState.community ?? [],
    stage: gameState.stage ?? 'preflop',
    pot,
    currentBet: gameState.currentBet ?? 0,
    toCall: gameState.toCall ?? 0,
    myChips,
    spr,
    position: {
      seatIndex: me?.seatIndex ?? 0,
      isDealer: gameState.dealerIdx === me?.seatIndex,
      isSmallBlind: gameState.smallBlindIdx === me?.seatIndex,
      isBigBlind: gameState.bigBlindIdx === me?.seatIndex,
      totalPlayers: gameState.players?.length ?? 2,
    },
    opponents: opponents.map(p => ({
      chips: p.chips,
      lastAction: p.lastAction ?? null,
      allIn: p.allIn ?? false,
      isDealer: gameState.dealerIdx === p.seatIndex,
    })),
    validActions: gameState.validActions ?? ['fold', 'call'],
    bigBlind: gameState.bigBlind ?? 20,
    handNumber: gameState.handNumber ?? 1,
  };
}
