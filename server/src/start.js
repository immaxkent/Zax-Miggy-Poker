/**
 * Entrypoint that optionally loads secrets from AWS, then starts the server.
 *
 * - Local / .env only:  node src/server.js  (or npm start → node src/server.js)
 * - EC2 with AWS Secrets: set AWS_SECRET_NAME (and AWS_REGION), then
 *   node src/start.js   (or npm run start:aws)
 *
 * If AWS_SECRET_NAME is set, we fetch the secret (JSON), merge into process.env,
 * then import server.js. Otherwise we just load .env and start the server.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env first (server/.env and repo root) — AWS secrets will override
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const useAws = !!process.env.AWS_SECRET_NAME;

async function main() {
  if (useAws) {
    const { loadAwsSecrets } = await import('./load-aws-secrets.js');
    await loadAwsSecrets();
  }
  await import('./server.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
