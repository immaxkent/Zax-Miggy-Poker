# Cast Wallet Quick Reference

All commands use your encrypted keystore — no plaintext private keys anywhere.

## Setup (one-time)

```bash
# Create encrypted wallet from private key
cast wallet import <NAME> --interactive
# Prompts for private key, then password — key is encrypted and stored in OS keychain
```

## Using encrypted wallet

Every `cast send` or `forge script` command uses:
```bash
--account <NAME>
```
You'll be prompted for the password you set during import.

## Examples

### Deploy contract
```bash
forge script script/Deploy.s.sol \
  --rpc-url anvil \
  --account deployer \
  --broadcast \
  --sender <YOUR_ADDRESS>
```

### Send transaction
```bash
cast send <CONTRACT> \
  "functionName(arg1Type,arg2Type)" \
  arg1Value arg2Value \
  --rpc-url anvil \
  --account deployer
```

### Read-only calls (no account needed)
```bash
cast call <CONTRACT> \
  "viewFunction()(returnType)" \
  --rpc-url anvil
```

## Wallet management

```bash
# List imported wallets
cast wallet list

# Get address from wallet name
cast wallet address --account deployer

# Remove wallet
cast wallet remove deployer
```

## For this project

**Local dev wallet (anvil default account #0):**
- Name: `deployer`
- Private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Password (our choice): `dev`

**Production wallet:**
- Generate: `cast wallet new`
- Import: `cast wallet import deployer --interactive`
- Use strong password
- NEVER commit the private key anywhere
