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

function sshRun(sshKey, sshHost, remoteScript) {
  return execFileSync(
    'ssh',
    ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', sshHost, remoteScript],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
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

  const envScript = Object.entries(updates)
    .map(([k, v]) => {
      if (v == null || v === '') return '';
      const val = String(v).replace(/'/g, `'\\''`);
      return `if grep -q '^${k}=' ${envPath} 2>/dev/null; then sed -i 's|^${k}=.*|${k}=${val}|' ${envPath}; else echo '${k}=${val}' >> ${envPath}; fi`;
    })
    .filter(Boolean)
    .join('\n');

  const verifyScript = `echo '--- server/.env (arena) ---' && grep -E '^(CHAIN_ID|BASE_RPC_URL|USDC_ADDRESS|AGENTIC_ARENA|ARENA_|BOT_FACTORY|AGENTIC_)' ${envPath} || true`;

  const restartScript = `cd ${shellQuote(remoteDir)} && pm2 restart poker --update-env`;

  const healthScript = [
    'sleep 2',
    'H=""',
    'for i in 1 2 3 4 5; do',
    '  H=$(curl -sf http://127.0.0.1:3001/health) && break',
    '  sleep 2',
    'done',
    'if [ -n "$H" ]; then echo "$H"; else echo "health check failed — server may still be starting"; fi',
  ].join('\n');

  console.log(`Wiring EC2 for ${network} v${d.version} → ${d.arenaAddress}`);

  try {
    sshRun(sshKey, sshHost, envScript);
    console.log('✓ Updated server/.env on EC2');
  } catch (err) {
    console.error('Failed to update server/.env:', err.stderr || err.message);
    process.exit(1);
  }

  try {
    const pm2Out = sshRun(sshKey, sshHost, restartScript);
    console.log(pm2Out.trim());
    console.log('✓ pm2 restart poker');
  } catch (err) {
    console.error('pm2 restart failed:', err.stderr || err.message);
    process.exit(1);
  }

  try {
    const verify = sshRun(sshKey, sshHost, verifyScript);
    console.log(verify.trim());
  } catch (_) {
    /* non-fatal */
  }

  try {
    const health = sshRun(sshKey, sshHost, healthScript);
    console.log('\nHealth:', health.trim());
  } catch (err) {
    console.warn('\n⚠️  Health check did not return JSON (env + pm2 were still applied).');
    console.warn('   Try: curl -s https://zax-and-miggy-poker.ngrok.app/health');
    console.warn(err.stderr || err.message || '');
  }

  console.log('\nDone. Copy VITE_* from client/.env to Vercel for Sepolia testing.');
}

main();
