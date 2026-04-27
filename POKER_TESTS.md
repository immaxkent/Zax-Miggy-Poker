# Poker Engine — Test Plan

## Texas Hold'em Rules (Concise)

### Setup
- 2–9 players, standard 52-card deck
- Three forced roles rotate each hand: **Dealer (Button)**, **Small Blind (SB)**, **Big Blind (BB)**
- SB posts half the big blind; BB posts the full big blind
- **Heads-up exception**: dealer = SB, acts first pre-flop; other player = BB, acts second pre-flop

### Hand Flow
1. **Deal** — 2 hole cards face-down to each player
2. **Pre-flop** — betting starts left of BB (UTG); BB gets a final option to raise if no one raised
3. **Flop** — 3 community cards dealt; betting starts left of dealer (SB or next active)
4. **Turn** — 1 community card; same betting order
5. **River** — 1 community card; final betting round
6. **Showdown** — remaining players reveal; best 5-card hand wins

### Betting Actions (each street)
- **Check** — pass (only if no bet has been made this street)
- **Call** — match the current bet
- **Raise** — increase the bet (minimum raise = previous bet size / big blind)
- **Fold** — surrender cards; forfeit any chips already in the pot

### Betting Round End
A street ends when **all active (non-folded, non-all-in) players have matched the current bet AND every player has had at least one action opportunity**.

### All-In
- A player who can't cover the bet goes all-in for their remaining chips
- They can only win chips they contributed to (main pot)
- Excess chips form a **side pot** contested only by players who matched the full bet
- All-in players are skipped for future action but stay in the hand

### Side Pots
- Created whenever players are all-in at different stack levels
- Each pot has an eligible set of players who can win it
- Resolved independently at showdown

### Showdown
- Best 5-card hand from any combination of 2 hole cards + 5 community cards wins
- **Ties** — pot split equally among tied players (odd chip to earliest position)
- Folded players are ineligible regardless of their cards

### Hand Rankings (low → high)
0. High Card
1. One Pair
2. Two Pair
3. Three of a Kind
4. Straight (A-2-3-4-5 "wheel" is the lowest straight)
5. Flush
6. Full House
7. Four of a Kind
8. Straight Flush
9. Royal Flush (A-K-Q-J-T of same suit)

---

## Bugs Already Identified in the Engine

| # | Bug | Location | Effect |
|---|-----|----------|--------|
| 1 | All-in infinite loop | `_nextStage()` | Hand freezes when all remaining players are all-in; while loop seeking a non-all-in player never exits |
| 2 | Ties not split | `_resolveShowdown()` | One tied player wins entire pot; others get nothing |
| 3 | Heads-up blind order wrong | `startHand()` | Dealer posts BB, other player posts SB — reversed from correct rules |

---

## Test Coverage Plan

### 1. Hand Evaluator
- [ ] Royal flush identified and beats straight flush
- [ ] Straight flush beats four of a kind
- [ ] Four of a kind beats full house
- [ ] Full house beats flush
- [ ] Flush beats straight
- [ ] Straight beats three of a kind
- [ ] Three of a kind beats two pair
- [ ] Two pair beats one pair
- [ ] One pair beats high card
- [ ] Wheel (A-2-3-4-5) recognised as a straight, lowest straight
- [ ] Wheel loses to 2-3-4-5-6
- [ ] Higher kicker breaks tie between same category (e.g. pair of Aces vs pair of Kings)
- [ ] Kicker comparison: same pair, different 3rd card
- [ ] Best 5 chosen correctly from all 21 combinations of 7 cards
- [ ] Tie correctly detected (two identical best hands)

### 2. Side Pot Calculator
- [ ] No all-in: single pot with all players eligible
- [ ] One all-in below others: main pot (all eligible) + side pot (non-all-in players only)
- [ ] Two all-ins at different levels: three separate pots with correct eligibility
- [ ] Folded players excluded from all pots
- [ ] Pot amounts sum to total chips committed

### 3. Seat Management
- [ ] `sitDown` adds player; `toPublicState` reflects them
- [ ] `sitDown` throws if table is full (maxSeats)
- [ ] `sitDown` throws if same player tries to sit twice
- [ ] `standUp` removes player and returns correct chip count
- [ ] `canStart` false below minPlayers, true at minPlayers

### 4. Blinds & Dealer Rotation
- [ ] First hand: dealer=0, SB=1, BB=2 (3+ players)
- [ ] Dealer rotates by 1 each hand
- [ ] SB and BB chip deductions correct
- [ ] Pot equals SB + BB after deal
- [ ] **Heads-up**: dealer = SB (index 0), other = BB (index 1)
- [ ] **Heads-up**: pre-flop action starts with dealer (SB), not BB

### 5. Pre-flop Action Order
- [ ] Action starts left of BB (UTG) for 3+ players
- [ ] BB gets option to raise if no one raised (action must return to BB)
- [ ] BB can check if no raise (everyone just called)
- [ ] Acting out of turn throws an error
- [ ] Player who already folded cannot act

### 6. Post-flop Action Order
- [ ] Flop: action starts with first active player left of dealer (SB position or next)
- [ ] Turn: same order as flop
- [ ] River: same order as flop
- [ ] Skips folded players
- [ ] Skips all-in players

### 7. Betting Actions
- [ ] `check` succeeds when currentBet = 0
- [ ] `check` throws when there is an outstanding bet
- [ ] `call` deducts correct amount from chips; adds to pot
- [ ] `call` does not over-deduct (partial call → all-in)
- [ ] `raise` below minimum rejected with correct error
- [ ] `raise` updates `currentBet` to new level
- [ ] `raise` reopens action (players who already called must act again)
- [ ] `fold` marks player folded; they are skipped thereafter
- [ ] `fold` with one player remaining ends hand immediately (no showdown)

### 8. All-In Scenarios
- [ ] Calling more chips than available → player goes all-in for remaining
- [ ] All-in player is skipped in subsequent action
- [ ] Two active + one all-in: action continues between the two active
- [ ] All remaining non-folded players all-in → hand runs to showdown without freezing (bug #1)
- [ ] All-in player wins main pot if they have best hand
- [ ] All-in player cannot win side pot they didn't contribute to

### 9. Stage Transitions
- [ ] preflop → flop (3 community cards added)
- [ ] flop → turn (1 community card added)
- [ ] turn → river (1 community card added)
- [ ] river → showdown (no extra cards)
- [ ] Player bets reset to 0 at start of each new street
- [ ] `currentBet` resets to 0 at start of each new street
- [ ] All players folding before showdown resolves immediately

### 10. Showdown & Winner Resolution
- [ ] Best hand wins entire pot (single winner)
- [ ] Chips credited to winner
- [ ] Folded players ineligible even with strong cards
- [ ] **Tie: pot split equally** (bug #2 — currently broken)
- [ ] `pendingHandComplete` set with correct results, community, holeCards
- [ ] Stage resets to `'waiting'` after hand
- [ ] Player chips persist correctly into next hand

### 11. Full Hand Integration (end-to-end)
- [ ] 2-player hand: complete pre-flop → showdown, chips correct at end
- [ ] 3-player hand: fold to one winner before showdown
- [ ] 3-player hand: goes to showdown, best hand wins
- [ ] Multiple hands in sequence: dealer rotates, chips carry over correctly
- [ ] Hand where all players check every street (no raise)
- [ ] Hand with a raise that forces re-action from previous callers
- [ ] Hand with one all-in and a side pot, distributed correctly

### 12. Provably Fair RNG
- [ ] Same serverSeed + clientSeed + nonce produces same shuffle
- [ ] Different nonce produces different shuffle
- [ ] All 52 cards dealt exactly once per shuffle (no duplicates)
- [ ] `verifyInfo()` returns serverSeed and serverHash; SHA256(serverSeed) === serverHash

---

## Notes
- No test runner installed — suggest adding `node:test` (built-in, zero deps) or `vitest`
- Tests should import `poker-engine.js` directly; no server/socket needed
- Fix bugs #1–3 before or alongside writing tests so failures are meaningful
