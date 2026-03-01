# ZaxAndMiggyVault + Game lifecycle (USDC) — Proposal

## Your concern (scalability / value)

- Current chip model: every hand/game could require NFT-backed minting or ownership checks; with many parallel games, lots of async chip minting and unclear “real value”.
- You want: **USDC in when a game is initialised**, server-signed **withdrawals** (like PokerVault), and an explicit **Game** lifecycle (create → join → play off-chain → close + payout + store) so chips aren’t the unit of account; the vault and the Game struct are.

---

## High-level design

1. **ZaxAndMiggyVault.sol**  
   - Holds **USDC** (or another stablecoin).  
   - When a **game is initialised**, the contract creates a **Game** (or reserves a `gameId`).  
   - Players **deposit USDC** to **join** that game; the contract updates the Game (players[], deposit amount, fees).  
   - When the **game is finished**, someone calls **closeGame** with a **server-signed voucher** (winner + amount). The vault checks the winner is in that Game’s players, pays the winner (and fees), marks the game finished, and stores the Game (e.g. in a `Games[]` or equivalent) for async/history.

2. **Utils.sol**  
   - Defines a **Game** struct (and optionally pure/view helpers). No state; the **vault** holds the actual games.  
   - Struct fields (conceptually):
     - **address[] players** — up to 8 (full table).  
     - **uint256 depositAmount** — per-seat deposit; updated when a USDC deposit succeeds (e.g. total deposited or per-player stake).  
     - **uint256 fee** (or feeBps) — computed when the game is built, stored and updated as each player joins if needed.  
     - **uint256 createdAt** — timestamp when the first player joins (game creation).  
     - **bool finished** — set true on close.  
     - Optionally: **address winner**, **uint256 paidOut**, etc., for payout and history.

3. **Signing**  
   - Reuse the same idea as PokerVault: EIP-191 hash over (e.g. chainId, vault, gameId, winner, amount, nonce). Server signs; vault’s **closeGame(gameId, winner, amount, nonce, sig)** verifies and pays.

---

## Implementation outline (no code)

### Utils.sol

- **Purpose**: Shared **Game** struct and, if useful, pure/view helpers (e.g. “is address in this game’s players?”).  
- **No state**: Library or a contract that only defines types and pure functions. The vault imports the struct (and helpers if any).

### ZaxAndMiggyVault.sol

- **State**:
  - USDC (IERC20) reference.
  - Server signer, fee recipient (like PokerVault).
  - Games: e.g. `mapping(uint256 gameId => Game) games` and `uint256 nextGameId` (or similar).
  - Optional: `Game[] completedGames` or `uint256[] completedGameIds` for history.
  - Nonces: e.g. per-game or per-player for closeGame (replay protection).

- **Game creation / init**:
  - **Option A**: Anyone can call `createGame(depositAmount, feeBps)` → allocates `gameId`, creates Game with empty players, `createdAt = 0` or “not started”.
  - **Option B**: First joiner creates the game: server signs (gameId, depositAmount, fee, …), first joiner calls `joinGame(signedParams)` and that creates the game and adds them.
  - **Option C**: Only a designated “creator” (owner or server EOA) can create; avoids spam.

- **Join game**:
  - `joinGame(gameId)` (and optionally amount, or use game’s fixed depositAmount):
    - Require game exists, not finished, not full (players.length < 8).
    - Pull USDC from msg.sender (transferFrom).
    - “Modify deposit on bool success”: on success, push msg.sender to `games[gameId].players`, update deposit tracking (e.g. totalDeposited += amount), set `createdAt = block.timestamp` if first joiner, update fee storage if needed.
  - Concurrency: two joins for last seat — only one can win; require strict `< 8` and revert when full.

- **Fees**:
  - “Calculated at time of building a game, stored and updated on each player joining”:
    - At create: set e.g. `feeBps` or total `feeAmount` for the game.
    - On each join: optionally update a running total (e.g. fee to collect = numberOfPlayers * feePerSeat) so at close you know exactly how much to send to fee recipient.

- **Close game**:
  - `closeGame(gameId, winner, payoutAmount, nonce, sig)`:
    - Require game exists, `!games[gameId].finished`.
    - Require `winner` is in `games[gameId].players` (use the Utils helper or inline check).
    - Build hash (chainId, vault, gameId, winner, payoutAmount, nonce); verify signature == serverSigner; require nonce not used.
    - Mark nonce used; set `games[gameId].finished = true` (and e.g. winner, paidOut).
    - Transfer USDC: payoutAmount to winner, fee to feeRecipient (fee either already deducted from payoutAmount or computed here).
    - **Store in Games[]**: push this game (or gameId + minimal info) to `completedGames` / `completedGameIds` for async and history.
  - Reentrancy: use ReentrancyGuard; do all state updates before USDC transfers.

- **Edge cases**:
  - **Abandoned games**: Games that never fill or are cancelled. Need a policy: e.g. owner or server-signed “cancel game” that refunds USDC to current players, or a timeout after which refunds are allowed.
  - **Replay**: Nonce scope must be clear — e.g. one nonce per (gameId) so one close per game, or global per (signer, nonce).

---

## Issues and risks (high level)

1. **Where Game lives**  
   Utils = types (and maybe pure helpers). Vault = state (`mapping(gameId => Game)`, optional `Games[]`). Don’t put storage in a library.

2. **Who can create games**  
   If anyone: spam/empty games. If only server or owner: need a clear creation path (createGame by owner, or first join with signed params).

3. **Gas and Games[]**  
   Pushing a **full** Game (e.g. 8 addresses + amounts + timestamps) to a dynamic array on every close can be expensive. Alternatives: push only **gameId** and keep full state in `mapping(gameId => Game)`; or push a compact/commitment; or use events for history and keep a small “last N games” array.

4. **Concurrency**  
   Last seat: two joins in same block — one will revert. Define “first wins” and document.

5. **Trust**  
   Same as PokerVault: server signer is trusted for who wins and how much. Secure key handling and optional future multi-sig/role split.

6. **Abandoned / cancelled games**  
   Without a cancel/refund path, USDC can be stuck in games that never fill or never get closed. Need at least one of: timeout + refund, owner cancel, or server-signed cancel.

7. **Fee semantics**  
   Be explicit: is payoutAmount “net to winner” (fees already taken) or “gross” (vault deducts fee)? Same for join: is depositAmount “before fee” or “after fee”?

8. **Nonce scope**  
   Per-game nonce (one close per game) vs per-player global nonce. Per-game keeps closeGame simple and avoids cross-game replay.

9. **Utils as library vs contract**  
   If you only need the struct, a contract that only defines the struct (and is imported by the vault) is enough. Use a library only if you want reusable pure/view logic in a delegatecall context.

10. **Async gaming**  
    Many games in parallel is fine: each gameId is independent; join and close only touch that game. “Stored in Games[]” gives you a clear on-chain record for async and auditing.

---

## Suggested next steps (once you’re happy)

- Define **Game** struct and where `createdAt` / `finished` / fee fields live.
- Decide **game creation** (who, how) and **join** (fixed vs variable deposit, who sets fee).
- Implement **ZaxAndMiggyVault**: createGame, joinGame, closeGame, nonce handling, ReentrancyGuard.
- Add **Utils.sol** with struct (and optional helpers).
- Add **cancel/refund** path for abandoned games.
- Reuse or mirror PokerVault’s hash/signing (and server API) for closeGame so your backend stays consistent.

If you want to tweak any of this (e.g. creation rules, fee timing, or how Games[] is used), we can adjust the spec before any implementation.
