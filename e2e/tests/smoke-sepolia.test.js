/**
 * smoke-sepolia.test.js
 *
 * Read-only checks against deployed Base Sepolia + production server.
 * No wallet keys required.
 *
 * Run:
 *   E2E_SMOKE_SEPOLIA=1 cd e2e && npm run test:smoke:sepolia
 *
 * Optional env:
 *   E2E_SERVER_URL=https://zax-and-miggy-poker.ngrok.app
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { httpGet } from '../helpers/http.js';

const RUN = process.env.E2E_SMOKE_SEPOLIA === '1';
const SERVER = process.env.E2E_SERVER_URL || 'https://zax-and-miggy-poker.ngrok.app';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(__dirname, '..', '..', 'versions', 'base-sepolia', '1.0.1', 'agentic-deployment.json');

const describeSmoke = RUN ? describe : describe.skip;

describeSmoke('Base Sepolia smoke (live)', () => {
  let manifest;

  it('loads deployment manifest', () => {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    assert.equal(manifest.chainId, 84532);
    assert.ok(manifest.arenaAddress);
  });

  it('GET /health — arena + supabase', async () => {
    const res = await httpGet(`${SERVER}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.arenaEnabled, true);
    assert.equal(body.dbBackend, 'supabase');
    assert.ok(body.signer?.startsWith('0x'));
  });

  it('GET /api/arena/status — matches manifest', async () => {
    const res = await httpGet(`${SERVER}/api/arena/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.contracts.arena.toLowerCase(), manifest.arenaAddress.toLowerCase());
    assert.equal(body.contracts.rankingsV2.toLowerCase(), manifest.agenticRankingsV2Address.toLowerCase());
  });

  it('GET /api/games — lists arena games', async () => {
    const res = await httpGet(`${SERVER}/api/games`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.arenaDb));
    assert.ok(Array.isArray(body.arenaLive));
  });
});
