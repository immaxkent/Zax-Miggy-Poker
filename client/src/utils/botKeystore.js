import JSZip from 'jszip';
import { ethers } from 'ethers';

/** @returns {import('jszip').JSZipObject | null} */
export function findZipEntry(zip, filename) {
  const direct = zip.file(filename);
  if (direct) return direct;

  const base = filename.toLowerCase();
  const path = Object.keys(zip.files).find((p) => {
    if (zip.files[p].dir) return false;
    const leaf = p.split('/').pop()?.toLowerCase();
    return leaf === base;
  });
  return path ? zip.file(path) : null;
}

/**
 * Validate Web3 secret storage JSON (ethers v5 `crypto` or v6 `Crypto`).
 * @returns {{ keystoreJson: string, address: string }}
 */
export function parseKeystoreJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Keystore is not valid JSON');
  }

  const hasSecret = parsed.crypto || parsed.Crypto;
  const version = parsed.version ?? parsed.Version;
  if (!hasSecret || version == null) {
    throw new Error('Not a valid Ethereum keystore (Web3 secret storage / EIP-2335)');
  }

  let rawAddress = parsed.address;
  if (!rawAddress) {
    throw new Error('Keystore is missing the address field');
  }
  const address = ethers.getAddress(
    rawAddress.startsWith('0x') ? rawAddress : `0x${rawAddress}`,
  );

  return { keystoreJson: text, address };
}

/**
 * @returns {Promise<{ keystoreJson: string, address: string, config: object, sourceName: string }>}
 */
export async function parseBotZipFile(file) {
  const zip = await JSZip.loadAsync(file);

  const ksFile = findZipEntry(zip, 'keystore.json');
  if (!ksFile) throw new Error('ZIP is missing keystore.json');

  const keystoreJson = await ksFile.async('string');
  const { address, keystoreJson: normalizedJson } = parseKeystoreJson(keystoreJson);

  let config = {};
  const cfgFile = findZipEntry(zip, 'config.json');
  if (cfgFile) {
    try {
      config = JSON.parse(await cfgFile.async('string'));
    } catch {
      throw new Error('config.json is not valid JSON');
    }
  }

  return {
    keystoreJson: normalizedJson,
    address,
    config,
    sourceName: file.name,
  };
}

export async function verifyKeystorePassword(keystoreJson, password) {
  await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
}
