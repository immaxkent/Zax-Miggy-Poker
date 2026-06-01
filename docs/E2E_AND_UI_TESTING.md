# E2E and UI testing (Agentic Arena)

## Two layers

| Layer | What it proves | Needs |
|-------|----------------|-------|
| **Local E2E** (`e2e/`) | Server + poker engine + Arena contracts on **anvil** | Foundry `anvil` in PATH |
| **Sepolia smoke** | EC2 + Supabase + deployed Sepolia addresses | Network only |
| **Manual UI** | Wallet, USDC, Vercel env | MetaMask on Base Sepolia |

---

## 1. Local E2E (run before UI)

From repo root:

```bash
# Contracts + server unit tests
npm run test:arena
cd server && npm test

# Full local stack (anvil + server + sockets + on-chain settleGame)
npm run test:e2e:arena
```

Or all e2e (legacy USDC vault + arena + spectator):

```bash
npm run test:e2e
```

**Requires:** `anvil` (install Foundry).

**Arena test covers:**

- Deploy Arena stack on anvil
- `createBot` / `createGame` / `joinGame` on-chain
- `joinArenaTable` + `startGame` (host = owner wallet)
- Play to `gameOver` with `mode: 'arena'`
- `settleGame` on-chain (chips burned)
- Vault **not** used for arena `gameId`

Verbose server logs: `E2E_VERBOSE=1 npm run test:e2e:arena`

---

## 2. Sepolia smoke (live server, no keys)

After `wire:base-sepolia:ec2` and Vercel env:

```bash
npm run test:smoke:sepolia
```

Checks:

- `versions/base-sepolia/1.0.1/agentic-deployment.json`
- `GET /health` → `arenaEnabled`, `dbBackend: supabase`
- `GET /api/arena/status` → addresses match manifest
- `GET /api/tables`

Optional: `E2E_SERVER_URL=https://your-ngrok.app npm run test:smoke:sepolia`

---

## 3. Manual UI checklist (Base Sepolia)

**Wallet & app**

1. MetaMask on **Base Sepolia** (chain 84532).
2. Vercel has `VITE_CHAIN_ID=84532` and all `VITE_ARENA_*` / `VITE_USDC_*` from `client/.env`.
3. Hard refresh app after deploy.

**Bots (`/bots` or Bot Config)**

4. Hold test **USDC** on Sepolia (`0x036CbD…`).
5. Register bot on-chain (~$3 USDC) → tx confirms.
6. Bot profile loads from server (`/api/arena/bots/.../profile`).

**Arena lobby (`/arena`)**

7. Create game (on-chain tier fee + server table).
8. Second wallet/bot joins same `gameId`.
9. Host clicks **Start** (must be game creator wallet).
10. Play a hand; actions update for both seats.
11. Run down to one stack → `gameOver` + optional `arenaSettlement` toast.
12. Basescan: `settleGame` on `0x99202708…` (Arena).

**Sanity URLs**

- Health: `https://zax-and-miggy-poker.ngrok.app/health`
- Arena: `https://zax-and-miggy-poker.ngrok.app/api/arena/status`

---

## 4. Order we recommend

```bash
npm run test:arena          # Foundry
cd server && npm test       # server unit
npm run test:e2e:arena      # full arena path on anvil
npm run test:smoke:sepolia  # live EC2 + manifest
# then manual UI on Sepolia
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `anvil not found` | Install Foundry: https://getfoundry.sh |
| `Only the host can start` | Pull latest server (host = wallet, not bot address) |
| `Agentic arena disabled` | EC2: `AGENTIC_ARENA_ENABLED=true` + pm2 restart |
| Client “contracts not configured” | Vercel `VITE_ARENA_ADDRESS` + redeploy |
| `settleGame` failed on EC2 | `SIGNER_PRIVATE_KEY` must match deploy `SETTLEMENT_SIGNER` |
| Smoke test skipped | Set `E2E_SMOKE_SEPOLIA=1` |
