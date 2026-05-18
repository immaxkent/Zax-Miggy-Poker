import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dir, '..', '..', 'agent');

// Map of ownerAddress → { process, gameId, startedAt, output[] }
const activeAgents = new Map();

const MAX_OUTPUT_LINES = 200;

/**
 * Spawn an agent process for the given owner.
 * The decrypted keystore and config are passed as environment variables —
 * never written to disk.
 *
 * @param {object} params
 * @param {string} params.ownerAddress       EVM address of the bot owner (MetaMask wallet)
 * @param {string} params.keystoreJson       Raw keystore JSON string
 * @param {string} params.keystorePassword   Decryption password
 * @param {object} params.config             Parsed config.json object
 * @param {number} params.gameId             On-chain game ID to join
 * @param {object} params.serverConfig       Server config (urls, keys)
 * @returns {{ ok: boolean, error?: string }}
 */
export function spawnAgent({ ownerAddress, botAddress, keystoreJson, keystorePassword, config, gameId, serverConfig }) {
  if (activeAgents.has(ownerAddress)) {
    return { ok: false, error: 'Agent already running for this address' };
  }

  const env = {
    ...process.env,
    AGENT_KEYSTORE_JSON:      keystoreJson,
    AGENT_KEYSTORE_PASSWORD:  keystorePassword,
    AGENT_CONFIG_JSON:        JSON.stringify(config),
    ...(gameId ? { AGENT_GAME_ID: String(gameId) } : {}),
    SERVER_URL:               serverConfig.serverUrl,
    SOCKET_URL:               serverConfig.socketUrl,
    SERVER_API_KEY:           serverConfig.apiKey,
    ANTHROPIC_API_KEY:        serverConfig.anthropicApiKey,
    BASE_RPC_URL:             serverConfig.rpcUrl,
    USDC_ADDRESS:             serverConfig.usdcAddress,
    ZAX_MIGGY_VAULT_ADDRESS:  serverConfig.vaultAddress,
    // Suppress dotenv from loading a .env file (we're passing everything explicitly)
    DOTENV_CONFIG_PATH:       '/dev/null',
  };

  const proc = spawn('node', ['index.js'], {
    cwd: AGENT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry = {
    process: proc,
    gameId,
    ownerAddress,
    botAddress: botAddress ? botAddress.toLowerCase() : null,
    startedAt: Date.now(),
    output: [],
    status: 'running',
  };

  const appendLog = (line) => {
    entry.output.push({ ts: Date.now(), line });
    if (entry.output.length > MAX_OUTPUT_LINES) entry.output.shift();
  };

  proc.stdout.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach(appendLog);
  });
  proc.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => appendLog(`[ERR] ${line}`));
  });

  proc.on('exit', (code) => {
    entry.status = code === 0 ? 'exited' : `exited(${code})`;
    appendLog(`Process exited with code ${code}`);
    activeAgents.delete(ownerAddress);
  });

  activeAgents.set(ownerAddress, entry);
  return { ok: true };
}

/**
 * Kill a running agent owned by the given address.
 */
export function killAgent(ownerAddress) {
  const entry = activeAgents.get(ownerAddress);
  if (!entry) return { ok: false, error: 'No agent running for this address' };
  entry.process.kill('SIGTERM');
  activeAgents.delete(ownerAddress);
  return { ok: true };
}

/**
 * Return status + recent logs for an agent.
 */
export function getAgentStatus(ownerAddress) {
  const entry = activeAgents.get(ownerAddress);
  if (!entry) return null;
  return {
    ownerAddress: entry.ownerAddress,
    botAddress: entry.botAddress,
    gameId: entry.gameId,
    startedAt: entry.startedAt,
    status: entry.status,
    output: entry.output.slice(-50),  // last 50 lines
  };
}

/**
 * Return a summary of all active agents.
 */
export function listAgents() {
  return Array.from(activeAgents.values()).map(e => ({
    ownerAddress: e.ownerAddress,
    gameId: e.gameId,
    startedAt: e.startedAt,
    status: e.status,
  }));
}
