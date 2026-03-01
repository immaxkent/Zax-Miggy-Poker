# Setup instructions — you and your mate playing online (Ethereum Sepolia)

Follow these in order. When done, you’ll have the Vercel site and game server on Ethereum Sepolia so both of you can connect and play.

---

## Step 1: Deploy the game server (so the site can talk to it)

The frontend needs a **public** server URL. Deploy the `server/` app to a host that gives you HTTPS.

**Option A — Railway**

1. Go to [railway.app](https://railway.app), sign in, **New Project** → **Deploy from GitHub** and pick your repo.
2. Set **Root Directory** to **`server`**.
3. In **Variables**, add the same env vars as in `server/.env` (see list below). Set at least:
   - `NODE_ENV=production`
   - `CHAIN_ID=11155111`
   - `SEPOLIA_RPC_URL` = your Sepolia RPC (e.g. from your root `.env`: `https://sepolia.infura.io/v3/60e0b9d5653c432c9d7fa56cd469494a`)
   - `ALLOWED_ORIGINS` = your Vercel URL, e.g. `https://your-app.vercel.app` (comma-separated if you have more)
   - `TOKEN_ADDRESS` and `VAULT_ADDRESS` (you’ll fill these after Step 2)
   - `JWT_SECRET`, `HMAC_SECRET`, `SERVER_API_KEY`, `SIGNER_PRIVATE_KEY` (generate/copy from your existing server `.env`)
4. Deploy. Copy the **public URL** (e.g. `https://your-project.railway.app`). You’ll use it in Step 3 and 4.

**Option B — Render**

1. [render.com](https://render.com) → **New** → **Web Service**, connect your repo.
2. **Root Directory**: `server`. **Build**: `npm install`. **Start**: `npm start`.
3. Add the same env vars as above in **Environment**.
4. Deploy and copy the service URL.

**Server env checklist (for Ethereum Sepolia)**

- `NODE_ENV=production`
- `CHAIN_ID=11155111`
- `SEPOLIA_RPC_URL` = e.g. `https://sepolia.infura.io/v3/YOUR_KEY` (your root `.env` already has this; use the same value on the host)
- `ALLOWED_ORIGINS` = your Vercel URL
- `TOKEN_ADDRESS` = (after Step 2)
- `VAULT_ADDRESS` = (after Step 2)
- `JWT_SECRET`, `HMAC_SECRET`, `SERVER_API_KEY`, `SIGNER_PRIVATE_KEY` (same as in your `server/.env`)

---

## Step 2: Deploy contracts on Ethereum Sepolia

You need a **token** and **vault** on Ethereum Sepolia. The server and frontend will use their addresses.

1. **Prepare `contracts/.env`**
   - `TOKEN_ADDRESS` = address of an ERC-20 on Sepolia (deploy a test token first if you don’t have one).
   - `SIGNER_ADDRESS` = the same address as the wallet whose private key is in the server’s `SIGNER_PRIVATE_KEY`.
   - `FEE_RECIPIENT` = your wallet address for receiving fees.
   - (Optional) `ETHERSCAN_API_KEY` for contract verification.

2. **Deploy from your machine** (with your root `.env` or `SEPOLIA_RPC_URL` in the environment so the script uses your Infura URL):

   ```bash
   cd "Zax & Miggy Poker"
   # If your .env is in repo root and you want the script to use SEPOLIA_RPC_URL:
   export $(grep -v '^#' .env | xargs)
   node scripts/deploy-and-save.js sepolia 1.0.1
   ```

   Or deploy manually:

   ```bash
   cd contracts
   forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast --verify \
     --sender YOUR_DEPLOYER_ADDRESS --account deployer
   ```

3. **Note the printed** `TOKEN_ADDRESS` and `VAULT_ADDRESS`.  
   If you used `deploy-and-save.js`, they’re also in `versions/sepolia/1.0.1/deployment.json`.

4. **Update the hosted server** (Railway/Render): set `TOKEN_ADDRESS` and `VAULT_ADDRESS` to these values and redeploy if needed.

---

## Step 3: Set Vercel environment variables

So the **built** site points at Ethereum Sepolia and your **public** game server (not localhost).

1. Open your project on [vercel.com](https://vercel.com) → **Settings** → **Environment Variables**.

2. Add these for **Production** (and **Preview** if you use preview deployments):

   | Name | Value |
   |------|--------|
   | `VITE_CHAIN_ID` | `11155111` |
   | `VITE_SERVER_URL` | Your game server URL from Step 1 (e.g. `https://your-project.railway.app`) — **no trailing slash** |
   | `VITE_SERVER_API_KEY` | **Same** as `SERVER_API_KEY` on the server |
   | `VITE_TOKEN_ADDRESS` | The Sepolia token address from Step 2 |
   | `VITE_VAULT_ADDRESS` | The Sepolia vault address from Step 2 |
   | `VITE_TOKEN_DECIMALS` | `18` |
   | `VITE_TOKEN_SYMBOL` | `CHIP` |
   | `VITE_SEPOLIA_RPC_URL` | Your Sepolia RPC (e.g. `https://sepolia.infura.io/v3/60e0b9d5653c432c9d7fa56cd469494a`) — optional but recommended so the app uses the same RPC as your `.env` |

3. **Redeploy** the Vercel project (Deployments → ⋮ → Redeploy, or push a commit). The new build will use these values.

---

## Step 4: Check the server allows your frontend

On the host (Railway/Render):

- **ALLOWED_ORIGINS** must include your Vercel URL, e.g. `https://your-app.vercel.app`.  
  If you use preview URLs, add something like `https://your-app-*.vercel.app` or list each preview origin.

Redeploy the server after changing env vars.

---

## Step 5: Test with your mate

1. Open the **Vercel** site (e.g. `https://your-app.vercel.app`).
2. Connect wallet and switch to **Ethereum Sepolia** (chain ID 11155111).
3. Sign in; the app should show “Server connected” (it’s talking to your hosted server, not localhost).
4. Get test Sepolia ETH from a faucet if needed; buy chips and join a table.
5. Your mate does the same on the same URL. You should see each other and be able to play.

---

## Quick checklist

- [ ] Game server deployed (Railway/Render) and **VITE_SERVER_URL** in Vercel points to it.
- [ ] Server has **CHAIN_ID=11155111** and **SEPOLIA_RPC_URL** (or equivalent) set.
- [ ] Token and vault deployed on **Ethereum Sepolia**; same **TOKEN_ADDRESS** and **VAULT_ADDRESS** in server and Vercel.
- [ ] Server **SIGNER** matches the vault’s `serverSigner` and server **SERVER_API_KEY** matches **VITE_SERVER_API_KEY** in Vercel.
- [ ] **ALLOWED_ORIGINS** on the server includes your Vercel URL.
- [ ] Vercel env vars set and project **redeployed** after changing them.

If your mate still sees “Can’t reach the game server. Is it running at http://localhost:3001?”, the frontend was built without **VITE_SERVER_URL**: add it in Vercel (Step 3) and redeploy.
