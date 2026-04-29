# Zax & Miggy Poker — Project Reference

## What We're Building

A real-money poker platform on Base (Ethereum L2). Players deposit USDC to create or join a game, play Texas Hold'em, and the winner receives the pot minus a 10% fee — all enforced by a smart contract. The server mediates gameplay only; funds are held on-chain and released via server-signed vouchers.

**Current scope: single-table USDC games.**
One game per `gameId`. One table per game. 2–8 players. Host creates, others join by ID. Host can terminate before the first hand starts; once started, the game must play to completion.

---

## Architecture

```
┌─────────────────────┐       HTTPS / WSS        ┌──────────────────────┐
│   Client (Vercel)   │ ◄────────────────────────► │  Server (EC2+ngrok)  │
│   React + wagmi     │                            │  Express + Socket.IO │
│   RainbowKit        │                            │  poker-engine.js     │
└─────────────────────┘                            └──────────┬───────────┘
         │                                                    │
         │  on-chain tx (wagmi)                               │  ethers (read + sign)
         ▼                                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Base Mainnet (Chain ID 8453)                         │
│   ZaxAndMiggyVault.sol  ·  USDC (ERC-20)                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key directories

| Path | Purpose |
|------|---------|
| `client/src/` | React frontend |
| `client/src/pages/Lobby.jsx` | Game creation, joining, lobby UI |
| `client/src/components/PokerTable.jsx` | In-game table UI |
| `client/src/context/GameContext.jsx` | Socket.IO connection, game state |
| `server/src/server.js` | Express routes + Socket.IO event handlers |
| `server/src/poker-engine.js` | Pure poker logic (no I/O) |
| `server/src/security.js` | JWT, HMAC, EIP-191 auth, voucher signing |
| `contracts/src/ZaxAndMiggyVault.sol` | USDC vault — holds funds, verifies signatures |
| `contracts/src/Utils.sol` | Game struct, constants |
| `e2e/` | End-to-end tests (server + anvil + contracts) |
| `server/test/` | Unit tests (poker engine only) |

### Infrastructure

- **Frontend:** Vercel (static deploy from `client/`)
- **Server:** AWS EC2 Ubuntu, managed via PM2 (`pm2 restart poker`)
- **Tunnel:** ngrok Pro static domain `zax-and-miggy-poker.ngrok.app` → EC2:3001
- **Redeploy:** `npm run redeploy` from root (commits + push → Vercel, then SSH → EC2 git pull + pm2 restart)

---

## USDC Game Lifecycle

### 1. Create
- Host calls `createGame(depositAmount)` on `ZaxAndMiggyVault`
- USDC transferred to vault; on-chain `gameId` assigned (auto-increment)
- Host shares `gameId` with other players

### 2. Join (on-chain)
- Player calls `joinGame(gameId)` on vault
- Must deposit same `depositAmount` as creator
- Max 8 players; game must not be `finished`
- Player added to on-chain `game.players[]`

### 3. Go to table (server)
- Player calls `joinUsdcTable` socket event with `gameId`
- Server creates in-memory `PokerTable` for `usdc-{gameId}` if not already present
- Player seated with starting chips (1000 default; or saved stack on rejoin)
- First player to join becomes host

### 4. Play
- Host calls `startGame` socket event (only in `waiting` stage, only the host)
- Texas Hold'em hands play out via socket events
- Server broadcasts `gameState` to each player with their personalised view
- Chips track in-memory; no on-chain interaction during gameplay

### 5a. Game ends — winner
- After final hand, server calls `closeGame(gameId, winner, nonce, sig)` on vault
- Vault pays winner 90% of pot; 10% fee to fee recipient
- Game marked `finished` on-chain
- Players cannot rejoin

### 5b. Terminate (host cancels before first hand)
- Host calls `terminateGame` socket event
- **Server must** call `cancelGame(gameId, nonce, sig)` on vault → vault refunds all players
- Game marked `finished` on-chain
- In-memory table removed
- Players cannot rejoin (game is finished on-chain)

---

## Texas Hold'em Rules (as implemented)

### Positions (per hand)
- **Dealer (Button):** rotates clockwise each hand
- **Small Blind (SB):** posts half the big blind
- **Big Blind (BB):** posts the full big blind
- **Heads-up exception:** dealer = SB, acts first pre-flop

### Hand flow
1. Each player dealt 2 hole cards
2. **Pre-flop** — betting from UTG (left of BB); BB gets option to raise if uncalled
3. **Flop** — 3 community cards; betting from left of dealer
4. **Turn** — 1 community card; same betting order
5. **River** — 1 community card; final betting
6. **Showdown** — best 5-card hand from any 2 hole + 5 community wins

### Betting actions
- `check` — only if no bet outstanding this street
- `call` — match current bet (partial call = all-in)
- `raise` — minimum raise = current bet + big blind; reopens action for all other players
- `fold` — surrender; forfeit chips in pot

### Street ends when
All active (non-folded, non-all-in) players have matched the current bet AND every active player has acted at least once this street. Tracked via `actedThisRound` Set on the server (not `firstToActIdx` — that approach had a bug when the first-to-act player folded mid-street).

### All-in
- Player bets all remaining chips; marked `allIn`; skipped for future action
- Side pots created when players are all-in at different stack levels
- If all remaining players are all-in, board runs out automatically (no action required)

### Hand rankings (low → high)
0. High Card · 1. One Pair · 2. Two Pair · 3. Three of a Kind · 4. Straight · 5. Flush · 6. Full House · 7. Four of a Kind · 8. Straight Flush · 9. Royal Flush

Wheel (A-2-3-4-5) is the lowest straight. Straight comparison uses the high card only (not raw Ace rank).

### Ties
Pot split equally. Odd chip goes to earliest position.

---

## Socket.IO Event API

### Client → Server (with ack callback)

| Event | Payload | Description |
|-------|---------|-------------|
| `joinUsdcTable` | `{ gameId }` | Sit at the server table for this on-chain game |
| `leaveTable` | `{}` | Stand up; chips returned to account |
| `startGame` | `{}` | Host only; starts first hand |
| `terminateGame` | `{}` | Host only; before first hand; should cancel on-chain |
| `playerAction` | `{ action, amount }` | `fold/check/call/raise` |
| `getState` | `{}` | Fetch current game state |
| `chipDeposited` | `{ netAmount }` | Notify server of chip deposit (chip-based tables) |

### Server → Client (broadcast)

| Event | Payload | Description |
|-------|---------|-------------|
| `gameState` | personalised state object | Emitted after every action |
| `handStarted` | `{ handNumber, dealerIdx, serverHash }` | New hand beginning |
| `handComplete` | `{ results, community, holeCards, verify }` | Hand resolved |
| `chipsUpdated` | `{ chips }` | Player chip balance changed |
| `winNotification` | `{ amount }` | Player won chips |
| `playerJoined` | `{ playerId }` | Someone sat down |
| `playerLeft` | `{ playerId }` | Someone stood up |
| `tableTerminated` | `{}` | Host terminated the game |

---

## Smart Contract Interface (`ZaxAndMiggyVault`)

| Function | Who calls | What it does |
|----------|-----------|--------------|
| `createGame(amount)` | Creator (client tx) | Deposits USDC, creates game, returns `gameId` |
| `joinGame(gameId)` | Joiner (client tx) | Deposits same amount, adds player |
| `closeGame(gameId, winner, nonce, sig)` | Anyone (server submits) | Pays winner 90%, fee 10%; marks finished |
| `cancelGame(gameId, nonce, sig)` | Anyone (server submits) | Refunds all players; marks finished |
| `getGame(gameId)` | Anyone (read) | Returns players, count, deposit, finished, winner |

Server signs `closeGame` and `cancelGame` vouchers using `SIGNER_PRIVATE_KEY`. The contract verifies the signature against `serverSigner` address.

---

## Authentication Flow

1. Client calls `POST /auth/challenge` with `{ address }`
2. Server returns `{ nonce, message }` — message is `"Sign this message to log in to CryptoPoker.\nNonce: {nonce}"`
3. Client signs message with wallet (EIP-191, no gas)
4. Client calls `POST /auth/verify` with `{ address, signature }`
5. Server recovers signer, issues JWT
6. Socket connects with `auth: { token, apiKey }`

---

## Testing Strategy

### Level 1 — Engine unit tests ✅
`server/test/poker-engine.test.js` · Run: `cd server && npm test`
Pure logic. No network. 77 tests covering hand evaluation, betting, all-in, showdown, RNG.

### Level 2 — Server integration tests (planned)
`server/test/server-integration.test.js`
socket.io-client connects to a real server instance. Blockchain calls mocked.
Covers: auth, join/leave, start, action flow, access control.

### Level 3 — Contract unit tests (Foundry)
`contracts/test/` · Run: `cd contracts && forge test`
Tests `createGame`, `joinGame`, `closeGame`, `cancelGame` in isolation.

### Level 4 — Full E2E tests ✅ (scaffold)
`e2e/` · Run: `cd e2e && npm test`
Real anvil chain + real server + real contract. Tests the full flow including on-chain state verification.
**This is the level that catches server/blockchain state divergence bugs like the terminate bug.**

---

## Known Bugs / Issues

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| 1 | Critical | `terminateGame` does not call `cancelGame` on-chain — USDC stays locked in vault | Fixed |
| 2 | Medium | After terminate, server recreates table on rejoin (giving 1000 free chips) | Fixed |
| 3 | Fixed | Raise did not reopen action for players who had already acted | Fixed |
| 4 | Fixed | All-in infinite loop — `_nextStage()` hung when all players were all-in | Fixed |
| 5 | Fixed | Pot not split on tie — one player took everything | Fixed |
| 6 | Fixed | Heads-up blind order reversed | Fixed |
| 7 | Fixed | Wheel straight (A-2-3-4-5) kicker compared incorrectly | Fixed |

---

## Environment Variables

### Server (`server/.env`)
```
PORT=3001
JWT_SECRET=...
HMAC_SECRET=...
SIGNER_PRIVATE_KEY=...   # signs closeGame / cancelGame vouchers
SERVER_API_KEY=...
ALLOWED_ORIGINS=https://your-app.vercel.app
NODE_ENV=production
CHAIN_ID=8453
BASE_RPC_URL=https://mainnet.base.org
ZAX_MIGGY_VAULT_ADDRESS=0x...
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### Client (`client/.env`)
```
VITE_SERVER_URL=https://zax-and-miggy-poker.ngrok.app
VITE_SOCKET_URL=https://zax-and-miggy-poker.ngrok.app
VITE_SERVER_API_KEY=...
VITE_CHAIN_ID=8453
VITE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
VITE_ZAX_MIGGY_VAULT_ADDRESS=0x...
VITE_WALLETCONNECT_PROJECT_ID=...
```

---

## Development Commands

```bash
# From repo root:
npm run open-ssh          # SSH to EC2
npm run redeploy          # commit + push (Vercel) + EC2 git pull + pm2 restart

# Server:
cd server && npm run dev  # nodemon dev server on :3001
cd server && npm test     # engine unit tests (node:test, 77 tests)

# Client:
cd client && npm run dev  # Vite dev server on :5173

# E2E:
cd e2e && npm test        # full stack tests (requires anvil in PATH)

# Contracts:
cd contracts && forge build
cd contracts && forge test
```
