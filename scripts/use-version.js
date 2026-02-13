#!/usr/bin/env node
/**
 * Point client and server .env at a deployed version (versions/<network>/<version>/deployment.json).
 *
 * Usage:
 *   node scripts/use-version.js anvil 1.0.1
 *   node scripts/use-version.js anvil        # uses latest version in that network
 *
 * Updates client/.env (VITE_TOKEN_ADDRESS, VITE_VAULT_ADDRESS) and
 * server/.env (TOKEN_ADDRESS, VAULT_ADDRESS).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');
const CLIENT_ENV = path.join(REPO_ROOT, 'client', '.env');
const SERVER_ENV = path.join(REPO_ROOT, 'server', '.env');

function getLatestVersion(network) {
  const networkDir = path.join(VERSIONS_DIR, network);
  if (!fs.existsSync(networkDir)) return null;
  const dirs = fs.readdirSync(networkDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => {
      const [aa, ab, ac] = a.split('.').map(Number);
      const [ba, bb, bc] = b.split('.').map(Number);
      if (aa !== ba) return ba - aa;
      if (ab !== bb) return bb - ab;
      return bc - ac;
    });
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function readDeployment(network, version) {
  const v = version || getLatestVersion(network);
  if (!v) return null;
  const p = path.join(VERSIONS_DIR, network, v, 'deployment.json');
  if (!fs.existsSync(p)) return null;
  return { ...JSON.parse(fs.readFileSync(p, 'utf8')), version: v };
}

function updateEnv(filePath, updates) {
  if (!fs.existsSync(filePath)) {
    console.warn('Missing', filePath);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^(${key}=).*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `$1${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function main() {
  const network = process.argv[2];
  const version = process.argv[3];
  if (!network) {
    console.error('Usage: node scripts/use-version.js <network> [version]');
    console.error('Example: node scripts/use-version.js anvil 1.0.1');
    process.exit(1);
  }

  const deployment = readDeployment(network, version);
  if (!deployment) {
    console.error(`No deployment found for ${network}${version ? ` ${version}` : ''}. Run deploy-and-save first.`);
    process.exit(1);
  }

  const { tokenAddress, vaultAddress, version: v } = deployment;
  if (!vaultAddress) {
    console.error('Deployment missing vaultAddress');
    process.exit(1);
  }

  updateEnv(CLIENT_ENV, {
    VITE_TOKEN_ADDRESS: tokenAddress || '0x0000000000000000000000000000000000000000',
    VITE_VAULT_ADDRESS: vaultAddress,
  });
  updateEnv(SERVER_ENV, {
    TOKEN_ADDRESS: tokenAddress || '0x0000000000000000000000000000000000000000',
    VAULT_ADDRESS: vaultAddress,
  });

  console.log(`Using ${network} @ ${v}`);
  console.log('  Token:', tokenAddress || '(none)');
  console.log('  Vault:', vaultAddress);
  console.log('Updated client/.env and server/.env. Restart server and client to test on localhost.');
}

main();
