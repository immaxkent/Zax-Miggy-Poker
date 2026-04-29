/**
 * anvil.js — Spawn a local anvil instance and deploy contracts.
 *
 * Exports:
 *   startAnvil()  → { provider, anvilPort, anvilUrl, deployer, wallets, usdc, vault, stop() }
 *
 * Requires `anvil` (Foundry) in PATH.
 * Compatible with Node 16+ (no built-in fetch used).
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import http from 'node:http';
import path from 'path';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'contracts', 'out');

// Anvil deterministic private keys (accounts 0–4)
export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // 0 — deployer / owner
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // 1 — server signer
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // 2 — player 1 (host)
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // 3 — player 2
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // 4 — player 3
];

function loadArtifact(solFile, contractName) {
  const p = path.join(ARTIFACTS, solFile, `${contractName}.json`);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

// Wait for anvil's JSON-RPC to respond (Node 16-compatible, no fetch)
function waitForAnvil(port, timeoutMs = 12_000) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  const deadline = Date.now() + timeoutMs;

  function attempt() {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => { res.resume(); resolve(true); }
      );
      req.on('error', () => resolve(false));
      req.end(body);
    });
  }

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() >= deadline) {
        return reject(new Error(`Anvil on port ${port} did not start within ${timeoutMs}ms`));
      }
      attempt().then((ok) => {
        if (ok) resolve();
        else setTimeout(poll, 250);
      });
    }
    setTimeout(poll, 300); // give the process a moment before first attempt
  });
}

export async function startAnvil() {
  // Use a random port in the ephemeral range to avoid inter-suite collisions
  const port = 18000 + Math.floor(Math.random() * 2000);

  const proc = spawn('anvil', ['--port', String(port), '--silent'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.on('error', (err) => {
    throw new Error(`Failed to spawn anvil: ${err.message}. Is Foundry installed? (https://getfoundry.sh)`);
  });

  await waitForAnvil(port);

  const anvilUrl = `http://127.0.0.1:${port}`;
  const provider = new ethers.JsonRpcProvider(anvilUrl);

  // Wallets connected to provider
  const rawWallets = ANVIL_KEYS.map(pk => new ethers.Wallet(pk, provider));
  const [rawDeployer, serverSignerWallet, player1, player2, player3] = rawWallets;

  // Wrap deployer in NonceManager so rapid sequential txs don't collide
  const deployer = new ethers.NonceManager(rawDeployer);

  // ── Deploy MockUSDC ────────────────────────────────────────────────────────
  const usdcArt = loadArtifact('MockUSDC.sol', 'MockUSDC');
  const UsdcFactory = new ethers.ContractFactory(usdcArt.abi, usdcArt.bytecode, deployer);
  const usdc = await UsdcFactory.deploy();
  await usdc.waitForDeployment();

  // ── Deploy ZaxAndMiggyVault ────────────────────────────────────────────────
  const vaultArt = loadArtifact('ZaxAndMiggyVault.sol', 'ZaxAndMiggyVault');
  const VaultFactory = new ethers.ContractFactory(vaultArt.abi, vaultArt.bytecode, deployer);
  const vault = await VaultFactory.deploy(
    await usdc.getAddress(),
    serverSignerWallet.address,  // serverSigner = account 1
    rawDeployer.address,         // feeRecipient = deployer
  );
  await vault.waitForDeployment();

  // Distribute USDC to players (deployer received 1M USDC in MockUSDC constructor)
  // Use transfer (not mint) — deployer already holds all tokens.
  const GIVE = 10_000n * 1_000_000n; // 10,000 USDC each
  for (const w of [player1, player2, player3]) {
    await (await usdc.transfer(w.address, GIVE)).wait();
  }

  function stop() {
    proc.kill('SIGTERM');
  }

  return {
    provider,
    anvilPort: port,
    anvilUrl,
    deployer,
    serverSignerWallet,
    wallets: { player1, player2, player3 },
    usdc,
    vault,
    stop,
  };
}
