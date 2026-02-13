# BOOT — From Zero to Running

Everything below is copy-paste ready. Run each section in order.

---

## Prerequisites

```bash
# Foundry (if not installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Node.js 20+ (if not installed)
# https://nodejs.org — or via nvm:
nvm install 20 && nvm use 20

# Verify
forge --version   # forge 0.2.x
cast --version    # cast 0.2.x
anvil --version   # anvil 0.2.x
node --version    # v20.x
```

---

## Step 1 — Install contract dependencies

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
```

---

## Step 2 — Start anvil (local chain)

Open a dedicated terminal and leave it running:

```bash
anvil
```

You'll see 10 funded accounts printed. Anvil account #0 is your deployer.
Anvil account #1 (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`) is pre-set
as the signing wallet in all `.env` files — no changes needed for local dev.

---

## Step 3 — Encrypt your deployer key (one-time setup)

This stores the key encrypted in your OS keychain. You'll type a password
once — after that `forge script --account deployer` unlocks it at deploy time.

```bash
# Import anvil account #0 (local dev only — never do this with a real key)
cast wallet import deployer --interactive
# Paste: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Enter a password (e.g. "dev")
```

For production, you'll import your real wallet the same way:
```bash
cast wallet import deployer --interactive
# Paste your real private key — it's encrypted immediately and the key is gone
```

---

## Step 4 — Deploy a mock ERC-20 token (local dev)

We need a token to deposit. Deploy a simple mintable one:

```bash
cd contracts

# Deploy MockToken (the test contract has one — deploy it directly)
forge create test/PokerVault.t.sol:MockToken \
  --rpc-url anvil \
  --account deployer

# Note the "Deployed to:" address → set TOKEN_ADDRESS in all 3 .env files
```

Mint yourself some tokens:
```bash
# Replace 0x<TOKEN> with the address above, 0x<YOU> with your wallet
cast send 0x<TOKEN> "mint(address,uint256)" \
  0x<YOUR_WALLET_ADDRESS> \
  $(cast to-wei 1000000) \
  --rpc-url anvil \
  --account deployer
```

---

## Step 5 — Deploy PokerVault

```bash
cd contracts

# Check your .env has TOKEN_ADDRESS, SIGNER_ADDRESS, FEE_RECIPIENT set
cat .env

forge script script/Deploy.s.sol \
  --rpc-url anvil \
  --account deployer \
  --broadcast \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Output will show: PokerVault deployed at: 0x...
# Copy that address into:
#   server/.env  → VAULT_ADDRESS=
#   client/.env  → VITE_VAULT_ADDRESS=
# Also copy TOKEN_ADDRESS into:
#   server/.env  → TOKEN_ADDRESS=
#   client/.env  → VITE_TOKEN_ADDRESS=
```

---

## Step 6 — Run the tests

```bash
cd contracts
forge test -vv
# All 6 tests should pass
```

---

## Step 7 — Start the server

```bash
cd server
npm install
npm run dev
# → CryptoPoker server running on port 3001
# → Server signer: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

---

## Step 8 — Start the client

```bash
cd client
npm install
npm run dev
# → Local: http://localhost:5173
```

Open http://localhost:5173 — connect MetaMask pointed at localhost:8545
(chain ID 31337).

---

## Sanity check — full flow via cast

```bash
# Check vault is live
cast call $VAULT_ADDRESS "token()(address)" --rpc-url anvil

# Check server health
curl http://localhost:3001/health

# The signer address from /health must match SIGNER_ADDRESS in contracts/.env
# If they match → withdrawals will work. If not → check SIGNER_PRIVATE_KEY.
```

---

## Useful cast commands during dev

```bash
# Check player's token balance
cast call $TOKEN_ADDRESS "balanceOf(address)(uint256)" $YOUR_ADDRESS --rpc-url anvil

# Check vault's token balance (total locked)
cast call $TOKEN_ADDRESS "balanceOf(address)(uint256)" $VAULT_ADDRESS --rpc-url anvil

# Check fee config
cast call $VAULT_ADDRESS "buyInFeeBps()(uint256)" --rpc-url anvil
cast call $VAULT_ADDRESS "winnerFeeBps()(uint256)" --rpc-url anvil

# Change fees (owner only)
cast send $VAULT_ADDRESS "setFeeConfig(uint256,uint256)" 600 400 \
  --rpc-url anvil --account deployer
# ^ sets buy-in to 6%, winner to 4%

# Change signer (e.g. after generating new server key)
cast send $VAULT_ADDRESS "setServerSigner(address)" $NEW_SIGNER \
  --rpc-url anvil --account deployer
```

---

## Moving to Base Sepolia (testnet)

1. Fund your deployer wallet with Sepolia ETH from https://faucet.base.org

2. Import your real deployer key (if not done):
   ```bash
   cast wallet import deployer --interactive
   ```

3. Set `TOKEN_ADDRESS` in `contracts/.env` to your real ERC-20

4. Deploy:
   ```bash
   forge script script/Deploy.s.sol \
     --rpc-url base_sepolia \
     --account deployer \
     --broadcast \
     --verify \
     --sender $YOUR_ADDRESS
   ```

5. Update `server/.env`:
   ```
   BASE_RPC_URL=https://sepolia.base.org
   CHAIN_ID=84532
   ```

6. Update `client/.env`:
   ```
   VITE_CHAIN_ID=84532
   ```

---

## Generating a production signer wallet

The server signs withdrawal vouchers with a hot wallet. For production,
generate a fresh one that you never use for anything else:

```bash
# Generate
cast wallet new

# Output:
# Address:     0xABC...
# Private key: 0xDEF...

# Import into OS keychain (encrypted)
cast wallet import poker-signer --interactive
# Paste the private key → set a password

# Now set in server/.env:
# SIGNER_PRIVATE_KEY=0xDEF...  (or use AWS Secrets Manager in prod)

# And in contracts/.env:
# SIGNER_ADDRESS=0xABC...

# Then redeploy vault with new signer address, or:
cast send $VAULT_ADDRESS "setServerSigner(address)" 0xABC... \
  --rpc-url base_sepolia --account deployer
```

---

## Project structure reminder

```
poker-platform/
├── contracts/          ← Foundry project
│   ├── src/PokerVault.sol
│   ├── script/Deploy.s.sol
│   ├── test/PokerVault.t.sol
│   ├── foundry.toml
│   └── .env            ← forge script vars (no private keys)
├── server/             ← Node.js + Socket.IO
│   ├── src/
│   └── .env            ← server secrets (gitignored)
└── client/             ← React + Vite
    ├── src/
    └── .env            ← public config (gitignored)
```
