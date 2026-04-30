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
  verifyMessage,
  createChallenge,
  getChallenge,
  consumeChallenge,
  socketAuthMiddleware,
  signWithdrawalVoucher,
  getServerSignerAddress,
  signAndSubmitCancelGame,
} from './security.js';
import { PokerTable } from './poker-engine.js';

// ─── Validate env on boot ─────────────────────────────────────────────────────
validateConfig();

// ─── In-memory stores (replace with Redis/DB for multi-instance) ──────────────
const players = new Map();  // address → { id, chips, tableId, nonce }
const tables  = new Map();  // tableId → PokerTable
const usdcStacks = new Map();  // tableId → Map<playerId, chips> (stack when they left, for rejoin)
const terminatedTables = new Set();  // tableIds that have been terminated (blocks rejoin)

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
app.use(rateLimiter(60, 60_000));

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
app.post('/auth/challenge', requireApiKey, rateLimiter(10, 60_000), (req, res) => {
  const { address } = req.body;
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });
  const nonce = createChallenge(address);
  res.json({
    nonce,
    message: `Sign this message to log in to CryptoPoker.\nNonce: ${nonce}`,
  });
});

// ── Auth: Step 2 — verify signature, issue JWT ────────────────────────────────
app.post('/auth/verify', requireApiKey, rateLimiter(10, 60_000), async (req, res) => {
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
  socket.on('joinUsdcTable', ({ gameId }, ack) => {
    try {
      const player = players.get(playerId);
      if (!player) return ack?.({ error: 'NOT_AUTHENTICATED' });
      if (player.tableId) return ack?.({ error: 'Already at a table. Leave first.' });

      const tableId = `usdc-${gameId}`;
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
        };
        table = new PokerTable({
          ...usdcStake,
          actionTimeoutSeconds: config.tables.actionTimeoutSeconds,
          minPlayers: usdcStake.minPlayers || config.tables.minPlayersToStart,
        }, tableId);
        tables.set(tableId, table);
        console.log(`📋 USDC table created: ${tableId}`);
        table.hostId = null;
        table.gameStarted = false;
      }

      const stackMap = usdcStacks.get(tableId) || new Map();
      const savedStack = stackMap.get(playerId);
      const startingChips = savedStack != null ? savedStack : 1000;
      if (savedStack != null) stackMap.delete(playerId);
      usdcStacks.set(tableId, stackMap);
      player.tableId = tableId;
      if (!table.hostId) table.hostId = (playerId || '').toLowerCase();
      const state = enrichState(table, table.sitDown({ id: playerId, address: playerId, chips: startingChips }), playerId);

      socket.join(tableId);
      io.to(tableId).emit('playerJoined', { playerId, chips: startingChips });
      ack?.({ state });

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

      // Hand finished: applyAction returns toPublicState (no `results`). Engine sets pendingHandComplete.
      if (table.pendingHandComplete) {
        const hc = table.pendingHandComplete;
        table.pendingHandComplete = null;
        io.to(player.tableId).emit('handComplete', {
          handNumber: hc.handNumber,
          results:    hc.results,
          community:  hc.community,
          holeCards:  hc.holeCards,
          verify:     hc.verify,
        });
        issueWinnerVouchers(io, hc.results, player.tableId);
      }

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
}

function findSocket(io, playerId) {
  const id = (playerId || '').toLowerCase();
  for (const [, s] of io.sockets.sockets) {
    if ((s.walletAddress || '').toLowerCase() === id) return s;
  }
  return null;
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
  ack?.({ chips: player.chips });
}

function tryStartHand(io, table) {
  if (!table.canStart() || table.stage !== 'waiting') return false;
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

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(config.server.port, () => {
  console.log(`🚀 CryptoPoker server running on port ${config.server.port}`);
  console.log(`🔑 Server signer: ${getServerSignerAddress()}`);
  console.log(`⛓️  Chain ID: ${config.chain.chainId}`);
  console.log(`💰 Buy-in fee: ${config.fees.buyInBps / 100}%  |  Winner fee: ${config.fees.winnerBps / 100}%`);
});

export { app, io };
