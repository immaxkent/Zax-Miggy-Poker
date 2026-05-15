/**
 * One-time wallet generator.
 * Run: node scripts/generate-wallet.js
 *
 * Prompts for a password (or reads WALLET_PASSWORD env var) and writes
 * an EIP-55 encrypted keystore to ./wallet.json.
 */
import { generateWallet } from '../src/wallet.js';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dir, '..', 'wallet.json');

async function run() {
  const password = process.env.WALLET_PASSWORD || await prompt('Enter a password for your keystore: ');
  if (!password) {
    console.error('Password is required.');
    process.exit(1);
  }
  await generateWallet(password, outPath);
  console.log('\nKeep wallet.json and your password safe.');
  console.log('Upload wallet.json (your keystore) to the bot activation page on Zax & Miggy Poker.');
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

run();
