import { ethers } from 'ethers';

const VAULT_ABI = [
  'event GameCreated(uint256 indexed gameId, address indexed creator, uint256 depositAmount)',
  'function getGame(uint256 gameId) external view returns (address[8] memory players, uint8 playerCount, uint256 depositAmount, uint256 createdAt, bool finished, address winner)',
  'function joinGame(uint256 gameId) external',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

/**
 * Find joinable games on-chain within the agent's price range.
 * Scans recent GameCreated events and filters by deposit amount + game state.
 *
 * @param {object} params
 * @param {string} params.rpcUrl
 * @param {string} params.vaultAddress
 * @param {string} params.agentAddress     Bot's wallet address
 * @param {number} params.priceRangeMin    Minimum deposit in USDC (whole units)
 * @param {number} params.priceRangeMax    Maximum deposit in USDC (0 = no limit)
 * @param {number} [params.blockLookback]  How many blocks to scan (default 50000 ~1 day on Base)
 * @returns {Promise<Array<{gameId: bigint, depositAmount: bigint, playerCount: number}>>}
 */
export async function findJoinableGames({
  rpcUrl,
  vaultAddress,
  agentAddress,
  priceRangeMin = 0,
  priceRangeMax = 0,
  blockLookback = 50000,
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - blockLookback);

  const events = await vault.queryFilter(vault.filters.GameCreated(), fromBlock, latestBlock);

  const minWei = BigInt(Math.round(priceRangeMin * 1e6));
  const maxWei = priceRangeMax > 0 ? BigInt(Math.round(priceRangeMax * 1e6)) : null;

  const joinable = [];
  for (const ev of events) {
    const gameId = ev.args.gameId;
    const depositAmount = ev.args.depositAmount;

    if (depositAmount < minWei) continue;
    if (maxWei && depositAmount > maxWei) continue;

    try {
      const game = await vault.getGame(gameId);
      if (game.finished) continue;
      if (game.playerCount >= 8) continue;
      // Don't join a game we're already in
      const alreadyIn = game.players.some(p => p.toLowerCase() === agentAddress.toLowerCase());
      if (alreadyIn) continue;

      joinable.push({ gameId, depositAmount, playerCount: Number(game.playerCount) });
    } catch {
      // Game may not exist yet; skip
    }
  }

  return joinable;
}

/**
 * Approve USDC and call joinGame on-chain.
 *
 * @param {ethers.Wallet} wallet
 * @param {string}        vaultAddress
 * @param {string}        usdcAddress
 * @param {bigint}        gameId
 * @param {bigint}        depositAmount   Exact deposit in USDC wei (6 decimals)
 * @returns {Promise<string>} Transaction hash of joinGame
 */
export async function joinGameOnChain(wallet, vaultAddress, usdcAddress, gameId, depositAmount) {
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, wallet);

  // Check and set allowance
  const allowance = await usdc.allowance(wallet.address, vaultAddress);
  if (allowance < depositAmount) {
    console.log(`[onchain] Approving ${depositAmount} USDC for vault...`);
    const approveTx = await usdc.approve(vaultAddress, depositAmount);
    await approveTx.wait();
    console.log(`[onchain] Approval confirmed: ${approveTx.hash}`);
  }

  console.log(`[onchain] Joining game ${gameId} with deposit ${depositAmount}...`);
  const joinTx = await vault.joinGame(gameId);
  const receipt = await joinTx.wait();
  console.log(`[onchain] Joined game ${gameId}: ${receipt.hash}`);
  return receipt.hash;
}

/**
 * Return the agent's USDC balance in whole units.
 */
export async function getUsdcBalance(rpcUrl, usdcAddress, agentAddress) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);
  const raw = await usdc.balanceOf(agentAddress);
  return Number(raw) / 1e6;
}
