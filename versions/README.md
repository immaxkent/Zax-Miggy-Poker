# Deployment versions

Contract addresses per network and **version** (e.g. `1.0.1`).

## Legacy USDC vault

Written by `scripts/deploy-and-save.js` / `extract-and-save.js`:

- `versions/<network>/<version>/deployment.json` — `vaultAddress`, `usdcAddress`

## Agentic Arena (v1.0.1)

Written by `scripts/deploy-agentic-arena.js`:

- `versions/<network>/<version>/agentic-deployment.json` — `arenaAddress`, `botFactoryAddress`, `agenticRankingsV2Address`, `agenticChips1155Address`

| Network | Chain ID | USDC |
|---------|----------|------|
| `base-sepolia` | 84532 | `0x036CbD53842c6846630281C1C3aD1868e8e7a34f` |
| `base` | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

**Deploy + wire locally:**
```bash
export DEPLOYER_PRIVATE_KEY=0x...   # deployer with ETH (or re-import cast wallet on this Mac)
npm run deploy:arena:base-sepolia
npm run deploy:arena:base
npm run wire:arena:base-sepolia
node scripts/wire-ec2-arena-env.js base-sepolia
```

**Point legacy vault at a version:**
```bash
node scripts/use-version.js anvil 1.0.1
```
