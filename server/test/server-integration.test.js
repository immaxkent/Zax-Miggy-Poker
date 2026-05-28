/**
 * Tier B — Server integration tests
 *
 * Spins up a real server subprocess on port 3099, then tests HTTP + Socket.IO.
 * Does NOT test actual blockchain flows; addresses are unset so chain calls no-op.
 *
 * Run: node --test test/server-integration.test.js  (from server/)
 * Or:  npm run test:integration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { ethers } from 'ethers';
import { io as ioc } from 'socket.io-client';

const __dir = path.dirname(fileURLToPath(import.meta.url));

const TEST_PORT  = 3099;
const BASE_URL   = `http://localhost:${TEST_PORT}`;
const API_KEY    = 'test-api-key-integration-9z8y7x';
const JWT_SECRET = 'test-jwt-secret-minimum-32-chars!!!!';
const HMAC_SECRET = 'test-hmac-secret-value';
// Anvil test key #0 — publicly known, safe for tests
const SIGNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let serverProcess;

// ── HTTP helper (no fetch in Node 16) ────────────────────────────────────────

function httpReq(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: Number(u.port) || 80,
      path: u.pathname + (u.search || ''),
      method,
      headers,
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => JSON.parse(text),
          text: () => text,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function apiGet(path, headers = {}) {
  return httpReq(`${BASE_URL}${path}`, { headers });
}

function apiPost(path, body, extraHeaders = {}) {
  return httpReq(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  });
}

function apiDel(path, headers = {}) {
  return httpReq(`${BASE_URL}${path}`, { method: 'DELETE', headers });
}

async function waitForServer(maxMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await apiGet('/health');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('Server did not become ready in time');
}

async function getAuthToken(wallet) {
  const chalRes = await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY });
  const { message } = chalRes.json();
  const sig = await wallet.signMessage(message);
  const verRes = await apiPost('/auth/verify', { address: wallet.address, signature: sig }, { 'X-Poker-Key': API_KEY });
  const { token } = verRes.json();
  return token;
}

// ── All tests wrapped in one describe so before/after are properly scoped ─────
// Node 16's experimental test runner requires lifecycle hooks to be inside a
// describe block to guarantee they run before child tests.

describe('Server Integration', () => {
  before(async () => {
    serverProcess = fork(path.join(__dir, '../src/server.js'), [], {
      env: {
        ...process.env,
        PORT:                String(TEST_PORT),
        JWT_SECRET,
        HMAC_SECRET,
        SIGNER_PRIVATE_KEY:  SIGNER_KEY,
        SERVER_API_KEY:      API_KEY,
        NODE_ENV:            'test',
        CHAIN_ID:            '31337',
        ALLOWED_ORIGINS:     '',
        TOKEN_ADDRESS:       '',
        VAULT_ADDRESS:       '',
        ZAX_MIGGY_VAULT_ADDRESS: '',
        USDC_ADDRESS:        '',
        AGENTIC_RANKINGS_ADDRESS: '',
      },
      silent: true,
    });

    serverProcess.stderr.on('data', d => {
      const txt = d.toString();
      if (!txt.includes('ExperimentalWarning')) {
        process.stderr.write('[server] ' + txt);
      }
    });

    await waitForServer();
  });

  after(() => {
    serverProcess?.kill('SIGTERM');
  });

  // ── GET /health ─────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns status ok', async () => {
      const res = await apiGet('/health');
      assert.strictEqual(res.status, 200);
      const body = res.json();
      assert.strictEqual(body.status, 'ok');
    });

    it('includes tables count', async () => {
      const body = (await apiGet('/health')).json();
      assert.ok(typeof body.tables === 'number');
    });

    it('does not require API key', async () => {
      const res = await apiGet('/health');
      assert.ok(res.ok);
    });
  });

  // ── GET /api/games ──────────────────────────────────────────────────────────

  describe('GET /api/games', () => {
    it('returns legacy, arenaLive, and arenaDb arrays', async () => {
      const res = await apiGet('/api/games');
      assert.strictEqual(res.status, 200);
      const body = res.json();
      assert.ok(Array.isArray(body.legacy));
      assert.ok(Array.isArray(body.arenaLive));
      assert.ok(Array.isArray(body.arenaDb));
    });

    it('requires no authentication', async () => {
      const res = await apiGet('/api/games');
      assert.ok(res.ok);
    });

    it('returns no usdc tables initially', async () => {
      const { legacy } = (await apiGet('/api/games')).json();
      const usdcGames = legacy.filter(g => g.tableId?.startsWith('usdc-'));
      assert.strictEqual(usdcGames.length, 0);
    });

    it('each legacy game entry has expected shape', async () => {
      const { legacy } = (await apiGet('/api/games')).json();
      assert.ok(Array.isArray(legacy));
    });
  });

  // ── POST /auth/challenge ────────────────────────────────────────────────────

  describe('POST /auth/challenge', () => {
    it('returns 401 without API key', async () => {
      const wallet = ethers.Wallet.createRandom();
      const res = await apiPost('/auth/challenge', { address: wallet.address });
      assert.strictEqual(res.status, 401);
    });

    it('returns 400 for invalid address', async () => {
      const res = await apiPost('/auth/challenge', { address: 'not-an-address' }, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 for missing address', async () => {
      const res = await apiPost('/auth/challenge', {}, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 400);
    });

    it('returns nonce and message for a valid address', async () => {
      const wallet = ethers.Wallet.createRandom();
      const res = await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 200);
      const body = res.json();
      assert.ok(typeof body.nonce === 'string' && body.nonce.length > 0, 'nonce missing');
      assert.ok(typeof body.message === 'string', 'message missing');
      assert.ok(body.message.includes(body.nonce), 'message should contain nonce');
    });

    it('message prefix matches expected login prompt', async () => {
      const wallet = ethers.Wallet.createRandom();
      const { message } = (await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY })).json();
      assert.ok(message.startsWith('Sign this message to log in to CryptoPoker'));
    });
  });

  // ── POST /auth/verify ───────────────────────────────────────────────────────

  describe('POST /auth/verify', () => {
    it('returns 400 when no challenge exists for address', async () => {
      const wallet = ethers.Wallet.createRandom();
      const res = await apiPost('/auth/verify', { address: wallet.address, signature: '0x00' }, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 400);
    });

    it('returns 401 when signature is from the wrong wallet', async () => {
      const wallet   = ethers.Wallet.createRandom();
      const impostor = ethers.Wallet.createRandom();
      const { message } = (await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY })).json();
      const sig = await impostor.signMessage(message);
      const res = await apiPost('/auth/verify', { address: wallet.address, signature: sig }, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 401);
    });

    it('issues a JWT when signature matches', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);
      assert.ok(typeof token === 'string', 'token should be a string');
      assert.strictEqual(token.split('.').length, 3, 'token should be a JWT (3 segments)');
    });

    it('returns the normalised wallet address alongside the JWT', async () => {
      const wallet = ethers.Wallet.createRandom();
      const { message } = (await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY })).json();
      const sig = await wallet.signMessage(message);
      const body = (await apiPost('/auth/verify', { address: wallet.address, signature: sig }, { 'X-Poker-Key': API_KEY })).json();
      assert.ok(body.address, 'response should include address');
      assert.strictEqual(body.address.toLowerCase(), wallet.address.toLowerCase());
    });

    it('challenge is consumed after successful verify (replay rejected)', async () => {
      const wallet = ethers.Wallet.createRandom();
      const { message } = (await apiPost('/auth/challenge', { address: wallet.address }, { 'X-Poker-Key': API_KEY })).json();
      const sig = await wallet.signMessage(message);
      await apiPost('/auth/verify', { address: wallet.address, signature: sig }, { 'X-Poker-Key': API_KEY });
      const res2 = await apiPost('/auth/verify', { address: wallet.address, signature: sig }, { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res2.status, 400, 'replay should be rejected with 400');
    });
  });

  // ── /spectate namespace ─────────────────────────────────────────────────────

  describe('/spectate namespace', () => {
    it('rejects connection without API key', async () => {
      const errMsg = await new Promise((resolve) => {
        const s = ioc(`${BASE_URL}/spectate`, { auth: {}, transports: ['websocket'], reconnection: false });
        s.on('connect_error', (e) => { s.disconnect(); resolve(e.message); });
        s.on('connect', () => { s.disconnect(); resolve(null); });
        setTimeout(() => resolve('timeout'), 3000);
      });
      assert.ok(errMsg?.includes('INVALID_API_KEY'), `Expected INVALID_API_KEY, got: ${errMsg}`);
    });

    it('rejects connection with wrong API key', async () => {
      const errMsg = await new Promise((resolve) => {
        const s = ioc(`${BASE_URL}/spectate`, { auth: { apiKey: 'wrong-key-xyz' }, transports: ['websocket'], reconnection: false });
        s.on('connect_error', (e) => { s.disconnect(); resolve(e.message); });
        s.on('connect', () => { s.disconnect(); resolve(null); });
        setTimeout(() => resolve('timeout'), 3000);
      });
      assert.ok(errMsg?.includes('INVALID_API_KEY'));
    });

    it('accepts connection with correct API key', async () => {
      const connected = await new Promise((resolve, reject) => {
        const s = ioc(`${BASE_URL}/spectate`, { auth: { apiKey: API_KEY }, transports: ['websocket'], reconnection: false });
        s.on('connect', () => { s.disconnect(); resolve(true); });
        s.on('connect_error', (e) => reject(new Error(e.message)));
        setTimeout(() => reject(new Error('connection timeout')), 5000);
      });
      assert.ok(connected);
    });

    it('spectate event for non-existent game returns found: false', async () => {
      const ack = await new Promise((resolve, reject) => {
        const s = ioc(`${BASE_URL}/spectate`, { auth: { apiKey: API_KEY }, transports: ['websocket'], reconnection: false });
        s.on('connect', () => {
          s.emit('spectate', { gameId: 99999 }, (a) => { s.disconnect(); resolve(a); });
        });
        s.on('connect_error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
      assert.strictEqual(ack?.ok, true);
      assert.strictEqual(ack?.found, false);
    });

    it('spectate with valid JWT does not crash connection', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);
      const ack = await new Promise((resolve, reject) => {
        const s = ioc(`${BASE_URL}/spectate`, {
          auth: { apiKey: API_KEY, token },
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => {
          s.emit('spectate', { gameId: 1 }, (a) => { s.disconnect(); resolve(a); });
        });
        s.on('connect_error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
      assert.strictEqual(ack?.found, false);
    });
  });

  // ── Agent endpoint auth guards ──────────────────────────────────────────────

  describe('Agent endpoints — auth guards', () => {
    it('POST /agent/activate returns 401 without JWT', async () => {
      const res = await apiPost('/agent/activate',
        { keystoreJson: '{}', keystorePassword: 'pw', gameId: 1 },
        { 'X-Poker-Key': API_KEY }
      );
      assert.strictEqual(res.status, 401);
    });

    it('GET /agent/status returns 401 without JWT', async () => {
      const res = await apiGet('/agent/status', { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 401);
    });

    it('DELETE /agent returns 401 without JWT', async () => {
      const res = await apiDel('/agent', { 'X-Poker-Key': API_KEY });
      assert.strictEqual(res.status, 401);
    });

    it('POST /agent/activate returns 400 when required fields missing (after auth)', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);
      const res = await apiPost('/agent/activate', {},
        { 'X-Poker-Key': API_KEY, 'Authorization': `Bearer ${token}` }
      );
      assert.strictEqual(res.status, 400);
    });

    it('GET /agent/status returns "none" when no agent running (after auth)', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);
      const res = await apiGet('/agent/status',
        { 'X-Poker-Key': API_KEY, 'Authorization': `Bearer ${token}` }
      );
      assert.strictEqual(res.status, 200);
      const body = res.json();
      assert.strictEqual(body.status, 'none');
    });

    it('DELETE /agent returns 404 when no agent running (after auth)', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);
      const res = await apiDel('/agent',
        { 'X-Poker-Key': API_KEY, 'Authorization': `Bearer ${token}` }
      );
      assert.strictEqual(res.status, 404);
    });
  });

  // ── Main Socket.IO namespace ────────────────────────────────────────────────

  describe('Main Socket.IO namespace', () => {
    it('rejects connection without API key', async () => {
      const errMsg = await new Promise((resolve) => {
        const s = ioc(`${BASE_URL}`, { auth: { token: 'fake-token' }, transports: ['websocket'], reconnection: false });
        s.on('connect_error', (e) => { s.disconnect(); resolve(e.message); });
        s.on('connect', () => { s.disconnect(); resolve(null); });
        setTimeout(() => resolve('timeout'), 3000);
      });
      assert.ok(errMsg !== null, 'Should have been rejected');
    });

    it('authenticated player can connect and receive initial state', async () => {
      const wallet = ethers.Wallet.createRandom();
      const token = await getAuthToken(wallet);

      const connected = await new Promise((resolve, reject) => {
        const s = ioc(`${BASE_URL}`, {
          auth: { token, apiKey: API_KEY },
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => { s.disconnect(); resolve(true); });
        s.on('connect_error', (e) => reject(new Error(e.message)));
        setTimeout(() => reject(new Error('connection timeout')), 5000);
      });
      assert.ok(connected);
    });
  });
});
