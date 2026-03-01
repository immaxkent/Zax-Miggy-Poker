import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { SERVER_URL, SERVER_API_KEY } from '../utils/web3Config';

const API_HEADERS = {
  'Content-Type':  'application/json',
  'X-Poker-Key':   SERVER_API_KEY,
};

async function apiPost(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method:  'POST',
    headers: API_HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync }     = useSignMessage();

  const [token,    setToken]    = useState(() => localStorage.getItem('poker_jwt'));
  const [authed,   setAuthed]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [authError, setAuthError] = useState(null);

  // Validate stored token on mount / address change
  useEffect(() => {
    if (!token || !address) { setAuthed(false); return; }
    // Simple decode to check sub matches current address
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expired = payload.exp && payload.exp * 1000 < Date.now();
      const matches = payload.sub?.toLowerCase() === address.toLowerCase();
      if (expired || !matches) {
        localStorage.removeItem('poker_jwt');
        setToken(null);
        setAuthed(false);
      } else {
        setAuthed(true);
      }
    } catch {
      setAuthed(false);
    }
  }, [token, address]);

  // Clear auth when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      setAuthed(false);
      setToken(null);
      localStorage.removeItem('poker_jwt');
    }
  }, [isConnected]);

  async function login() {
    if (!address) throw new Error('Connect wallet first');
    setLoading(true);
    setAuthError(null);
    try {
      // Step 1: Get nonce challenge
      const { nonce, message } = await apiPost('/auth/challenge', { address });

      // Step 2: Sign with wallet (EIP-191)
      const signature = await signMessageAsync({ message });

      // Step 3: Verify signature, get JWT
      const { token: jwt } = await apiPost('/auth/verify', { address, signature });

      localStorage.setItem('poker_jwt', jwt);
      setToken(jwt);
      setAuthed(true);
      return jwt;
    } catch (err) {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
      const message = err.message === 'Failed to fetch'
        ? "Can't reach the game server. Start it in another terminal: npm run start:server (or cd server && npm start). Server URL: " + serverUrl
        : err.message;
      setAuthError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('poker_jwt');
    setToken(null);
    setAuthed(false);
  }

  return { token, authed, loading, authError, login, logout, address };
}
