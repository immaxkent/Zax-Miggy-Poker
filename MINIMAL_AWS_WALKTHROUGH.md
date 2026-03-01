# Minimal AWS path — long walkthrough

This gets the game server running on a **single EC2 instance** so your Vercel frontend can talk to it. No load balancer, Redis, or database yet — just Node + PM2 and a public URL.

**See also:** [DEPLOYMENT.md](./DEPLOYMENT.md) for the full AWS architecture (ALB, Redis, RDS) and contract deployment.

**Why does the server need a private key?** Only to **sign withdrawal vouchers** — the contract pays out to the player's EOA when they call `withdraw(amount, nonce, signature)`. See [docs/SIGNER_AND_WITHDRAWALS.md](./docs/SIGNER_AND_WITHDRAWALS.md).

---

## Step 0: Prerequisites

- An **AWS account** and access to the AWS Console (or CLI).
- Your **repo** in a Git host (GitHub, etc.) so you can clone it on the instance.
- Your **Sepolia contract addresses** and **server signer** already set (you deployed contracts and have `TOKEN_ADDRESS`, `VAULT_ADDRESS`, and the private key for the vault's `serverSigner`).
- Your **Vercel app URL** (e.g. `https://zax-and-miggy-poker.vercel.app`) — you'll put this in the server's `ALLOWED_ORIGINS`.

---

## Step 1: Launch an EC2 instance

1. In **AWS Console** go to **EC2** → **Instances** → **Launch instance**.
2. **Name:** e.g. `poker-game-server`.
3. **AMI:** Pick **Ubuntu Server 24.04 LTS**.
4. **Instance type:** **t3.micro** (free tier eligible) or t3.small if you want a bit more headroom.
5. **Key pair:** Create a new key pair or use an existing one. Download the `.pem` file and keep it safe — you need it to SSH in (e.g. `chmod 400 your-key.pem`).
6. **Network settings:**
   - Create or use a security group.
   - **Inbound rules** — add:
     - **SSH (22)** from your IP (or 0.0.0.0/0 only if you're okay with the world being able to try SSH; prefer "My IP").
     - **Custom TCP (3001)** from **0.0.0.0/0** so the browser (and Vercel) can reach your game server.
     - Optionally **HTTP (80)** from 0.0.0.0/0 if you'll add Nginx/HTTPS later.
7. **Storage:** 8–20 GB is fine.
8. Click **Launch instance**.

Wait until the instance state is **Running**. Note its **Public IPv4** (this will change on stop/start unless you attach an Elastic IP).

---

## Step 2: Attach an Elastic IP (so the URL doesn't change)

1. **EC2** → **Network & Security** → **Elastic IPs**.
2. **Allocate Elastic IP address** → Allocate.
3. Select the new IP → **Actions** → **Associate Elastic IP address**.
4. Choose your instance, then Associate.
5. **Write down this IP** — e.g. `54.123.45.67`. Your server URL will be `http://54.123.45.67:3001`.

---

## Step 3: SSH into the instance

From your Mac (terminal):

```bash
chmod 400 /path/to/your-key.pem
ssh -i /path/to/your-key.pem ubuntu@<ELASTIC_IP>
```

Example: `ssh -i ~/Downloads/poker-key.pem ubuntu@54.123.45.67`. You should be in a shell as `ubuntu` on the EC2.

---

## Step 4: Install Node.js 20

On the EC2 (Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should show v20.x
npm -v
```

---

## Step 5: Clone the repo and install server deps

Still on the EC2:

```bash
# If your repo is public:
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO/server

# If private, use SSH or a personal access token in the URL; or copy files via scp/rsync from your machine.
```

Then:

```bash
npm install --production
```

(Use `npm install` if you don't care about devDependencies.)

---

## Step 6: Create the server `.env` file on EC2

The server reads env vars from `server/.env` (and optionally repo root). Create the file on the EC2:

```bash
cd /home/ubuntu/YOUR_REPO/server
nano .env
```

Paste the following, then **replace every placeholder** with your real values:

```env
PORT=3001
NODE_ENV=production

# Security — generate new values for production (see "Generate secrets" below)
JWT_SECRET=your_64_char_hex_jwt_secret
HMAC_SECRET=your_64_char_hex_hmac_secret
SERVER_API_KEY=your_32_char_hex_api_key

# Signer: private key for the address you used as SIGNER_ADDRESS when deploying PokerVault
SIGNER_PRIVATE_KEY=0x...

# CORS: your Vercel frontend URL (no trailing slash); add multiple comma-separated if needed
ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app

# Sepolia
CHAIN_ID=11155111
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY

# Your deployed Sepolia contracts (replace with yours if different)
TOKEN_ADDRESS=0xe79fF63fF171D3b20595D1C4c240eb5ceCd19BA7
VAULT_ADDRESS=0x8c50f4628E35416742282F9985d004E32d07b42e
TOKEN_DECIMALS=18

# Fees (match PokerVault.sol)
BUY_IN_FEE_BPS=800
WINNER_FEE_BPS=500

MIN_PLAYERS=2
MAX_SEATS=9
ACTION_TIMEOUT=30
RECONNECT_GRACE=60
```

Save (Ctrl+O, Enter) and exit (Ctrl+X). **Do not commit this file** — it stays only on the server.

### Generate secrets (run on your Mac or any machine with Node)

```bash
# JWT and HMAC (64 hex chars each)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# API key (32 hex chars) — use the same value in Vercel as VITE_SERVER_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a **dedicated signer wallet** for the server (not your main wallet). The **SIGNER_PRIVATE_KEY** on the server must be the key for the address you passed as `SIGNER_ADDRESS` in `contracts/.env` when you ran `DeploySepolia.s.sol`.

### Alternative: Use AWS Secrets Manager (no private key in .env)

If you already store a **mainnet RPC URL** and **private key** in AWS Secrets, add **SEPOLIA_RPC_URL** to the same secret (or a separate one). The server can load all of these at startup so the signer key never lives in a file on the box.

1. **AWS Console** → **Secrets Manager** → Create secret → **Other type of secret**.
2. Key/value pairs (add what you need; the server will inject these as env vars):
   - `SIGNER_PRIVATE_KEY` — same signer key you use for the vault (one key for both Sepolia and mainnet if you use the same vault signer).
   - `SEPOLIA_RPC_URL` — e.g. `https://sepolia.infura.io/v3/YOUR_KEY`.
   - `MAINNET_RPC_URL` or `BASE_RPC_URL` — if you ever switch CHAIN_ID.
   - Optionally also: `JWT_SECRET`, `HMAC_SECRET`, `SERVER_API_KEY` (then you don't need them in .env at all).
3. Name the secret e.g. `cryptopoker/server`. Note the **region** (e.g. `us-east-1`).
4. On the EC2, keep a **minimal .env** with only non-secret vars (or set them in the shell):
   - `PORT=3001`, `NODE_ENV=production`, `ALLOWED_ORIGINS=https://zax-and-miggy-poker.vercel.app`
   - `CHAIN_ID=11155111`, `TOKEN_ADDRESS=0x...`, `VAULT_ADDRESS=0x...`, `TOKEN_DECIMALS=18`
   - `AWS_SECRET_NAME=cryptopoker/server`, `AWS_REGION=us-east-1`
5. Give the EC2 instance an **IAM role** that has `secretsmanager:GetSecretValue` for that secret (or attach a policy with that permission).
6. Start the server with the AWS entrypoint so it fetches the secret before loading config:
   - `pm2 start src/start.js --name poker`  
   - or `npm run start:aws`

The server will fetch the secret (JSON), merge keys into `process.env`, then start. See `server/src/load-aws-secrets.js` and `server/src/start.js`.

---

## Step 7: Run the server with PM2

On the EC2:

**If using .env only (Step 6):**
```bash
sudo npm install -g pm2
cd /home/ubuntu/YOUR_REPO/server
pm2 start src/server.js --name poker
pm2 status
```

**If using AWS Secrets (alternative above):**
```bash
sudo npm install -g pm2
cd /home/ubuntu/YOUR_REPO/server
# Ensure AWS_SECRET_NAME and AWS_REGION are set (in .env or export)
pm2 start src/start.js --name poker
pm2 status
```

You should see `poker` with status **online**. Logs:

```bash
pm2 logs poker
```

To keep the process running after reboot:

```bash
pm2 startup
# run the command it prints (e.g. sudo env PATH=... pm2 startup systemd -u ubuntu --hp /home/ubuntu)
pm2 save
```

---

## Step 8: Test the server from your machine

From your Mac:

```bash
curl http://<ELASTIC_IP>:3001/health
```

You should get a JSON response. If you get "Connection refused", check the security group (port 3001 open from 0.0.0.0/0) and that PM2 shows the app running.

---

## Step 9: Point Vercel at the server

1. **Vercel** → your project → **Settings** → **Environment Variables**.
2. Add or edit:
   - **VITE_SERVER_URL** = `http://<ELASTIC_IP>:3001` (no trailing slash). Example: `http://54.123.45.67:3001`.
   - Ensure **VITE_SERVER_API_KEY** equals the same value you set as **SERVER_API_KEY** on the EC2.
   - Other existing vars (VITE_CHAIN_ID=11155111, VITE_TOKEN_ADDRESS, VITE_VAULT_ADDRESS, etc.) stay as they are.
3. **Redeploy** the Vercel project (Deployments → … → Redeploy) so the new build gets the updated `VITE_SERVER_URL`.

---

## Step 10: Test the live site

1. Open your Vercel URL (e.g. `https://zax-and-miggy-poker.vercel.app`).
2. Connect wallet, switch to Sepolia, sign in.
3. If you see "Can't reach the game server", check:
   - EC2 security group allows **inbound 3001** from 0.0.0.0/0.
   - `ALLOWED_ORIGINS` on the server includes your Vercel URL exactly (with `https://`, no trailing slash).
   - PM2: `pm2 status` and `pm2 logs poker`.
   - From your browser's dev tools (Network tab), see whether the request to `http://<ELASTIC_IP>:3001` is blocked (mixed content, CORS, or connection error).

**Mixed content:** If your Vercel site is **HTTPS** and you set **VITE_SERVER_URL** to **HTTP**, some browsers may block the request. For a quick test you can try in a browser that still allows it, but for production you'll want HTTPS on the server (e.g. Nginx + Let's Encrypt or an ALB with an ACM certificate). Then set `VITE_SERVER_URL=https://your-server-domain.com`.

---

## Optional: HTTPS on the EC2 (Nginx + Let's Encrypt)

If you have a **domain** pointing to your Elastic IP (e.g. `poker.yourdomain.com` → Elastic IP):

1. On the EC2: `sudo apt install -y nginx certbot python3-certbot-nginx`
2. Open port **80** in the security group.
3. Configure Nginx as a reverse proxy to `http://127.0.0.1:3001` and run `sudo certbot --nginx -d poker.yourdomain.com`.
4. Set **VITE_SERVER_URL** to `https://poker.yourdomain.com` and redeploy Vercel.

(WebSocket support over Nginx usually requires `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, `proxy_set_header Connection "upgrade"` for the Socket.IO path.)

---

## Summary checklist

- [ ] EC2 launched (Ubuntu 24.04), port 3001 open, Elastic IP attached.
- [ ] Node 20 and PM2 installed, repo cloned, `npm install` in `server/`.
- [ ] `server/.env` created with production secrets, `ALLOWED_ORIGINS`, Sepolia vars, and contract addresses.
- [ ] `pm2 start src/server.js --name poker`, `pm2 save`, `pm2 startup` run.
- [ ] `curl http://<ELASTIC_IP>:3001/health` returns JSON.
- [ ] Vercel env: `VITE_SERVER_URL=http://<ELASTIC_IP>:3001`, `VITE_SERVER_API_KEY` matches server, then redeploy.
- [ ] Live site: connect wallet (Sepolia), sign in, and confirm you don't get "Can't reach the game server".
