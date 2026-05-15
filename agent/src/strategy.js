/**
 * strategy.js — compile a config.json into a structured system prompt for Claude.
 *
 * Config schema (all fields optional — defaults applied):
 * {
 *   persona: "gto" | "aggressive" | "rock" | "maniac" | "trappy",
 *   starting_hand_range: 0–100,         // % of hands to play (100 = any two cards)
 *   positional_tightness: 0–100,        // how much tighter to play OOP vs IP
 *   open_raise_size: 0–100,             // 0 = min-raise, 100 = pot-sized or bigger
 *   three_bet_frequency: 0–100,
 *   cbet_frequency: 0–100,
 *   bluff_frequency: 0–100,
 *   bluff_detection: 0–100,             // 0 = trust everyone, 100 = call down wide
 *   bet_sizing: 0–100,                  // 0 = small bets, 100 = overbets
 *   hand_strength_threshold: 0–100,     // min perceived strength to continue on danger boards
 *   stack_depth_adjustment: true|false, // dynamically tighten/loosen based on effective SPR
 *   price_range_min: number,            // min USDC deposit to join (0 = any)
 *   price_range_max: number,            // max USDC deposit to join (0 = no limit)
 *   custom_instructions: string,        // free-text appended verbatim to system prompt
 * }
 */

const PRESETS = {
  gto: {
    starting_hand_range: 22,
    positional_tightness: 60,
    open_raise_size: 50,
    three_bet_frequency: 40,
    cbet_frequency: 55,
    bluff_frequency: 35,
    bluff_detection: 50,
    bet_sizing: 50,
    hand_strength_threshold: 40,
    stack_depth_adjustment: true,
  },
  aggressive: {
    starting_hand_range: 35,
    positional_tightness: 30,
    open_raise_size: 75,
    three_bet_frequency: 65,
    cbet_frequency: 75,
    bluff_frequency: 60,
    bluff_detection: 40,
    bet_sizing: 70,
    hand_strength_threshold: 25,
    stack_depth_adjustment: true,
  },
  rock: {
    starting_hand_range: 12,
    positional_tightness: 85,
    open_raise_size: 40,
    three_bet_frequency: 15,
    cbet_frequency: 40,
    bluff_frequency: 10,
    bluff_detection: 70,
    bet_sizing: 35,
    hand_strength_threshold: 70,
    stack_depth_adjustment: true,
  },
  maniac: {
    starting_hand_range: 65,
    positional_tightness: 10,
    open_raise_size: 90,
    three_bet_frequency: 80,
    cbet_frequency: 85,
    bluff_frequency: 80,
    bluff_detection: 20,
    bet_sizing: 90,
    hand_strength_threshold: 10,
    stack_depth_adjustment: false,
  },
  trappy: {
    starting_hand_range: 18,
    positional_tightness: 50,
    open_raise_size: 30,
    three_bet_frequency: 20,
    cbet_frequency: 30,
    bluff_frequency: 25,
    bluff_detection: 60,
    bet_sizing: 25,
    hand_strength_threshold: 55,
    stack_depth_adjustment: true,
  },
};

const DEFAULTS = PRESETS.gto;

/**
 * Merge preset → defaults → user overrides and compile a Claude system prompt.
 * @param {object} config  Parsed config.json
 * @returns {string} System prompt for Claude
 */
export function buildSystemPrompt(config = {}) {
  const preset = config.persona && PRESETS[config.persona] ? PRESETS[config.persona] : DEFAULTS;
  const cfg = { ...DEFAULTS, ...preset, ...config };

  // Translate numeric sliders to natural-language descriptions
  const label = (v) =>
    v <= 20 ? 'very low' : v <= 40 ? 'low' : v <= 60 ? 'moderate' : v <= 80 ? 'high' : 'very high';

  const lines = [
    'You are an autonomous Texas Hold\'em poker agent playing real-money USDC games.',
    'You will receive the current game state as JSON and must respond with a single JSON action.',
    '',
    `## Playing Style: ${(config.persona || 'gto').toUpperCase()}`,
    '',
    '### Pre-flop tendencies',
    `- Starting hand range: ${label(cfg.starting_hand_range)} (play ~${cfg.starting_hand_range}% of hands)`,
    `- Positional tightness: ${label(cfg.positional_tightness)} (adjust range significantly based on position)`,
    `- Open-raise sizing: ${label(cfg.open_raise_size)} (prefer ${cfg.open_raise_size <= 40 ? 'min-raises' : cfg.open_raise_size <= 65 ? 'standard 3x raises' : 'large or pot-sized opens'})`,
    `- 3-bet frequency: ${label(cfg.three_bet_frequency)}`,
    '',
    '### Post-flop tendencies',
    `- Continuation bet frequency: ${label(cfg.cbet_frequency)}`,
    `- Bluff frequency: ${label(cfg.bluff_frequency)}`,
    `- Bluff detection (calling down): ${label(cfg.bluff_detection)}`,
    `- Bet sizing preference: ${label(cfg.bet_sizing)} (${cfg.bet_sizing <= 35 ? 'small bets to induce mistakes' : cfg.bet_sizing <= 65 ? 'balanced sizing' : 'large bets and overbets'})`,
    `- Minimum hand strength to continue on dangerous boards: ${label(cfg.hand_strength_threshold)}`,
    '',
    '### Dynamic adjustments',
    cfg.stack_depth_adjustment
      ? '- Stack depth adjustment: ON — tighten significantly when effective SPR < 4 (commit-or-fold territory); loosen with deep stacks.'
      : '- Stack depth adjustment: OFF — play your range regardless of effective stack depth.',
    '',
    '## Decision Instructions',
    'You will be given a JSON object with:',
    '  - holeCards: your 2 private cards',
    '  - community: community cards so far',
    '  - stage: preflop/flop/turn/river',
    '  - pot: current pot size in chips',
    '  - toCall: chips required to call (0 means free check)',
    '  - myChips: your remaining stack',
    '  - players: array of opponents with chips, lastAction, allIn status',
    '  - position: your seat position and dealer/blind roles',
    '  - validActions: array of valid moves (fold/check/call/raise)',
    '',
    'Evaluate hand strength honestly. Consider:',
    '1. Absolute hand strength (made hand rank)',
    '2. Relative strength (board texture, opponent ranges)',
    '3. Pot odds and implied odds for draws',
    '4. Stack-to-pot ratio for commitment decisions',
    '5. Position and information advantage',
    '',
    'Respond ONLY with a JSON object:',
    '  { "action": "fold"|"check"|"call"|"raise", "amount": <number if raise, else omit>, "reasoning": "<brief>" }',
    '',
    'Do not include any text outside the JSON object.',
  ];

  if (cfg.custom_instructions) {
    lines.push('', '## Custom Instructions', cfg.custom_instructions);
  }

  return lines.join('\n');
}

export { PRESETS };
