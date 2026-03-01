/**
 * Load env vars from AWS Secrets Manager and merge into process.env.
 * Used when running on EC2/ECS so you don't store secrets in .env.
 *
 * Set AWS_SECRET_NAME (e.g. cryptopoker/server) and optionally AWS_REGION.
 * Secret value must be a JSON object with keys like:
 *   SIGNER_PRIVATE_KEY, SEPOLIA_RPC_URL, MAINNET_RPC_URL (or BASE_RPC_URL),
 *   JWT_SECRET, HMAC_SECRET, SERVER_API_KEY, etc.
 *
 * You can add SEPOLIA_RPC_URL and use the same signer key you already have
 * in that secret; the server uses CHAIN_ID to pick which RPC (Sepolia vs mainnet).
 */

export async function loadAwsSecrets() {
  const secretName = process.env.AWS_SECRET_NAME;
  if (!secretName) return { loaded: false };

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    console.warn('⚠️  AWS_SECRET_NAME set but AWS_REGION not set — skipping AWS secrets');
    return { loaded: false };
  }

  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    const raw = response.SecretString;
    if (!raw) {
      console.warn('⚠️  AWS secret is empty');
      return { loaded: false };
    }
    const parsed = JSON.parse(raw);
    let count = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (value != null && process.env[key] === undefined) {
        process.env[key] = String(value).trim();
        count++;
      }
    }
    console.log(`✅ Loaded ${count} env var(s) from AWS Secrets Manager (${secretName})`);
    return { loaded: true, count };
  } catch (err) {
    console.error('Failed to load AWS secrets:', err.message);
    throw err;
  }
}
