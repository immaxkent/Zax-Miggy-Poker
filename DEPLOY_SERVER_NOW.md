# Deploy the game server (for https://zax-and-miggy-poker.vercel.app)

You have to do this once in your browser; the repo now has a **render.yaml** so Render can deploy the server with the right settings.

---

## Option A — Render (recommended)

1. **Go to [render.com](https://render.com)** and sign in (or create an account).

2. **New → Blueprint**: connect your GitHub repo that contains this project.  
   Render will read **render.yaml** and create a web service with:
   - Root directory: **server**
   - Build: `npm install`
   - Start: `npm start`
   - `NODE_ENV=production`, `CHAIN_ID=11155111`, `ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app`

3. **Before the first deploy**, add the **secret** env vars in the Render dashboard:
   - **Environment** (or **Environment Variables**) for that service:
     - `JWT_SECRET` — copy from your `server/.env`
     - `HMAC_SECRET` — copy from `server/.env`
     - `SERVER_API_KEY` — copy from `server/.env` (you’ll use the same in Vercel)
     - `SIGNER_PRIVATE_KEY` — copy from `server/.env`
     - `SEPOLIA_RPC_URL` — e.g. `https://sepolia.infura.io/v3/60e0b9d5653c432c9d7fa56cd469494a` (or from your root `.env`)
     - `TOKEN_ADDRESS` — your Sepolia token address (or leave blank until contracts are deployed, then add and redeploy)
     - `VAULT_ADDRESS` — your Sepolia vault address (same as above)

4. **Deploy**. When it’s live, copy the service URL (e.g. `https://cryptopoker-server.onrender.com`).

5. **In Vercel** (project **zax-and-miggy-poker**):
   - **Settings → Environment Variables**
   - Add **`VITE_SERVER_URL`** = that Render URL (no trailing slash)
   - **Redeploy** the frontend

Then your mate (and you) should get “Server connected” instead of “Can’t reach the game server”.

---

## Option B — Railway

1. Go to [railway.app](https://railway.app) and sign in.
2. **New Project → Deploy from GitHub** and select this repo.
3. After the repo is connected, open the new service → **Settings**:
   - Set **Root Directory** to **server**.
   - **Build Command**: leave default or `npm install`.
   - **Start Command**: `npm start`.
4. **Variables**: add the same env vars as in Option A (step 3).
5. Deploy and copy the **public URL** (enable “Generate domain” if needed).
6. Set **VITE_SERVER_URL** in Vercel to that URL and redeploy.

---

## After the server is live

- Test: open `https://YOUR-SERVER-URL/health` in a browser; you should see JSON like `{"status":"ok", ...}`.
- Then in Vercel set **VITE_SERVER_URL** and redeploy so the site uses that URL instead of localhost.
