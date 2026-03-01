# Poker engine & current issues

## What SDK are we using for the poker?

**No external SDK.** The poker game uses a **custom in-house engine**:

- **Server:** `server/src/poker-engine.js`  
  - Full Texas Hold'em: deck, blinds, preflop → flop → turn → river → showdown  
  - Hand evaluation (7-card best-5, all standard hand ranks)  
  - Side pots, provably fair RNG (commit/reveal with server seed)  
  - `PokerTable` class: `sitDown`, `standUp`, `startHand`, `applyAction`, `_advanceAction`, `_nextStage`, `_resolveShowdown`, `toPublicState`

- **Client:** `client/src/components/PokerTable.jsx`  
  - Renders state from the server (Socket.IO `gameState`). No game logic; display only.

So the rules and flow are standard Texas Hold'em; everything is custom code in this repo.

---

## Reported issues and status

| # | Issue | Status / fix |
|---|--------|---------------|
| 1 | **UI: players over center, should be on border with spacing** | Seats use fixed 9 positions; with 2 players they sit at first two slots. Need to position by actual player count (e.g. 2 = opposite sides) and add avatar circle + icon. |
| 2 | **Game should be Texas Hold'em and flow gracefully** | Engine is correct TH; “weird” feel may be from UI/timing. Consider transitions and clearer stage labels. |
| 3 | **Other player can’t act past flop; stalls on “my hand”** | Likely broadcast or turn order. Check: (a) `findSocket(playerId)` finds both sockets (case-sensitive?), (b) after `_nextStage()` both clients get new `gameState` with correct `actionIdx`. |
| 4 | **Other player got 10 chips instead of 1000** | Server gives `startingChips = 1000` for USDC tables. If they saw 10, may be display bug or leftover from another test. |
| 5 | **“Hand 2 starting” stays after friend left** | Notification isn’t cleared when leaving table. Clear `notification` when `gameState` becomes null (or on leave). |
| 6 | **Can leave and rejoin with same chips** | On USDC leave we don’t credit server chips (correct). On rejoin we currently give 1000 again. Need to either block rejoin to same game or persist/restore stack per player per USDC game. |
| 7 | **Cashout option for friend** | For USDC games there’s no cashout; winnings come from on-chain `closeGame`. Hide “cash out” wording on USDC tables; show “Leave table” only. |

---

## Fixes applied (in code)

- **USDC table:** “Leave table” only (no “cash out”) when `tableId.startsWith('usdc-')`.
- **Notification:** Cleared when leaving table (setNotification(null) in leaveTable ack).
- **Seats:** Positions computed from player count (getSeatPositions(n)) so 2 players sit opposite; only actual players rendered (no empty slots in the middle).
- **Avatars:** Deterministic icon from address (🃏👤🎭🦊🐶🐱🦁🐯) in a circle instead of hex.
- **USDC rejoin:** Server stores stack in `usdcStacks` when a player leaves a USDC table; on rejoin they get that stack back instead of 1000.
- **Socket lookup:** findSocket now compares lowercase playerId so both players get gameState updates (may fix “other player can’t act past flop”).

---

## Possible cause for “other player can’t act past flop”

- Server uses `findSocket(p.id)` to send `gameState` to each player. If `p.id` is lowercase and `socket.walletAddress` isn’t (or vice versa), one client might never get updates. Ensure wallet addresses are normalized to one case (e.g. lowercase) when storing and when looking up sockets.
