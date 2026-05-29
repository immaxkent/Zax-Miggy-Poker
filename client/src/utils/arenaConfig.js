/**
 * Agentic Arena — client constants, ABIs, env (non-gambling training mode).
 */

export const ARENA_ADDRESS = import.meta.env.VITE_ARENA_ADDRESS || null;
export const BOT_FACTORY_ADDRESS = import.meta.env.VITE_BOT_FACTORY_ADDRESS || null;
export const AGENTIC_RANKINGS_V2_ADDRESS =
  import.meta.env.VITE_AGENTIC_RANKINGS_V2_ADDRESS || null;
export const AGENTIC_CHIPS_1155_ADDRESS =
  import.meta.env.VITE_AGENTIC_CHIPS_1155_ADDRESS || null;

export const isArenaConfigured = () => !!ARENA_ADDRESS;

/** USDC 6 decimals */
export const BOT_CREATE_FEE_RAW = 3_000_000n;
export const TIER_FEES_RAW = {
  0: 10_000n,
  1: 50_000n,
  2: 90_000n,
};

export const ARENA_TIERS = [
  {
    id: 0,
    key: 'unranked',
    name: 'Unranked',
    feeLabel: '$0.01',
    feeRaw: TIER_FEES_RAW[0],
    color: '#64748b',
    desc: 'Open practice — any bot',
  },
  {
    id: 1,
    key: 'ranked',
    name: 'Ranked',
    feeLabel: '$0.05',
    feeRaw: TIER_FEES_RAW[1],
    color: '#00b4d8',
    desc: 'Registered bots — affects rank',
  },
  {
    id: 2,
    key: 'elite',
    name: 'Elite',
    feeLabel: '$0.09',
    feeRaw: TIER_FEES_RAW[2],
    color: '#f59e0b',
    desc: 'Top 100 bots only',
  },
];

export const ARENA_ABI = [
  {
    name: 'createBot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'metadataURI', type: 'string' },
        { name: 'configURI', type: 'string' },
      ],
    }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'createGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tier', type: 'uint8' },
          { name: 'settingsHash', type: 'bytes32' },
          { name: 'maxPlayers', type: 'uint16' },
        ],
      },
      { name: 'bot', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'joinGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'bot', type: 'address' },
    ],
    outputs: [],
  },
  { name: 'gameCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'botCreationFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'tierFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'BotCreated',
    type: 'event',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'bot', type: 'address', indexed: true },
      { name: 'feePaid', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'GameCreated',
    type: 'event',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'creatorBot', type: 'address', indexed: true },
      { name: 'tier', type: 'uint8', indexed: true },
      { name: 'settingsHash', type: 'bytes32', indexed: false },
    ],
  },
];

export const RANKINGS_V2_ABI = [
  {
    name: 'isEliteEligible',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isRegistered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'profileOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'gamesPlayed', type: 'uint256' },
        { name: 'gamesWon', type: 'uint256' },
        { name: 'handsWon', type: 'uint256' },
        { name: 'chipsNet', type: 'int256' },
        { name: 'rankedGames', type: 'uint256' },
        { name: 'eliteGames', type: 'uint256' },
        { name: 'rankedWins', type: 'uint256' },
        { name: 'eliteWins', type: 'uint256' },
        { name: 'opponentStrengthBeaten', type: 'uint256' },
        { name: 'assassinScore', type: 'uint256' },
        { name: 'sociopathScore', type: 'uint256' },
        { name: 'consistencyScore', type: 'uint256' },
        { name: 'recencyScore', type: 'uint256' },
        { name: 'compositeScore', type: 'uint256' },
      ],
    }],
  },
  { name: 'rankOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'bot', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

export function tierKeyToId(tier) {
  if (tier === 'ranked' || tier === 1) return 1;
  if (tier === 'elite' || tier === 2) return 2;
  return 0;
}

export function tierIdToKey(id) {
  return ARENA_TIERS[id]?.key ?? 'unranked';
}

/** Empty settings hash when no custom table config */
export const ZERO_SETTINGS_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
