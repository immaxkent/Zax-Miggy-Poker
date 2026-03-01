#!/usr/bin/env node
/**
 * redeploy.js
 *
 * 1. If there are uncommitted changes: git add, commit, push (triggers Vercel redeploy).
 * 2. SSH to EC2 and run: pm2 restart poker
 *
 * Optional env (or .env): REDEPLOY_SSH_KEY, REDEPLOY_SSH_HOST, REDEPLOY_COMMIT_MSG
 *   REDEPLOY_SSH_KEY  path to .pem key (default: ~/Downloads/poker-game-server.pem)
 *   REDEPLOY_SSH_HOST user@host (default: ubuntu@35.179.163.69)
 *
 * Usage: npm run redeploy
 */

const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
  }
}

loadEnv();

const SSH_KEY = process.env.REDEPLOY_SSH_KEY || path.join(process.env.HOME || '', 'Downloads', 'poker-game-server.pem');
const SSH_HOST = process.env.REDEPLOY_SSH_HOST || 'ubuntu@35.179.163.69';

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: root, ...opts });
}

function hasChanges() {
  try {
    const status = run('git status --porcelain');
    return status.trim().length > 0;
  } catch (e) {
    return false;
  }
}

function commitAndPush() {
  if (!hasChanges()) {
    console.log('No uncommitted changes. Skipping commit & push.');
    return false;
  }
  console.log('Uncommitted changes found. Adding, committing, pushing...');
  run('git add -A');
  try {
    const msg = process.env.REDEPLOY_COMMIT_MSG || 'chore: redeploy ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
    execFileSync('git', ['commit', '-m', msg], { encoding: 'utf8', cwd: root });
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join('');
    if (e.status === 1 && /nothing to commit|no changes added/i.test(out)) {
      console.log('Nothing to commit (working tree clean after add). Skipping push.');
      return true;
    }
    throw e;
  }
  run('git push');
  console.log('Pushed. Vercel will redeploy the frontend.');
  return true;
}

function restartServer() {
  const keyPath = path.resolve(SSH_KEY.replace(/^~/, process.env.HOME || ''));
  if (!fs.existsSync(keyPath)) {
    console.warn('SSH key not found: ' + keyPath + '. Set REDEPLOY_SSH_KEY or add key to ~/Downloads/poker-game-server.pem');
    console.warn('Skipping server restart.');
    return;
  }
  console.log('Restarting game server on EC2...');
  const sshCmd = 'ssh -i "' + keyPath + '" -o StrictHostKeyChecking=no ' + SSH_HOST + ' "pm2 restart poker"';
  try {
    run(sshCmd);
    console.log('Server restarted (pm2 restart poker).');
  } catch (err) {
    console.error('Server restart failed:', err.message);
    process.exit(1);
  }
}

commitAndPush();
restartServer();
console.log('Redeploy done.');
