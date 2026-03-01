#!/usr/bin/env node
/**
 * Save already-deployed addresses to versions/<network>/<version>/deployment.json (no deploy).
 * Use after deploying ZaxAndMiggyVault on Base so versions/base/<version>/deployment.json exists.
 *
 * Usage:
 *   node scripts/extract-and-save.js base [1.0.1] [ZAX_MIGGY_VAULT_ADDRESS]
 * If the vault address is not passed, it is read from contracts/.env (ZAX_MIGGY_VAULT_ADDRESS).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
}
loadEnv(path.join(REPO_ROOT, '.env'));
loadEnv(path.join(CONTRACTS_DIR, '.env'));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getVersion() {
  const a = process.argv[3];
  const b = process.argv[4];
  if (a && /^\d+\.\d+\.\d+$/.test(a)) return a;
  if (b && /^\d+\.\d+\.\d+$/.test(b)) return b;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    if (pkg.version) return pkg.version;
  } catch (_) {}
  return '1.0.0';
}

function getVaultAddressFromArgs() {
  const a = process.argv[3];
  const b = process.argv[4];
  if (a && /^0x[a-fA-F0-9]{40}$/.test(a)) return a;
  if (b && /^0x[a-fA-F0-9]{40}$/.test(b)) return b;
  return null;
}

function main() {
  const network = process.argv[2];
  const version = getVersion();
  if (network !== 'base') {
    console.error('Usage: node scripts/extract-and-save.js base [version]');
    console.error('Currently only "base" is supported (ZaxAndMiggyVault).');
    process.exit(1);
  }

  const zaxMiggyVaultAddress = getVaultAddressFromArgs() || process.env.ZAX_MIGGY_VAULT_ADDRESS;
  const usdcAddress = process.env.USDC_ADDRESS || BASE_USDC;

  if (!zaxMiggyVaultAddress || !/^0x[a-fA-F0-9]{40}$/.test(zaxMiggyVaultAddress)) {
    console.error('Missing or invalid ZAX_MIGGY_VAULT_ADDRESS. Set it in contracts/.env (the address from your deploy output).');
    process.exit(1);
  }

  const versionDir = path.join(VERSIONS_DIR, network, version);
  ensureDir(versionDir);

  const deployment = {
    version,
    network,
    tokenAddress: usdcAddress,
    vaultAddress: zaxMiggyVaultAddress,
    usdcAddress,
    zaxMiggyVaultAddress,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(versionDir, 'deployment.json');
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log(JSON.stringify(deployment, null, 2));
}

main();
