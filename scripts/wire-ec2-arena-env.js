#!/usr/bin/env node
/**
 * Push agentic arena addresses to EC2 server/.env and restart pm2.
 *
 * Usage:
 *   node scripts/wire-ec2-arena-env.js base-sepolia [1.0.1]
 *
 * Env (optional): REDEPLOY_SSH_KEY, REDEPLOY_SSH_HOST, REDEPLOY_REMOTE_DIR
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(REPO_ROOT, 'versions');

const NETWORK_META = {
  'base-sepolia': { chainId: '84532', rpc: 'https://sepolia.base.org' },
  base: { chainId: '8453', rpc: 'https://mainnet.base.org' },
};

function loadDeployment(network, version) {
  const networkDir = path.join(VERSIONS_DIR, network);
  const v = version || fs.readdirSync(networkDir).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort().reverse()[0];
  const p = path.join(networkDir, v, 'agentic-deployment.json');
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function main() {
  const network = process.argv[2];
  const version = process.argv[3];
  const meta = NETWORK_META[network];
  if (!meta) {
    console.error('Usage: node scripts/wire-ec2-arena-env.js <base-sepolia|base> [version]');
    process.exit(1);
  }

  const d = loadDeployment(network, version);
  const sshKey = process.env.REDEPLOY_SSH_KEY || path.join(process.env.HOME || '', 'Downloads', 'poker-game-server.pem');
  const sshHost = process.env.REDEPLOY_SSH_HOST || 'ubuntu@35.179.163.69';
  const remoteDir = process.env.REDEPLOY_REMOTE_DIR || '/home/ubuntu/Zax-Miggy-Poker';
  const envPath = `${remoteDir}/server/.env`;

  const updates = {
    CHAIN_ID: meta.chainId,
    BASE_RPC_URL: meta.rpc,
    USDC_ADDRESS: d.usdcAddress,
    AGENTIC_ARENA_ENABLED: 'true',
    ARENA_ADDRESS: d.arenaAddress,
    BOT_FACTORY_ADDRESS: d.botFactoryAddress,
    AGENTIC_RANKINGS_V2_ADDRESS: d.agenticRankingsV2Address,
    AGENTIC_CHIPS_1155_ADDRESS: d.agenticChips1155Address,
  };

  const remoteScript = Object.entries(updates)
    .map(([k, v]) => {
      if (v == null || v === '') return '';
      return `if grep -q '^${k}=' ${envPath} 2>/dev/null; then sed -i 's|^${k}=.*|${k}=${v}|' ${envPath}; else echo '${k}=${v}' >> ${envPath}; fi`;
    })
    .filter(Boolean)
    .join('\n');

  const cmd = [
    'ssh',
    '-i', sshKey,
    '-o', 'StrictHostKeyChecking=no',
    sshHost,
    `${remoteScript} && cd ${shellQuote(remoteDir)} && pm2 restart poker --update-env && curl -s http://127.0.0.1:3001/health`,
  ];

  console.log(`Wiring EC2 for ${network} v${d.version} → ${d.arenaAddress}`);
  const out = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(out);
}

main();
