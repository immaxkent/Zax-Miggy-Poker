#!/usr/bin/env node
/**
 * Apply versions/<network>/<version>/agentic-deployment.json to client/.env and server/.env
 *
 * Usage:
 *   node scripts/wire-agentic-env.js base-sepolia [1.0.1]
 *   node scripts/wire-agentic-env.js base-sepolia        # latest version folder
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');
const CLIENT_ENV = path.join(REPO_ROOT, 'client', '.env');
const SERVER_ENV = path.join(REPO_ROOT, 'server', '.env');

const NETWORK_META = {
  'base-sepolia': { chainId: '84532', rpc: 'https://sepolia.base.org' },
  base: { chainId: '8453', rpc: 'https://mainnet.base.org' },
};

function getLatestVersion(network) {
  const networkDir = path.join(VERSIONS_DIR, network);
  if (!fs.existsSync(networkDir)) return null;
  const dirs = fs.readdirSync(networkDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
  return dirs[0] || null;
}

function readAgenticDeployment(network, version) {
  const v = version || getLatestVersion(network);
  if (!v) return null;
  const p = path.join(VERSIONS_DIR, network, v, 'agentic-deployment.json');
  if (!fs.existsSync(p)) return null;
  return { ...JSON.parse(fs.readFileSync(p, 'utf8')), version: v };
}

function updateEnv(filePath, updates) {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') continue;
    const regex = new RegExp(`^(${key}=).*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `$1${value}`);
    } else {
      content = content.trimEnd() + (content.endsWith('\n') || !content ? '' : '\n') + `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function main() {
  const network = process.argv[2];
  const version = process.argv[3];

  if (!network || !NETWORK_META[network]) {
    console.error('Usage: node scripts/wire-agentic-env.js <base-sepolia|base> [version]');
    process.exit(1);
  }

  const d = readAgenticDeployment(network, version);
  if (!d?.arenaAddress) {
    console.error(`No agentic-deployment.json for ${network}. Run deploy-agentic-arena first.`);
    process.exit(1);
  }

  const meta = NETWORK_META[network];

  const clientUpdates = {
    VITE_CHAIN_ID: meta.chainId,
    VITE_USDC_ADDRESS: d.usdcAddress,
    VITE_ARENA_ADDRESS: d.arenaAddress,
    VITE_BOT_FACTORY_ADDRESS: d.botFactoryAddress,
    VITE_AGENTIC_RANKINGS_V2_ADDRESS: d.agenticRankingsV2Address,
    VITE_AGENTIC_CHIPS_1155_ADDRESS: d.agenticChips1155Address,
  };

  const serverUpdates = {
    CHAIN_ID: meta.chainId,
    BASE_RPC_URL: meta.rpc,
    USDC_ADDRESS: d.usdcAddress,
    AGENTIC_ARENA_ENABLED: 'true',
    ARENA_ADDRESS: d.arenaAddress,
    BOT_FACTORY_ADDRESS: d.botFactoryAddress,
    AGENTIC_RANKINGS_V2_ADDRESS: d.agenticRankingsV2Address,
    AGENTIC_CHIPS_1155_ADDRESS: d.agenticChips1155Address,
  };

  updateEnv(CLIENT_ENV, clientUpdates);
  updateEnv(SERVER_ENV, serverUpdates);

  console.log(`Wired agentic arena: ${network} @ ${d.version}`);
  console.log('  Arena:', d.arenaAddress);
  console.log('  RankingsV2:', d.agenticRankingsV2Address);
  console.log('  Chips1155:', d.agenticChips1155Address);
  console.log('  BotFactory:', d.botFactoryAddress);
  console.log('\nUpdated client/.env and server/.env');
  console.log('Copy the same VITE_* vars to Vercel; restart server / redeploy client.');
}

main();
