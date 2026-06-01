#!/usr/bin/env node
/**
 * Print addresses for local cast keystores (prompts for password unless FOUNDRY_PASSWORD is set).
 *
 * Usage:
 *   npm run cast:address
 *   npm run cast:address -- deployMeta deployer
 */

const { spawnSync } = require('child_process');

const accounts = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['deployMeta', 'deployer', 'deployKey'];

function addressForAccount(name) {
  const extra = process.env.FOUNDRY_PASSWORD
    ? ['--password', process.env.FOUNDRY_PASSWORD]
    : [];

  const r = spawnSync(
    'cast',
    ['wallet', 'address', '--account', name, ...extra],
    { encoding: 'utf8', env: process.env },
  );

  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.status !== 0) {
    return { name, error: err || out || `exit ${r.status}` };
  }
  return { name, address: out };
}

console.log('Local cast keystores:\n');
for (const name of accounts) {
  const row = addressForAccount(name);
  if (row.address) {
    console.log(`  ${row.name.padEnd(12)} ${row.address}`);
  } else {
    console.log(`  ${row.name.padEnd(12)} (failed)`);
    console.log(`    ${row.error.split('\n')[0]}`);
    if (row.error.includes('Mac Mismatch')) {
      console.log('    → Re-import on this Mac: cast wallet import ' + name + ' --private-key 0x...');
    } else if (row.error.includes('Device not configured')) {
      console.log('    → Run in your terminal (needs password prompt), or set FOUNDRY_PASSWORD');
    }
  }
}
console.log('\nSet DEPLOY_ACCOUNT in contracts/.env to the account you deploy with.');
