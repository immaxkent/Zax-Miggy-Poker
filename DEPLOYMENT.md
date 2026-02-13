# CryptoPoker — AWS Deployment Guide

## Local dev (Anvil): token + vault in one go

To avoid "sending to burn address" / "not a contract" errors, deploy the mock token and vault first:

```bash
# Terminal 1: start chain (use --port 8546 if another Anvil/codebase already uses 8545)
anvil
# or: anvil --port 8546

# Terminal 2: deploy — use the same port as above (8545 or 8546)
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# If you used --port 8546: replace 8545 with 8546 in --rpc-url and in client/server .env (see below)
```

**Two Anvil instances (e.g. another IDE/codebase on 8545):**  
Run this project’s Anvil on a different port: `anvil --port 8546`. Then set **client/.env**: `VITE_ANVIL_RPC_URL=http://127.0.0.1:8546`, **server/.env**: `BASE_RPC_URL=http://127.0.0.1:8546`. Deploy with `--rpc-url http://127.0.0.1:8546`. In MetaMask, add the custom network with RPC **http://127.0.0.1:8546** and Chain ID **31337** (so MetaMask talks to this project’s Anvil, not the other one).

Copy the printed `TOKEN_ADDRESS` and `VAULT_ADDRESS` into **server/.env** and **client/.env**, then restart the server and client. After that, "Buy Chips" will work.

**Optional — save addresses to `versions/`:**  
From repo root, run `node scripts/deploy-and-save.js anvil` (with anvil running). This runs the same deploy and writes **versions/anvil/deployment.json** with `tokenAddress`, `vaultAddress`, and `deployedAt`. For Base Sepolia or Base mainnet use `base-sepolia` or `base` (set `contracts/.env` and `DEPLOYER_ADDRESS` / cast wallet first).

If `forge build` fails, install deps: `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-commit` (requires git), or ensure `lib/forge-std` and `lib/openzeppelin-contracts` exist.

---

## Architecture on AWS

```
Internet → ALB (HTTPS/WSS termination)
              → EC2 / ECS (Node.js game server)
              → ElastiCache Redis (game state)
              → RDS PostgreSQL (hand history)
```

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
