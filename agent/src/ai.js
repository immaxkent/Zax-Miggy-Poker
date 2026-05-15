import Anthropic from '@anthropic-ai/sdk';

let _client = null;

function getClient(apiKey) {
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
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
  const client = getClient(apiKey);

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
  const me = gameState.players?.find(p => p.id === playerId);
  const opponents = gameState.players?.filter(p => p.id !== playerId && p.active) ?? [];

  // Compute effective SPR (stack-to-pot ratio) for stack depth awareness
  const myChips = me?.chips ?? 0;
  const pot = gameState.pot ?? 1;
  const spr = pot > 0 ? +(myChips / pot).toFixed(2) : 99;

  return {
    holeCards: me?.holeCards ?? [],
    community: gameState.community ?? [],
    stage: gameState.stage ?? 'preflop',
    pot,
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
