# Point https://zax-and-miggy-poker.vercel.app at Ethereum Sepolia

Do these two things: **1) Deploy contracts to Sepolia.** **2) Set env vars in Vercel and redeploy.**

---

## 1. Deploy to Ethereum Sepolia (you run this once)

From your machine, in the project:

**1.1** Set `contracts/.env`:

- `SIGNER_ADDRESS` = the **address** of the wallet whose **private key** is in `server/.env` as `SIGNER_PRIVATE_KEY` (the server signer).
- `FEE_RECIPIENT` = your wallet address (where fees go).
- `DEPLOYER_ADDRESS` = wallet you’ll deploy with (needs Sepolia ETH for gas).

**1.2** Deploy (uses your root `.env` for `SEPOLIA_RPC_URL` if set):

```bash
cd "Zax & Miggy Poker"
export $(grep -v '^#' .env | xargs)   # load SEPOLIA_RPC_URL etc.
node scripts/deploy-and-save.js sepolia 1.0.1
```

You’ll need the deployer wallet (e.g. `cast wallet import deployer --interactive` and Sepolia ETH). The script deploys **MockToken + PokerVault** and writes addresses to `versions/sepolia/1.0.1/deployment.json`.

**Or** run Foundry directly:

```bash
cd contracts
forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url $SEPOLIA_RPC_URL --broadcast \
  --sender $DEPLOYER_ADDRESS --account deployer
```

**1.3** Note the printed **TOKEN_ADDRESS** and **VAULT_ADDRESS** (or read them from `versions/sepolia/1.0.1/deployment.json`).

---

## 2. Make the frontend point at those contracts (Vercel)

In **[Vercel](https://vercel.com)** → your project **zax-and-miggy-poker** → **Settings** → **Environment Variables**, add (or update) for **Production**:

| Name | Value |
|------|--------|
| `VITE_CHAIN_ID` | `11155111` |
| `VITE_TOKEN_ADDRESS` | *(the TOKEN_ADDRESS from step 1)* |
| `VITE_VAULT_ADDRESS` | *(the VAULT_ADDRESS from step 1)* |
| `VITE_TOKEN_DECIMALS` | `18` |
| `VITE_TOKEN_SYMBOL` | `CHIP` |
| `VITE_SERVER_URL` | *(your game server URL, e.g. from Render/Railway — if you don’t have one yet, the app will still show Sepolia and contracts but “Can’t reach game server” until the server is deployed)* |
| `VITE_SERVER_API_KEY` | *(same as SERVER_API_KEY on your game server)* |
| `VITE_SEPOLIA_RPC_URL` | *(optional) e.g. `https://sepolia.infura.io/v3/60e0b9d5653c432c9d7fa56cd469494a` from your `.env`)* |

Then **Redeploy** the project (Deployments → ⋮ → Redeploy).

After that, https://zax-and-miggy-poker.vercel.app uses **Ethereum Sepolia** and your **deployed token + vault**. Users connect with Sepolia in their wallet and the app talks to those contracts.
