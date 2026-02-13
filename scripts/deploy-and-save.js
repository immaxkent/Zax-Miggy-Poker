#!/usr/bin/env node
/**
 * Deploy contracts for the given network and save addresses to versions/<network>/<version>/deployment.json.
 * Version comes from optional second arg or repo root package.json (e.g. 1.0.1).
 *
 * Usage:
 *   node scripts/deploy-and-save.js anvil [1.0.1]
 *   node scripts/deploy-and-save.js base-sepolia [1.0.1]
 *   node scripts/deploy-and-save.js base [1.0.1]
 *
 * Requires: anvil running for anvil; contracts/.env set for base-sepolia/base.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');

const ANVIL_RPC = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:8545';

const NETWORKS = {
  anvil: {
    rpc: ANVIL_RPC,
    script: 'script/DeployLocal.s.sol:DeployLocal',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    parseFromDeployLocal: true,
  },
  'base-sepolia': {
    rpc: 'https://sepolia.base.org',
    script: 'script/Deploy.s.sol:Deploy',
    parseFromDeployLocal: false,
    useAccount: true,
  },
  base: {
    rpc: 'https://mainnet.base.org',
    script: 'script/Deploy.s.sol:Deploy',
    parseFromDeployLocal: false,
    useAccount: true,
  },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function runForgeScript(networkKey) {
  const config = NETWORKS[networkKey];
  if (!config) {
    console.error('Unknown network. Use: anvil | base-sepolia | base');
    process.exit(1);
  }

  const args = [
    'script',
    config.script,
    '--rpc-url', config.rpc,
    '--broadcast',
  ];
  if (config.privateKey) {
    args.push('--private-key', config.privateKey);
  }
  if (config.useAccount) {
    const sender = process.env.DEPLOYER_ADDRESS;
    if (!sender) {
      console.error('For base-sepolia/base set DEPLOYER_ADDRESS and use cast wallet (e.g. --account deployer).');
      process.exit(1);
    }
    args.push('--sender', sender, '--account', 'deployer');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('forge', args, {
      cwd: CONTRACTS_DIR,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const full = stdout + '\n' + stderr;
      if (code !== 0) reject(new Error(`forge script exited ${code}\n${full}`));
      resolve(full);
    });
  });
}

function parseAddresses(output, fromDeployLocal) {
  // DeployLocal.s.sol: "TOKEN_ADDRESS= 0x..." and "VAULT_ADDRESS= 0x..."
  const tokenMatch = output.match(/TOKEN_ADDRESS=\s*(0x[a-fA-F0-9]{40})/);
  const vaultFromLocal = output.match(/VAULT_ADDRESS=\s*(0x[a-fA-F0-9]{40})/);
  // Deploy.s.sol: "PokerVault deployed at: 0x..." and "Token:          0x..."
  const vaultFromDeploy = output.match(/PokerVault deployed at:\s*(0x[a-fA-F0-9]{40})/);
  const tokenFromDeploy = output.match(/Token:\s*(0x[a-fA-F0-9]{40})/);

  const tokenAddress = tokenMatch?.[1] ?? tokenFromDeploy?.[1] ?? null;
  const vaultAddress = vaultFromLocal?.[1] ?? vaultFromDeploy?.[1] ?? null;

  return { tokenAddress, vaultAddress };
}

function getVersion() {
  const arg = process.argv[3];
  if (arg && /^\d+\.\d+\.\d+$/.test(arg)) return arg;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    if (pkg.version) return pkg.version;
  } catch (_) {}
  return '1.0.0';
}

async function main() {
  const network = process.argv[2] || 'anvil';
  const version = getVersion();
  if (!NETWORKS[network]) {
    console.error('Usage: node scripts/deploy-and-save.js <network> [version]');
    console.error('Networks: anvil, base-sepolia, base. Version defaults to package.json or 1.0.0.');
    process.exit(1);
  }

  console.log(`Deploying for network: ${network} version ${version}...`);
  const output = await runForgeScript(network);
  const config = NETWORKS[network];
  const { tokenAddress, vaultAddress } = parseAddresses(output, config.parseFromDeployLocal);

  if (!vaultAddress) {
    console.error('Could not parse VAULT_ADDRESS from forge output.');
    console.error(output.slice(-2000));
    process.exit(1);
  }
  if (!tokenAddress && network === 'anvil') {
    console.error('Could not parse TOKEN_ADDRESS from forge output.');
    process.exit(1);
  }

  const versionDir = path.join(VERSIONS_DIR, network, version);
  ensureDir(versionDir);

  const deployment = {
    version,
    network,
    tokenAddress: tokenAddress || null,
    vaultAddress,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(versionDir, 'deployment.json');
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
