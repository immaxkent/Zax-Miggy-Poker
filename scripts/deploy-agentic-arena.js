#!/usr/bin/env node
/**
 * Deploy Agentic Arena stack to Base Sepolia or Base mainnet.
 * Saves addresses to versions/<network>/<version>/agentic-deployment.json
 *
 * Prerequisites:
 *   cd contracts && forge build
 *   cast wallet import deployMeta --interactive   # or deployer
 *
 * Usage:
 *   node scripts/deploy-agentic-arena.js base-sepolia [1.0.1]
 *   node scripts/deploy-agentic-arena.js base [1.0.1]
 *
 * Required in contracts/.env (or repo root .env):
 *   SIGNER_ADDRESS      — server settlement signer (same as SIGNER_PRIVATE_KEY on EC2)
 *   FEE_RECIPIENT       — treasury for USDC fees
 *
 * Optional:
 *   DEPLOY_ACCOUNT=deployMeta   — forge keystore account (default deployMeta)
 *   BASE_SEPOLIA_RPC_URL        — custom RPC for Base Sepolia
 *   BASE_RPC_URL                — custom RPC for Base mainnet
 *   BASESCAN_API_KEY            — for --verify
 *   VERIFY=1                    — verify on Basescan after deploy
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');

const NETWORKS = {
  'base-sepolia': {
    chainId: 84532,
    rpc: () => process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    usdc: '0x036CbD53842c6846630281C1C3aD1868e8e7a34f',
    clientChainId: '84532',
    serverRpcKey: 'BASE_RPC_URL',
    serverRpcDefault: 'https://sepolia.base.org',
    label: 'Base Sepolia',
  },
  base: {
    chainId: 8453,
    rpc: () => process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    clientChainId: '8453',
    serverRpcKey: 'BASE_RPC_URL',
    serverRpcDefault: 'https://mainnet.base.org',
    label: 'Base Mainnet',
  },
};

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
  const arg = process.argv[3];
  if (arg && /^\d+\.\d+\.\d+$/.test(arg)) return arg;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    if (pkg.version) return pkg.version;
  } catch (_) {}
  return '1.0.0';
}

function parseFromConsole(output) {
  const pick = (key) => {
    const m = output.match(new RegExp(`${key}=\\s*(0x[a-fA-F0-9]{40})`));
    return m ? m[1] : null;
  };
  return {
    agenticRankingsV2Address: pick('AGENTIC_RANKINGS_V2_ADDRESS'),
    agenticChips1155Address: pick('AGENTIC_CHIPS_1155_ADDRESS'),
    botFactoryAddress: pick('BOT_FACTORY_ADDRESS'),
    arenaAddress: pick('ARENA_ADDRESS'),
  };
}

function parseFromBroadcast(chainId) {
  const broadcastPath = path.join(
    CONTRACTS_DIR,
    'broadcast',
    'DeployAgenticArena.s.sol',
    String(chainId),
    'run-latest.json',
  );
  if (!fs.existsSync(broadcastPath)) return null;

  const run = JSON.parse(fs.readFileSync(broadcastPath, 'utf8'));
  const byName = {};
  for (const tx of run.transactions || []) {
    if (tx.transactionType !== 'CREATE' || !tx.contractName) continue;
    byName[tx.contractName] = tx.contractAddress;
  }

  return {
    agenticRankingsV2Address: byName.AgenticRankingsV2 || null,
    agenticChips1155Address: byName.AgenticChips1155 || null,
    botFactoryAddress: byName.BotFactory || null,
    arenaAddress: byName.Arena || null,
  };
}

function runForgeScript(networkKey, net, envForForge) {
  const account = process.env.DEPLOY_ACCOUNT || 'deployMeta';
  const rpc = net.rpc();
  const args = [
    'script',
    'script/DeployAgenticArena.s.sol:DeployAgenticArena',
    '--rpc-url', rpc,
    '--broadcast',
    '--account', account,
    '--chain-id', String(net.chainId),
  ];

  if (process.env.VERIFY === '1' && process.env.BASESCAN_API_KEY) {
    args.push('--verify', '--etherscan-api-key', process.env.BASESCAN_API_KEY);
  }

  const childEnv = { ...process.env, ...envForForge };

  return new Promise((resolve, reject) => {
    const proc = spawn('forge', args, {
      cwd: CONTRACTS_DIR,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: childEnv,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
    proc.on('close', (code) => {
      const full = stdout + '\n' + stderr;
      if (code !== 0) reject(new Error(`forge script exited ${code}`));
      else resolve(full);
    });
  });
}

function printEnvBlock(networkKey, net, deployment) {
  const c = deployment;
  const lines = [
    '',
    '══════════════════════════════════════════════════════════════',
    `  ${net.label} — wire these env vars`,
    '══════════════════════════════════════════════════════════════',
    '',
    '── server/.env (and EC2) ──',
    `CHAIN_ID=${net.clientChainId}`,
    `${net.serverRpcKey}=${net.serverRpcDefault}`,
    `USDC_ADDRESS=${c.usdcAddress}`,
    `AGENTIC_ARENA_ENABLED=true`,
    `ARENA_ADDRESS=${c.arenaAddress}`,
    `BOT_FACTORY_ADDRESS=${c.botFactoryAddress}`,
    `AGENTIC_RANKINGS_V2_ADDRESS=${c.agenticRankingsV2Address}`,
    `AGENTIC_CHIPS_1155_ADDRESS=${c.agenticChips1155Address}`,
    '',
    '── client/.env + Vercel ──',
    `VITE_CHAIN_ID=${net.clientChainId}`,
    `VITE_USDC_ADDRESS=${c.usdcAddress}`,
    `VITE_ARENA_ADDRESS=${c.arenaAddress}`,
    `VITE_BOT_FACTORY_ADDRESS=${c.botFactoryAddress}`,
    `VITE_AGENTIC_RANKINGS_V2_ADDRESS=${c.agenticRankingsV2Address}`,
    `VITE_AGENTIC_CHIPS_1155_ADDRESS=${c.agenticChips1155Address}`,
    '',
    'Then: node scripts/wire-agentic-env.js ' + networkKey + ' ' + deployment.version,
    '       pm2 restart poker  (on EC2)',
    '       Redeploy Vercel with client env vars above',
    '══════════════════════════════════════════════════════════════',
    '',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  const networkKey = process.argv[2];
  const version = getVersion();
  const net = NETWORKS[networkKey];

  if (!net) {
    console.error('Usage: node scripts/deploy-agentic-arena.js <network> [version]');
    console.error('Networks: base-sepolia | base');
    process.exit(1);
  }

  const settlementSigner = process.env.SETTLEMENT_SIGNER || process.env.SIGNER_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT;

  if (!settlementSigner || !/^0x[a-fA-F0-9]{40}$/i.test(settlementSigner)) {
    console.error('Missing SIGNER_ADDRESS (or SETTLEMENT_SIGNER) in contracts/.env');
    console.error('Must match the address derived from server SIGNER_PRIVATE_KEY.');
    process.exit(1);
  }
  if (!feeRecipient || !/^0x[a-fA-F0-9]{40}$/i.test(feeRecipient)) {
    console.error('Missing FEE_RECIPIENT in contracts/.env (treasury wallet).');
    process.exit(1);
  }

  const usdc = process.env.USDC_ADDRESS || net.usdc;
  const envForForge = {
    USDC_ADDRESS: usdc,
    FEE_RECIPIENT: feeRecipient,
    SETTLEMENT_SIGNER: settlementSigner,
  };

  console.log(`\nDeploying Agentic Arena → ${net.label} (chain ${net.chainId}) v${version}`);
  console.log('  USDC:', usdc);
  console.log('  Treasury:', feeRecipient);
  console.log('  Settlement signer:', settlementSigner);
  console.log('  Account:', process.env.DEPLOY_ACCOUNT || 'deployMeta');
  console.log('');

  const output = await runForgeScript(networkKey, net, envForForge);

  let addresses = parseFromBroadcast(net.chainId);
  const fromConsole = parseFromConsole(output);
  if (!addresses?.arenaAddress) addresses = { ...fromConsole, ...addresses };

  if (!addresses?.arenaAddress) {
    console.error('Could not parse deployment addresses. Check forge output or broadcast JSON.');
    process.exit(1);
  }

  const deployment = {
    version,
    network: networkKey,
    chainId: net.chainId,
    usdcAddress: usdc,
    settlementSigner,
    feeRecipient,
    ...addresses,
    deployedAt: new Date().toISOString(),
  };

  const versionDir = path.join(VERSIONS_DIR, networkKey, version);
  ensureDir(versionDir);
  const outPath = path.join(versionDir, 'agentic-deployment.json');
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2), 'utf8');

  console.log('\nWrote', outPath);
  console.log(JSON.stringify(deployment, null, 2));
  printEnvBlock(networkKey, net, deployment);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
