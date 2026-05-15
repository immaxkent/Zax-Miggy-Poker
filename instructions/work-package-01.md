# Work Package 01 — Agent Bot, Spectator Mode, Agentic Rankings

## Overview

Three parallel workstreams, delivered in five phases. The foundation (Phase 1) unblocks both spectator and agent features. Spectator ships independently in Phase 2. Agent core and UI ship in Phases 3–4. Rankings UI closes in Phase 5.

---

## Component 1: Agent Bot

### What it is
A server-hosted Node.js process that plays Texas Hold'em on behalf of a user. It holds a funded wallet, discovers open games on-chain, joins autonomously within a configured price range, and makes decisions via the Claude API using a user-defined strategy profile.

### Bot architecture (`agent/`)

```
agent/
  src/
    wallet.js       # keypair generation, keystore encrypt/decrypt (EIP-55, AES-128-CTR + scrypt)
    auth.js         # POST /auth/challenge → sign with bot key → POST /auth/verify → JWT (isAgent: true)
    client.js       # Socket.IO event loop: joinUsdcTable, listen for gameState, emit playerAction
    ai.js           # Claude API: gameState + compiled system prompt → { action, amount }
    strategy.js     # config.json → structured system prompt (see MYBOT.md for full spec)
    onchain.js      # ethers.js: filter GameCreated logs, check joinable, call joinGame
  MYBOT.md          # full config documentation (for users and AI strategy scrapers)
  index.js          # entry point — receives decrypted key + config from agent-manager
  package.json
```

### Strategy config topics (stored in `config.json`, compiled into Claude system prompt)

| Topic | Type | Description |
|-------|------|-------------|
| `persona` | preset | `gto / aggressive / rock / maniac / trappy` — sets defaults for all below |
| `starting_hand_range` | 0.0–1.0 | Fraction of hands played (0.15 = top 15%) |
| `positional_tightness` | 0.0–1.0 | How much tighter in early position vs. button |
| `open_raise_size` | `2.5 / 3 / 4` | BB multiplier for opens |
| `three_bet_frequency` | 0.0–1.0 | How often to 3-bet instead of call |
| `cbet_frequency` | 0.0–1.0 | Continuation bet frequency post-flop |
| `bluff_frequency` | 0.0–1.0 | Bluff frequency on missed draws / air |
| `bluff_detection` | 0.0–1.0 | Willingness to call down light (0 = always fold to pressure) |
| `bet_sizing` | `small / medium / large / polarized` | Default post-flop sizing |
| `hand_strength_threshold` | 0.0–1.0 | Minimum equity to continue; scales with stack depth |
| `stack_depth_adjustment` | bool | Enable implied-odds reasoning on deep stacks |
| `price_range_min` | USDC | Minimum game deposit to auto-join |
| `price_range_max` | USDC | Maximum game deposit to auto-join |
| `custom_instructions` | string | Freeform overrides appended to system prompt |

Hand strength and stack depth are dynamic inputs: the bot reads live stack sizes from every `gameState` event and adjusts `hand_strength_threshold` automatically when `stack_depth_adjustment` is true. Deep stacks raise implied odds — the bot loosens its hand strength threshold for speculative hands. Short stacks collapse implied odds — push/fold territory, speculative hands folded.

### MYBOT.md
A human- and AI-readable reference in `agent/MYBOT.md` covering:
- What each config topic does and why it matters
- How topics interact (e.g. high bluff_frequency + low bluff_detection = suicide)
- Example persona configs with explanation
- Prompt compilation format (so an AI can generate novel strategies)
- How to fund and activate the bot

### Server-side additions

| File | Purpose |
|------|---------|
| `server/src/agent-manager.js` | Spawn / kill agent child processes; map MetaMask address → agent process |
| `POST /api/agent/register` | Register bot wallet address against authenticated MetaMask address |
| `POST /api/agent/activate` | Accept keystore + config + password; decrypt in-memory; spawn agent process |
| `POST /api/agent/deactivate` | Kill agent process; clear key from memory |
| `GET /api/agent/status` | Return agent state: `idle / searching / in-game / stopped` |
| `GET /api/games` | List active USDC tables (public, no auth): `{ tableId, gameId, playerCount, depositAmountUsdc, stage }` |

Agent socket connections are identified by `isAgent: true` in JWT. UI renders a robot icon for agent seats. The bot owner (authenticated MetaMask address) receives the full `gameState` including their bot's hole cards when spectating.

### New client pages/routes

#### `/bots` — Bot Configuration & Generation
- Preset selector with descriptions
- Sliders/dropdowns for each strategy topic
- Price range min/max inputs
- "Generate Bot" button:
  - Generates keypair client-side
  - Prompts for password
  - Encrypts to `keystore.json` (client-side, key never touches server at generation time)
  - Downloads `keystore.json` + `config.json`
  - Shows wallet address + QR code for funding (ETH for gas, USDC to play)
  - Registers wallet address against MetaMask account (server call)

#### `/activate-agent` — Bot Activation
- Drag-and-drop zones for `keystore.json` and `config.json`
- Password input (to decrypt keystore server-side — key held in-memory only for session duration)
- Price range confirmation
- "Activate" button → `POST /api/agent/activate`
- Once active: live status panel showing bot's current game
  - If bot is in a game and user is the registered owner: full table view with bot's hole cards
  - "Join this game" button (lets the human owner sit at the same table)
  - "Deactivate" button

---

## Component 2: Spectator Mode

### What it is
A read-only live view of any active game. Hole cards are hidden during play; revealed at showdown. No auth required to spectate.

### Server additions (`server/src/server.js`)

- `spectate` socket event: joins socket to room `spectators-{tableId}`, no seat taken
- After every existing `gameState` broadcast, also emit redacted state to `spectators-{tableId}`:
  - All `holeCards` arrays set to `null`
  - All other state (community cards, pot, bets, stacks, whose turn) intact
- On `handComplete`: broadcast full reveal (all hole cards) to spectators room — showdown is public
- `GET /api/games` (shared with agent discovery) feeds the spectatable game list

### Client additions

#### `/spectate/:gameId` — Spectate Table
- Read-only version of `PokerTable.jsx`
- Face-down card components during play
- Hole cards revealed at `handComplete`
- No action buttons, no raise slider
- Live player list with stack sizes and current bet
- Hand history ticker (last N actions)

#### Lobby changes
- "Watch" button next to each listed game (links to `/spectate/:gameId`)
- Game list sourced from `GET /api/games`

### Considerations
- Spectators join a room, not the game — no impact on game flow
- Bot owner spectating their own bot gets full view (hole cards visible) — handled by owner-detection middleware, not the spectator path
- Timing: spectator state updates fire after the action is processed server-side, same as player updates — no meaningful information leakage beyond what bet sizes already reveal

---

## Component 3: AgenticRankings Contract

### Who gets ranked
Every Ethereum address that completes a USDC game is ranked — EOAs (human players) and bot wallets alike. The contract has no concept of human vs. bot; the frontend adds the robot icon based on a registered bot address list stored off-chain.

### Rankings card UI

```
┌──────────────────────────────────────┐
│  #1   🤖 AggroBot           Base     │
│       0x1a2b...cd3e                  │
│                                      │
│  Score    2,847                      │
│  Record   23W / 31G   (74%)          │
│  Net      +$1,240 USDC               │
└──────────────────────────────────────┘
```

- Human players show a person icon (or no icon) instead of the robot
- Display name: optional, stored off-chain in user DB. Bots default to `{persona}Bot·{last4}` (e.g. `AggroBot·cd3e`). Humans default to truncated address.
- Score formula (computed off-chain): `(wins / gamesPlayed) * sqrt(max(0, totalWon - totalLost))`
- Rankings page: `/rankings` — sortable by score, wins, net winnings

### Contract: `contracts/src/AgenticRankings.sol`

```solidity
struct PlayerStats {
    uint256 wins;
    uint256 gamesPlayed;
    uint256 totalWon;   // gross USDC received from winning (6 decimals), never decremented
    uint256 totalLost;  // gross USDC deposited into games (6 decimals), never decremented
}

mapping(address => PlayerStats) public stats;
mapping(uint256 => bool) public processedGames;  // idempotency guard

// Called by server after closeGame confirms
function updateRankings(uint256 gameId) external onlyServerSigner

// Called by server after cancelGame confirms (terminate)
function recordCancellation(uint256 gameId) external onlyServerSigner
```

- `updateRankings`: reads `vault.getGame(gameId)` for players, depositAmount, winner. Winner gets `+wins`, `+gamesPlayed`, `+totalWon` (90% of pot). All players get `+totalLost` (depositAmount) and `+gamesPlayed`.
- `recordCancellation`: reads game from vault (finished=true, winner=address(0)). All players get `+gamesPlayed` only — no win/loss, game was refunded.
- `processedGames[gameId]` prevents double-processing if server retries.
- `onlyServerSigner`: `msg.sender == serverSigner` — server uses same key to sign and submit txs.
- Net winnings for display: `max(0, totalWon - totalLost)` computed off-chain. Clamped at 0.

### Contract interdependency

```
ZaxAndMiggyVault          AgenticRankings
─────────────────         ───────────────────────────────────────
createGame()              constructor(address vault,
joinGame()                            address serverSigner)
closeGame()    ─────────► updateRankings(gameId)
cancelGame()   ─────────► recordCancellation(gameId)
getGame()      ◄───────── (reads players + depositAmount + winner)
```

One-way dependency: `AgenticRankings` reads from vault. Vault has no knowledge of rankings. If the rankings contract has a bug, `closeGame` / `cancelGame` on the vault are unaffected — payouts still work.

### Deployment order

```
1. ZaxAndMiggyVault   — already deployed on Base mainnet
2. AgenticRankings    — deploy with (vaultAddress, serverSignerAddress)
                        vaultAddress  = ZAX_MIGGY_VAULT_ADDRESS from env
                        serverSigner  = SIGNER_ADDRESS from env
```

### New deployment script: `contracts/script/DeployAgenticRankings.s.sol`

Reads `ZAX_MIGGY_VAULT_ADDRESS` and `SIGNER_ADDRESS` from env. Deploys `AgenticRankings`. Logs the new address with instructions to set `AGENTIC_RANKINGS_ADDRESS` in server and client `.env`.

### New env vars

```bash
# server/.env
AGENTIC_RANKINGS_ADDRESS=0x...

# client/.env  
VITE_AGENTIC_RANKINGS_ADDRESS=0x...
```

### Server call sequence (after each game)

Two separate transactions — decoupled so a rankings bug never blocks payouts:

```
1. vault.closeGame(gameId, winner, nonce, sig)  → wait for confirmation
2. rankings.updateRankings(gameId)              → fire-and-forget with warn on failure

1. vault.cancelGame(gameId, nonce, sig)         → wait for confirmation
2. rankings.recordCancellation(gameId)          → fire-and-forget with warn on failure
```

Rankings calls are non-blocking (fire-and-forget after vault confirms). A rankings failure logs a warning but does not surface as an error to players.

### Contract tests: `contracts/test/AgenticRankings.t.sol`

- `test_updateRankings_winner` — winner gets wins++, correct totalWon, correct totalLost
- `test_updateRankings_losers` — all other players get gamesPlayed++, totalLost += depositAmount
- `test_recordCancellation` — all players get gamesPlayed++, no win/loss changes
- `test_idempotency` — calling updateRankings twice on same gameId reverts
- `test_accessControl` — non-signer call reverts
- `test_requiresFinishedGame` — calling on unfinished game reverts

---

## Implementation Phases

### Phase 1 — Foundation (current)
Unblocks everything else. No visible user-facing changes.

- [x] `contracts/src/IZaxAndMiggyVault.sol` — vault interface for rankings contract
- [x] `contracts/src/AgenticRankings.sol` — rankings contract
- [x] `contracts/test/AgenticRankings.t.sol` — Foundry tests
- [x] `contracts/script/DeployAgenticRankings.s.sol` — Base mainnet deploy script
- [x] `server/src/config.js` — add `agenticRankingsAddress`
- [x] `server/src/security.js` — add `submitUpdateRankings`, `submitRecordCancellation`
- [x] `server/src/server.js` — `GET /api/games` endpoint + rankings calls after close/cancel + store `depositAmountUsdc` on tables

### Phase 2 — Spectator Mode (2 days, independent)

- Server: `spectate` socket event + redacted `gameState` to spectators room
- Client: `SpectateTable.jsx` (read-only, face-down cards)
- Client: `/spectate/:gameId` route
- Lobby: "Watch" button + game list from `GET /api/games`

### Phase 3 — Agent Core (3–4 days)

- `agent/` npm project scaffold
- `wallet.js`, `auth.js`, `client.js`, `ai.js`, `strategy.js`, `onchain.js`
- `MYBOT.md` — full configuration documentation
- `server/src/agent-manager.js` — process spawn/kill/status

### Phase 4 — Agent UI (3 days)

- Client: `/bots` page — preset picker, sliders, generate + download
- Client: `/activate-agent` page — drag-drop, activate, live status
- Server: `/api/agent/*` routes
- Owner full-view spectating

### Phase 5 — Rankings UI (1 day)

- Client: `/rankings` page — sorted cards, scores from on-chain data

---

## Open Questions (resolved)

- [x] Agent runs server-side (EC2), key decrypted in-memory only — agreed
- [x] Universal rankings: EOAs and bot wallets ranked equally on-chain
- [x] Rankings page: standalone `/rankings`
- [ ] Persona preset default values — define exact slider defaults for each of the 5 presets
- [ ] Display names: opt-in or auto-generated?
