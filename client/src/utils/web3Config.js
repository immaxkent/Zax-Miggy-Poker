import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia, sepolia } from 'wagmi/chains';
import { defineChain } from 'viem';

// Local anvil — use VITE_ANVIL_RPC_URL if you run this project's anvil on a different port (e.g. 8546 when another app uses 8545)
const ANVIL_RPC = import.meta.env.VITE_ANVIL_RPC_URL || 'http://127.0.0.1:8545';
const anvil = defineChain({
  id:   31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
});
export const ANVIL_RPC_URL = ANVIL_RPC;

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);

// 31337=Anvil, 11155111=Ethereum Sepolia, 84532=Base Sepolia, 8453=Base mainnet
// Use VITE_SEPOLIA_RPC_URL (e.g. from .env / Vercel) when on Ethereum Sepolia for custom RPC (Infura, Alchemy, etc.)
const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC_URL;
const sepoliaChain = CHAIN_ID === 11155111 && SEPOLIA_RPC
  ? { ...sepolia, rpcUrls: { default: { http: [SEPOLIA_RPC] } } }
  : sepolia;

const chain = CHAIN_ID === 8453    ? base
            : CHAIN_ID === 84532  ? baseSepolia
            : CHAIN_ID === 11155111 ? sepoliaChain
            : anvil;

export const wagmiConfig = getDefaultConfig({
  appName:   'CryptoPoker',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo',
  chains:    [chain],
  ssr:       false,
});

export const TOKEN_ADDRESS  = import.meta.env.VITE_TOKEN_ADDRESS;
export const VAULT_ADDRESS  = import.meta.env.VITE_VAULT_ADDRESS;
export const TOKEN_DECIMALS = Number(import.meta.env.VITE_TOKEN_DECIMALS || 18);
export const TOKEN_SYMBOL   = import.meta.env.VITE_TOKEN_SYMBOL || 'CHIP';

// USDC (Base mainnet canonical; set VITE_USDC_ADDRESS for local/test mock)
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS || (CHAIN_ID === 8453 ? BASE_USDC : null);
export const USDC_DECIMALS = 6;
export const ZAX_MIGGY_VAULT_ADDRESS = import.meta.env.VITE_ZAX_MIGGY_VAULT_ADDRESS || null;
export const isBaseWithUsdc = () => CHAIN_ID === 8453 && !!USDC_ADDRESS && !!ZAX_MIGGY_VAULT_ADDRESS;

export const VAULT_ABI = [
  { name: 'deposit',  type: 'function', inputs: [{ name: 'grossAmount', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', inputs: [
    { name: 'grossAmount', type: 'uint256' },
    { name: 'nonce',       type: 'uint256' },
    { name: 'sig',         type: 'bytes'   },
  ], outputs: [] },
  { name: 'token',    type: 'function', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'buyInFeeBps',  type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'winnerFeeBps', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
];

export const ERC20_ABI = [
  { name: 'approve',   type: 'function', inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount',  type: 'uint256' },
  ], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [
    { name: 'owner',   type: 'address' },
    { name: 'spender', type: 'address' },
  ], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals',  type: 'function', inputs: [], outputs: [{ type: 'uint8' }] },
];

export const ZAX_MIGGY_VAULT_ABI = [
  { name: 'createGame', type: 'function', inputs: [{ name: 'depositAmount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'joinGame',   type: 'function', inputs: [{ name: 'gameId', type: 'uint256' }], outputs: [] },
  { name: 'getGame',    type: 'function', inputs: [{ name: 'gameId', type: 'uint256' }], outputs: [
    { name: 'players', type: 'address[8]' },
    { name: 'playerCount', type: 'uint8' },
    { name: 'depositAmount', type: 'uint256' },
    { name: 'createdAt', type: 'uint256' },
    { name: 'finished', type: 'bool' },
    { name: 'winner', type: 'address' },
  ] },
  { name: 'nextGameId', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'closeGame', type: 'function', inputs: [
    { name: 'gameId', type: 'uint256' },
    { name: 'winner', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'sig', type: 'bytes' },
  ], outputs: [] },
  { name: 'cancelGame', type: 'function', inputs: [
    { name: 'gameId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'sig', type: 'bytes' },
  ], outputs: [] },
  { name: 'buildCloseHash', type: 'function', inputs: [
    { name: 'gameId', type: 'uint256' },
    { name: 'winner', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ], outputs: [{ type: 'bytes32' }] },
  { name: 'buildCancelHash', type: 'function', inputs: [
    { name: 'gameId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ], outputs: [{ type: 'bytes32' }] },
];

export const SERVER_URL     = import.meta.env.VITE_SERVER_URL    || 'http://localhost:3001';
export const SERVER_API_KEY = import.meta.env.VITE_SERVER_API_KEY || '';
// Socket.IO needs a URL that supports WebSocket (Vercel proxy does not). Use VITE_SOCKET_URL (e.g. ngrok) when needed.
export const SOCKET_URL     = import.meta.env.VITE_SOCKET_URL    || SERVER_URL;
