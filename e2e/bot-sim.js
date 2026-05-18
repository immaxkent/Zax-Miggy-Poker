#!/usr/bin/env node
/**
 * bot-sim.js — Run two AI bots against each other on a local anvil chain.
 *
 * Usage:
 *   node scripts/bot-sim.js [--bot1-persona gto] [--bot2-persona aggressive] [--ai]
 *
 * Options:
 *   --bot1-persona <name>   Strategy for bot 1 (default: gto)
 *   --bot2-persona <name>   Strategy for bot 2 (default: aggressive)
 *   --deposit <usdc>        USDC deposit per player (default: 100)
 *   --ai                    Use real Claude API (requires ANTHROPIC_API_KEY in env)
 *
 * Without --ai: bots play weighted-random (no API key needed, free).
 * With --ai: bots use Claude Haiku for real decisions (~$0.01/game).
 */

import { spawn, fork } from 'child_process';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import http from 'node:http';
import path from 'path';
import { readFileSync } from 'fs';
import { io as ioClient } from 'socket.io-client';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = __dirname;              // e2e/ is CWD when invoked via npm run sim
const REPO_ROOT   = path.resolve(ROOT, '..'); // repo root
const ARTIFACTS   = path.join(REPO_ROOT, 'contracts', 'out');
const SERVER_DIR  = path.join(REPO_ROOT, 'server');
const AGENT_ENTRY = path.join(REPO_ROOT, 'agent', 'index.js');

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get  = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const has  = (flag) => args.includes(flag);

const BOT1_PERSONA   = get('--bot1-persona', 'gto');
const BOT2_PERSONA   = get('--bot2-persona', 'aggressive');
const DEPOSIT_USDC   = Number(get('--deposit', '1'));
const USE_AI         = has('--ai');
const ANTHROPIC_KEY  = USE_AI ? (process.env.ANTHROPIC_API_KEY || '') : '';

if (USE_AI && !ANTHROPIC_KEY) {
  console.error('❌  --ai flag requires ANTHROPIC_API_KEY to be set in the environment.');
  process.exit(1);
}

// ── Anvil keys (deterministic) ────────────────────────────────────────────────

const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // 0 deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // 1 server signer
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // 2 bot 1
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // 3 bot 2
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadArtifact(sol, name) {
  const json = JSON.parse(readFileSync(path.join(ARTIFACTS, sol, `${name}.json`), 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function waitHttp(url, timeoutMs = 15_000) {
  const u = new URL(url);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() >= deadline) return reject(new Error(`${url} did not respond in time`));
      const req = http.request(
        { hostname: u.hostname, port: Number(u.port), path: u.pathname, method: 'GET' },
        (res) => { res.resume(); res.statusCode === 200 ? resolve() : setTimeout(attempt, 250); }
      );
      req.on('error', () => setTimeout(attempt, 250));
      req.end();
    }
    setTimeout(attempt, 400);
  });
}

function waitRpc(port, timeoutMs = 12_000) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() >= deadline) return reject(new Error(`Anvil on :${port} did not start`));
      const req = http.request(
        { hostname: '127.0.0.1', port, method: 'POST', path: '/',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
        (res) => { res.resume(); resolve(); }
      );
      req.on('error', () => setTimeout(attempt, 250));
      req.end(body);
    }
    setTimeout(attempt, 300);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request(
      { hostname: u.hostname, port: Number(u.port), path: u.pathname, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': buf.length, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }
    );
    req.on('error', reject);
    req.end(buf);
  });
}

// ── Card / state formatting ───────────────────────────────────────────────────

const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };
function fmtCard(c) { return c?.rank && c?.suit ? `${c.rank}${SUITS[c.suit] ?? c.suit}` : '?'; }
function fmtCards(arr) { return (arr ?? []).map(fmtCard).join(' '); }
function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '?'; }

// ── Main ──────────────────────────────────────────────────────────────────────

const SECRETS = {
  JWT_SECRET:     'sim-jwt-secret-xxxxxxxxxxxxxxxxxxxxx',
  HMAC_SECRET:    'sim-hmac-secret-xxxxxxxxxxxxxxxxxxxx',
  SERVER_API_KEY: 'sim-api-key-local',
};

async function main() {
  const cleanup = [];
  let anvilPort, serverPort, serverBaseUrl;

  // Trap ctrl-c so we always kill child processes
  process.on('SIGINT', () => { cleanup.forEach(fn => { try { fn(); } catch {} }); process.exit(0); });

  try {
    // ── 1. Start anvil ──────────────────────────────────────────────────────

    anvilPort = 19000 + Math.floor(Math.random() * 1000);
    const anvilProc = spawn('anvil', ['--port', String(anvilPort), '--silent'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanup.push(() => anvilProc.kill('SIGTERM'));
    await waitRpc(anvilPort);
    const anvilUrl = `http://127.0.0.1:${anvilPort}`;
    console.log(`🔗 Anvil started on :${anvilPort}`);

    const provider = new ethers.JsonRpcProvider(anvilUrl);
    const deployer = new ethers.NonceManager(new ethers.Wallet(ANVIL_KEYS[0], provider));
    const bot1Address = new ethers.Wallet(ANVIL_KEYS[2]).address;
    const bot2Address = new ethers.Wallet(ANVIL_KEYS[3]).address;
    const bot1Wallet  = new ethers.NonceManager(new ethers.Wallet(ANVIL_KEYS[2], provider));
    const bot2Wallet  = new ethers.NonceManager(new ethers.Wallet(ANVIL_KEYS[3], provider));

    // ── 2. Deploy contracts ─────────────────────────────────────────────────

    const usdcArt  = loadArtifact('MockUSDC.sol', 'MockUSDC');
    const vaultArt = loadArtifact('ZaxAndMiggyVault.sol', 'ZaxAndMiggyVault');

    const usdc  = await new ethers.ContractFactory(usdcArt.abi, usdcArt.bytecode, deployer).deploy();
    await usdc.waitForDeployment();

    const serverSignerAddr = new ethers.Wallet(ANVIL_KEYS[1]).address;
    const deployerAddr     = new ethers.Wallet(ANVIL_KEYS[0]).address;
    const vault = await new ethers.ContractFactory(vaultArt.abi, vaultArt.bytecode, deployer)
      .deploy(await usdc.getAddress(), serverSignerAddr, deployerAddr);
    await vault.waitForDeployment();

    const usdcAddress  = await usdc.getAddress();
    const vaultAddress = await vault.getAddress();
    console.log(`📜 Deployed MockUSDC + ZaxAndMiggyVault`);

    // ── 3. Fund bot wallets ─────────────────────────────────────────────────

    const FUND = 10n * 1_000_000n; // 10 USDC each (enough for multiple 1 USDC games)
    await (await usdc.transfer(bot1Address, FUND)).wait();
    await (await usdc.transfer(bot2Address, FUND)).wait();
    console.log(`💰 Funded Bot 1 (${BOT1_PERSONA.toUpperCase().padEnd(12)}) ${shortAddr(bot1Address)} — 10 USDC`);
    console.log(`💰 Funded Bot 2 (${BOT2_PERSONA.toUpperCase().padEnd(12)}) ${shortAddr(bot2Address)} — 10 USDC`);

    // ── 4. Start server ─────────────────────────────────────────────────────

    serverPort    = 15000 + Math.floor(Math.random() * 1000);
    serverBaseUrl = `http://127.0.0.1:${serverPort}`;

    const serverProc = spawn('node', ['src/server.js'], {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT:                    String(serverPort),
        NODE_ENV:                'test',
        ALLOWED_ORIGINS:         '',
        CHAIN_ID:                '31337',
        BASE_RPC_URL:            anvilUrl,
        ZAX_MIGGY_VAULT_ADDRESS: vaultAddress,
        USDC_ADDRESS:            usdcAddress,
        SIGNER_PRIVATE_KEY:      ANVIL_KEYS[1],
        AGENTIC_RANKINGS_ADDRESS: '',
        ...SECRETS,
      },
    });
    cleanup.push(() => serverProc.kill('SIGTERM'));
    serverProc.stderr.on('data', d => {
      const t = d.toString();
      if (!t.includes('ExperimentalWarning') && !t.includes('DeprecationWarning')) process.stderr.write(t);
    });

    await waitHttp(`${serverBaseUrl}/health`);
    console.log(`🚀 Server started on :${serverPort}`);

    // ── 5. Create game on-chain (bot 1) ─────────────────────────────────────

    const depositAmount = BigInt(DEPOSIT_USDC) * 1_000_000n;
    await (await usdc.connect(bot1Wallet).approve(vaultAddress, depositAmount)).wait();
    const createTx = await vault.connect(bot1Wallet).createGame(depositAmount);
    const createReceipt = await createTx.wait();

    let gameId;
    for (const log of createReceipt.logs) {
      try {
        const p = vault.interface.parseLog(log);
        if (p?.name === 'GameCreated') { gameId = Number(p.args.gameId); break; }
      } catch {}
    }
    console.log(`🎮 Game #${gameId} created (deposit: ${DEPOSIT_USDC} USDC each)`);

    // ── 6. Join game on-chain (bot 2) ────────────────────────────────────────

    await (await usdc.connect(bot2Wallet).approve(vaultAddress, depositAmount)).wait();
    await (await vault.connect(bot2Wallet).joinGame(gameId)).wait();
    console.log(`🎮 Bot 2 joined game #${gameId}`);

    // ── 7. Connect spectator socket for live commentary ──────────────────────

    const spec = ioClient(`${serverBaseUrl}/spectate`, {
      auth: { apiKey: SECRETS.SERVER_API_KEY },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise(r => spec.on('connect', r));
    spec.emit('spectate', { gameId: String(gameId) });

    let currentHand = 0;
    let lastStage   = null;

    spec.on('spectatorState', (state) => {
      if (!state || state.stage === 'waiting') return;

      if (state.handNumber > currentHand) {
        currentHand = state.handNumber;
        lastStage   = null;
        const dealer = state.players.find(p => p.seatIndex === state.dealerIdx);
        console.log(`\n── Hand #${currentHand} ${'─'.repeat(40)}`);
        console.log(`   Dealer: ${shortAddr(dealer?.id)} | Pot: ${state.pot}`);
      }

      if (state.stage !== lastStage) {
        lastStage = state.stage;
        if (state.community?.length) {
          console.log(`   [${state.stage}] ${fmtCards(state.community)}`);
        }
      }
    });

    spec.on('spectatorHandComplete', (data) => {
      if (!data?.results) return;
      for (const [pid, { won }] of Object.entries(data.results)) {
        if (won > 0) console.log(`   → ${shortAddr(pid)} wins ${won} chips`);
      }
    });

    // ── 8. Spawn both agent processes ────────────────────────────────────────

    const agentEnvBase = {
      ...process.env,
      SERVER_URL:               serverBaseUrl,
      SOCKET_URL:               serverBaseUrl,
      SERVER_API_KEY:           SECRETS.SERVER_API_KEY,
      ANTHROPIC_API_KEY:        ANTHROPIC_KEY,
      BASE_RPC_URL:             anvilUrl,
      USDC_ADDRESS:             usdcAddress,
      ZAX_MIGGY_VAULT_ADDRESS:  vaultAddress,
      AGENT_GAME_ID:            String(gameId),
      AGENT_DEPOSIT_USDC:       String(DEPOSIT_USDC),
    };

    function spawnBot(name, privateKey, persona) {
      const config = JSON.stringify({ persona });
      const proc = fork(AGENT_ENTRY, [], {
        env: {
          ...agentEnvBase,
          AGENT_WALLET_PRIVATE_KEY: privateKey,
          AGENT_CONFIG_JSON:        config,
          // Provide dummy keystore values — bypassed by AGENT_WALLET_PRIVATE_KEY
          AGENT_KEYSTORE_JSON:      '{}',
          AGENT_KEYSTORE_PASSWORD:  '',
        },
        silent: true,
      });

      proc.stdout.on('data', d => {
        const lines = d.toString().trim().split('\n');
        for (const line of lines) {
          if (line.includes('Decision:') || line.includes('My turn') || line.includes('Auto-started')) {
            console.log(`   🤖 ${name}: ${line.replace(/.*\[agent\]\s*/, '')}`);
          }
        }
      });
      proc.stderr.on('data', d => {
        const t = d.toString();
        if (!t.includes('ExperimentalWarning') && !t.includes('DeprecationWarning')) {
          process.stderr.write(`[${name}] ${t}`);
        }
      });

      return proc;
    }

    console.log(`\n🤖 Bot 1 (${BOT1_PERSONA}) starting...`);
    console.log(`🤖 Bot 2 (${BOT2_PERSONA}) starting...`);
    console.log(USE_AI ? '🧠 AI mode: Claude Haiku\n' : '🎲 Random play mode (no API key)\n');

    const bot1Proc = spawnBot(`Bot1/${BOT1_PERSONA}`, ANVIL_KEYS[2], BOT1_PERSONA);
    const bot2Proc = spawnBot(`Bot2/${BOT2_PERSONA}`, ANVIL_KEYS[3], BOT2_PERSONA);
    cleanup.push(() => { bot1Proc.kill(); bot2Proc.kill(); });

    // ── 9. Wait for gameOver ─────────────────────────────────────────────────

    const result = await new Promise((resolve, reject) => {
      spec.on('spectatorGameOver', resolve);
      bot1Proc.on('exit', (code) => { if (code !== 0) reject(new Error(`Bot1 exited unexpectedly (code ${code})`)); });
      bot2Proc.on('exit', (code) => { if (code !== 0) reject(new Error(`Bot2 exited unexpectedly (code ${code})`)); });
      setTimeout(() => reject(new Error('Game did not finish within 10 minutes')), 10 * 60_000);
    });

    spec.disconnect();
    bot1Proc.kill();
    bot2Proc.kill();

    // ── 10. Print result ─────────────────────────────────────────────────────

    const winnerPersona = result.winner === bot1Address.toLowerCase() ? BOT1_PERSONA : BOT2_PERSONA;
    const winnerName    = result.winner === bot1Address.toLowerCase() ? 'Bot 1' : 'Bot 2';

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`🏆  ${winnerName} (${winnerPersona.toUpperCase()}) wins!`);
    console.log(`    Winner: ${shortAddr(result.winner)}`);
    console.log(`    Pot: ${DEPOSIT_USDC * 2} USDC → winner receives ${(DEPOSIT_USDC * 2 * 0.9).toFixed(0)} USDC (10% fee)`);
    console.log(`${'═'.repeat(50)}\n`);

  } finally {
    cleanup.forEach(fn => { try { fn(); } catch {} });
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
