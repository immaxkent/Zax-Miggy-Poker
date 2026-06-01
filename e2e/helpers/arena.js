/**
 * arena.js — Deploy Agentic Arena stack on a local anvil instance.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'contracts', 'out');

function loadArtifact(solFile, contractName) {
  const p = path.join(ARTIFACTS, solFile, `${contractName}.json`);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/**
 * @param {object} ctx — from startAnvil(): deployer, serverSignerWallet, provider
 */
export async function deployArenaStack(ctx) {
  const { deployer, serverSignerWallet, provider } = ctx;
  const treasury = await deployer.getAddress();

  const rankingsArt = loadArtifact('AgenticRankingsV2.sol', 'AgenticRankingsV2');
  const RankingsFactory = new ethers.ContractFactory(rankingsArt.abi, rankingsArt.bytecode, deployer);
  const rankings = await RankingsFactory.deploy(await deployer.getAddress());
  await rankings.waitForDeployment();

  const chipsArt = loadArtifact('AgenticChips1155.sol', 'AgenticChips1155');
  const ChipsFactory = new ethers.ContractFactory(chipsArt.abi, chipsArt.bytecode, deployer);
  const chips = await ChipsFactory.deploy('https://e2e/agentic/chips/{id}.json');
  await chips.waitForDeployment();

  const factoryArt = loadArtifact('BotFactory.sol', 'BotFactory');
  const BotFactoryFactory = new ethers.ContractFactory(factoryArt.abi, factoryArt.bytecode, deployer);
  const factory = await BotFactoryFactory.deploy(ethers.ZeroAddress);
  await factory.waitForDeployment();

  const usdcAddr = await ctx.usdc.getAddress();
  const arenaArt = loadArtifact('Arena.sol', 'Arena');
  const ArenaFactory = new ethers.ContractFactory(arenaArt.abi, arenaArt.bytecode, deployer);
  const arena = await ArenaFactory.deploy(
    usdcAddr,
    treasury,
    await factory.getAddress(),
    await rankings.getAddress(),
    await chips.getAddress(),
    serverSignerWallet.address,
  );
  await arena.waitForDeployment();

  await (await factory.setArena(await arena.getAddress())).wait();
  await (await chips.setArena(await arena.getAddress())).wait();
  await (await rankings.setUpdater(await arena.getAddress())).wait();

  return { arena, factory, chips, rankings, treasury };
}

export async function arenaCreateBot(wallet, arena, usdc, metadata = 'ipfs://e2e/bot') {
  const arenaAddr = await arena.getAddress();
  const fee = await arena.botCreationFee();
  await (await usdc.connect(wallet).approve(arenaAddr, fee)).wait();
  const tx = await arena.connect(wallet).createBot({
    metadataURI: metadata,
    configURI: `${metadata}/cfg`,
  });
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const parsed = arena.interface.parseLog(log);
      if (parsed?.name === 'BotCreated') return parsed.args.bot;
    } catch { /* skip */ }
  }
  throw new Error('BotCreated event not found');
}

export async function arenaCreateGame(wallet, arena, usdc, bot, tier = 0) {
  const arenaAddr = await arena.getAddress();
  const fee = await arena.tierFee(tier);
  await (await usdc.connect(wallet).approve(arenaAddr, fee)).wait();
  const tx = await arena.connect(wallet).createGame(
    { tier, settingsHash: ethers.keccak256(ethers.toUtf8Bytes('e2e')), maxPlayers: 8 },
    bot,
  );
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const parsed = arena.interface.parseLog(log);
      if (parsed?.name === 'GameCreated') return parsed.args.gameId;
    } catch { /* skip */ }
  }
  throw new Error('GameCreated event not found');
}

export async function arenaJoinGame(wallet, arena, usdc, gameId, bot, tier = 0) {
  const arenaAddr = await arena.getAddress();
  const fee = await arena.tierFee(tier);
  await (await usdc.connect(wallet).approve(arenaAddr, fee)).wait();
  await (await arena.connect(wallet).joinGame(gameId, bot)).wait();
}
