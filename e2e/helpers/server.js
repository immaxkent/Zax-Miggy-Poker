/**
 * server.js — Spawn the game server as a child process for E2E tests.
 *
 * Exports:
 *   startServer(opts) → { baseUrl, apiKey, hmacSecret, stop() }
 *
 * The server is launched with controlled test env vars so it points at
 * the local anvil instance and uses deterministic secrets.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import http from 'node:http';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', '..', 'server');

const TEST_SECRETS = {
  JWT_SECRET:       'e2e-test-jwt-secret-xxxxxxxxxxxxxxxx',
  HMAC_SECRET:      'e2e-test-hmac-secret-xxxxxxxxxxxxxxx',
  SERVER_API_KEY:   'e2e-test-api-key',
  // SIGNER_PRIVATE_KEY is passed per-test so it matches the deployed vault's serverSigner
};

// Node 16-compatible health check (no built-in fetch)
function waitForHealth(baseUrl, timeoutMs = 15_000) {
  const url = new URL('/health', baseUrl);
  const deadline = Date.now() + timeoutMs;

  function attempt() {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: url.hostname, port: Number(url.port), path: url.pathname, method: 'GET' },
        (res) => { res.resume(); resolve(res.statusCode === 200); }
      );
      req.on('error', () => resolve(false));
      req.end();
    });
  }

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() >= deadline) {
        return reject(new Error(`Server at ${baseUrl} did not start within ${timeoutMs}ms`));
      }
      attempt().then((ok) => {
        if (ok) resolve();
        else setTimeout(poll, 300);
      });
    }
    setTimeout(poll, 500);
  });
}

/**
 * @param {object} opts
 * @param {number} opts.port           — port to listen on
 * @param {string} opts.signerPrivKey  — private key matching vault's serverSigner address
 * @param {string} opts.anvilUrl       — JSON-RPC URL for anvil (e.g. http://127.0.0.1:18545)
 * @param {string} opts.vaultAddress   — deployed ZaxAndMiggyVault address
 * @param {string} opts.usdcAddress    — deployed MockUSDC address
 */
export async function startServer({ port, signerPrivKey, anvilUrl, vaultAddress, usdcAddress }) {
  const env = {
    ...process.env,
    PORT:                   String(port),
    NODE_ENV:               'test',
    ALLOWED_ORIGINS:        '',            // allow all origins in test
    CHAIN_ID:               '31337',
    BASE_RPC_URL:           anvilUrl,
    ZAX_MIGGY_VAULT_ADDRESS: vaultAddress,
    USDC_ADDRESS:           usdcAddress,
    SIGNER_PRIVATE_KEY:     signerPrivKey,
    ...TEST_SECRETS,
  };

  const proc = spawn('node', ['src/server.js'], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Surface server stdout/stderr when debugging (set E2E_VERBOSE=1)
  if (process.env.E2E_VERBOSE) {
    proc.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  }

  proc.on('error', (err) => {
    throw new Error(`Failed to spawn server: ${err.message}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  function stop() {
    proc.kill('SIGTERM');
  }

  return {
    baseUrl,
    apiKey:     TEST_SECRETS.SERVER_API_KEY,
    hmacSecret: TEST_SECRETS.HMAC_SECRET,
    jwtSecret:  TEST_SECRETS.JWT_SECRET,
    stop,
  };
}
