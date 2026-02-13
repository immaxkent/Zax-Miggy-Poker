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

// ─── Simple per-IP rate limiter (in-memory) ───────────────────────────────────
const ipBuckets = new Map();

export function rateLimiter(maxRequests = 20, windowMs = 60_000) {
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
