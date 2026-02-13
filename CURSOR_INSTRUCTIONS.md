# Instructions for Cursor AI Agent

You are helping deploy and boot a crypto poker platform. Follow these steps exactly in order. After each step that produces output, show me the result and wait for confirmation before proceeding.

---

## PHASE 1: Setup Dependencies

**Step 1.1** - Check if Foundry is installed:
```bash
forge --version
```
If not installed, run:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Step 1.2** - Check Node.js version (need 20+):
```bash
node --version
```
If < v20, install Node 20.

**Step 1.3** - Navigate to project root and install Foundry dependencies:
```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
```

Show me the output, then wait for my confirmation.

---

## PHASE 2: Start Local Blockchain

**Step 2.1** - Start anvil in a dedicated terminal (tell me when this is running):
```bash
anvil
```

This should print 10 funded accounts. Keep this terminal running. Show me the first 2 addresses printed.

Wait for my confirmation.

---

## PHASE 3: Setup Encrypted Wallet

**Step 3.1** - Import anvil's default account #0 as an encrypted keystore:
```bash
cast wallet import deployer --interactive
```

When prompted:
- Private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- Password: `dev` (for local dev only)

**Important**: This is anvil's default account. For production, you'd use a real wallet's private key.

Show me the output, then wait for confirmation.

---

## PHASE 4: Deploy Mock ERC-20 Token

**Step 4.1** - Deploy a test token to anvil:
```bash
cd contracts
forge create test/PokerVault.t.sol:MockToken \
  --rpc-url anvil \
  --account deployer
```

Enter password: `dev`

**Step 4.2** - From the output, find the line "Deployed to: 0x..." — this is your TOKEN_ADDRESS.

Show me the deployed address.

**Step 4.3** - Update all three .env files with this TOKEN_ADDRESS:
- `contracts/.env` → `TOKEN_ADDRESS=0x...`
- `server/.env` → `TOKEN_ADDRESS=0x...`
- `client/.env` → `VITE_TOKEN_ADDRESS=0x...`

Confirm you've updated all three files.

---

## PHASE 5: Mint Tokens to Test Account

**Step 5.1** - Get your MetaMask address (or any wallet address you'll use for testing).

Tell me your wallet address.

**Step 5.2** - Mint 1,000,000 tokens to your wallet using encrypted key:
```bash
cast send <TOKEN_ADDRESS_FROM_STEP_4.2> \
  "mint(address,uint256)" \
  <YOUR_WALLET_ADDRESS> \
  $(cast --to-wei 1000000) \
  --rpc-url anvil \
  --account deployer
```

This uses your encrypted `deployer` keystore. Enter password: `dev`

Show me the transaction hash.

---

## PHASE 6: Deploy PokerVault Contract

**Step 6.1** - Verify contracts/.env has these set correctly:
- `TOKEN_ADDRESS=0x...` (from Step 4.2)
- `SIGNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (anvil account #1, pre-configured)
- `FEE_RECIPIENT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (anvil account #0)
- `DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

Show me these values from the file.

**Step 6.2** - Deploy the vault:
```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url anvil \
  --account deployer \
  --broadcast \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

Enter password: `dev`

**Step 6.3** - From the output, find "PokerVault deployed at: 0x..." — this is your VAULT_ADDRESS.

Show me the deployed vault address.

**Step 6.4** - Update the vault address in:
- `server/.env` → `VAULT_ADDRESS=0x...`
- `client/.env` → `VITE_VAULT_ADDRESS=0x...`

Confirm you've updated both files.

---

## PHASE 7: Run Contract Tests

**Step 7.1** - Run the test suite:
```bash
cd contracts
forge test -vv
```

All 6 tests should pass. Show me the test output. If any fail, stop and show me the error.

---

## PHASE 8: Start the Game Server

**Step 8.1** - Install server dependencies:
```bash
cd server
npm install
```

**Step 8.2** - Verify server/.env has:
- `TOKEN_ADDRESS=0x...` (from Step 4.2)
- `VAULT_ADDRESS=0x...` (from Step 6.3)
- `BASE_RPC_URL=http://127.0.0.1:8545`
- `CHAIN_ID=31337`

Show me these values.

**Step 8.3** - Start the server in a new terminal:
```bash
npm run dev
```

You should see:
```
✅ Config OK — chain 31337 (development)
🚀 CryptoPoker server running on port 3001
🔑 Server signer: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Show me the startup output. Keep this terminal running.

---

## PHASE 9: Start the Frontend

**Step 9.1** - Install client dependencies:
```bash
cd client
npm install
```

**Step 9.2** - Verify client/.env has:
- `VITE_TOKEN_ADDRESS=0x...` (from Step 4.2)
- `VITE_VAULT_ADDRESS=0x...` (from Step 6.3)
- `VITE_CHAIN_ID=31337`
- `VITE_SERVER_API_KEY=dev_poker_key_change_before_prod` (must match server)

Show me these values.

**Step 9.3** - Start the frontend in a new terminal:
```bash
npm run dev
```

You should see:
```
VITE vX.X.X  ready in XXX ms
➜  Local:   http://localhost:5173/
```

Show me the output and the URL.

---

## PHASE 10: Configure MetaMask and Test

**Step 10.1** - Add Anvil network to MetaMask:
- Network name: Anvil Local
- RPC URL: http://127.0.0.1:8545
- Chain ID: 31337
- Currency symbol: ETH

**Step 10.2** - Import a funded anvil account to MetaMask:
Use one of the private keys printed when you started anvil in Step 2.1 (NOT the deployer key).
For example, account #2: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

**Step 10.3** - Open http://localhost:5173 in your browser

**Step 10.4** - Connect wallet (should auto-detect Anvil Local network)

**Step 10.5** - Click "Sign In" to authenticate with the server

**Step 10.6** - Test the deposit flow:
1. Click "+ Buy Chips"
2. Enter amount (e.g. 1000)
3. Approve and deposit
4. Should see chips credited (920 after 8% fee)

**Step 10.7** - Join a table and test playing a hand with 2 players

Tell me when each of these steps completes successfully, or show me any errors.

---

## PHASE 11: Sanity Checks

**Step 11.1** - Check server health endpoint:
```bash
curl http://localhost:3001/health
```

Should return:
```json
{
  "status": "ok",
  "signer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "tables": 4,
  "players": 0
}
```

**CRITICAL**: The `signer` address must match `SIGNER_ADDRESS` in contracts/.env. If they don't match, withdrawals will fail.

Show me the health check response.

**Step 11.2** - Check vault configuration on-chain:
```bash
cast call <VAULT_ADDRESS> "serverSigner()(address)" --rpc-url anvil
cast call <VAULT_ADDRESS> "buyInFeeBps()(uint256)" --rpc-url anvil
cast call <VAULT_ADDRESS> "winnerFeeBps()(uint256)" --rpc-url anvil
```

Should return:
- Signer: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Buy-in fee: `800` (8%)
- Winner fee: `500` (5%)

Show me these values.

---

## TROUBLESHOOTING CHECKLIST

If something doesn't work, check:

1. **Anvil still running?** (check the terminal from Step 2.1)
2. **All 3 terminals running?** (anvil, server, client)
3. **MetaMask on Anvil network?** (chain ID 31337)
4. **Token and Vault addresses match across all .env files?**
5. **Server signer matches vault's serverSigner?**

## USEFUL CAST COMMANDS (All Use Encrypted Wallet)

All these commands use your encrypted `deployer` keystore. You'll be prompted for password: `dev`

**Read-only calls (no password needed):**
```bash
# Check vault is deployed
cast code <VAULT_ADDRESS> --rpc-url anvil | head -c 50

# Check your token balance
cast call <TOKEN_ADDRESS> \
  "balanceOf(address)(uint256)" \
  <YOUR_WALLET_ADDRESS> \
  --rpc-url anvil

# Check vault's token balance
cast call <TOKEN_ADDRESS> \
  "balanceOf(address)(uint256)" \
  <VAULT_ADDRESS> \
  --rpc-url anvil

# Check vault config
cast call <VAULT_ADDRESS> "serverSigner()(address)" --rpc-url anvil
cast call <VAULT_ADDRESS> "buyInFeeBps()(uint256)" --rpc-url anvil
cast call <VAULT_ADDRESS> "winnerFeeBps()(uint256)" --rpc-url anvil
```

**Write calls (require password: `dev`):**
```bash
# Mint more tokens to yourself
cast send <TOKEN_ADDRESS> \
  "mint(address,uint256)" \
  <YOUR_WALLET_ADDRESS> \
  $(cast --to-wei 100000) \
  --rpc-url anvil \
  --account deployer

# Change vault fees (owner only)
cast send <VAULT_ADDRESS> \
  "setFeeConfig(uint256,uint256)" \
  600 400 \
  --rpc-url anvil \
  --account deployer
# ^ sets buy-in to 6%, winner to 4%

# Update server signer address (if you generate a new one)
cast send <VAULT_ADDRESS> \
  "setServerSigner(address)" \
  <NEW_SIGNER_ADDRESS> \
  --rpc-url anvil \
  --account deployer
```

**Check transaction status:**
```bash
cast receipt <TX_HASH> --rpc-url anvil
```

---

## SUCCESS CRITERIA

You've succeeded when:
- ✅ All 6 forge tests pass
- ✅ Server running on port 3001 with correct signer
- ✅ Frontend running on port 5173
- ✅ You can connect wallet, sign in, deposit chips, join a table
- ✅ `/health` endpoint shows correct signer address
- ✅ You can play a hand with 2 players

---

## NEXT STEPS (After Local Dev Works)

When you want to deploy to Base Sepolia testnet:
1. Get Sepolia ETH from https://faucet.base.org
2. Import your real wallet: `cast wallet import deployer --interactive`
3. Update all `.env` files: `CHAIN_ID=84532`, `VITE_CHAIN_ID=84532`
4. Deploy with `--rpc-url base_sepolia --verify`
5. Use your real ERC-20 token address

---

## IMPORTANT NOTES FOR AI

- Show output after EACH step, don't batch them
- If any step fails, STOP and show me the error
- Don't skip the confirmation steps
- The token and vault addresses from deployment must be copied to ALL env files
- Password for encrypted wallet in local dev is: `dev`
- Keep all 3 terminals running (anvil, server, client)
- All contract addresses start with `0x` and are 42 characters long
