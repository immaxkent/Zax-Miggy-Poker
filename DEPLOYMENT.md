# CryptoPoker — AWS Deployment Guide

## Local dev (Anvil): token + vault in one go

Deployment uses **Anvil**, a **cast-imported deployer** (private key), and Forge with **`--sender`** and **`--account`** — no private key in scripts or repo.

**One-time:** Import the deployer key: `cast wallet import deployer --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Anvil default; for Sepolia use your own key). Set **contracts/.env**: `DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (or your key's address).

```bash
# Terminal 1: start chain (use --port 8546 if another Anvil/codebase already uses 8545)
anvil
# or: anvil --port 8546

# Terminal 2: deploy — use the same port as above (8545 or 8546)
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --account deployer
# If you used --port 8546: replace 8545 with 8546 in --rpc-url and in client/server .env (see below)
```

**Two Anvil instances (e.g. another IDE/codebase on 8545):**  
Run this project’s Anvil on a different port: `anvil --port 8546`. Then set **client/.env**: `VITE_ANVIL_RPC_URL=http://127.0.0.1:8546`, **server/.env**: `BASE_RPC_URL=http://127.0.0.1:8546`. Deploy with `--rpc-url http://127.0.0.1:8546`. In MetaMask, add the custom network with RPC **http://127.0.0.1:8546** and Chain ID **31337** (so MetaMask talks to this project’s Anvil, not the other one).

Copy the printed `TOKEN_ADDRESS` and `VAULT_ADDRESS` into **server/.env** and **client/.env**, then restart the server and client. After that, "Buy Chips" will work.

**Optional — save addresses to `versions/`:**  
From repo root: `node scripts/deploy-and-save.js anvil` (with anvil running). Writes **versions/anvil/<version>/deployment.json**. For Sepolia/Base use `sepolia`, `base-sepolia`, or `base` — same flow: `cast wallet import deployer`, `DEPLOYER_ADDRESS` in contracts/.env, then `node scripts/deploy-and-save.js sepolia` etc.

If `forge build` fails, install deps: `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-commit` (requires git), or ensure `lib/forge-std` and `lib/openzeppelin-contracts` exist.

---

## Shared test online (Ethereum Sepolia + Vercel)

To let you and a mate play together on the **real** internet (testnet), the live site must point at **Ethereum Sepolia** (chain ID **11155111**) and a **hosted game server**, not localhost/Anvil.

**Why the server must be global:** The Vercel frontend runs in users’ browsers. `localhost:3001` on the client points to *their* machine, not yours — so the game server must be deployed to a **public URL** (AWS, Render, Railway, etc.). Then you set `VITE_SERVER_URL` in Vercel to that URL so the live site talks to your server.

**Right now the Vercel site is not pointing at Sepolia** — it was built with no (or default) env, so it still uses Anvil + localhost. Do the following.

### 1. Deploy the game server somewhere (required for live site)

The Node server in `server/` must be reachable on the internet. Options:

- **AWS EC2:** One global instance; full control, HTTPS/WebSocket via ALB. See [Architecture on AWS](#architecture-on-aws) and the minimal EC2 path below.
- **Railway:** Connect repo, set Root to `server`, add env vars (see server `.env`), deploy. Copy the public URL (e.g. `https://your-app.railway.app`).
- **Render:** New Web Service, connect repo, root `server`, build `npm install`, start `npm start`. Add env vars. Copy URL.
- **Fly.io / other:** Same idea — run `server`, expose HTTPS, copy URL.

On the server, set at least: `NODE_ENV=production`, `ALLOWED_ORIGINS=https://your-vercel-app.vercel.app` (e.g. `https://zax-and-miggy-poker.vercel.app`), `CHAIN_ID=11155111`, `SEPOLIA_RPC_URL` (or `BASE_RPC_URL`), `TOKEN_ADDRESS`, `VAULT_ADDRESS`, and all secrets (JWT, HMAC, API key, signer key). Use the same `SERVER_API_KEY` in the client (Vercel) env.

### 2. Deploy contracts to Ethereum Sepolia

You need a **token** and **vault** on **Ethereum Sepolia**. Same flow as Anvil: **cast wallet** + **--sender** and **--account**. Import your deployer key once: `cast wallet import deployer --private-key <YOUR_KEY>`; set **contracts/.env** `DEPLOYER_ADDRESS` to that address. In `.env` also set `TOKEN_ADDRESS`, `SIGNER_ADDRESS`, `FEE_RECIPIENT`. Then either:

- **Full deploy (MockToken + PokerVault):** from repo root: `node scripts/deploy-and-save.js sepolia` (uses `SEPOLIA_RPC_URL` from root or contracts `.env`).
- **Manual (from contracts dir):** source env then run the **Sepolia** script (not DeployLocal — that’s for Anvil only):
  ```bash
  cd contracts
  set -a && source .env && source ../.env 2>/dev/null; set +a
  forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url "$SEPOLIA_RPC_URL" --broadcast --account deployer
  ```
  Ensure `SEPOLIA_RPC_URL` is set in **contracts/.env** or root **.env** (and that Anvil is **not** required for Sepolia).

Note the **Ethereum Sepolia** `TOKEN_ADDRESS` and `VAULT_ADDRESS` and the **server signer** address (must match the signer used in the vault and in the server’s `SIGNER_PRIVATE_KEY`).

### 3. Set Vercel environment variables

In the Vercel project: **Settings → Environment Variables**. Add these for **Production** (and **Preview** if you want):

| Name | Value |
|------|--------|
| `VITE_CHAIN_ID` | `11155111` (Ethereum Sepolia) |
| `VITE_SERVER_URL` | `https://your-game-server-url.com` (no trailing slash) |
| `VITE_SERVER_API_KEY` | Same as `SERVER_API_KEY` on the server |
| `VITE_TOKEN_ADDRESS` | Your Ethereum Sepolia token address |
| `VITE_VAULT_ADDRESS` | Your Ethereum Sepolia vault address |
| `VITE_TOKEN_DECIMALS` | `18` |
| `VITE_TOKEN_SYMBOL` | `CHIP` (or your symbol) |
| `VITE_WALLETCONNECT_PROJECT_ID` | (optional) From WalletConnect Cloud |

Redeploy the Vercel project so the new build uses these values. After that, the site will use **Ethereum Sepolia** and your **hosted server**, so you and your mate can connect, sign in, buy chips, and join the same table.

### 4. Quick checklist

- [ ] Game server deployed and URL works (e.g. `https://your-server.com/health` returns JSON).
- [ ] Server `ALLOWED_ORIGINS` includes your Vercel URL (e.g. `https://your-app.vercel.app`).
- [ ] Contracts on **Ethereum Sepolia** (chain 11155111); server and Vercel have the same `TOKEN_ADDRESS` and `VAULT_ADDRESS`.
- [ ] Server `CHAIN_ID=11155111` and `BASE_RPC_URL` points to an Ethereum Sepolia RPC (e.g. `https://rpc.sepolia.org`).
- [ ] Server signer matches the vault’s `serverSigner`.
- [ ] Vercel env vars set and project redeployed.

---

## ZaxAndMiggyVault on Base mainnet (USDC tables)

The **ZaxAndMiggyVault** uses **real USDC** on Base mainnet — no mock token. Users create games by depositing USDC (they set the table cost); others join by depositing the same amount. Winner gets 90% of the pot; 10% goes to the fee recipient.

### Prerequisites

- A wallet with **Base ETH** for gas and (optionally) **USDC** for testing.
- **cast** (Foundry) and the deployer key imported:  
  `cast wallet import deployer --private-key <YOUR_PRIVATE_KEY>`

### 1. Set contracts/.env

In **contracts/.env** (create from **contracts/.env.example** if needed):

```bash
# Deployer (must match the key you imported with cast)
DEPLOYER_ADDRESS=0xYourDeployerAddress

# Base RPC (public or from Alchemy/Infura)
BASE_RPC_URL=https://mainnet.base.org

# Server signer: the EOA that will sign close/cancel vouchers (see "Generate signer" below)
SIGNER_ADDRESS=0xYourServerSignerAddress

# Where the 10% winner fee is sent
FEE_RECIPIENT=0xYourFeeRecipientAddress
```

**Generate a signer key** (do not use your main wallet):

```bash
node -e "
const { ethers } = require('ethers');
const w = ethers.Wallet.createRandom();
console.log('Private key (store in server SIGNER_PRIVATE_KEY):', w.privateKey);
console.log('Address (use as SIGNER_ADDRESS in .env):', w.address);
"
```

### 2. Deploy the vault (no mock)

From the **contracts** directory:

```bash
cd contracts
forge script script/DeployZaxMiggyBase.s.sol:DeployZaxMiggyBase \
  --rpc-url "$BASE_RPC_URL" \
  --broadcast \
  --account deployer
```

The script uses **canonical Base USDC** at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. No MockUSDC is deployed on mainnet.

Note the printed **ZAX_MIGGY_VAULT_ADDRESS**.

### 3. Set client and server env

**Client (e.g. Vercel env or client/.env):**

| Name | Value |
|------|--------|
| `VITE_CHAIN_ID` | `8453` (Base mainnet) |
| `VITE_USDC_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (optional on Base; script defaults to this when chain is 8453) |
| `VITE_ZAX_MIGGY_VAULT_ADDRESS` | The `ZAX_MIGGY_VAULT_ADDRESS` from step 2 |
| `VITE_SERVER_URL` | Your game server URL (if using chip tables too) |
| `VITE_SERVER_API_KEY` | Same as server `SERVER_API_KEY` |

**Server:** If the server will sign **close** or **cancel** vouchers for USDC games, set:

- `SIGNER_PRIVATE_KEY` — private key for the `SIGNER_ADDRESS` used in the vault.
- Optionally `ZAX_MIGGY_VAULT_ADDRESS` and `USDC_ADDRESS` for logging or future API use.

### 4. Deployment process summary

1. **One-time:** Import deployer key with `cast wallet import deployer --private-key <key>`.
2. **contracts/.env:** Set `DEPLOYER_ADDRESS`, `BASE_RPC_URL`, `SIGNER_ADDRESS`, `FEE_RECIPIENT`.
3. **Deploy:**  
   `forge script script/DeployZaxMiggyBase.s.sol:DeployZaxMiggyBase --rpc-url $BASE_RPC_URL --broadcast --account deployer`
4. **Copy** `ZAX_MIGGY_VAULT_ADDRESS` (and optionally `USDC_ADDRESS`) into client and server env.
5. **Redeploy** the frontend (e.g. Vercel) so the "USDC Tables" section appears; users can Create game (deposit USDC to set table cost) and Join game (by game ID).

The UI shows **USDC Tables (Base)** when both `VITE_USDC_ADDRESS` (or default Base USDC) and `VITE_ZAX_MIGGY_VAULT_ADDRESS` are set. Create game deposits USDC and creates the on-chain game; Join game reads the table cost from the contract and deposits the same amount.

---

## Architecture on AWS

```
Internet → ALB (HTTPS/WSS termination)
              → EC2 / ECS (Node.js game server)
              → ElastiCache Redis (game state)
              → RDS PostgreSQL (hand history)
```

**Minimal path (one EC2, no ALB/Redis/RDS yet):** Full step-by-step walkthrough: **[MINIMAL_AWS_WALKTHROUGH.md](./MINIMAL_AWS_WALKTHROUGH.md)**. Short version: Launch an Ubuntu 24.04 EC2 (e.g. t3.micro), open HTTP (80) and your server port (e.g. 3001) in the security group, assign an Elastic IP. On the instance: install Node 20, clone repo, `cd server && npm install`, set env vars (see §2 below or a single `.env` file), run with `pm2 start src/server.js --name poker`. Point Vercel `VITE_SERVER_URL` to `http://<ELASTIC_IP>:3001` (or use a domain + Nginx/Caddy for HTTPS). For production you’ll want HTTPS (ALB or Nginx with Let’s Encrypt) and `ALLOWED_ORIGINS` set to your Vercel URL.

---

## 1. Server Setup (EC2 / Ubuntu 24.04)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone repo and install
git clone <your-repo>
cd poker-platform/server
npm install

# Install PM2 for process management
npm install -g pm2
```

---

## 2. Environment Variables (AWS Parameter Store)

Store all secrets in AWS Systems Manager Parameter Store (SecureString):

```
/cryptopoker/JWT_SECRET
/cryptopoker/HMAC_SECRET
/cryptopoker/SERVER_API_KEY
/cryptopoker/SIGNER_PRIVATE_KEY
/cryptopoker/TOKEN_ADDRESS
/cryptopoker/VAULT_ADDRESS
/cryptopoker/BASE_RPC_URL
/cryptopoker/SEPOLIA_RPC_URL
/cryptopoker/CHAIN_ID
```

Fetch at startup with:
```bash
aws ssm get-parameters-by-path --path /cryptopoker/ --with-decryption \
  --query "Parameters[*].{Name:Name,Value:Value}" \
  --output json | jq -r '.[] | "export " + (.Name | split("/")[-1]) + "=\"" + .Value + "\""' > /tmp/env.sh
source /tmp/env.sh
```

---

## 3. Generate Secrets

```bash
# JWT & HMAC secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# API Key (simpler, but still strong)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Signer wallet (DO NOT use your main wallet)
node -e "
const { ethers } = require('ethers');
const w = ethers.Wallet.createRandom();
console.log('Private key:', w.privateKey);
console.log('Address (put this in PokerVault constructor):', w.address);
"
```

**Save the signer address** — you'll need it when deploying PokerVault.sol.

---

## 4. ALB + HTTPS + WebSocket

In AWS Console:
1. Create **Application Load Balancer** (public, port 443)
2. Add **SSL certificate** via ACM (free)
3. Create target group → port 3001 (HTTP)
4. Add listener rule: forward all to target group
5. **Critical for WebSocket**: In target group settings →
   - Stickiness: Enabled (duration-based, 1 day)
   - Protocol: HTTP/1.1

Security group on EC2: allow inbound 3001 from ALB security group only.

---

## 5. Client → Server Security

The client authenticates on every connection:

```
Client                          Server
  |                               |
  |-- POST /auth/challenge -----→ |  (X-Poker-Key header required)
  |←- { nonce, message } -------- |
  |                               |
  |  [wallet signs message]       |
  |                               |
  |-- POST /auth/verify --------→ |
  |←- { JWT token } ------------- |
  |                               |
  |-- io.connect({ auth: {        |
  |     token: JWT,               |
  |     apiKey: SERVER_API_KEY    |
  |   }}) ----------------------→ |  (socketAuthMiddleware checks both)
  |                               |
  |  [HMAC-signed messages only]  |
```

---

## 6. Smart Contract Deployment (Base)

Use the project's Foundry deploy script (reads `contracts/.env`):

```bash
cd contracts

# Ensure .env has: TOKEN_ADDRESS, SIGNER_ADDRESS, FEE_RECIPIENT
# Use encrypted keystore (no plaintext key in .env):
#   cast wallet import deployer --interactive

# Base mainnet
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify \
  --sender $DEPLOYER_ADDRESS --account deployer

# Or Base Sepolia first
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify \
  --sender $DEPLOYER_ADDRESS --account deployer
```

After deploying:
1. Note the vault address → set `VAULT_ADDRESS` in server + client env
2. Verify the `serverSigner` matches your AWS signer wallet address
3. Run `buildWithdrawHash()` test to confirm signature scheme works

---

## 7. Fee Configuration

Current defaults (configurable via env + contract):

| Fee          | Rate | When taken                          |
|--------------|------|-------------------------------------|
| Buy-in       | 8%   | At deposit (on-chain, contract)     |
| Winner payout| 5%   | At withdrawal (on-chain, contract)  |

**Net player economics example (Low stakes, 2 players):**
- Each player deposits 200 tokens → pays 16 fee → 184 chips each
- Pot = 368 chips
- Winner takes 368 chips
- Withdrawal: 368 × 0.95 = **349.6 tokens net**
- House profit: 16 + 16 (buy-in) + 18.4 (winner) = **50.4 tokens (13.7% of gross)**

To adjust fees (owner only):
```solidity
vault.setFeeConfig(
  600,   // 6% buy-in
  400    // 4% winner
);
```

---

## 8. Min Players Config

Current: `MIN_PLAYERS=2` (for testing)

To change for production:
```bash
# In .env or Parameter Store
MIN_PLAYERS=3   # require 3 players to start
# or per-table in config.js stakes[key].minPlayers
```

---

## 9. PM2 Process Config

```js
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name:   'cryptopoker',
    script: 'src/server.js',
    env_production: {
      NODE_ENV: 'production',
    },
    instances: 1,          // scale to 2+ with Redis session sharing
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file:  '/var/log/pm2/cryptopoker-error.log',
    out_file:    '/var/log/pm2/cryptopoker-out.log',
  }]
};
```

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

---

## 10. Quick Health Check

```bash
# Should return server status + signer address
curl https://your-domain.com/health

# Expected response:
{
  "status": "ok",
  "signer": "0xYourSignerAddress",
  "tables": 4,
  "players": 0
}
```

Cross-check: the `signer` address must match what's set in `PokerVault.sol`.
If they don't match, withdrawals will fail with "Invalid server signature".

---

## 11. Checklist Before Going Live

- [ ] `SIGNER_PRIVATE_KEY` matches `serverSigner` in PokerVault
- [ ] `VAULT_ADDRESS` set in both server and client env
- [ ] `TOKEN_ADDRESS` set and tested with a small deposit
- [ ] `ALLOWED_ORIGINS` locked to your domain only
- [ ] `SERVER_API_KEY` is strong (32+ byte random hex)
- [ ] SSL cert active on ALB
- [ ] EC2 security group blocks port 3001 from internet (ALB only)
- [ ] Test full flow: connect → sign → deposit → join table → play → cash out
- [ ] Verify provably fair: compare `serverHash` pre-hand vs `serverSeed` post-hand
