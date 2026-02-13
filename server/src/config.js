// ─────────────────────────────────────────────────────────────────────────────
//  POKER PLATFORM — CENTRAL CONFIG
//  All game economics, security, and table settings live here.
//  Set via environment variables in production (AWS Parameter Store / .env)
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

export const config = {

  // ── Server Identity & Security ──────────────────────────────────────────────
  server: {
    port:           process.env.PORT             || 3001,
    jwtSecret:      process.env.JWT_SECRET,                    // REQUIRED
    // HMAC key for client↔server message signing (prevents MITM)
    hmacSecret:     process.env.HMAC_SECRET,                   // REQUIRED
    // Signing wallet private key (issues withdrawal vouchers)
    signerPrivKey:  process.env.SIGNER_PRIVATE_KEY,            // REQUIRED
    // Allowed frontend origin(s) — reject all others
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    // API key clients must send in X-Poker-Key header
    apiKey:         process.env.SERVER_API_KEY,                // REQUIRED
    nodeEnv:        process.env.NODE_ENV         || 'development',
  },

  // ── Blockchain ───────────────────────────────────────────────────────────────
  chain: {
    rpcUrl:          process.env.BASE_RPC_URL    || 'http://127.0.0.1:8545',
    chainId:         Number(process.env.CHAIN_ID || 31337),     // 31337=anvil, 8453=Base mainnet, 84532=Base Sepolia
    tokenAddress:    process.env.TOKEN_ADDRESS,                 // ERC-20
    vaultAddress:    process.env.VAULT_ADDRESS,                 // PokerVault.sol
    tokenDecimals:   Number(process.env.TOKEN_DECIMALS || 18),
  },

  // ── Fee Structure ─────────────────────────────────────────────────────────
  // These MUST match the on-chain contract values or be ≤ them.
  // The contract enforces the deduction; server just needs to know net chips.
  fees: {
    // Buy-in fee taken at deposit (contract deducts, server credits net chips)
    buyInBps:       Number(process.env.BUY_IN_FEE_BPS   || 800),  // 8%
    // Winner cashout fee taken at withdrawal
    winnerBps:      Number(process.env.WINNER_FEE_BPS   || 500),  // 5%
  },

  // ── Table Defaults ────────────────────────────────────────────────────────
  tables: {
    // Minimum players to START a hand (configurable per table)
    minPlayersToStart:  Number(process.env.MIN_PLAYERS   || 2),
    // Maximum seats per table
    maxSeats:           Number(process.env.MAX_SEATS     || 9),

    // Stake levels — buy-in in token units (post-fee, i.e. chips credited)
    stakes: {
      micro: {
        name:          'Micro',
        smallBlind:    1,
        bigBlind:      2,
        minBuyIn:      40,    // 20x BB
        maxBuyIn:      200,   // 100x BB
        maxSeats:      6,
        minPlayers:    2,
      },
      low: {
        name:          'Low',
        smallBlind:    5,
        bigBlind:      10,
        minBuyIn:      200,
        maxBuyIn:      1000,
        maxSeats:      9,
        minPlayers:    2,
      },
      mid: {
        name:          'Mid',
        smallBlind:    25,
        bigBlind:      50,
        minBuyIn:      1000,
        maxBuyIn:      5000,
        maxSeats:      9,
        minPlayers:    2,
      },
      high: {
        name:          'High Roller',
        smallBlind:    100,
        bigBlind:      200,
        minBuyIn:      4000,
        maxBuyIn:      20000,
        maxSeats:      6,
        minPlayers:    2,
      },
    },

    // Action timer
    actionTimeoutSeconds: Number(process.env.ACTION_TIMEOUT || 30),

    // Reconnect grace period before folding player
    reconnectGraceSeconds: Number(process.env.RECONNECT_GRACE || 60),
  },

  // ── Provably Fair RNG ─────────────────────────────────────────────────────
  rng: {
    // Server seed is re-rolled every N hands
    rotateSeedEveryHands: 100,
  },

  // ── Redis ─────────────────────────────────────────────────────────────────
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // ── Database ─────────────────────────────────────────────────────────────
  db: {
    url: process.env.DATABASE_URL,
  },
};

// Validate required secrets on startup
export function validateConfig() {
  const required = [
    ['server.jwtSecret',     config.server.jwtSecret],
    ['server.hmacSecret',    config.server.hmacSecret],
    ['server.signerPrivKey', config.server.signerPrivKey],
    ['server.apiKey',        config.server.apiKey],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }

  // Warn (don't crash) if contract addresses not yet set — expected before deploy
  const zero = '0x0000000000000000000000000000000000000000';
  if (!config.chain.tokenAddress || config.chain.tokenAddress === zero) {
    console.warn('⚠️  TOKEN_ADDRESS not set — set after deploying your ERC-20');
  }
  if (!config.chain.vaultAddress || config.chain.vaultAddress === zero) {
    console.warn('⚠️  VAULT_ADDRESS not set — set after: forge script script/Deploy.s.sol');
  }

  console.log(`✅ Config OK — chain ${config.chain.chainId} (${config.server.nodeEnv})`);
}

export default config;
