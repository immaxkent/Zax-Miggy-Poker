/**
 * agent-launch.test.js
 *
 * E2E tests for the no-JWT bot launch endpoints:
 *   POST /agent/launch
 *   GET  /agent/status/:botAddress
 *
 * These cover the regression where BotConfig.jsx called /agent/activate
 * (which requires a JWT) instead of /agent/launch, causing "Failed to activate
 * agent" whenever the user hadn't signed in with MetaMask.
 *
 * Run:  cd e2e && npm test
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';

import { startAnvil, ANVIL_KEYS } from '../helpers/anvil.js';
import { startServer } from '../helpers/server.js';

function httpReq(url, method, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname,
        method,
        headers: {
          ...headers,
          ...(bodyBuf ? { 'content-type': 'application/json', 'content-length': bodyBuf.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, text, json: () => JSON.parse(text) });
        });
      }
    );
    req.on('error', reject);
    if (bodyBuf) req.end(bodyBuf);
    else req.end();
  });
}

describe('Bot launch — no-JWT endpoints', () => {
  let anvil, server;
  let botWallet, keystoreJson, botAddress;
  const PASSWORD = 'test-password-123';

  before(async () => {
    anvil  = await startAnvil();
    const serverPort = 15000 + Math.floor(Math.random() * 1000);
    server = await startServer({
      port:           serverPort,
      signerPrivKey:  ANVIL_KEYS[1],
      anvilUrl:       anvil.anvilUrl,
      vaultAddress:   await anvil.vault.getAddress(),
      usdcAddress:    await anvil.usdc.getAddress(),
    });

    // Generate a bot wallet and encrypt it (low N for speed in tests)
    botWallet   = ethers.Wallet.createRandom();
    botAddress  = botWallet.address.toLowerCase();
    // ethers v6: second arg to encrypt() must be a ProgressCallback function
    keystoreJson = await botWallet.encrypt(PASSWORD, () => {});
  });

  after(() => {
    try { server?.stop(); } catch {}
    try { anvil?.stop(); } catch {}
  });

  // ── /agent/launch ────────────────────────────────────────────────────────────

  it('POST /agent/launch returns 401 without API key', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { /* no x-poker-key */ },
      { keystoreJson, keystorePassword: PASSWORD }
    );
    assert.equal(res.status, 401, 'Expected 401 without API key');
  });

  it('POST /agent/launch returns 400 when keystoreJson is missing', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystorePassword: PASSWORD }
    );
    assert.equal(res.status, 400);
    assert.ok(res.json().error, 'Expected error message in body');
  });

  it('POST /agent/launch returns 400 when keystorePassword is missing', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystoreJson }
    );
    assert.equal(res.status, 400);
  });

  it('POST /agent/launch returns 400 for malformed JSON keystore', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystoreJson: 'not-json', keystorePassword: PASSWORD }
    );
    assert.equal(res.status, 400);
    assert.match(res.json().error, /invalid keystore/i);
  });

  it('POST /agent/launch returns 400 for keystore without address field', async () => {
    const noAddr = JSON.stringify({ version: 3, crypto: {}, id: 'test' });
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystoreJson: noAddr, keystorePassword: PASSWORD }
    );
    assert.equal(res.status, 400);
  });

  it('POST /agent/launch succeeds with valid keystore — no JWT required', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystoreJson, keystorePassword: PASSWORD, config: { persona: 'gto' } }
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
    const body = res.json();
    assert.ok(body.ok, 'Expected ok:true');
    assert.ok(body.botAddress, 'Expected botAddress in response');
    assert.equal(body.botAddress.toLowerCase(), botAddress, 'botAddress should match generated wallet');
  });

  it('POST /agent/launch returns 409 if same bot tries to launch twice', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/launch`,
      'POST',
      { 'x-poker-key': server.apiKey },
      { keystoreJson, keystorePassword: PASSWORD }
    );
    assert.equal(res.status, 409, 'Expected 409 conflict for duplicate launch');
    assert.match(res.json().error, /already running/i);
  });

  // ── /agent/status/:botAddress ─────────────────────────────────────────────────

  it('GET /agent/status/:botAddress returns 401 without API key', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/status/${botAddress}`,
      'GET',
      { /* no x-poker-key */ }
    );
    assert.equal(res.status, 401);
  });

  it('GET /agent/status/:botAddress returns status object — no JWT required', async () => {
    const res = await httpReq(
      `${server.baseUrl}/agent/status/${botAddress}`,
      'GET',
      { 'x-poker-key': server.apiKey }
    );
    assert.equal(res.status, 200);
    const body = res.json();
    // Agent may have started then exited (no game available in test env); either
    // 'running', 'exited', or 'exited(N)' are all valid — what matters is that
    // the endpoint resolves the bot address correctly and returns structured data.
    assert.ok(body.status, 'Expected a status field');
    assert.ok(
      body.botAddress?.toLowerCase() === botAddress || body.status === 'none',
      `Expected botAddress=${botAddress} or status=none, got: ${JSON.stringify(body)}`
    );
  });

  it('GET /agent/status/:botAddress returns {status:"none"} for unknown address', async () => {
    const unknownAddr = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const res = await httpReq(
      `${server.baseUrl}/agent/status/${unknownAddr}`,
      'GET',
      { 'x-poker-key': server.apiKey }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json().status, 'none');
  });
});
