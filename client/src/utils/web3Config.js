import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia } from 'wagmi/chains';
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

const chain = CHAIN_ID === 8453  ? base
            : CHAIN_ID === 84532 ? baseSepolia
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

export const SERVER_URL     = import.meta.env.VITE_SERVER_URL    || 'http://localhost:3001';
export const SERVER_API_KEY = import.meta.env.VITE_SERVER_API_KEY || '';
