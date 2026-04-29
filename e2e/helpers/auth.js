/**
 * auth.js — Authenticate a wallet against the test server and connect a socket.
 *
 * Node 16-compatible (no built-in fetch — uses node:http).
 *
 * Exports:
 *   authenticate(wallet, serverCtx) → { jwt, socket }
 *   waitForEvent(socket, event, timeoutMs?)
 *   emit(socket, event, payload?, timeoutMs?)
 *   emitExpectError(socket, event, payload?, timeoutMs?)
 */

import http from 'node:http';
import { io as ioClient } from 'socket.io-client';

// ─── HTTP helper (Node 16, no fetch) ─────────────────────────────────────────

function httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: u.hostname,
      port: Number(u.port) || 80,
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(bodyBuf ? { 'content-type': 'application/json', 'content-length': bodyBuf.length } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.end(bodyBuf);
    else req.end();
  });
}

// ─── Auth flow ────────────────────────────────────────────────────────────────

/**
 * Perform the challenge/verify auth flow and return a JWT.
 */
export async function getJwt(wallet, { baseUrl, apiKey }) {
  // getAddress() works for both ethers.Wallet and ethers.NonceManager
  const address = wallet.address ?? (await wallet.getAddress());

  // Step 1: challenge
  const chalRes = await httpRequest(
    `${baseUrl}/auth/challenge`,
    'POST',
    { 'x-poker-key': apiKey },
    { address }
  );
  if (chalRes.status !== 200) throw new Error(`Challenge failed (${chalRes.status}): ${chalRes.text}`);
  const { message } = chalRes.json();

  // Step 2: sign (signMessage delegates to underlying signer for NonceManager)
  const signature = await wallet.signMessage(message);

  // Step 3: verify
  const verRes = await httpRequest(
    `${baseUrl}/auth/verify`,
    'POST',
    { 'x-poker-key': apiKey },
    { address, signature }
  );
  if (verRes.status !== 200) throw new Error(`Verify failed (${verRes.status}): ${verRes.text}`);
  const { token } = verRes.json();
  return token;
}

/**
 * Create an authenticated Socket.IO connection.
 */
export function connectSocket(jwt, { baseUrl, apiKey }) {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    auth: { token: jwt, apiKey },
  });
}

/**
 * Full authenticate: challenge → sign → verify → connect socket.
 * Returns { jwt, socket }.  Caller must call socket.disconnect() when done.
 */
export async function authenticate(wallet, serverCtx) {
  const jwt = await getJwt(wallet, serverCtx);
  const socket = connectSocket(jwt, serverCtx);
  await waitForEvent(socket, 'connect', 8_000);
  return { jwt, socket };
}

// ─── Socket helpers ───────────────────────────────────────────────────────────

/**
 * Wait for a socket event and return its payload.
 */
export function waitForEvent(socket, event, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}" (${timeoutMs}ms)`)),
      timeoutMs
    );
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

/**
 * Emit with ack; rejects on { error } or timeout.
 */
export function emit(socket, event, payload = {}, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Ack timeout for "${event}"`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack?.error) reject(new Error(`Server error on "${event}": ${ack.error}`));
      else resolve(ack);
    });
  });
}

/**
 * Like emit but expects the server to return { error }.
 * Resolves with the error string. Rejects if no error returned.
 */
export function emitExpectError(socket, event, payload = {}, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Ack timeout for "${event}"`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack?.error) resolve(ack.error);
      else reject(new Error(`Expected server error on "${event}" but got: ${JSON.stringify(ack)}`));
    });
  });
}
