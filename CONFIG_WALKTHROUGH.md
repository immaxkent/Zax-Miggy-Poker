# Config walkthrough: ngrok + EC2 + Vercel

Follow these in order. Your reserved domain: **https://zax-and-miggy-poker.ngrok.app**

---

## Part 1 — EC2: allow the ngrok origin

The game server on EC2 only accepts requests from origins listed in `ALLOWED_ORIGINS`. You need both your Vercel app and the ngrok URL in that list.

### 1.1 SSH into EC2

From your Mac terminal (use your real key path and host if different):

```bash
ssh -i ~/Downloads/poker-game-server.pem ubuntu@35.179.163.69
```

### 1.2 Go to the app folder and open `server/.env`

On EC2 the repo is usually under `/home/ubuntu/` — might be `Zax-Miggy-Poker` or similar. Adjust if your path is different.

```bash
cd /home/ubuntu/Zax-Miggy-Poker
nano server/.env
```

(Or use `vim server/.env` if you prefer.)

### 1.3 Set ALLOWED_ORIGINS

Find the line that says `ALLOWED_ORIGINS=...`. Change it to (one line, comma between, **no spaces**):

```env
ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app,https://zax-and-miggy-poker.ngrok.app
```

- Keep any other variables in `.env` as they are.
- No spaces around the `=`.
- No trailing slash on the URLs.

Save and exit (`nano`: Ctrl+O, Enter, then Ctrl+X).

### 1.4 Restart the game server

Still on EC2:

```bash
pm2 restart poker
```

Check it’s running:

```bash
pm2 status
```

You should see `poker` with status **online**. Then you can type `exit` to leave SSH (ngrok in `screen` keeps running if you started it there).

---

## Part 2 — Vercel: point frontend at ngrok for the socket

The frontend needs to know the WebSocket URL. That’s set by `VITE_SOCKET_URL` in Vercel.

### 2.1 Open Vercel project settings

1. Go to [vercel.com](https://vercel.com) and log in.
2. Open your **Zax & Miggy Poker** project (or whatever the project name is).
3. Click **Settings** (top tab).
4. In the left sidebar, click **Environment Variables**.

### 2.2 Add or edit VITE_SOCKET_URL

- If **VITE_SOCKET_URL** is already there: click the three dots → **Edit**. Set **Value** to:
  ```text
  https://zax-and-miggy-poker.ngrok.app
  ```
- If it’s not there: click **Add New**:
  - **Name:** `VITE_SOCKET_URL`
  - **Value:** `https://zax-and-miggy-poker.ngrok.app`
  - **Environment:** check Production (and Preview if you want).

No spaces, no trailing slash. Save.

### 2.3 Redeploy so the new value is used

Env vars are baked in at **build** time, so you must redeploy:

1. In the project, go to the **Deployments** tab.
2. Find the latest deployment (top of the list).
3. Click the three dots **⋮** on that row → **Redeploy**.
4. Confirm **Redeploy** (no need to change any options).

Wait for the new deployment to finish (status “Ready”). After that, the live site will use the ngrok URL for the socket.

---

## Part 3 — Quick recap

| Where        | What you did |
|-------------|--------------|
| **EC2**     | Set `ALLOWED_ORIGINS=...,https://zax-and-miggy-poker.ngrok.app` in `server/.env` and ran `pm2 restart poker`. |
| **Vercel**  | Set `VITE_SOCKET_URL=https://zax-and-miggy-poker.ngrok.app` and **redeployed** the frontend. |
| **ngrok**   | Running on EC2 inside `screen -S ngrok` (or as a systemd service), so it stays up when you close SSH. |

- **Check/stop ngrok later:** SSH in, then `screen -r ngrok` → Ctrl+C to stop ngrok → type `exit` to leave the screen.
- Full details (including systemd option) are in **WEBSOCKET_AND_DEPLOY.md**.
