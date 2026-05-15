/**
 * security.js
 *
 * All server-side trust checks:
 *  1. API key gate  — every HTTP request must include X-Poker-Key
 *  2. HMAC guard    — every WS message must include a HMAC-SHA256 of its payload
 *  3. JWT auth      — players hold a short-lived JWT tied to their wallet address
 *  4. Rate limiter  — simple in-memory per-IP limiter
 *
 * The combination means:
 *  • Only our own frontend (holding the API key) can even connect
 *  • Messages can't be tampered in transit (HMAC)
 *  • Player identity can't be spoofed (JWT + wallet signature on login)
 */

import crypto from 'crypto';
import jwt    from 'jsonwebtoken';
import config from './config.js';

// ─── API Key middleware (Express) ─────────────────────────────────────────────
export function requireApiKey(req, res, next) {
  const key = req.headers['x-poker-key'];
  if (!key || key !== config.server.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────
export function issueJWT(walletAddress) {
  return jwt.sign(
    { sub: walletAddress.toLowerCase(), iat: Math.floor(Date.now() / 1000) },
    config.server.jwtSecret,
    { expiresIn: '8h', algorithm: 'HS256' }
  );
}

export function verifyJWT(token) {
  return jwt.verify(token, config.server.jwtSecret, { algorithms: ['HS256'] });
}

// ─── HMAC message signing ─────────────────────────────────────────────────────
/**
 * Clients compute HMAC-SHA256(JSON.stringify(payload), sharedHmacSecret)
 * and attach it as `payload._hmac`.  Server verifies before processing.
 */
export function signMessage(payload) {
  const body = JSON.stringify(payload);
  const sig  = crypto
    .createHmac('sha256', config.server.hmacSecret)
    .update(body)
    .digest('hex');
  return { ...payload, _hmac: sig };
}

export function verifyMessage(payload) {
  const { _hmac, ...rest } = payload;
  if (!_hmac) return false;
  const expected = crypto
    .createHmac('sha256', config.server.hmacSecret)
    .update(JSON.stringify(rest))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(_hmac,    'hex'),
    Buffer.from(expected, 'hex')
  );
}

// ─── Socket.IO auth middleware ────────────────────────────────────────────────
export function socketAuthMiddleware(socket, next) {
  try {
    const { token, apiKey } = socket.handshake.auth;

    // 1. API key check
    if (!apiKey || apiKey !== config.server.apiKey) {
      return next(new Error('INVALID_API_KEY'));
    }

    // 2. JWT check
    const payload = verifyJWT(token);
    socket.walletAddress = payload.sub;
    next();
  } catch (err) {
    next(new Error('INVALID_TOKEN'));
  }
}

// ─── Wallet login challenge (EIP-191 personal_sign) ───────────────────────────
const challenges = new Map(); // address → { nonce, expiresAt }

export function createChallenge(address) {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min
  challenges.set(address.toLowerCase(), { nonce, expiresAt });
  return nonce;
}

export function getChallenge(address) {
  const rec = challenges.get(address.toLowerCase());
  if (!rec || Date.now() > rec.expiresAt) {
    challenges.delete(address?.toLowerCase());
    return null;
  }
  return rec.nonce;
}

export function consumeChallenge(address) {
  challenges.delete(address.toLowerCase());
}

// ─── Withdrawal voucher signing ───────────────────────────────────────────────
import { ethers } from 'ethers';

const signerWallet = new ethers.Wallet(config.server.signerPrivKey);

/**
 * Sign a withdrawal voucher.
 * Hash must match exactly what PokerVault.sol verifies.
 */
export async function signWithdrawalVoucher({ chainId, vaultAddress, playerAddress, amount, nonce }) {
  const packed = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'address', 'uint256', 'uint256'],
    [chainId, vaultAddress, playerAddress.toLowerCase(), amount, nonce]
  );
  // toEthSignedMessageHash is what ethers.signMessage does under the hood
  const sig = await signerWallet.signMessage(ethers.getBytes(packed));
  return sig;
}

export function getServerSignerAddress() {
  return signerWallet.address;
}

// ─── Vault contract — server-submitted on-chain transactions ─────────────────

const VAULT_ABI = [
  'function cancelGame(uint256 gameId, uint256 nonce, bytes calldata sig) external',
  'function closeGame(uint256 gameId, address winner, uint256 nonce, bytes calldata sig) external',
  'function getGame(uint256 gameId) view returns (address[] players, uint8 playerCount, uint256 depositAmount, uint256 createdAt, bool finished, address winner)',
];

// Lazily initialised so the server can start before the vault address is set
let _vault = null;

function getVault() {
  if (_vault) return _vault;
  const addr = config.chain.zaxMiggyVaultAddress;
  if (!addr) return null;
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const connected = new ethers.Wallet(config.server.signerPrivKey, provider);
  _vault = new ethers.Contract(addr, VAULT_ABI, connected);
  return _vault;
}

/**
 * Sign and submit cancelGame on-chain. Resolves when the tx is mined.
 * Hash mirrors _buildCancelHash in ZaxAndMiggyVault.sol:
 *   keccak256(abi.encodePacked(block.chainid, address(this), "cancel", gameId, nonce))
 */
export async function signAndSubmitCancelGame(gameId) {
  const vault = getVault();
  if (!vault) throw new Error('ZAX_MIGGY_VAULT_ADDRESS not configured — cannot cancel game on-chain');

  const nonce  = BigInt(Date.now());
  const packed = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'string', 'uint256', 'uint256'],
    [config.chain.chainId, config.chain.zaxMiggyVaultAddress, 'cancel', BigInt(gameId), nonce]
  );
  const sig = await signerWallet.signMessage(ethers.getBytes(packed));
  const tx  = await vault.cancelGame(BigInt(gameId), nonce, sig);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

/**
 * Sign and submit closeGame on-chain. Resolves when the tx is mined.
 * Hash mirrors _buildCloseHash in ZaxAndMiggyVault.sol:
 *   keccak256(abi.encodePacked(block.chainid, address(this), "close", gameId, winner, nonce))
 */
export async function signAndSubmitCloseGame(gameId, winnerAddress) {
  const vault = getVault();
  if (!vault) throw new Error('ZAX_MIGGY_VAULT_ADDRESS not configured — cannot close game on-chain');

  const nonce  = BigInt(Date.now());
  // Hash matches _buildCloseHash in ZaxAndMiggyVault.sol:
  //   keccak256(abi.encodePacked(block.chainid, address(this), gameId, winner, nonce))
  const packed = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'uint256', 'address', 'uint256'],
    [config.chain.chainId, config.chain.zaxMiggyVaultAddress, BigInt(gameId), winnerAddress, nonce]
  );
  const sig = await signerWallet.signMessage(ethers.getBytes(packed));
  const tx  = await vault.closeGame(BigInt(gameId), winnerAddress, nonce, sig);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

// ─── AgenticRankings contract — post-game stat updates ───────────────────────

const RANKINGS_ABI = [
  'function updateRankings(uint256 gameId) external',
  'function recordCancellation(uint256 gameId) external',
  'function getStats(address player) view returns (tuple(uint256 wins, uint256 gamesPlayed, uint256 totalWon, uint256 totalLost))',
  'function getStatsBatch(address[] addresses) view returns (tuple(uint256 wins, uint256 gamesPlayed, uint256 totalWon, uint256 totalLost)[])',
  'event RankingsUpdated(uint256 indexed gameId, address indexed winner, uint8 playerCount)',
  'event CancellationRecorded(uint256 indexed gameId, uint8 playerCount)',
];

const VAULT_READ_ABI = [
  'function getGame(uint256 gameId) view returns (address[8] players, uint8 playerCount, uint256 depositAmount, uint256 createdAt, bool finished, address winner)',
  'function nextGameId() view returns (uint256)',
];

let _rankings = null;

function getRankings() {
  if (_rankings) return _rankings;
  const addr = config.chain.agenticRankingsAddress;
  if (!addr) return null;
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const connected = new ethers.Wallet(config.server.signerPrivKey, provider);
  _rankings = new ethers.Contract(addr, RANKINGS_ABI, connected);
  return _rankings;
}

// ─── Leaderboard — scan events → collect addresses → batch read stats ─────────

let _leaderboardCache = null;
let _leaderboardCachedAt = 0;
const LEADERBOARD_CACHE_MS = 30_000;

export async function getLeaderboard() {
  if (_leaderboardCache && Date.now() - _leaderboardCachedAt < LEADERBOARD_CACHE_MS) {
    return _leaderboardCache;
  }

  const rankingsAddr = config.chain.agenticRankingsAddress;
  const vaultAddr    = config.chain.zaxMiggyVaultAddress;
  if (!rankingsAddr) return { entries: [], lastUpdated: null, error: 'Rankings contract not configured' };

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const rankingsContract = new ethers.Contract(rankingsAddr, RANKINGS_ABI, provider);

  // Collect gameIds from all processed games
  const [updatedLogs, cancelledLogs] = await Promise.all([
    rankingsContract.queryFilter(rankingsContract.filters.RankingsUpdated(), 0, 'latest'),
    rankingsContract.queryFilter(rankingsContract.filters.CancellationRecorded(), 0, 'latest'),
  ]);

  const gameIds = new Set([
    ...updatedLogs.map(l => Number(l.args.gameId)),
    ...cancelledLogs.map(l => Number(l.args.gameId)),
  ]);

  // Collect all unique player addresses from vault game data
  const uniqueAddresses = new Set();

  if (vaultAddr && gameIds.size > 0) {
    const vaultContract = new ethers.Contract(vaultAddr, VAULT_READ_ABI, provider);
    await Promise.all([...gameIds].map(async (gameId) => {
      try {
        const game = await vaultContract.getGame(BigInt(gameId));
        const playerCount = Number(game.playerCount ?? game[1]);
        const players = game.players ?? game[0];
        for (let i = 0; i < playerCount; i++) {
          const addr = players[i];
          if (addr && addr !== ethers.ZeroAddress) uniqueAddresses.add(addr.toLowerCase());
        }
      } catch {
        // skip if game not found
      }
    }));
  } else {
    // Fallback: collect winners from events when vault unavailable
    for (const log of updatedLogs) {
      const winner = log.args.winner;
      if (winner && winner !== ethers.ZeroAddress) uniqueAddresses.add(winner.toLowerCase());
    }
  }

  if (uniqueAddresses.size === 0) {
    _leaderboardCache = { entries: [], lastUpdated: new Date().toISOString() };
    _leaderboardCachedAt = Date.now();
    return _leaderboardCache;
  }

  const addressList = [...uniqueAddresses];
  const rawStats = await rankingsContract.getStatsBatch(addressList);

  const entries = addressList
    .map((address, i) => {
      const s = rawStats[i];
      const wins        = Number(s.wins ?? s[0]);
      const gamesPlayed = Number(s.gamesPlayed ?? s[1]);
      const totalWon    = BigInt(s.totalWon  ?? s[2]);
      const totalLost   = BigInt(s.totalLost ?? s[3]);
      return {
        address,
        wins,
        gamesPlayed,
        totalWon:   totalWon.toString(),
        totalLost:  totalLost.toString(),
        netProfit:  (totalWon - totalLost).toString(),
      };
    })
    .filter(e => e.gamesPlayed > 0)
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return Number(BigInt(b.totalWon) - BigInt(a.totalWon));
    });

  _leaderboardCache = { entries, lastUpdated: new Date().toISOString() };
  _leaderboardCachedAt = Date.now();
  return _leaderboardCache;
}

export async function submitUpdateRankings(gameId) {
  const rankings = getRankings();
  if (!rankings) {
    console.warn(`⚠️  AGENTIC_RANKINGS_ADDRESS not set — skipping rankings update for game ${gameId}`);
    return;
  }
  const tx = await rankings.updateRankings(BigInt(gameId));
  const receipt = await tx.wait();
  console.log(`📊 updateRankings(${gameId}) mined: ${tx.hash}`);
  return { txHash: tx.hash, receipt };
}

export async function submitRecordCancellation(gameId) {
  const rankings = getRankings();
  if (!rankings) {
    console.warn(`⚠️  AGENTIC_RANKINGS_ADDRESS not set — skipping cancellation record for game ${gameId}`);
    return;
  }
  const tx = await rankings.recordCancellation(BigInt(gameId));
  const receipt = await tx.wait();
  console.log(`📊 recordCancellation(${gameId}) mined: ${tx.hash}`);
  return { txHash: tx.hash, receipt };
}

export async function getCloseGameQuote(gameId) {
  const vault = getVault();
  if (!vault) throw new Error('ZAX_MIGGY_VAULT_ADDRESS not configured — cannot quote closeGame payout');
  const g = await vault.getGame(BigInt(gameId));

  const playerCount = Number(g?.playerCount ?? g?.[1] ?? 0);
  const depositAmount = BigInt(g?.depositAmount ?? g?.[2] ?? 0n);
  const totalPot = depositAmount * BigInt(playerCount);
  const winnerPayout = (totalPot * 90n) / 100n;

  return {
    playerCount,
    depositAmount: depositAmount.toString(),
    totalPot: totalPot.toString(),
    winnerPayout: winnerPayout.toString(),
  };
}

// ─── Simple per-IP rate limiter (in-memory) ───────────────────────────────────

export function rateLimiter(maxRequests = 20, windowMs = 60_000) {
  const ipBuckets = new Map();
  return (req, res, next) => {
    const ip  = req.ip;
    const now = Date.now();
    let   bucket = ipBuckets.get(ip);

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      ipBuckets.set(ip, bucket);
    }

    bucket.count++;
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}
