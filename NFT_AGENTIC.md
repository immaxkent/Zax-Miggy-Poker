# NFT Agentic Arena Transition Scope

## Context

Due to gambling-related regulation risk, the product is shifting from real-money poker competition to an **agentic training arena**.

Core principle: **no monetary payouts to winners**.  
USDC is used for platform access fees (bot creation and game entry), while in-game chips are represented by temporary ERC-1155 game tokens.

---

## New Product Vision

The platform becomes an AI bot arena where users:

1. Create and deploy on-chain bot identities.
2. Fund bots with USDC for participation fees.
3. Join or create arena games by tier.
4. Train/evaluate bot strategies through gameplay outcomes.
5. Track bot performance in a multidimensional ranking profile.

Spectating remains open. Owner private-card spectating remains supported.

---

## Contract Model

## 1) `Arena.sol` (deployer-owned core contract)

Responsibilities:

- Charge flat bot creation fee: **$3.00 USDC**.
- Spawn new bot contracts (`Bot.sol`) for users.
- Register newly created bots in `AgenticRankings` immediately.
- Charge per-game entry fee by tier:
  - **Unranked**: `$0.01`
  - **Ranked**: `$0.05`
  - **Elite**: `$0.09` (top 100 bots only)
- Mint game chips as ERC-1155 tokens when bot joins a game (e.g. 1000 chips).
- Burn game chips at game end.
- Emit canonical events for off-chain indexers / server sync.

Suggested events:

- `BotCreated(owner, bot, feePaid)`
- `GameJoined(gameId, bot, tier, feePaid, chipsMinted)`
- `GameCreated(gameId, creatorBot, tier)`
- `GameSettled(gameId, tier, participants)`
- `ChipsMinted(gameId, bot, tokenId, amount)`
- `ChipsBurned(gameId, bot, tokenId, amount)`

## 2) `Bot.sol` (per-user spawned contract)

Responsibilities:

- Represent bot identity/account on-chain.
- Hold/approve USDC for arena actions.
- Enforce owner controls (owner can update metadata/config pointer, pause, etc.).
- Optionally store immutable creation metadata and mutable profile pointers.

## 3) `AgenticRankings` (existing rankings system, evolved)

Responsibilities:

- Register bot at creation (initial score 0, no games).
- Record post-game metrics (wins/chips/quality of opponents beaten).
- Store multidimensional ranking signals (not just one score).

---

## User / Bot Lifecycle (Target Flow)

## Phase A: Bot creation

1. User triggers bot creation.
2. `Arena.sol` charges **$3 USDC**.
3. `Arena.sol` deploys/spawns `Bot.sol`.
4. Bot is auto-registered in `AgenticRankings` with baseline stats.
5. UI exports bot package (keystore + config + history cache).

## Phase B: Lobby + game routing

Bot process in lobby:

1. Check for open game matching bot config and chosen tier.
2. If match exists, join that game.
3. If none, create game for that tier.
4. Pay join/create fee via `Arena.sol`.
5. Receive in-game chips as ERC-1155 tokens for that game.
6. Play game (existing gameplay engine largely reused).

## Phase C: Game completion

1. Compute final chip results.
2. Burn all game ERC-1155 chips for the game.
3. Submit game outcome to `AgenticRankings`.
4. Update bot profile stats and ranks.
5. Persist game history snapshot for owner analysis/tuning.

---

## Game Tiers

| Tier | Entry Fee (USDC) | Access |
|---|---:|---|
| Unranked | 0.01 | Any bot |
| Ranked | 0.05 | Any registered bot |
| Elite | 0.09 | Top 100 ranked bots only |

Notes:

- No prize pool payout to users.
- Fees are platform participation costs.
- Tier should be encoded in game metadata and token IDs.

---

## ERC-1155 Chip Model

Recommended token ID scheme:

- `tokenId = hash(gameId, tier)` or deterministic packed integer `(tier << N) | gameId`.

Mint:

- On join, mint fixed chip amount (example: 1000) to bot identity for that game token ID.

Burn:

- On game settlement, burn all minted chips for that game token ID.
- Ensure reconciliation checks pass before settlement finalization.

Why this works:

- Keeps chips scoped to a game.
- Avoids persistent transferable value semantics.
- Makes chip lifecycle auditable on-chain.

---

## Ranking Profile (Beyond Simple Winnings)

Do not rely on a single universal score only. Maintain a profile with multiple dimensions:

- `gamesPlayed`
- `gamesWon`
- `handsWon`
- `chipsNet` (agentic chip net, non-redeemable)
- `rankedWins`
- `eliteWins`
- `opponentStrengthBeaten` (sum/avg rank of defeated bots)
- `assassinRank` (performance vs stronger opponents)
- `sociopathRank` (consistency of crushing weaker pools)
- `consistencyIndex` (variance-adjusted performance)
- `recencyScore` (recent form weighting)

Suggested composite score inputs:

- Elo-style adjustment per game for baseline skill movement.
- Strength-of-schedule multiplier (quality of opponents).
- Tier multiplier (`elite > ranked > unranked`).
- Anti-farming dampener (repeatedly beating same low-rank bots).

---

## Bot Package / Local Learning Artifacts

Current ZIP should evolve from only `keystore.json + config.json` to include history:

- `keystore.json`
- `config.json`
- `history.json` (rolling per-game/hand summaries, capped size)
- optional `metrics.json` (derived analytics snapshot)

Use-case:

- Owner edits bot settings based on historical outcomes.
- Re-importing ZIP preloads strategy and performance context.
- Keeps bot tuning portable without depending solely on backend state.

---

## Backend / Client Behavior Changes

## Keep

- Existing lobby UX patterns.
- Spectator functionality.
- Owner-authenticated private hole-card spectating.
- Core poker hand mechanics / action flow.

## Change

- Remove real-money winner payout flows from game lifecycle.
- Replace deposit-based game economics with tiered arena fee model.
- Add tier filters and matching in lobby (unranked/ranked/elite).
- Add bot eligibility checks for elite tier (top-100 gate).
- Add game history export/import support on bot config page.

---

## Migration Plan (High Level)

1. Freeze old real-money flow as legacy baseline (`original` branch already created).
2. Implement contracts:
   - `Arena.sol`
   - `Bot.sol`
   - updates to `AgenticRankings`
3. Update server domain model for tiered arena games and non-cash settlement.
4. Add ERC-1155 mint/burn integration to game join/settle.
5. Update client:
   - Bot creation flow (`$3 create fee`)
   - Tiered game create/join UI
   - Bot profile/ranking views
6. Add analytics/history in bot ZIP import/export.
7. Rework tests:
   - contract unit tests
   - server integration tests
   - e2e for each tier + ranking updates

---

## Open Design Decisions

- Whether `Bot.sol` should be minimal proxy clones vs full deployments.
- Exact `AgenticRankings` storage layout for multidimensional rank vectors.
- How much ranking logic stays on-chain vs server-validated and submitted on-chain.
- Whether 1155 chips are non-transferable (recommended) to avoid token market confusion.
- Fee recipient and treasury accounting model in `Arena.sol`.

---

## Immediate Next Steps

1. Define final interfaces for `Arena.sol`, `Bot.sol`, and ranking update entrypoints.
2. Lock game tier enum + fee constants.
3. Specify deterministic settlement payload from server to contracts.
4. Implement a first pass of ranking profile schema and score formulas.
5. Update bot ZIP format spec (`history.json` and merge semantics).

---

## Workload

This section captures the concrete implementation proposal and delivery plan.

### A) Contracts: New, Deprecated, and Responsibilities

#### New contracts

- `Arena.sol` — core entrypoint for create/join/settle fee logic.
- `BotFactory.sol` — deploys bot contracts (or folded into `Arena.sol`; separate preferred).
- `Bot.sol` — per-user bot identity contract with owner controls.
- `AgenticChips1155.sol` — non-transferable game chips, mint/burn by arena only.
- `AgenticRankingsV2.sol` — multidimensional ranking profiles and score updates.
- Optional: `ArenaRegistry.sol` if game metadata should be split from fee accounting.

#### Contracts likely deprecated

- `ZaxAndMiggyVault.sol` payout/deposit lifecycle (`createGame`/`joinGame`/`closeGame`/`cancelGame`).
- Voucher-signature payout flow tied to real-money settlement.

#### Core contents by contract

- `Arena.sol`
  - constants for `BOT_CREATE_FEE_USDC = 3e6`
  - tier fee constants: `UNRANKED=1e4`, `RANKED=5e4`, `ELITE=9e4`
  - create bot (collect fee, deploy bot, register ranking profile)
  - create/join game (collect fee, enforce elite gate, mint 1155 chips)
  - settle game (burn chips, update rankings, mark closed)
  - canonical events for indexers/backend sync
- `Bot.sol`
  - owner + optional operator
  - config/history metadata URI pointers
  - arena-allowlisted action forwarding
- `AgenticChips1155.sol`
  - game-scoped token IDs
  - mint/burn restricted to arena
  - transfer-disabled to avoid tradable-value semantics
- `AgenticRankingsV2.sol`
  - bot registration at creation
  - per-game stat ingestion
  - component scores + composite rank
  - top-100 eligibility queries for elite gate

### B) Ranking Model

Track both raw stats and derived ranks:

- Raw:
  - `gamesPlayed`, `gamesWon`, `handsWon`, `chipsNet`
  - `rankedGames`, `eliteGames`, `rankedWins`, `eliteWins`
  - `opponentStrengthBeaten`
- Derived profile metrics:
  - `assassinRank` (beats stronger bots)
  - `sociopathRank` (beats weaker pools; capped anti-farm influence)
  - `consistencyIndex` (variance adjusted)
  - `recencyScore` (recent form weighting)
- Composite score (example weighting):
  - 40% Elo delta
  - 20% strength-of-schedule
  - 15% assassin
  - 10% consistency
  - 10% recency
  - 5% sociopath (capped)

Anti-abuse rules:

- repeated-opponent dampening
- minimum unique-opponents thresholds for elite eligibility

### C) Deployment and Script Updates

#### New deployment flow

1. Deploy `AgenticRankingsV2`
2. Deploy `AgenticChips1155`
3. Deploy `BotFactory`
4. Deploy `Arena` with wired addresses
5. Grant roles/permissions:
   - chips mint/burn permission to arena
   - rankings writer permission to arena
6. Verify contracts and emit deployment manifest JSON

#### Environment/config updates

- add:
  - `ARENA_ADDRESS`
  - `BOT_FACTORY_ADDRESS`
  - `AGENTIC_CHIPS_1155_ADDRESS`
  - `AGENTIC_RANKINGS_V2_ADDRESS`
- remove/phase out:
  - vault payout signer dependencies once migration is complete

### D) Frontend Changes

- Bot creation page:
  - on-chain create bot tx (`$3`)
  - show bot contract address + status
- Lobby:
  - tier selector (unranked/ranked/elite)
  - fee preview + gas estimate
  - elite lock/unlock indicator
- Bot profile:
  - component ranking panels (assassin/sociopath/consistency/recency)
  - game history and opponent quality breakdown
- ZIP format evolution:
  - `keystore.json`, `config.json`, `history.json`, optional `metrics.json`
  - re-import preloads strategy and historical tuning context

### E) Backend and DB Requirements

#### Backend

- shift from payout orchestration to arena lifecycle orchestration
- chain service for `createBot`, `create/joinGame`, `settleGame`
- ranking derivation service (off-chain analytics -> on-chain compact updates)
- history writer service for ZIP-exportable artifacts

#### Database (recommended)

Add tables:

- `bots`
- `games`
- `game_participants`
- `hands` (optional condensed hand summaries)
- `bot_stats_snapshots`
- `ranking_events`
- `bot_history_exports`

Rationale:

- rich bot profile UX and analytics require indexed/queryable history beyond pure on-chain reads.

### F) Migration / Deprecation Plan

1. Parallel deploy new contracts (feature flag controlled).
2. Backend dual-mode toggle (`REAL_MONEY_MODE=false` target default).
3. Frontend cutover to Agentic Arena flows.
4. Disable old vault routes in production.
5. Archive legacy docs/tests for original branch reference.

### G) Testing Scope

- Contract unit tests:
  - bot creation fee, tier fees, elite gate, 1155 mint/burn, ranking updates
- Server integration tests:
  - create/join/settle round-trips for all tiers
- E2E:
  - full lifecycle by tier, elite lock/unlock transitions, ZIP history round-trip

### H) Delivery Order (Recommended)

1. Finalize interfaces/events (Step 1)
2. Lock enums/constants and settlement payload format
3. Implement contracts
4. Implement backend + DB schema
5. Implement frontend tier/profile flows
6. Complete migration + test hardening

