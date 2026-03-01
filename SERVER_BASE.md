# Server configuration for Base mainnet

Use this after you've deployed **ZaxAndMiggyVault** on Base and run **extract-and-save** so `versions/base/1.0.1/deployment.json` exists.

---

## 1. Point local client and server to Base (one command)

From the repo root:

```bash
node scripts/use-version.js base 1.0.1
```

This updates **client/.env** and **server/.env** with Base chain (8453), USDC address, and ZaxMiggy vault address from `versions/base/1.0.1/deployment.json`. Restart your local server and client.

---

## 2. Check if you have a game server on AWS

You set this up with **MINIMAL_AWS_WALKTHROUGH.md**. To verify:

1. **AWS Console** → **EC2** → **Instances**. Look for an instance (e.g. `poker-game-server`). Note **State** and **Public IPv4** (or the Elastic IP).
2. **Elastic IP:** EC2 → Network & Security → Elastic IPs — see which instance is associated.
3. From your machine: `curl http://<ELASTIC_IP>:3001/health` — if you get JSON, the server is up. Connection refused/timeout = instance stopped, port 3001 closed, or app not running.

---

## 3. Configure the AWS server for Base

SSH in:

```bash
ssh -i /path/to/your-key.pem ubuntu@<ELASTIC_IP>
```

Edit server env:

```bash
cd /home/ubuntu/YOUR_REPO/server
nano .env
```

Set/update for **Base mainnet** (use your ZaxMiggy vault address if different):

```env
CHAIN_ID=8453
BASE_RPC_URL=https://mainnet.base.org

TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
VAULT_ADDRESS=0x382C20bDbCcaa7E299C4aD014CfF2FeB226a3ef0
TOKEN_DECIMALS=6

USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
ZAX_MIGGY_VAULT_ADDRESS=0x382C20bDbCcaa7E299C4aD014CfF2FeB226a3ef0
```

**SIGNER_PRIVATE_KEY** must be the key for the **SIGNER_ADDRESS** you used when deploying ZaxAndMiggyVault. **ALLOWED_ORIGINS** must include your Vercel URL (e.g. `https://your-app.vercel.app`). Save and exit.

Restart:

```bash
pm2 restart poker
pm2 logs poker
```

You should see: `Config OK — chain 8453 (production)`.

---

## 4. Point Vercel at the server

Vercel → Settings → Environment Variables:

- **VITE_SERVER_URL** = `http://<ELASTIC_IP>:3001` (or your HTTPS URL)
- **VITE_CHAIN_ID** = `8453`
- **VITE_USDC_ADDRESS** = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **VITE_ZAX_MIGGY_VAULT_ADDRESS** = your ZaxMiggy vault address
- **VITE_SERVER_API_KEY** = same as server's **SERVER_API_KEY**

Redeploy the project.

---

## 5. Checklist

- [ ] `versions/base/1.0.1/deployment.json` exists
- [ ] Local: `node scripts/use-version.js base 1.0.1`, restart server + client
- [ ] AWS: instance running, port 3001 open, Elastic IP known
- [ ] AWS server/.env: CHAIN_ID=8453, BASE_RPC_URL, TOKEN/VAULT addresses, SIGNER_PRIVATE_KEY, ALLOWED_ORIGINS
- [ ] `pm2 restart poker`; logs show chain 8453
- [ ] Vercel env set and project redeployed
