# CryptoPoker

On-chain poker on Base. Players deposit ERC-20 tokens, play at the table, and withdraw with server-signed vouchers.

## Stack

- **Frontend:** React, Vite, wagmi, RainbowKit, Socket.IO client
- **Backend:** Node.js, Express, Socket.IO
- **Contracts:** Solidity (Foundry), PokerVault + MockToken for local dev
- **Chain:** Anvil (local), Base Sepolia, Base mainnet

## Quick start (local)

1. **Install deps**
   - `cd server && npm install`
   - `cd client && npm install`
   - `cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` (requires git), or ensure `lib/forge-std` and `lib/openzeppelin-contracts` exist.

2. **Start Anvil** (e.g. `anvil` or `anvil --port 8546` if 8545 is in use).

3. **Deploy contracts**  
   From repo root: `node scripts/deploy-and-save.js anvil`  
   Then: `node scripts/use-version.js anvil 1.0.1`  
   (Or follow [DEPLOYMENT.md](./DEPLOYMENT.md) for manual deploy.)

4. **Configure env**  
   Copy `.env.example` files in `server/` and `client/` (if present), or set `TOKEN_ADDRESS` / `VAULT_ADDRESS` and `VITE_*` after deploy. Never commit `.env`.

5. **Run server and client**
   - `cd server && npm run dev` (port 3001)
   - `cd client && npm run dev` (port 5173)
   - Open http://localhost:5173, connect wallet (Anvil network), sign in, buy chips, join a table.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for full local and AWS deployment, versions, and production checklist.

## Repo layout

- `client/` — Vite + React frontend
- `server/` — Express + Socket.IO game server
- `contracts/` — Foundry (PokerVault, MockToken, deploy scripts)
- `scripts/` — `deploy-and-save.js`, `use-version.js`
- `versions/` — Deployed addresses per network/version (e.g. `versions/anvil/1.0.1/deployment.json`)

## Publishing to GitHub (or other Git host)

The repo is already initialized with an initial commit. To publish:

1. **Create a new repository** on GitHub (or GitLab, etc.): do **not** add a README, .gitignore, or license (this repo already has them).

2. **Add the remote and push** (replace `YOUR_USERNAME` and `YOUR_REPO` with your repo path):

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```

   Or with SSH:

   ```bash
   git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

3. **After clone**, others need to:
   - Create `server/.env` and `client/.env` from your docs (never commit real `.env`).
   - Run `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` in `contracts/` (requires git) so `forge build` works.

## License

MIT
