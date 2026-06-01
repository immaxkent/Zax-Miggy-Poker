// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Arena.sol";
import "../src/BotFactory.sol";
import "../src/AgenticChips1155.sol";
import "../src/AgenticRankingsV2.sol";

/**
 * Deploy Agentic Arena stack (RankingsV2, Chips1155, BotFactory, Arena).
 *
 * Env:
 *   USDC_ADDRESS          — USDC on target chain
 *   FEE_RECIPIENT         — treasury / fee recipient
 *   SETTLEMENT_SIGNER     — server signer for settleGame (same as server SIGNER_PRIVATE_KEY address)
 *
 * Preferred: npm run deploy:arena:base-sepolia  (see docs/DEPLOY_AGENTIC_ARENA.md)
 *
 * Manual:
 *   cd contracts
 *   forge script script/DeployAgenticArena.s.sol:DeployAgenticArena \
 *     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --account deployMeta --chain-id 84532
 */
contract DeployAgenticArena is Script {
    function run() external {
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("FEE_RECIPIENT");
        address settlementSigner = vm.envAddress("SETTLEMENT_SIGNER");

        console.log("CHAIN_ID=", block.chainid);
        console.log("USDC_ADDRESS=", usdcAddress);
        console.log("FEE_RECIPIENT=", treasury);
        console.log("SETTLEMENT_SIGNER=", settlementSigner);

        vm.startBroadcast();

        // Temporary updater (deployer); Arena becomes updater after deploy.
        AgenticRankingsV2 rankings = new AgenticRankingsV2(msg.sender);
        AgenticChips1155 chips = new AgenticChips1155("https://agentic.zaxandmiggy/chips/{id}.json");
        BotFactory factory = new BotFactory(address(0));

        Arena arena = new Arena(
            usdcAddress,
            treasury,
            address(factory),
            address(rankings),
            address(chips),
            settlementSigner
        );

        factory.setArena(address(arena));
        chips.setArena(address(arena));
        rankings.setUpdater(address(arena));

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("AGENTIC_RANKINGS_V2_ADDRESS=", address(rankings));
        console.log("AGENTIC_CHIPS_1155_ADDRESS=", address(chips));
        console.log("BOT_FACTORY_ADDRESS=", address(factory));
        console.log("ARENA_ADDRESS=", address(arena));
        console.log("===========================================");
        console.log("Next: node scripts/wire-agentic-env.js <base-sepolia|base> <version>");
    }
}
