# MYBOT — Zax & Miggy Poker Agent Configuration Guide

This file documents every configuration option for your AI poker bot.
It is written for both human operators AND for AI agents that may read it to generate novel strategies.

---

## What is a Bot?

A bot is a Claude-powered agent that:
1. Holds its own Ethereum wallet (generated once, encrypted as a keystore)
2. Deposits USDC on-chain, joins games autonomously, and plays Texas Hold'em
3. Makes decisions using the Claude API guided by your `config.json` strategy

---

## Quick Start

1. **Generate a wallet** on the bot activation page (or locally: `npm run generate-wallet`)
2. **Download `config.json`** from the bot configuration page after setting your preferences
3. **Activate** on the `/activate-agent` page: drag-and-drop your keystore + config → the server spawns your bot
4. **Watch** your bot play by navigating to its game — you will see its hole cards (bot owners only)

---

## config.json Schema

```json
{
  "persona": "gto",
  "starting_hand_range": 22,
  "positional_tightness": 60,
  "open_raise_size": 50,
  "three_bet_frequency": 40,
  "cbet_frequency": 55,
  "bluff_frequency": 35,
  "bluff_detection": 50,
  "bet_sizing": 50,
  "hand_strength_threshold": 40,
  "stack_depth_adjustment": true,
  "price_range_min": 1,
  "price_range_max": 10,
  "custom_instructions": ""
}
```

All numeric fields are **0–100** sliders unless stated otherwise.

---

## Configuration Topics

### `persona` (string)
Sets a base preset. Individual sliders override the preset.

| Value | Description |
|-------|-------------|
| `gto` | Balanced, game-theory-optimal baseline. Hard to exploit. |
| `aggressive` | Wide ranges, large bets, frequent bluffs. High variance. |
| `rock` | Very tight, only plays premium hands, bets for value only. |
| `maniac` | Plays almost any hand, fires huge bets, almost never folds. |
| `trappy` | Tight range, slow-plays strong hands, induces bluffs. |

---

### `starting_hand_range` (0–100)
Percentage of starting hands the bot will voluntarily enter the pot with.

- **0–15**: Premium only (AA, KK, QQ, AKs and little else)
- **16–25**: Solid TAG range (top ~20% of hands)
- **26–40**: Loose-aggressive opening range
- **41–65**: Speculative hands included (suited connectors, small pairs)
- **66–100**: Any two cards

**AI note:** Ranges should contract in early position and expand on the button. Combine with `positional_tightness` for realistic position-aware play.

---

### `positional_tightness` (0–100)
How much tighter to play out-of-position (UTG, UTG+1) vs. in-position (CO, BTN).

- **0–20**: Ignores position entirely — same range everywhere
- **21–50**: Slight position adjustment
- **51–80**: Strong positional awareness (recommended for most strategies)
- **81–100**: Extreme — near-premium only UTG, very wide on the button

**AI note:** In a 6-handed game, consider UTG range ~60% of BTN range at high positional_tightness.

---

### `open_raise_size` (0–100)
Preferred raise size when opening the pot pre-flop.

- **0–30**: Min-raises (2x BB) — keeps pot small, polarised approach
- **31–55**: Standard 2.5–3x BB opens
- **56–75**: 3.5–4x BB — puts more pressure on blinds
- **76–100**: Pot-sized opens and overbets

**AI note:** Larger opens are effective with nutted hands or when the table folds too often to big raises. Scale down with stack depth < 20BB.

---

### `three_bet_frequency` (0–100)
How often to re-raise a pre-flop opener.

- **0–20**: 3-bet only for value (QQ+, AK)
- **21–45**: Balanced value + some bluff 3-bets
- **46–70**: Aggressive — 3-bet suited Ax and KQ+ as bluffs
- **71–100**: Nearly polarised 3-bet range; apply heavy pre-flop pressure

**AI note:** High 3-bet frequency pairs well with `aggressive` persona and large `open_raise_size`. Low 3-bet frequency pairs with `rock` or `trappy`.

---

### `cbet_frequency` (0–100)
How often to continuation-bet the flop after raising pre-flop.

- **0–25**: Check most flops; only cbet dry boards with strong hands
- **26–50**: Selective cbetting — prefer boards that hit our range
- **51–70**: Balanced approach; cbet most dry boards, check some wet boards
- **71–100**: Near-automatic cbet on almost every board

**AI note:** Cbetting frequency should decrease on coordinated boards (e.g. 8♣7♣6♥) unless your range has a significant nut advantage.

---

### `bluff_frequency` (0–100)
General propensity to bet/raise as a bluff (no made hand, often draw-based).

- **0–15**: Almost never bluffs; bets are always for value
- **16–35**: Occasional bluffs on good runouts; semi-bluffs with draws
- **36–60**: Regular bluffs; fires at undefended pots
- **61–80**: Frequently bluffs; relies on fold equity
- **81–100**: Maniac-level bluffing; calls for high variance play

**AI note:** Effective bluffing requires representing a believable range. Bluff when: (a) the board favours your perceived range, (b) your opponent has shown weakness, (c) there are fold equity opportunities.

---

### `bluff_detection` (0–100)
Willingness to call down suspected bluffs (affects call/fold decisions with marginal holdings).

- **0–20**: Very trusting; folds to most bets without a strong hand
- **21–45**: Standard — calls with good pot odds or reads
- **46–70**: Suspicious of bets on scary runouts; widens calling range
- **71–100**: Station mode; calls down very wide; resistant to being bluffed

**AI note:** High bluff detection is exploitable when opponents adjust by value-betting thinner. Optimal detection level depends on opponent's bluff frequency.

---

### `bet_sizing` (0–100)
Controls bet size as a fraction of pot when making value bets or bluffs.

- **0–25**: Small bets (25–33% pot) — induce calls, build small pots
- **26–50**: Standard sizing (50% pot)
- **51–75**: Large bets (66–75% pot) — polarised range
- **76–100**: Overbets (pot or larger) — maximise value from nutted hands

**AI note:** Large bets work best with polarised ranges (very strong or complete air). Small bets work well for merged ranges with thin value.

---

### `hand_strength_threshold` (0–100)
Minimum perceived hand strength (relative to board + opponents) required to continue in a hand when facing a bet.

- **0–20**: Continue with almost any piece of the board or draw
- **21–40**: Require at least a pair or a strong draw to continue
- **41–60**: Need a decent made hand (top pair / overpair) on danger boards
- **61–80**: Tight — require top pair good kicker or better
- **81–100**: Only continue with two-pair, set, or better

**AI note:** This interacts with `bluff_detection`. A high threshold + high bluff detection means: fold often, but when you continue, you're usually winning.

---

### `stack_depth_adjustment` (boolean, default: true)
When `true`, the bot dynamically tightens its range based on effective stack-to-pot ratio (SPR).

- **SPR < 4** (short-stack territory): Commit-or-fold mode. Only continue with top pair+ or strong draws.
- **SPR 4–15**: Standard play; most strategies apply normally.
- **SPR > 15** (deep-stack): Speculative hands (suited connectors, small pairs) increase in value due to implied odds. The bot opens its range slightly.

Set to `false` for a persona that ignores stack depth (e.g. Maniac).

---

### `price_range_min` / `price_range_max` (number, USDC)
Game auto-discovery price filter.

The bot scans on-chain `GameCreated` events and only joins games where the deposit is within this range.
Set `price_range_max` to `0` to disable the upper limit.

Example: `{ "price_range_min": 5, "price_range_max": 20 }` — only join games with 5–20 USDC buy-in.

---

### `custom_instructions` (string)
Free-form text appended verbatim to the Claude system prompt.
Use this for advanced strategy instructions not covered by the sliders.

Examples:
- `"Always raise on the river if you have the nut flush."`
- `"Avoid 3-betting early position opens unless you have QQ+."`
- `"Target the big blind with steal attempts when stack depth allows."`
- `"Adopt a tighter range when there are 5 or more players remaining."`

**AI strategy generation note:** This field is the most powerful lever. Describe a specific exploitative strategy, e.g.:
- `"When a player has called two streets and checks the river, bluff 70% of the time."`
- `"3-bet squeeze from the blinds when there is a raise and one caller in position."`
- `"Slow-play sets on dry boards when the pot is below 300 chips."`

---

## Preset Reference Table

| Topic | GTO | Aggressive | Rock | Maniac | Trappy |
|-------|-----|-----------|------|--------|--------|
| starting_hand_range | 22 | 35 | 12 | 65 | 18 |
| positional_tightness | 60 | 30 | 85 | 10 | 50 |
| open_raise_size | 50 | 75 | 40 | 90 | 30 |
| three_bet_frequency | 40 | 65 | 15 | 80 | 20 |
| cbet_frequency | 55 | 75 | 40 | 85 | 30 |
| bluff_frequency | 35 | 60 | 10 | 80 | 25 |
| bluff_detection | 50 | 40 | 70 | 20 | 60 |
| bet_sizing | 50 | 70 | 35 | 90 | 25 |
| hand_strength_threshold | 40 | 25 | 70 | 10 | 55 |
| stack_depth_adjustment | true | true | true | false | true |

---

## Novel Strategy Ideas for AI Agents

If you are an AI system reading this to generate a unique bot configuration, here are strategy archetypes worth implementing:

**Solver-Minbet**: Very low `bet_sizing` (10–20), high `cbet_frequency` (80+), moderate bluff frequency. Forces opponents into many close decisions with small bets and relies on long-run EV.

**Blocker Heavy**: Moderate range, but `custom_instructions` focus on blocker-aware bluffing. E.g. always bluff the river when holding the A-high flush blocker on a three-flush board.

**Nitty-Squeeze**: Low `starting_hand_range` (8–12) and very high `three_bet_frequency` (75+). Plays almost no hands but 3-bets aggressively to steal dead money from opens.

**Float & Stab**: Low `cbet_frequency` (25), high `bluff_detection` (70), high `bluff_frequency` on the turn. Calls flop cbets wide, then takes the pot away on the turn.

**River-Value Maximiser**: High `bet_sizing` (85+), low `bluff_frequency`, high `hand_strength_threshold`. Only plays strong hands, overbets the river for maximum value.

---

## Security Notes

- Your **keystore file** is encrypted with AES-128-CTR + scrypt (EIP-55 standard).
- The server decrypts your key in memory only for the duration of the session; it is never persisted to disk.
- The server is operated by Zax & Miggy Poker on AWS EC2. By activating a bot, you trust this server with your decrypted key during gameplay.
- Only fund your bot wallet with amounts you are comfortable wagering.
- Never share your keystore password with anyone.
