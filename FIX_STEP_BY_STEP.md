# Step-by-step fix: Join game blank + WebSocket error

Follow these in order.

---

## Part 1: Deploy latest code (fixes Join game modal)

1. **On your machine** (where the repo lives):
   ```bash
   cd "/Users/zuludykes/code/Zax & Miggy Poker"
   git pull origin main
   ```
   If you have uncommitted changes, commit and push first so Vercel gets the updates.

2. **Deploy to Vercel**
   - Open [vercel.com](https://vercel.com) → your project **zax-and-miggy-poker**.
   - If the repo is connected, push to `main` and wait for the automatic deploy.
   - Or: **Deployments** → **…** on latest → **Redeploy**.

3. **Confirm**
   - Open https://zax-and-miggy-poker.vercel.app
   - Connect wallet, sign in.
   - Click **Join game**, enter game ID **0**.
   - You should see the modal with instructions, Game ID input, and (after a moment) table cost and “You created this game” or a Join button. If that works, Part 1 is done.

---

## Part 2: Fix WebSocket (so “Server connected” works)

Your game server runs on EC2; the browser needs an **HTTPS** URL that supports WebSockets. Use **ngrok** to expose EC2.

### Step 1: Create ngrok account and get token

1. Go to [ngrok.com](https://ngrok.com) and sign up (free).
2. In the dashboard, copy your **authtoken**.

### Step 2: On EC2 — install and run ngrok

1. **SSH into EC2:**
   ```bash
   ssh -i ~/Downloads/poker-game-server.pem ubuntu@35.179.163.69
   ```

2. **Install ngrok** (one-time):
   ```bash
   curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
   echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
   sudo apt update && sudo apt install ngrok -y
   ```

3. **Add your token** (replace `YOUR_TOKEN` with the real token):
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```

4. **Start the tunnel** (leave this running; use a second terminal for other commands):
   ```bash
   ngrok http 3001
   ```
   In the ngrok output you’ll see a line like:
   ```text
   Forwarding   https://abc123.ngrok-free.app -> http://localhost:3001
   ```
   Copy the **HTTPS** URL only (e.g. `https://abc123.ngrok-free.app`). You’ll use it in the next steps.

### Step 3: Allow that URL on the game server

1. Still on EC2, edit the server env (use nano or vim):
   ```bash
   cd ~/Zax-Miggy-Poker/server
   nano .env
   ```

2. Find **ALLOWED_ORIGINS** and set it to your Vercel URL **and** your ngrok URL (comma-separated, no spaces):
   ```env
   ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app,https://abc123.ngrok-free.app
   ```
   Replace `abc123.ngrok-free.app` with your actual ngrok host from Step 2.

3. Save and exit (in nano: Ctrl+O, Enter, Ctrl+X).

4. Restart the game server:
   ```bash
   pm2 restart poker
   ```

### Step 4: Tell the frontend to use ngrok for the socket

1. Open [vercel.com](https://vercel.com) → your project → **Settings** → **Environment Variables**.

2. Add (or edit):
   - **Name:** `VITE_SOCKET_URL`
   - **Value:** your ngrok HTTPS URL, e.g. `https://abc123.ngrok-free.app`
   - **Environments:** Production (and Preview if you want).

3. Save.

### Step 5: Redeploy the frontend

1. In Vercel: **Deployments** → **…** on the latest deployment → **Redeploy**.
2. Wait for the build to finish.

### Step 6: Test

1. Open https://zax-and-miggy-poker.vercel.app
2. Connect wallet and sign in.
3. In the nav you should see **“Server connected”** (green) instead of “websocket error”.
4. Join game modal should still work as in Part 1.

---

## Part 3: MetaMask “ethereum has only a getter”

- This comes from having **more than one** wallet extension (e.g. MetaMask + Coinbase Wallet).
- **Option A:** Ignore it — the app usually still works.
- **Option B:** In your browser, disable or remove the other wallet extension(s) so only MetaMask (or one wallet) is active.

---

## Checklist

- [ ] Pulled latest code and redeployed (Join game modal works).
- [ ] ngrok account created and authtoken copied.
- [ ] ngrok installed on EC2 and `ngrok http 3001` running.
- [ ] ngrok HTTPS URL copied.
- [ ] `ALLOWED_ORIGINS` in `server/.env` includes Vercel + ngrok URL; `pm2 restart poker` run.
- [ ] `VITE_SOCKET_URL` set in Vercel to ngrok URL.
- [ ] Frontend redeployed on Vercel.
- [ ] “Server connected” appears after sign-in.

---

## If ngrok URL changes

Free ngrok URLs change every time you stop and start `ngrok http 3001`. If you restart ngrok:

1. Copy the new HTTPS URL.
2. Update **ALLOWED_ORIGINS** in `server/.env` with the new host and run `pm2 restart poker`.
3. Update **VITE_SOCKET_URL** in Vercel and redeploy.

For a stable URL, use a paid ngrok domain, Cloudflare Tunnel, or your own domain + Nginx on EC2 (see WEBSOCKET_AND_DEPLOY.md).
