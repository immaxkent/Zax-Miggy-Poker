# WebSocket + Create Game — Production (Vercel + EC2)

## Why you see "websocket error"

The app runs on **Vercel** (HTTPS) but the **game server** runs on **EC2**. Vercel’s proxy can forward HTTP requests to EC2, but it **does not forward WebSockets**. So:

- REST calls (sign-in, `/tables`, etc.) can work via `/api/game` proxy.
- Socket.IO (real-time game state) tries `wss://zax-and-miggy-poker.vercel.app/socket.io/` and fails because Vercel doesn’t run your game server.

To fix it, the frontend must connect the **socket** to a URL that actually reaches your EC2 server **and** supports WebSockets (HTTPS/WSS). The easiest way is an **HTTPS tunnel** (e.g. ngrok).

---

## Fix: Expose EC2 with ngrok (HTTPS + WebSocket)

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

- **MetaMask "ethereum has only a getter"** — Another wallet extension is also setting `window.ethereum`. Safe to ignore if connect/sign still works, or disable other wallet extensions.
- **ERR_NAME_NOT_RESOLVED / Failed to fetch** — Often a temporary network or proxy issue. Using one stable backend URL (e.g. ngrok) for both API and socket can make this more reliable.

---

## Optional: permanent URL

Free ngrok URLs change each time you restart ngrok. For a stable URL you can:

- Use **ngrok paid** (reserved domain), or  
- Use **Cloudflare Tunnel** (free, stable subdomain), or  
- Use your **own domain** + Nginx + Certbot on EC2 (see e.g. MINIMAL_AWS_WALKTHROUGH or SERVER_BASE for HTTPS on EC2).

Once you have a stable HTTPS URL for the game server, set `VITE_SERVER_URL` and optionally `VITE_SOCKET_URL` to that URL and remove the need for ngrok.
