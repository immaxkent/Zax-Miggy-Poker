import fetch from 'node-fetch';
import { signMessage } from './wallet.js';

/**
 * Complete the EIP-191 auth handshake and return a JWT.
 * Flow: POST /auth/challenge → sign nonce → POST /auth/verify → JWT
 *
 * @param {string}        serverUrl  Base URL of the poker server
 * @param {string}        apiKey     Server API key
 * @param {ethers.Wallet} wallet     Unlocked wallet for signing
 * @returns {Promise<string>} JWT token
 */
export async function authenticate(serverUrl, apiKey, wallet) {
  const address = wallet.address;

  const challengeRes = await fetch(`${serverUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-poker-key': apiKey },
    body: JSON.stringify({ address }),
  });
  if (!challengeRes.ok) throw new Error(`Challenge failed: ${challengeRes.status}`);
  const { message } = await challengeRes.json();

  const signature = await signMessage(wallet, message);

  const verifyRes = await fetch(`${serverUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-poker-key': apiKey },
    body: JSON.stringify({ address, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();
  return token;
}
