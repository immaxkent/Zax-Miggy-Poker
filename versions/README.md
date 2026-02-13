# Deployment versions

Deployed contract addresses per network and **version** (e.g. `1.0.1`), written by `scripts/deploy-and-save.js`.

Layout: `versions/<network>/<version>/deployment.json`  
Example: `versions/anvil/1.0.1/deployment.json`

- **anvil** — local dev (MockToken + PokerVault)
- **base-sepolia** — Base Sepolia testnet (PokerVault; set TOKEN_ADDRESS in contracts/.env first)
- **base** — Base mainnet (PokerVault; set TOKEN_ADDRESS in contracts/.env first)

Each `deployment.json` contains `version`, `network`, `tokenAddress`, `vaultAddress`, and `deployedAt`.

**Point app at a version (updates client/.env and server/.env):**
```bash
node scripts/use-version.js anvil 1.0.1
node scripts/use-version.js anvil   # use latest version for that network
```
Then restart the server and client to test on localhost.
