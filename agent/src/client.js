import { io } from 'socket.io-client';
import { decideAction, buildDecisionContext } from './ai.js';

/**
 * Connect to the poker server, sit at a table, and play autonomously.
 *
 * @param {object} opts
 * @param {string}   opts.socketUrl       Socket.IO server URL
 * @param {string}   opts.apiKey          Server API key
 * @param {string}   opts.token           JWT from auth flow
 * @param {string}   opts.playerId        Agent wallet address
 * @param {number}   opts.gameId          On-chain game ID to join
 * @param {string}   opts.systemPrompt    Compiled strategy prompt
 * @param {string}   opts.anthropicApiKey Anthropic API key
 * @param {function} [opts.onStateUpdate] Optional callback for server manager UI sync
 * @returns {Promise<void>} Resolves when the table is terminated or game ends
 */
export function connectAndPlay({
  socketUrl,
  apiKey,
  token,
  playerId,
  gameId,
  systemPrompt,
  anthropicApiKey,
  onStateUpdate,
}) {
  return new Promise((resolve, reject) => {
    const socket = io(socketUrl, {
      auth: { token, apiKey },
      transports: ['websocket'],
    });

    let latestState = null;
    let isMyTurn = false;
    let actionInFlight = false;

    socket.on('connect', () => {
      console.log(`[agent] Connected. Joining table usdc-${gameId}...`);
      socket.emit('joinUsdcTable', { gameId }, (ack) => {
        if (!ack?.ok) {
          console.error('[agent] Failed to join table:', ack);
          socket.disconnect();
          reject(new Error(ack?.error || 'joinUsdcTable failed'));
        } else {
          console.log(`[agent] Seated at usdc-${gameId}`);
        }
      });
    });

    socket.on('gameState', async (state) => {
      latestState = state;
      onStateUpdate?.(state);

      // Detect when it's our turn to act
      if (
        state.currentPlayerId === playerId &&
        state.stage !== 'waiting' &&
        state.stage !== 'showdown' &&
        !actionInFlight
      ) {
        isMyTurn = true;
        actionInFlight = true;
        try {
          await takeAction(socket, state, playerId, systemPrompt, anthropicApiKey);
        } finally {
          actionInFlight = false;
          isMyTurn = false;
        }
      }
    });

    socket.on('handComplete', (data) => {
      console.log(`[agent] Hand complete. Results:`, data.results?.map(r => `${r.playerId}: ${r.chips > 0 ? '+' : ''}${r.chips}`).join(', '));
    });

    socket.on('tableTerminated', () => {
      console.log('[agent] Table terminated.');
      socket.disconnect();
      resolve();
    });

    socket.on('disconnect', (reason) => {
      console.log(`[agent] Disconnected: ${reason}`);
      resolve();
    });

    socket.on('connect_error', (err) => {
      console.error('[agent] Connection error:', err.message);
      reject(err);
    });
  });
}

async function takeAction(socket, gameState, playerId, systemPrompt, anthropicApiKey) {
  const ctx = buildDecisionContext(gameState, playerId);

  console.log(`[agent] My turn — stage: ${ctx.stage}, pot: ${ctx.pot}, toCall: ${ctx.toCall}, myChips: ${ctx.myChips}`);
  console.log(`[agent] Hand: ${ctx.holeCards.join(' ')} | Community: ${ctx.community.join(' ') || '(none)'}`);

  const decision = await decideAction(systemPrompt, ctx, anthropicApiKey);
  console.log(`[agent] Decision: ${decision.action}${decision.amount != null ? ' ' + decision.amount : ''} — ${decision.reasoning}`);

  // Validate action is in validActions
  if (!ctx.validActions.includes(decision.action)) {
    console.warn(`[agent] Invalid action "${decision.action}", falling back to safe default`);
    const safe = ctx.validActions.includes('check') ? 'check' : 'fold';
    socket.emit('playerAction', { action: safe });
    return;
  }

  const payload = { action: decision.action };
  if (decision.action === 'raise' && decision.amount != null) {
    payload.amount = Math.round(decision.amount);
  }

  socket.emit('playerAction', payload, (ack) => {
    if (!ack?.ok) {
      console.error('[agent] Action rejected:', ack?.error);
    }
  });
}
