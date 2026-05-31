# Deploy Agentic Arena (Base Sepolia → Base Mainnet)

Deploy `Arena`, `BotFactory`, `AgenticChips1155`, and `AgenticRankingsV2`, then wire addresses into the client and server.

## Prerequisites

1. **Foundry** installed (`forge`, `cast`).
2. **Deploy wallet** with ETH on the target chain (Base Sepolia faucet, then mainnet ETH on Base).
3. **USDC** on the deployer wallet for testing `createBot` / `joinGame` (not required for deploy itself).
4. **Server signer** — one wallet whose private key lives in `server/.env` as `SIGNER_PRIVATE_KEY`. Its address is `SIGNER_ADDRESS` below.

```bash
# One-time: import deploy key into Foundry keystore
cast wallet import deployMeta --interactive
# or: cast wallet import deployer --interactive
```

## 1. Configure `contracts/.env`

Copy `contracts/.env.example` → `contracts/.env`:

```env
SIGNER_ADDRESS=0x91D4A99A08942FCd28dE2f1dd3ac2b44fb8d26d0   # from server /health "signer"
FEE_RECIPIENT=0xYourTreasuryWallet
DEPLOY_ACCOUNT=deployMeta
```

Optional in repo root `.env`:

```env
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org
BASESCAN_API_KEY=...   # for VERIFY=1
```

## 2. Deploy to Base Sepolia (testnet)

```bash
cd "/path/to/Zax & Miggy Poker"
npm run test:contracts          # sanity check
node scripts/deploy-agentic-arena.js base-sepolia 1.0.1
```

This:

- Deploys all four contracts
- Writes `versions/base-sepolia/1.0.1/agentic-deployment.json`
- Prints env blocks for server + Vercel

**USDC (canonical on Base Sepolia):** `0x036CbD53842c6846630281C1C3aD1868e8e7a34f`  
**Chain ID:** `84532`

Get test ETH: [Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet).  
Get test USDC from Circle / bridge as needed.

## 3. Wire local env

```bash
node scripts/wire-agentic-env.js base-sepolia 1.0.1
```

Updates `client/.env` and `server/.env` with `VITE_ARENA_*` / `ARENA_*` and `CHAIN_ID=84532`.

## 4. Vercel (frontend)

In the Vercel project → **Settings → Environment Variables**, add (Preview + Production for Sepolia testing, or a Preview-only env):

| Variable | Example |
|----------|---------|
| `VITE_CHAIN_ID` | `84532` |
| `VITE_USDC_ADDRESS` | `0x036CbD53842c6846630281C1C3aD1868e8e7a34f` |
| `VITE_ARENA_ADDRESS` | from `agentic-deployment.json` |
| `VITE_BOT_FACTORY_ADDRESS` | … |
| `VITE_AGENTIC_RANKINGS_V2_ADDRESS` | … |
| `VITE_AGENTIC_CHIPS_1155_ADDRESS` | … |

Keep existing `VITE_SERVER_URL`, `VITE_SOCKET_URL`, `VITE_SERVER_API_KEY`, `VITE_WALLETCONNECT_PROJECT_ID`.

Redeploy Vercel after saving.

## 5. EC2 server (testnet)

SSH to the box, edit `server/.env` (same keys as printed by deploy script):

```env
CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
USDC_ADDRESS=0x036CbD53842c6846630281C1C3aD1868e8e7a34f
AGENTIC_ARENA_ENABLED=true
ARENA_ADDRESS=0x...
BOT_FACTORY_ADDRESS=0x...
AGENTIC_RANKINGS_V2_ADDRESS=0x...
AGENTIC_CHIPS_1155_ADDRESS=0x...
```

```bash
pm2 restart poker --update-env
curl -s http://127.0.0.1:3001/health
# expect arenaEnabled: true, dbBackend: supabase
curl -s http://127.0.0.1:3001/api/arena/status
```

## 6. Test in the app

1. Connect wallet on **Base Sepolia** (add chain in MetaMask if needed).
2. Open **ARENA** → create game (on-chain fee + server table).
3. `/bots` → register bot on-chain ($3 USDC) when contracts are wired.

## 7. Deploy to Base mainnet

When Sepolia testing is done:

```bash
node scripts/deploy-agentic-arena.js base 1.0.1
node scripts/wire-agentic-env.js base 1.0.1
```

**USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`  
**Chain ID:** `8453`

Update Vercel to `VITE_CHAIN_ID=8453` and mainnet addresses. Update EC2 `server/.env` and restart pm2.

## Manual forge (without Node script)

```bash
cd contracts
export USDC_ADDRESS=0x036CbD53842c6846630281C1C3aD1868e8e7a34f
export FEE_RECIPIENT=0x...
export SETTLEMENT_SIGNER=0x...

forge script script/DeployAgenticArena.s.sol:DeployAgenticArena \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --account deployMeta \
  --chain-id 84532
```

Copy `ARENA_ADDRESS`, etc. from the log, then `node scripts/wire-agentic-env.js` after saving JSON manually under `versions/`.

## Verify on Basescan (optional)

```bash
VERIFY=1 node scripts/deploy-agentic-arena.js base-sepolia 1.0.1
```

Requires `BASESCAN_API_KEY` in `.env`.

## Address manifest

| Network | File |
|---------|------|
| Base Sepolia | `versions/base-sepolia/<version>/agentic-deployment.json` |
| Base mainnet | `versions/base/<version>/agentic-deployment.json` |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing SIGNER_ADDRESS` | Set in `contracts/.env`; must match server signer |
| Insufficient funds | Fund deploy wallet with Sepolia ETH |
| `createBot` USDC fails | Approve Arena; hold test USDC on owner wallet |
| Client still “contracts not configured” | Redeploy Vercel with `VITE_ARENA_ADDRESS` |
| Server arena disabled | `AGENTIC_ARENA_ENABLED=true` + restart pm2 |
