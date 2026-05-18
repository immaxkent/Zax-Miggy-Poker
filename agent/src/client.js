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
  depositAmountUsdc,
  persona,
  onStateUpdate,
}) {
  return new Promise((resolve, reject) => {
    const socket = io(socketUrl, {
      auth: { token, apiKey },
      transports: ['websocket'],
    });

    let latestState = null;
    let actionInFlight = false;
    let hasAutoStarted = false;

    // Called after every gameState update AND after each action completes.
    // Ensures we never miss a turn due to the race where a new gameState
    // arrives while actionInFlight=true.
    async function checkAndAct() {
      if (actionInFlight || !latestState) return;
      const state = latestState;
      const isOurTurn =
        (state.currentPlayerId || '').toLowerCase() === playerId.toLowerCase() &&
        state.stage !== 'waiting' &&
        state.stage !== 'showdown';
      if (!isOurTurn) return;
      actionInFlight = true;
      try {
        await takeAction(socket, state, playerId, systemPrompt, anthropicApiKey, persona);
      } finally {
        actionInFlight = false;
        // Re-check in case another gameState arrived while we were acting
        await checkAndAct();
      }
    }

    socket.on('connect', () => {
      console.log(`[agent] Connected. Joining table usdc-${gameId}...`);
      const joinPayload = { gameId, ...(depositAmountUsdc != null ? { depositAmount: depositAmountUsdc } : {}) };
      socket.emit('joinUsdcTable', joinPayload, (ack) => {
        if (ack?.error) {
          console.error('[agent] Failed to join table:', ack.error);
          socket.disconnect();
          reject(new Error(ack.error));
        } else {
          console.log(`[agent] Seated at usdc-${gameId}`);
        }
      });
    });

    socket.on('gameState', async (state) => {
      latestState = state;
      onStateUpdate?.(state);

      // Auto-start: if we're the host and enough players are seated
      if (
        !hasAutoStarted &&
        state.stage === 'waiting' &&
        (state.hostId || '').toLowerCase() === playerId.toLowerCase() &&
        (state.players?.length ?? 0) >= 2
      ) {
        hasAutoStarted = true;
        socket.emit('startGame', {}, (ack) => {
          if (ack?.ok) {
            console.log('[agent] Auto-started game as host.');
          } else {
            console.warn('[agent] Auto-start failed:', ack?.error);
            hasAutoStarted = false;
          }
        });
        return;
      }

      await checkAndAct();
    });

    socket.on('handComplete', (data) => {
      if (!data?.results) return;
      const summary = Object.entries(data.results)
        .filter(([, r]) => r.won > 0)
        .map(([id, r]) => `${id.slice(0, 8)}: +${r.won}`)
        .join(', ');
      console.log(`[agent] Hand complete. ${summary}`);
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

async function takeAction(socket, gameState, playerId, systemPrompt, anthropicApiKey, persona) {
  const ctx = buildDecisionContext(gameState, playerId);
  if (persona) ctx.persona = persona;

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

  await new Promise(resolve => {
    socket.emit('playerAction', payload, (ack) => {
      if (!ack?.ok) {
        console.error('[agent] Action rejected:', ack?.error, '— retrying with safe fallback');
        const safe = ctx.validActions.includes('check') ? 'check' : (ctx.validActions.includes('call') ? 'call' : 'fold');
        socket.emit('playerAction', { action: safe }, resolve);
      } else {
        resolve();
      }
    });
  });
}
