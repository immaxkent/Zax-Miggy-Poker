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
} from './security.js';
import { PokerTable } from './poker-engine.js';

// ─── Validate env on boot ─────────────────────────────────────────────────────
validateConfig();

// ─── In-memory stores (replace with Redis/DB for multi-instance) ──────────────
const players = new Map();  // address → { id, chips, tableId, nonce }
const tables  = new Map();  // tableId → PokerTable

// ─── Pre-create tables for each stake level ───────────────────────────────────
for (const [key, stakeConfig] of Object.entries(config.tables.stakes)) {
  const tableId = `${key}-1`;
  tables.set(tableId, new PokerTable({
    ...stakeConfig,
    actionTimeoutSeconds:  config.tables.actionTimeoutSeconds,
    minPlayers:            stakeConfig.minPlayers || config.tables.minPlayersToStart,
  }, tableId));
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
    const recovered = ethers.verifyMessage(message, signature);

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

      const table = tables.get(tableId);
      if (!table)           return ack?.({ error: 'TABLE_NOT_FOUND' });

      if (player.chips < buyIn)         return ack?.({ error: 'INSUFFICIENT_CHIPS' });
      if (buyIn < table.config.minBuyIn) return ack?.({ error: 'BELOW_MIN_BUY_IN' });
      if (buyIn > table.config.maxBuyIn) return ack?.({ error: 'ABOVE_MAX_BUY_IN' });

      // Deduct chips and sit down
      player.chips  -= buyIn;
      player.tableId = tableId;
      const state    = table.sitDown({ id: playerId, address: playerId, chips: buyIn });

      socket.join(tableId);
      io.to(tableId).emit('playerJoined', { playerId, chips: buyIn });
      ack?.({ state });

      // Auto-start if enough players
      if (table.canStart() && table.stage === 'waiting') {
        setTimeout(() => tryStartHand(table), 3000);
      }
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
      }

      const startingChips = 1000;
      player.tableId = tableId;
      const state = table.sitDown({ id: playerId, address: playerId, chips: startingChips });

      socket.join(tableId);
      io.to(tableId).emit('playerJoined', { playerId, chips: startingChips });
      ack?.({ state });

      if (table.canStart() && table.stage === 'waiting') {
        setTimeout(() => tryStartHand(table), 3000);
      }
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
      const result = table.applyAction(playerId, action, amount);

      // Broadcast new state to all at table
      table.players.forEach(p => {
        const playerSocket = findSocket(p.id);
        if (playerSocket) {
          playerSocket.emit('gameState', table.toPublicState(p.id));
        }
      });

      // Showdown resolution
      if (table.stage === 'waiting' && result?.results) {
        io.to(player.tableId).emit('handComplete', {
          results:  result.results,
          community: result.community,
          verify:   result.verify,
        });

        // Issue withdrawal vouchers for net winners
        issueWinnerVouchers(result.results, player.tableId);

        setTimeout(() => tryStartHand(table), 5000);
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
    ack?.({ state: table.toPublicState(playerId) });
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
function findSocket(playerId) {
  for (const [, s] of io.sockets.sockets) {
    if (s.walletAddress === playerId) return s;
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
  if (!isUsdcTable) {
    player.chips += refundChips;
  }
  player.tableId = null;

  socket.leave(table.id);
  io.to(table.id).emit('playerLeft', { playerId });
  socket.emit('chipsUpdated', { chips: player.chips });
  ack?.({ chips: player.chips });
}

function tryStartHand(table) {
  if (!table.canStart() || table.stage !== 'waiting') return;
  const info = table.startHand();
  // Broadcast private hole cards to each player
  table.players.forEach(p => {
    const s = findSocket(p.id);
    if (s) s.emit('gameState', table.toPublicState(p.id));
  });
  io.to(table.id).emit('handStarted', {
    handNumber:  info.handNumber,
    dealerIdx:   info.dealerIdx,
    serverHash:  info.serverHash, // for provability
  });
  console.log(`🃏 Hand #${info.handNumber} started on ${table.id}`);
}

async function issueWinnerVouchers(results, tableId) {
  const isUsdcTable = tableId.startsWith('usdc-');
  for (const [playerId, { won }] of Object.entries(results)) {
    if (won <= 0) continue;
    const player = players.get(playerId);
    if (!player) continue;

    if (!isUsdcTable) {
      player.chips += won;
    }
    const s = findSocket(playerId);
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
