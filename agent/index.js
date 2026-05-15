/**
 * Zax & Miggy Poker — AI Agent
 *
 * Usage (direct CLI):
 *   node index.js --keystore ./wallet.json --config ./config.json --password <pw>
 *
 * More commonly invoked by agent-manager.js on the server, which passes
 * keystore + config contents as environment variables after decrypting in-memory.
 *
 * Required env vars (set by agent-manager or .env):
 *   AGENT_KEYSTORE_JSON      - Keystore file contents (JSON string)
 *   AGENT_KEYSTORE_PASSWORD  - Decryption password
 *   AGENT_CONFIG_JSON        - Config file contents (JSON string)
 *   AGENT_GAME_ID            - On-chain game ID to join (number)
 *   SERVER_URL               - Poker server base URL
 *   SOCKET_URL               - Socket.IO URL (may differ from SERVER_URL)
 *   SERVER_API_KEY           - Server API key
 *   ANTHROPIC_API_KEY        - Claude API key
 *   BASE_RPC_URL             - Base mainnet RPC endpoint
 *   USDC_ADDRESS             - USDC contract address
 *   ZAX_MIGGY_VAULT_ADDRESS  - Vault contract address
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { loadWallet } from './src/wallet.js';
import { authenticate } from './src/auth.js';
import { buildSystemPrompt } from './src/strategy.js';
import { connectAndPlay } from './src/client.js';
import { findJoinableGames, joinGameOnChain } from './src/onchain.js';
import { readFileSync } from 'fs';

async function main() {
  // ── 1. Load keystore and config ──────────────────────────────────────────

  let keystoreJson, keystorePassword, config, gameId;

  // Support both env-var mode (server-spawned) and direct CLI mode
  if (process.env.AGENT_KEYSTORE_JSON) {
    keystoreJson    = process.env.AGENT_KEYSTORE_JSON;
    keystorePassword = process.env.AGENT_KEYSTORE_PASSWORD;
    config          = JSON.parse(process.env.AGENT_CONFIG_JSON || '{}');
    gameId          = process.env.AGENT_GAME_ID ? Number(process.env.AGENT_GAME_ID) : null;
  } else {
    // CLI: --keystore <path> --config <path> --password <pw> [--game <id>]
    const args = process.argv.slice(2);
    const get  = (flag) => args[args.indexOf(flag) + 1];
    const keystorePath = get('--keystore');
    const configPath   = get('--config');
    keystorePassword   = get('--password');
    if (!keystorePath || !configPath || !keystorePassword) {
      console.error('Usage: node index.js --keystore <path> --config <path> --password <pw> [--game <id>]');
      process.exit(1);
    }
    keystoreJson = readFileSync(keystorePath, 'utf8');
    config       = JSON.parse(readFileSync(configPath, 'utf8'));
    gameId       = get('--game') ? Number(get('--game')) : null;
  }

  const serverUrl       = process.env.SERVER_URL        || 'http://localhost:3001';
  const socketUrl       = process.env.SOCKET_URL        || serverUrl;
  const apiKey          = process.env.SERVER_API_KEY    || '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  const rpcUrl          = process.env.BASE_RPC_URL      || 'https://mainnet.base.org';
  const usdcAddress     = process.env.USDC_ADDRESS      || '';
  const vaultAddress    = process.env.ZAX_MIGGY_VAULT_ADDRESS || '';

  // ── 2. Decrypt wallet ────────────────────────────────────────────────────

  console.log('[agent] Decrypting wallet...');
  // Write keystore JSON to a temp buffer for ethers.Wallet.fromEncryptedJson
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, keystorePassword);
  const connectedWallet = wallet.connect(new ethers.JsonRpcProvider(rpcUrl));
  console.log(`[agent] Wallet: ${wallet.address}`);

  // ── 3. Authenticate with server ──────────────────────────────────────────

  console.log('[agent] Authenticating with server...');
  const token = await authenticate(serverUrl, apiKey, wallet);
  console.log('[agent] Authenticated.');

  // ── 4. Find and join a game on-chain (if no gameId supplied) ────────────

  if (!gameId) {
    if (!vaultAddress) {
      console.error('[agent] ZAX_MIGGY_VAULT_ADDRESS not set and no --game provided.');
      process.exit(1);
    }
    console.log('[agent] Scanning on-chain for joinable games...');
    const games = await findJoinableGames({
      rpcUrl,
      vaultAddress,
      agentAddress: wallet.address,
      priceRangeMin: config.price_range_min ?? 0,
      priceRangeMax: config.price_range_max ?? 0,
    });

    if (games.length === 0) {
      console.log('[agent] No joinable games found in price range. Exiting.');
      process.exit(0);
    }

    // Pick the first suitable game (lowest deposit, fewest players already seated)
    games.sort((a, b) => Number(a.depositAmount - b.depositAmount) || a.playerCount - b.playerCount);
    const chosen = games[0];
    console.log(`[agent] Chose game ${chosen.gameId} (deposit: ${Number(chosen.depositAmount) / 1e6} USDC, ${chosen.playerCount} players)`);

    await joinGameOnChain(connectedWallet, vaultAddress, usdcAddress, chosen.gameId, chosen.depositAmount);
    gameId = Number(chosen.gameId);
  }

  // ── 5. Build strategy prompt and play ────────────────────────────────────

  const systemPrompt = buildSystemPrompt(config);

  console.log(`[agent] Connecting to table usdc-${gameId}...`);
  await connectAndPlay({
    socketUrl,
    apiKey,
    token,
    playerId: wallet.address,
    gameId,
    systemPrompt,
    anthropicApiKey,
  });

  console.log('[agent] Session complete.');
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err);
  process.exit(1);
});
