import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';

/**
 * Generate a new random wallet and save it as an EIP-55 keystore JSON.
 * @param {string} password  Encryption password
 * @param {string} outPath   Where to write the keystore file
 * @returns {string} The wallet address
 */
export async function generateWallet(password, outPath) {
  const wallet = ethers.Wallet.createRandom();
  const keystore = await wallet.encrypt(password);
  writeFileSync(outPath, keystore, 'utf8');
  console.log(`Wallet created: ${wallet.address}`);
  console.log(`Keystore saved to: ${outPath}`);
  return wallet.address;
}

/**
 * Decrypt a keystore file and return an ethers Wallet.
 * The decrypted key is held only in memory for the process lifetime.
 * @param {string} keystorePath  Path to the keystore JSON file
 * @param {string} password      Decryption password
 * @returns {Promise<ethers.Wallet>}
 */
export async function loadWallet(keystorePath, password) {
  const json = readFileSync(keystorePath, 'utf8');
  const wallet = await ethers.Wallet.fromEncryptedJson(json, password);
  return wallet;
}

/**
 * Sign an arbitrary message (EIP-191) with the given wallet.
 * Used for the server auth challenge.
 */
export async function signMessage(wallet, message) {
  return wallet.signMessage(message);
}
