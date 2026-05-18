/**
 * server.js — Main entry point
 *
 * Express (REST auth + withdrawal API) + Socket.IO (real-time game)
 *
 * Security model:
 *  • HTTPS/WSS in production (terminate at ALB on AWS)
 *  • API key on every request/connection
 *  • JWT on every Socket.IO connection
 *  • HMAC on every WS message payload
 *  • Wallet signature on login (EIP-191)
 */

import express        from 'express';
import { createServer }  from 'http';
import { Server }     from 'socket.io';
import cors           from 'cors';
import helmet         from 'helmet';
import { ethers }     from 'ethers';

import config, { validateConfig }   from './config.js';
import {
  requireApiKey,
  rateLimiter,
  issueJWT,
  verifyJWT,
  verifyMessage,
  createChallenge,
  getChallenge,
  consumeChallenge,
  socketAuthMiddleware,
  signWithdrawalVoucher,
  getServerSignerAddress,
  signAndSubmitCancelGame,
  signAndSubmitCloseGame,
  getCloseGameQuote,
  submitUpdateRankings,
  submitRecordCancellation,
  getLeaderboard,
} from './security.js';
import { PokerTable } from './poker-engine.js';
import { spawnAgent, killAgent, getAgentStatus } from './agent-manager.js';

// ─── Validate env on boot ─────────────────────────────────────────────────────
validateConfig();

// ─── In-memory stores (replace with Redis/DB for multi-instance) ──────────────
const players = new Map();  // address → { id, chips, tableId, nonce }
const tables  = new Map();  // tableId → PokerTable
let spectateNsp = null;     // set after io is created; used by emitGameStateToAllAtTable
// socketId → { ownerAddress, botPlayerId, tableId }  — bot owners watching their own bot
const ownerSpectators = new Map();
const usdcStacks = new Map();  // tableId → Map<playerId, chips> (stack when they left, for rejoin)
const terminatedTables = new Set();  // tableIds that have been terminated (blocks rejoin)
const runoutTimers = new Map(); // tableId -> timeout for all-in runout pacing
const actionTimers = new Map(); // tableId -> timeout for current turn
const nextHandCountdownTimers = new Map(); // tableId -> interval for next-hand countdown broadcast
const RUNOUT_DELAY_MS = 3_000;
const HYGIENE_INTERVAL_MS = 5_000;

// ─── Pre-create tables for each stake level ───────────────────────────────────
for (const [key, stakeConfig] of Object.entries(config.tables.stakes)) {
  const tableId = `${key}-1`;
  const table = new PokerTable({
    ...stakeConfig,
    actionTimeoutSeconds:  config.tables.actionTimeoutSeconds,
    minPlayers:            stakeConfig.minPlayers || config.tables.minPlayersToStart,
  }, tableId);
  table.hostId = null;
  table.gameStarted = false;
  tables.set(tableId, table);
  console.log(`📋 Table created: ${tableId} (${stakeConfig.name} — ${stakeConfig.bigBlind}BB)`);
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: config.server.allowedOrigins.length
    ? config.server.allowedOrigins
    : '*',
  credentials: true,
}));
app.use(express.json());
// Exclude socket.io path — its WebSocket upgrade handshake must not be rate-limited.
// Socket.IO connections are protected by JWT auth independently.
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  return rateLimiter(120, 60_000)(req, res, next);
});

// ── Health check (no auth — used by AWS ALB) ──────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status:  'ok',
    signer:  getServerSignerAddress(),
    tables:  tables.size,
    players: players.size,
  });
});

// ── Auth: Step 1 — get nonce challenge ────────────────────────────────────────
app.post('/auth/challenge', requireApiKey, rateLimiter(30, 60_000), (req, res) => {
  const { address } = req.body;
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });
  const nonce = createChallenge(address);
  res.json({
    nonce,
    message: `Sign this message to log in to CryptoPoker.\nNonce: ${nonce}`,
  });
});

// ── Auth: Step 2 — verify signature, issue JWT ────────────────────────────────
app.post('/auth/verify', requireApiKey, rateLimiter(30, 60_000), async (req, res) => {
  try {
    const { address, signature } = req.body;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });

    const nonce = getChallenge(address);
    if (!nonce) return res.status(400).json({ error: 'Challenge expired or not found' });

    const message  = `Sign this message to log in to CryptoPoker.\nNonce: ${nonce}`;
    // Some wallets (e.g. MetaMask mobile) produce high-S signatures that ethers v6
    // rejects as non-canonical. Normalize before verifying.
    let sigToVerify = signature;
    try {
      const parsed = ethers.Signature.from(signature);
      sigToVerify = parsed.normalize().serialized;
    } catch { /* malformed sig — verifyMessage will reject it below */ }
    const recovered = ethers.verifyMessage(message, sigToVerify);

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'Signature mismatch' });
    }

    consumeChallenge(address);

    // Create/update player record
    const playerId = address.toLowerCase();
    if (!players.has(playerId)) {
      players.set(playerId, { id: playerId, address: playerId, chips: 0, tableId: null, withdrawNonce: 0 });
    }

    const token = issueJWT(address);
    res.json({ token, address: address.toLowerCase() });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// ── Withdrawal voucher endpoint ───────────────────────────────────────────────
app.post('/withdraw', requireApiKey, async (req, res) => {
  try {
    // JWT verification (reuse from middleware inline for REST)
    const auth  = req.headers.authorization?.replace('Bearer ', '');
    if (!auth)  return res.status(401).json({ error: 'No token' });
    const { verifyJWT } = await import('./security.js');
    const payload  = verifyJWT(auth);
    const playerId = payload.sub;

    const player = players.get(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.tableId) return res.status(400).json({ error: 'Cannot withdraw while at table' });

    const amount = req.body.amount; // tokens (in wei/base units)
    if (!amount || amount <= 0n) return res.status(400).json({ error: 'Invalid amount' });

    // Check server-side chip balance
    const amountBig = BigInt(amount);
    if (amountBig > BigInt(player.chips)) return res.status(400).json({ error: 'Insufficient chips' });

    // Increment nonce
    player.withdrawNonce++;
    const nonce = player.withdrawNonce;

    // Deduct chips optimistically (will be re-added if tx fails — TODO: DB tx)
    player.chips -= Number(amountBig);

    const sig = await signWithdrawalVoucher({
      chainId:       config.chain.chainId,
      vaultAddress:  config.chain.vaultAddress,
      playerAddress: playerId,
      amount:        amountBig,
      nonce,
    });

    res.json({ sig, amount: amountBig.toString(), nonce });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// ── Tables list ────────────────────────────────────────────────────────────────
app.get('/tables', requireApiKey, (_, res) => {
  const list = Array.from(tables.values()).map(t => ({
    id:       t.id,
    name:     t.config.name,
    stakes:   `${t.config.smallBlind}/${t.config.bigBlind}`,
    players:  t.players.length,
    maxSeats: t.config.maxSeats,
    stage:    t.stage,
  }));
  res.json(list);
});

// ── Public rankings leaderboard (no auth — reads from AgenticRankings contract) ─
app.get('/api/rankings', async (_, res) => {
  try {
    const data = await getLeaderboard();
    res.json(data);
  } catch (err) {
    console.error('[rankings] getLeaderboard error:', err.message);
    res.json({ entries: [], lastUpdated: null, error: err.message });
  }
});

// ── Public games list (no auth — used by agent discovery and spectator lobby) ──
app.get('/api/games', (_, res) => {
  const list = Array.from(tables.entries())
    .filter(([id]) => id.startsWith('usdc-'))
    .map(([id, t]) => ({
      tableId:          id,
      gameId:           Number(id.replace('usdc-', '')),
      playerCount:      t.players.length,
      maxSeats:         t.config.maxSeats,
      stage:            t.stage,
      depositAmountUsdc: t.depositAmountUsdc ?? null,
    }));
  res.json(list);
});

// ── Agent management endpoints ────────────────────────────────────────────────

// POST /agent/activate — spawn a bot process for the calling wallet owner
// Body: { keystoreJson, keystorePassword, config, gameId }
// Auth: JWT (owner must be authenticated via MetaMask)
app.post('/agent/activate', requireApiKey, async (req, res) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'No token' });
    const { verifyJWT } = await import('./security.js');
    const payload = verifyJWT(auth);
    const ownerAddress = payload.sub;

    const { keystoreJson, keystorePassword, config: botConfig, gameId, botAddress } = req.body;
    if (!keystoreJson || !keystorePassword || gameId == null) {
      return res.status(400).json({ error: 'keystoreJson, keystorePassword, and gameId are required' });
    }

    const result = spawnAgent({
      ownerAddress,
      botAddress: botAddress || null,
      keystoreJson,
      keystorePassword,
      config: botConfig || {},
      gameId: Number(gameId),
      serverConfig: {
        serverUrl:       config.server.serverUrl || `http://localhost:${config.server.port}`,
        socketUrl:       config.server.socketUrl || `http://localhost:${config.server.port}`,
        apiKey:          config.server.apiKey,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        rpcUrl:          config.chain.rpcUrl,
        usdcAddress:     config.chain.usdcAddress,
        vaultAddress:    config.chain.zaxMiggyVaultAddress,
      },
    });

    if (!result.ok) return res.status(409).json({ error: result.error });
    res.json({ ok: true, gameId: Number(gameId) });
  } catch (err) {
    console.error('Agent activate error:', err);
    res.status(500).json({ error: 'Failed to activate agent' });
  }
});

// GET /agent/status — poll running agent state + logs for the calling owner
app.get('/agent/status', requireApiKey, async (req, res) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'No token' });
    const { verifyJWT } = await import('./security.js');
    const payload = verifyJWT(auth);
    const status = getAgentStatus(payload.sub);
    res.json(status ?? { status: 'none' });
  } catch (err) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

// DELETE /agent — kill the running agent for the calling owner
app.delete('/agent', requireApiKey, async (req, res) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'No token' });
    const { verifyJWT } = await import('./security.js');
    const payload = verifyJWT(auth);
    const result = killAgent(payload.sub);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kill agent failed' });
  }
});

app.post('/ops/hygiene', requireApiKey, (_, res) => {
  const report = runHygieneSweep('manual');
  res.json({ ok: true, report });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: {
    origin: config.server.allowedOrigins.length ? config.server.allowedOrigins : '*',
    credentials: true,
  },
});

io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  const playerId = socket.walletAddress;
  console.log(`🔌 Connected: ${playerId}`);

  // Ensure player record exists (e.g. after server restart) and send current chips
  if (!players.has(playerId)) {
    players.set(playerId, { id: playerId, address: playerId, chips: 0, tableId: null, withdrawNonce: 0 });
  }
  const player = players.get(playerId);
  socket.emit('chipsUpdated', { chips: player.chips });

  // Mark player connected
  if (player?.tableId) {
    const table = tables.get(player.tableId);
    if (table) {
      const p = table.players.find(p => p.id === playerId);
      if (p) p.connected = true;
      io.to(player.tableId).emit('playerReconnected', { playerId });
    }
  }

  // ── Join table ────────────────────────────────────────────────────────────
  socket.on('joinTable', ({ tableId, buyIn }, ack) => {
    try {
      if (!verifySocketPayload(socket, { tableId, buyIn })) return ack?.({ error: 'INVALID_HMAC' });

      const player = players.get(playerId);
      if (!player)          return ack?.({ error: 'NOT_AUTHENTICATED' });
      if (player.tableId)   return ack?.({ error: 'Already at a table. Leave first.' });

      const table = tables.get(tableId);
      if (!table)           return ack?.({ error: 'TABLE_NOT_FOUND' });

      if (player.chips < buyIn)         return ack?.({ error: 'INSUFFICIENT_CHIPS' });
      if (buyIn < table.config.minBuyIn) return ack?.({ error: 'BELOW_MIN_BUY_IN' });
      if (buyIn > table.config.maxBuyIn) return ack?.({ error: 'ABOVE_MAX_BUY_IN' });

      // Deduct chips and sit down
      player.chips  -= buyIn;
      player.tableId = tableId;
      if (!table.hostId) table.hostId = (playerId || '').toLowerCase();
      const rawState = table.sitDown({ id: playerId, address: playerId, chips: buyIn });
      const state    = enrichState(table, rawState, playerId);

      socket.join(tableId);
      io.to(tableId).emit('playerJoined', { playerId, chips: buyIn });
      ack?.({ state });

      // No auto-start: host must call startGame
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  // ── Join USDC game table (on-chain game → server table for gameplay) ─────────
  socket.on('joinUsdcTable', ({ gameId, creatorAddress, depositAmount }, ack) => {
    try {
      const player = players.get(playerId);
      if (!player) return ack?.({ error: 'NOT_AUTHENTICATED' });

      const tableId = `usdc-${gameId}`;
      if (player.tableId && player.tableId !== tableId) {
        return ack?.({ error: 'Already at a table. Leave first.' });
      }
      if (terminatedTables.has(tableId)) {
        return ack?.({ error: 'Game has been terminated and cannot be rejoined' });
      }
      let table = tables.get(tableId);
      if (!table) {
        const usdcStake = {
          name:          `USDC Game ${gameId}`,
          smallBlind:    5,
          bigBlind:      10,
          minBuyIn:      200,
          maxBuyIn:      1000,
          maxSeats:      8,
          minPlayers:    2,
          blindSchedule: [
            { sb: 5,   bb: 10  },
            { sb: 10,  bb: 20  },
            { sb: 25,  bb: 50  },
            { sb: 50,  bb: 100 },
            { sb: 100, bb: 200 },
          ],
          blindInterval: 10,
        };
        table = new PokerTable({
          ...usdcStake,
          actionTimeoutSeconds: config.tables.actionTimeoutSeconds,
          minPlayers: usdcStake.minPlayers || config.tables.minPlayersToStart,
        }, tableId);
        tables.set(tableId, table);
        if (depositAmount) table.depositAmountUsdc = depositAmount;
        // Use the on-chain creator as the authoritative host so connection order doesn't matter
        table.hostId = creatorAddress ? creatorAddress.toLowerCase() : null;
        table.gameStarted = false;
        console.log(`📋 USDC table created: ${tableId} hostId=${table.hostId}`);
      } else if (!table.hostId && creatorAddress) {
        // Table exists but host was cleared — restore from on-chain creator
        table.hostId = creatorAddress.toLowerCase();
      }

      // Self-heal reconnect/re-entry: if already seated on this table, rejoin room and return state.
      if (player.tableId === tableId) {
        const alreadySeated = table.players.find(p => (p.id || '').toLowerCase() === playerId);
        if (alreadySeated) {
          alreadySeated.connected = true;
          socket.join(tableId);
          const state = enrichState(table, table.toPublicState(playerId), playerId);
          ack?.({ state, healed: true });
          scheduleAllInRunout(io, table);
          scheduleActionTimer(io, table);
          return;
        }
      }

      if (!table.hostId) table.hostId = playerId;

      const stackMap = usdcStacks.get(tableId) || new Map();
      const savedStack = stackMap.get(playerId);
      const startingChips = savedStack != null ? savedStack : 1000;
      if (savedStack != null) stackMap.delete(playerId);
      usdcStacks.set(tableId, stackMap);
      player.tableId = tableId;
      const state = enrichState(table, table.sitDown({ id: playerId, address: playerId, chips: startingChips }), playerId);

      socket.join(tableId);
      io.to(tableId).emit('playerJoined', { playerId, chips: startingChips });
      ack?.({ state });
      emitGameStateToAllAtTable(io, table, 'player joined');
      scheduleAllInRunout(io, table);
      scheduleActionTimer(io, table);

      // No auto-start: host must call startGame
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  // ── Leave table ────────────────────────────────────────────────────────────
  socket.on('leaveTable', (_, ack) => {
    leaveTable(playerId, socket, ack);
  });

  // ── Player action ─────────────────────────────────────────────────────────
  socket.on('playerAction', ({ action, amount }, ack) => {
    try {
      const player = players.get(playerId);
      if (!player?.tableId) return ack?.({ error: 'NOT_AT_TABLE' });

      const table  = tables.get(player.tableId);
      const pIdxBefore = table.actionIdx;
      const stageBefore = table.stage;
      const result = table.applyAction(playerId, action, amount);

      console.log(`[ACTION] ${(playerId || '').slice(0, 10)}... ${action} @ ${stageBefore} → actionIdx ${pIdxBefore} → ${table.actionIdx}, firstToAct=${table.firstToActIdx}, stage=${table.stage}`);

      emitGameStateToAllAtTable(io, table, `[ACTION] actionIdx=${table.actionIdx}`);

      const currentTableId = player.tableId;
      if (handlePendingHandComplete(io, table, currentTableId)) {
        ack?.({ ok: true });
        return;
      }
      scheduleAllInRunout(io, table);
      scheduleActionTimer(io, table);

      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  // ── Get current state ──────────────────────────────────────────────────────
  socket.on('getState', (_, ack) => {
    const player = players.get(playerId);
    if (!player?.tableId) return ack?.({ error: 'NOT_AT_TABLE' });
    const table = tables.get(player.tableId);
    ack?.({ state: enrichState(table, table.toPublicState(playerId), playerId) });
  });

  // ── Start game (host only, waiting stage, enough players) ────────────────────
  socket.on('startGame', (_, ack) => {
    try {
      const player = players.get(playerId);
      if (!player?.tableId) return ack?.({ error: 'NOT_AT_TABLE' });
      const table = tables.get(player.tableId);
      if (table.stage !== 'waiting') return ack?.({ error: 'Hand already in progress' });
      if (!table.canStart()) return ack?.({ error: 'Not enough players to start' });
      if ((table.hostId || '').toLowerCase() !== (playerId || '').toLowerCase()) {
        return ack?.({ error: 'Only the host can start the game' });
      }
      const started = tryStartHand(io, table);
      if (!started) {
        return ack?.({ error: 'Could not start hand — need enough players and table must be in lobby (waiting).' });
      }
      scheduleAllInRunout(io, table);
      scheduleActionTimer(io, table);
      ack?.({ ok: true, state: enrichState(table, table.toPublicState(playerId), playerId) });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  // ── Terminate game (host only, before first hand) ────────────────────────────
  socket.on('terminateGame', async (_, ack) => {
    try {
      const player = players.get(playerId);
      if (!player?.tableId) return ack?.({ error: 'NOT_AT_TABLE' });
      const table = tables.get(player.tableId);
      if (table.stage !== 'waiting') return ack?.({ error: 'Cannot terminate during a hand' });
      if (table.gameStarted) return ack?.({ error: 'Game has already started; cannot terminate' });
      if ((table.hostId || '').toLowerCase() !== (playerId || '').toLowerCase()) {
        return ack?.({ error: 'Only the host can terminate the game' });
      }
      const tableId = table.id;
      const isUsdc = tableId.startsWith('usdc-');

      // For USDC tables, cancel on-chain first so players get their deposits back
      if (isUsdc) {
        const gameId = tableId.replace('usdc-', '');
        await signAndSubmitCancelGame(gameId);
        submitRecordCancellation(gameId).catch(err =>
          console.error(`📊 recordCancellation(${gameId}) failed:`, err.message)
        );
      }

      // Block any future rejoins for this table
      terminatedTables.add(tableId);

      const stackMap = isUsdc ? (usdcStacks.get(tableId) || new Map()) : null;
      [...table.players].forEach(p => {
        const chips = table.standUp(p.id);
        const pl = players.get(p.id);
        if (pl) {
          pl.tableId = null;
          if (isUsdc && stackMap) stackMap.set(p.id, chips);
          else pl.chips += chips;
          const sock = findSocket(io, p.id);
          if (sock) {
            sock.leave(tableId);
            sock.emit('chipsUpdated', { chips: pl.chips });
            sock.emit('tableTerminated', {});
          }
        }
      });
      clearRunoutTimer(tableId);
      clearActionTimer(tableId);
      clearNextHandCountdown(tableId);
      tables.delete(tableId);
      if (isUsdc && stackMap) usdcStacks.set(tableId, stackMap);
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  // ── Chat ──────────────────────────────────────────────────────────────────
  socket.on('chatMessage', ({ text }) => {
    const player = players.get(playerId);
    if (!player?.tableId || typeof text !== 'string') return;
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    io.to(player.tableId).emit('chatMessage', { from: playerId, text: clean });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${playerId}`);
    const player = players.get(playerId);
    if (player?.tableId) {
      const table = tables.get(player.tableId);
      if (table) {
        const p = table.players.find(p => p.id === playerId);
        if (p) p.connected = false;
        io.to(player.tableId).emit('playerDisconnected', { playerId });
      }
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function enrichState(table, state, forPlayerId) {
  if (!state) return state;
  state.hostId = table.hostId ?? null;
  state.gameStarted = table.gameStarted ?? false;
  state.handNumber = table.handNumber ?? 0;
  state.bigBlind   = table.config?.bigBlind   ?? 10;
  state.smallBlind = table.config?.smallBlind ?? 5;
  state.blindLevel = table.blindLevelIdx ?? 0;
  state.nextBlindHand = state.nextBlindHand ?? null;

  const inHand = table.stage !== 'waiting';
  const ap = inHand && table.actionIdx >= 0 ? table.players[table.actionIdx] : null;
  state.currentPlayerId = ap?.id ?? null;

  if (inHand && table.dealerIdx >= 0 && table.players.length >= 2) {
    const n = table.players.length;
    const isHeadsUp = n === 2;
    state.smallBlindIdx = isHeadsUp ? table.dealerIdx : (table.dealerIdx + 1) % n;
    state.bigBlindIdx   = isHeadsUp ? (table.dealerIdx + 1) % n : (table.dealerIdx + 2) % n;
  } else {
    state.smallBlindIdx = -1;
    state.bigBlindIdx   = -1;
  }

  if (ap) {
    const outstanding = Math.max(0, (table.currentBet ?? 0) - (ap.bet ?? 0));
    state.toCall = Math.min(outstanding, ap.chips ?? 0);
    const canCheck = outstanding === 0;
    const canRaise = (ap.chips ?? 0) > state.toCall;
    state.validActions = [
      ...(canCheck ? ['check'] : []),
      ...(state.toCall > 0 ? ['call'] : []),
      ...(canRaise ? ['raise'] : []),
      'fold',
    ];
  } else {
    state.toCall = 0;
    state.validActions = [];
  }

  return state;
}

/**
 * Send each seated player their personalized view (hole cards). Prefer sockets that
 * joined the table room (reliable with ngrok / multiple tabs); fall back to global scan.
 */
function emitGameStateToAllAtTable(io, table, context = '') {
  const seatedIds = table.players.map((p) => (p.id || '').toLowerCase());
  const delivered = new Set();
  const room = io.sockets.adapter.rooms.get(table.id);
  if (room && room.size > 0) {
    for (const socketId of room) {
      const s = io.sockets.sockets.get(socketId);
      if (!s) continue;
      const wid = (s.walletAddress || '').toLowerCase();
      if (!wid || !seatedIds.includes(wid)) continue;
      s.emit('gameState', enrichState(table, table.toPublicState(wid), wid));
      delivered.add(wid);
    }
  }
  for (const pid of seatedIds) {
    if (delivered.has(pid)) continue;
    const s = findSocket(io, pid);
    if (s) {
      s.emit('gameState', enrichState(table, table.toPublicState(pid), pid));
      delivered.add(pid);
    }
  }
  const missed = seatedIds.filter((id) => !delivered.has(id));
  if (missed.length) {
    console.warn(`[${table.id}] ${context} gameState NOT delivered to: ${missed.map((m) => m.slice(0, 10)).join(', ')}`);
  } else if (context) {
    console.log(`[${table.id}] ${context} gameState -> ${delivered.size} seated player(s)`);
  }

  // Push redacted state to all spectators (cards hidden until showdown)
  if (spectateNsp) {
    spectateNsp
      .to(`spectators-${table.id}`)
      .emit('spectatorState', enrichState(table, table.toPublicState('__spectator__'), '__spectator__'));

    // Send personalized state to owner spectators (shows their bot's hole cards live)
    for (const [socketId, os] of ownerSpectators) {
      if (os.tableId !== table.id) continue;
      const sock = spectateNsp.sockets.get(socketId);
      if (sock) {
        sock.emit('spectatorState', enrichState(table, table.toPublicState(os.botPlayerId), os.botPlayerId));
      }
    }
  }
}

function findSocket(io, playerId) {
  const id = (playerId || '').toLowerCase();
  for (const [, s] of io.sockets.sockets) {
    if ((s.walletAddress || '').toLowerCase() === id) return s;
  }
  return null;
}

function clearRunoutTimer(tableId) {
  const t = runoutTimers.get(tableId);
  if (t) {
    clearTimeout(t);
    runoutTimers.delete(tableId);
  }
}

function clearActionTimer(tableId) {
  const t = actionTimers.get(tableId);
  if (t) {
    clearTimeout(t);
    actionTimers.delete(tableId);
  }
  io.to(tableId).emit('actionTimer', null);
}

function clearNextHandCountdown(tableId) {
  const t = nextHandCountdownTimers.get(tableId);
  if (t) {
    clearInterval(t);
    nextHandCountdownTimers.delete(tableId);
  }
  io.to(tableId).emit('nextHandCountdown', null);
}

function scheduleActionTimer(io, table) {
  if (!table?.id) return;
  const tableId = table.id;
  clearActionTimer(tableId);

  const actionableNow =
    table.stage !== 'waiting' &&
    table.stage !== 'showdown' &&
    table.actionIdx >= 0 &&
    table.players[table.actionIdx] &&
    !table.players[table.actionIdx].folded &&
    !table.players[table.actionIdx].allIn;
  if (!actionableNow) return;

  const player = table.players[table.actionIdx];
  const timeoutMs = Math.max(1, Number(config.tables.actionTimeoutSeconds || 30)) * 1000;
  const deadline = Date.now() + timeoutMs;
  io.to(tableId).emit('actionTimer', { playerId: player.id, deadline, seconds: Math.ceil(timeoutMs / 1000) });

  const timer = setTimeout(() => {
    actionTimers.delete(tableId);
    const latest = tables.get(tableId);
    if (!latest) return;
    const current = latest.players[latest.actionIdx];
    if (!current || current.id !== player.id) return;
    try {
      const timed = latest.applyTimeoutForCurrentPlayer();
      io.to(tableId).emit('chatMessage', {
        from: 'DEALER',
        text: `${timed.playerId.slice(0, 8)}... timed out: auto-${timed.action}.`,
        system: true,
      });
      emitGameStateToAllAtTable(io, latest, `[TIMEOUT] ${timed.playerId} -> ${timed.action}`);
      if (handlePendingHandComplete(io, latest, tableId)) return;
      scheduleAllInRunout(io, latest);
      scheduleActionTimer(io, latest);
    } catch (err) {
      console.error(`[TIMEOUT] Failed on ${tableId}:`, err.message);
    }
  }, timeoutMs);
  actionTimers.set(tableId, timer);
}

function shouldAutoRunout(table) {
  if (!table || !['flop', 'turn', 'river'].includes(table.stage)) return false;
  const contenders = table.players.filter(p => !p.folded);
  if (contenders.length < 2) return false;
  const actionable = contenders.filter(p => !p.allIn);
  return actionable.length <= 1;
}

function scheduleNextHandIfPossible(io, tableId) {
  clearNextHandCountdown(tableId);
  let secondsLeft = 4;
  io.to(tableId).emit('nextHandCountdown', { seconds: secondsLeft, deadline: Date.now() + secondsLeft * 1000 });
  const tick = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      io.to(tableId).emit('nextHandCountdown', { seconds: secondsLeft, deadline: Date.now() + secondsLeft * 1000 });
      return;
    }
    clearNextHandCountdown(tableId);
    const stillExists = tables.get(tableId);
    if (!stillExists) return;
    if (stillExists.stage !== 'waiting') return; // hand already in progress
    if (!stillExists.canStart()) return;         // not enough players
    const started = tryStartHand(io, stillExists);
    if (started) {
      scheduleAllInRunout(io, stillExists);
      scheduleActionTimer(io, stillExists);
      console.log(`♻️  Auto-rolled to next hand on ${tableId}`);
    }
  }, 1_000);
  nextHandCountdownTimers.set(tableId, tick);
}

function serializeReceipt(r) {
  if (!r) return null;
  return {
    blockNumber: r.blockNumber != null ? Number(r.blockNumber) : null,
    gasUsed: r.gasUsed != null ? r.gasUsed.toString() : null,
    cumulativeGasUsed: r.cumulativeGasUsed != null ? r.cumulativeGasUsed.toString() : null,
    effectiveGasPrice: r.effectiveGasPrice != null ? r.effectiveGasPrice.toString() : null,
    status: r.status != null ? Number(r.status) : null,
  };
}

function handlePendingHandComplete(io, table, tableId) {
  if (!table?.pendingHandComplete) return false;
  clearRunoutTimer(tableId);
  clearActionTimer(tableId);

  const hc = table.pendingHandComplete;
  table.pendingHandComplete = null;

  io.to(tableId).emit('handComplete', {
    handNumber: hc.handNumber,
    results:    hc.results,
    community:  hc.community,
    holeCards:  hc.holeCards,
    verify:     hc.verify,
  });

  // Full reveal for spectators — showdown cards are public info
  if (spectateNsp) {
    spectateNsp.to(`spectators-${tableId}`).emit('spectatorHandComplete', {
      handNumber: hc.handNumber,
      results:    hc.results,
      community:  hc.community,
      holeCards:  hc.holeCards,
    });
  }

  issueWinnerVouchers(io, hc.results, tableId);

  // Auto-finish USDC game when a player is busted (0 chips)
  if (tableId.startsWith('usdc-')) {
    const alive = table.players.filter(p => p.chips > 0);
    if (alive.length === 1) {
      const winner = alive[0];
      if (winner) {
        console.log(`🏆 USDC game ${tableId} over — winner: ${winner.id}`);
        const gameId = tableId.replace('usdc-', '');
        const chipsWonInGame = winner.chips - (winner.startChips || 0);
        const handsPlayed = table.handNumber;
        terminatedTables.add(tableId);

        io.to(tableId).emit('gameOver', {
          winner: winner.id,
          gameId: Number(gameId),
          summary: {
            handsPlayed,
            chipsWonInGame,
          },
        });

        if (spectateNsp) {
          spectateNsp.to(`spectators-${tableId}`).emit('spectatorGameOver', {
            winner: winner.id,
            gameId: Number(gameId),
            summary: { handsPlayed, chipsWonInGame },
          });
        }

        (async () => {
          let quote = null;
          try {
            quote = await getCloseGameQuote(gameId);
          } catch (err) {
            console.error(`⚠️ quote closeGame(${gameId}) failed:`, err.message);
          }

          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const mined = await signAndSubmitCloseGame(gameId, winner.id);
              submitUpdateRankings(gameId).catch(err =>
                console.error(`📊 updateRankings(${gameId}) failed:`, err.message)
              );
              const settlement = {
                gameId: Number(gameId),
                winner: winner.id,
                status: 'mined',
                txHash: mined.txHash,
                receipt: serializeReceipt(mined.receipt),
                summary: {
                  handsPlayed,
                  chipsWonInGame,
                  usdcWon: quote?.winnerPayout ?? null,
                  usdcPot: quote?.totalPot ?? null,
                  playerCount: quote?.playerCount ?? null,
                },
              };
              const winnerSocket = findSocket(io, winner.id);
              if (winnerSocket) winnerSocket.emit('usdcSettlement', settlement);
              console.log(`✅ closeGame(${gameId}) mined: ${mined.txHash}`);
              return;
            } catch (err) {
              console.error(`❌ closeGame(${gameId}) attempt ${attempt}/${maxAttempts} failed:`, err.message);
              if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2_000));
                continue;
              }
              const winnerSocket = findSocket(io, winner.id);
              if (winnerSocket) winnerSocket.emit('usdcSettlement', {
                gameId: Number(gameId),
                winner: winner.id,
                status: 'failed',
                error: err.message,
                summary: {
                  handsPlayed,
                  chipsWonInGame,
                  usdcWon: quote?.winnerPayout ?? null,
                  usdcPot: quote?.totalPot ?? null,
                  playerCount: quote?.playerCount ?? null,
                },
              });
            }
          }
        })();

        [...table.players].forEach(p => {
          const pl = players.get(p.id);
          if (pl) pl.tableId = null;
          const s = findSocket(io, p.id);
          if (s) {
            s.leave(tableId);
            s.emit('chipsUpdated', { chips: pl?.chips ?? 0 });
          }
        });
        clearRunoutTimer(tableId);
        clearActionTimer(tableId);
        clearNextHandCountdown(tableId);
        tables.delete(tableId);
        return true;
      }
    }
  }

  scheduleNextHandIfPossible(io, tableId);
  return true;
}

function scheduleAllInRunout(io, table) {
  const tableId = table?.id;
  if (!tableId || runoutTimers.has(tableId) || !shouldAutoRunout(table)) return;

  const tick = () => {
    runoutTimers.delete(tableId);
    const latest = tables.get(tableId);
    if (!latest || !shouldAutoRunout(latest)) return;

    latest._nextStage();
    emitGameStateToAllAtTable(io, latest, `[RUNOUT] stage=${latest.stage}`);
    scheduleActionTimer(io, latest);

    if (handlePendingHandComplete(io, latest, tableId)) return;
    if (!shouldAutoRunout(latest)) return;

    const next = setTimeout(tick, RUNOUT_DELAY_MS);
    runoutTimers.set(tableId, next);
  };

  const timer = setTimeout(tick, RUNOUT_DELAY_MS);
  runoutTimers.set(tableId, timer);
}

function leaveTable(playerId, socket, ack) {
  const player = players.get(playerId);
  if (!player?.tableId) return ack?.({ error: 'NOT_AT_TABLE' });
  const table  = tables.get(player.tableId);
  if (!table)            return ack?.({ error: 'TABLE_NOT_FOUND' });

  const refundChips = table.standUp(playerId);
  const isUsdcTable = table.id.startsWith('usdc-');
  if (isUsdcTable) {
    const stackMap = usdcStacks.get(table.id) || new Map();
    stackMap.set(playerId, refundChips);
    usdcStacks.set(table.id, stackMap);
  } else {
    player.chips += refundChips;
  }
  player.tableId = null;

  socket.leave(table.id);
  io.to(table.id).emit('playerLeft', { playerId });
  socket.emit('chipsUpdated', { chips: player.chips });
  if (table.players.length === 0) {
    clearRunoutTimer(table.id);
    clearActionTimer(table.id);
    clearNextHandCountdown(table.id);
  } else {
    scheduleActionTimer(io, table);
  }
  ack?.({ chips: player.chips });
}

function tryStartHand(io, table) {
  if (!table.canStart() || table.stage !== 'waiting') return false;
  clearNextHandCountdown(table.id);
  table.gameStarted = true;
  const info = table.startHand();
  emitGameStateToAllAtTable(io, table, 'hand start');
  io.to(table.id).emit('handStarted', {
    handNumber:  info.handNumber,
    dealerIdx:   info.dealerIdx,
    serverHash:  info.serverHash, // for provability
  });
  console.log(`🃏 Hand #${info.handNumber} started on ${table.id}`);
  return true;
}

async function issueWinnerVouchers(io, results, tableId) {
  const isUsdcTable = tableId.startsWith('usdc-');
  for (const [playerId, { won }] of Object.entries(results)) {
    if (won <= 0) continue;
    const player = players.get(playerId);
    if (!player) continue;

    if (!isUsdcTable) {
      player.chips += won;
    }
    const s = findSocket(io, playerId);
    if (s) {
      if (!isUsdcTable) s.emit('chipsUpdated', { chips: player.chips });
      s.emit('winNotification', { amount: won, tableId });
    }
    console.log(`💰 ${playerId} won ${won} chips on ${tableId}`);
  }
}

function verifySocketPayload(socket, payload) {
  // In production: require _hmac on payload
  // For dev: skip verification
  if (config.server.nodeEnv === 'production') {
    return verifyMessage(payload);
  }
  return true;
}

function runHygieneSweep(reason = 'interval') {
  let tablesChecked = 0;
  let playerLinksFixed = 0;
  let pipelinesRearmed = 0;
  let pendingHandled = 0;

  for (const [tableId, table] of tables.entries()) {
    tablesChecked++;

    // Keep players map and table seat ownership in sync.
    for (const seat of table.players) {
      const rec = players.get(seat.id);
      if (rec && rec.tableId !== tableId) {
        rec.tableId = tableId;
        playerLinksFixed++;
      }
    }

    if (table.pendingHandComplete) {
      handlePendingHandComplete(io, table, tableId);
      pendingHandled++;
      continue;
    }

    if (table.stage !== 'waiting') {
      scheduleAllInRunout(io, table);
      scheduleActionTimer(io, table);
      pipelinesRearmed++;
    }
  }

  if (reason !== 'interval') {
    console.log(`[HYGIENE:${reason}] tables=${tablesChecked} fixedLinks=${playerLinksFixed} pendingHandled=${pendingHandled} pipelinesRearmed=${pipelinesRearmed}`);
  }
  return { tablesChecked, playerLinksFixed, pendingHandled, pipelinesRearmed };
}

// ─── Spectate namespace (API key required; JWT optional for owner bot visibility) ─
spectateNsp = io.of('/spectate');

spectateNsp.use((socket, next) => {
  const { apiKey, token } = socket.handshake.auth;
  if (!apiKey || apiKey !== config.server.apiKey) return next(new Error('INVALID_API_KEY'));
  // Optionally decode JWT so owner can see their bot's cards
  if (token) {
    try {
      const payload = verifyJWT(token);
      socket.ownerAddress = payload.sub;
    } catch { /* invalid token — proceed as anonymous spectator */ }
  }
  next();
});

spectateNsp.on('connection', (socket) => {
  socket.on('spectate', ({ gameId }, ack) => {
    const tableId = `usdc-${gameId}`;
    socket.join(`spectators-${tableId}`);

    // Check if this authenticated owner has an active bot at this table
    let botPlayerId = null;
    if (socket.ownerAddress) {
      const agentStatus = getAgentStatus(socket.ownerAddress);
      if (agentStatus && agentStatus.gameId === Number(gameId) && agentStatus.botAddress) {
        botPlayerId = agentStatus.botAddress;
        ownerSpectators.set(socket.id, { ownerAddress: socket.ownerAddress, botPlayerId, tableId });
      }
    }

    const table = tables.get(tableId);
    if (table) {
      const viewAs = botPlayerId || '__spectator__';
      socket.emit('spectatorState', enrichState(table, table.toPublicState(viewAs), viewAs));
    }
    ack?.({ ok: true, found: !!table });
  });

  socket.on('disconnect', () => {
    ownerSpectators.delete(socket.id);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(config.server.port, () => {
  console.log(`🚀 CryptoPoker server running on port ${config.server.port}`);
  console.log(`🔑 Server signer: ${getServerSignerAddress()}`);
  console.log(`⛓️  Chain ID: ${config.chain.chainId}`);
  console.log(`💰 Buy-in fee: ${config.fees.buyInBps / 100}%  |  Winner fee: ${config.fees.winnerBps / 100}%`);
});

setInterval(() => {
  try {
    runHygieneSweep('interval');
  } catch (err) {
    console.error('[HYGIENE] sweep failed:', err.message);
  }
}, HYGIENE_INTERVAL_MS);

export { app, io };
