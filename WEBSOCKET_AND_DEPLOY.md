# WebSocket + Create Game — Production (Vercel + EC2)

## Why you see "websocket error"

The app runs on **Vercel** (HTTPS) but the **game server** runs on **EC2**. Vercel’s proxy can forward HTTP requests to EC2, but it **does not forward WebSockets**. So:

- REST calls (sign-in, `/tables`, etc.) can work via `/api/game` proxy.
- Socket.IO (real-time game state) tries `wss://zax-and-miggy-poker.vercel.app/socket.io/` and fails because Vercel doesn’t run your game server.

To fix it, the frontend must connect the **socket** to a URL that actually reaches your EC2 server **and** supports WebSockets (HTTPS/WSS). The easiest way is an **HTTPS tunnel** (e.g. ngrok).

---

## ngrok Pro: reconfigure with a reserved domain (recommended)

With **ngrok Pro** you get a **reserved domain** that never changes. Configure it once and you won’t need to update URLs after restarts.

### 1. Reserve a domain in ngrok

1. Go to [dashboard.ngrok.com](https://dashboard.ngrok.com) → **Domains** (or **Cloud Edge** → Domains).
2. Click **New Domain** and choose a name (e.g. `poker-game` → you’ll get `poker-game.ngrok-free.app` or `poker-game.ngrok.io` depending on plan).
3. Copy the full **HTTPS** URL, e.g. `https://poker-game.ngrok-free.app`. This is your **fixed** URL — use it everywhere below as `https://YOUR-RESERVED-DOMAIN`.

### 2. On EC2 — use the reserved domain when starting ngrok

**Important:** ngrok must run **on EC2** (where your game server is), not on your Mac. If you run it on your Mac, it forwards **your laptop’s** localhost; when you close the laptop, the tunnel dies and the app can’t reach the server. On EC2 it can run 24/7.

SSH into EC2 and run ngrok with your reserved domain:

```bash
# One-time: ensure ngrok is logged in with your Pro account (authtoken in place)
# ngrok config add-authtoken YOUR_PRO_TOKEN   # if not already done

# Start tunnel with reserved domain (keeps running until you stop it)
ngrok http 3001 --domain=YOUR-RESERVED-DOMAIN
```

Replace `YOUR-RESERVED-DOMAIN` with the **host only** (e.g. `zax-and-miggy-poker.ngrok.app`), not the full URL.

#### Run ngrok 24/7 on EC2 (autonomous)

So you don’t have to keep an SSH window open:

**Option A — screen (simple)**  
Start ngrok inside a `screen` session; it keeps running after you disconnect.

```bash
# On EC2, after SSH in:
screen -S ngrok
ngrok http 3001 --domain=zax-and-miggy-poker.ngrok.app
# Press Ctrl+A then D to detach (ngrok keeps running).
# Close SSH; ngrok stays up.

# Later, to check or stop ngrok:
ssh -i ~/Downloads/poker-game-server.pem ubuntu@35.179.163.69
screen -r ngrok   # reattach; Ctrl+C to stop ngrok, then exit
```

**Option B — systemd (survives reboot)**  
Run ngrok as a service so it starts on boot and restarts if it crashes.

On EC2 create a service file:

```bash
sudo nano /etc/systemd/system/ngrok.service
```

Paste (use your real domain and ensure ngrok is in PATH or use full path like `/usr/local/bin/ngrok`):

```ini
[Unit]
Description=ngrok tunnel for poker server
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/ngrok http 3001 --domain=zax-and-miggy-poker.ngrok.app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ngrok
sudo systemctl start ngrok
sudo systemctl status ngrok
```

After that, ngrok runs autonomously on EC2; you don’t need a local terminal open.

### 3. Server: allow the ngrok origin

On EC2, edit `server/.env` (in your app directory, e.g. `/home/ubuntu/Zax-Miggy-Poker/server/.env`):

```env
ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app,https://YOUR-RESERVED-DOMAIN
```

Use your actual reserved domain (e.g. `https://poker-game.ngrok-free.app`). No trailing slash. Then:

```bash
cd /home/ubuntu/Zax-Miggy-Poker   # or your repo path
pm2 restart poker
```

### 4. Frontend: point at the reserved URL (Vercel)

In **Vercel** → your project → **Settings** → **Environment Variables**:

| Name | Value |
|------|--------|
| `VITE_SOCKET_URL` | `https://YOUR-RESERVED-DOMAIN` |
| `VITE_SERVER_URL` | (optional) Same URL if you want all traffic via ngrok, or keep `https://zax-and-miggy-poker.vercel.app/api/game` for API proxy |

Example: `VITE_SOCKET_URL` = `https://poker-game.ngrok-free.app`  
Use **https**, not wss. Save.

### 5. Redeploy the frontend

Trigger a new deploy so the build uses the new env (e.g. **Deployments** → **Redeploy** or push a commit). After that, the app will always use your reserved ngrok URL for the socket; you won’t need to change it again when you restart ngrok.

---

## Fix: Expose EC2 with ngrok (free / one-off URL)

### 1. On your EC2 server (SSH in)

```bash
# Install ngrok (one-time)
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Sign up at https://ngrok.com and add your authtoken
ngrok config add-authtoken YOUR_TOKEN

# Expose port 3001 (run in a separate terminal or use screen/tmux so it keeps running)
ngrok http 3001
```

Copy the **HTTPS** URL ngrok prints (e.g. `https://abc123.ngrok-free.app`).

### 2. Allow that origin on the game server

On EC2, in `server/.env`:

```env
ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app,https://abc123.ngrok-free.app
```

Replace `abc123.ngrok-free.app` with your actual ngrok host. Then:

```bash
pm2 restart poker
```

### 3. Point the frontend socket at ngrok (Vercel env)

In **Vercel** → Project → **Settings** → **Environment Variables** add:

| Name | Value |
|------|--------|
| `VITE_SOCKET_URL` | `https://YOUR_NGROK_HOST.ngrok-free.app` |

Keep `VITE_SERVER_URL` as either:

- `https://zax-and-miggy-poker.vercel.app/api/game` (API via Vercel proxy), **or**
- The same ngrok URL (simplest: one URL for both API and socket).

If you set **only** `VITE_SOCKET_URL` and leave `VITE_SERVER_URL` as the Vercel proxy URL, the app will use the proxy for REST and ngrok for the socket. If you set **both** to the ngrok URL, everything (REST + socket) goes through ngrok.

### 4. Redeploy

Redeploy the frontend on Vercel so the new env is used. After that, the socket should connect and the "websocket error" should go away.

---

## Create game / "This transaction is likely to fail"

- **First tx (1 of 2)** is usually **approve** — USDC allowance to the vault. That’s what “took” your 5 USDC in terms of allowance.
- **Second tx (2 of 2)** is **createGame(5000000)** — 5 USDC (6 decimals). MetaMask’s “likely to fail” is an **estimate**; it can be wrong.

**Check whether it actually succeeded:**

1. Go to [basescan.org](https://basescan.org) and open your wallet address.
2. Look for a successful transaction to `0x382C20bDbCcaa7E299C4aD014CfF2FeB226a3ef0` with `createGame` in the log.

If that tx is successful, the game was created. You can then share the **game ID** (from the contract or the UI after we load it) so others can join. The WebSocket error is separate — fixing it with ngrok (or another tunnel) lets the app show “Server connected” and sync game state.

---

## Other console messages

- **MetaMask "Cannot set property ethereum of #<Window> which has only a getter"**  
  Another wallet extension (e.g. Coinbase Wallet, Rabby) has made `window.ethereum` read-only, so MetaMask can’t overwrite it. **Safe to ignore** if connect/sign still work. To avoid it: use a browser profile with only MetaMask, or disable other Ethereum extensions.

- **WebSocket connection to 'wss://…ngrok-free.dev/…' failed / Socket error: websocket error**  
  The frontend is trying to reach the **ngrok URL that was baked in at build time**. That usually means:
  1. **Ngrok isn’t running** — On EC2 (or your machine), start it: `ngrok http 3001`. The URL changes each time with free ngrok.
  2. **URL changed** — If you restarted ngrok, you got a **new** URL. The deployed app (Vercel) still has the **old** URL. Update **Vercel** → Settings → Environment Variables → `VITE_SOCKET_URL` to the **current** ngrok HTTPS URL (e.g. `https://xxxx.ngrok-free.app`), then **redeploy** the frontend so the new value is used.
  3. **Ngrok interstitial** — Free ngrok sometimes shows a browser warning page; that can break WebSocket. Visit the ngrok URL once in the browser and click through, or use a reserved ngrok domain.

- **ERR_NAME_NOT_RESOLVED / Failed to fetch** — Often a temporary network or proxy issue. Using one stable backend URL (e.g. ngrok) for both API and socket can make this more reliable.

---

## Optional: permanent URL

Free ngrok URLs change each time you restart ngrok. For a stable URL you can:

- Use **ngrok paid** (reserved domain), or  
- Use **Cloudflare Tunnel** (free, stable subdomain), or  
- Use your **own domain** + Nginx + Certbot on EC2 (see e.g. MINIMAL_AWS_WALKTHROUGH or SERVER_BASE for HTTPS on EC2).

Once you have a stable HTTPS URL for the game server, set `VITE_SERVER_URL` and optionally `VITE_SOCKET_URL` to that URL and remove the need for ngrok.
