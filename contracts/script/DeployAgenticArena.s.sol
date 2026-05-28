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
 *   SETTLEMENT_SIGNER     — server signer for settleGame
 *
 * Usage:
 *   cd contracts
 *   forge script script/DeployAgenticArena.s.sol:DeployAgenticArena \
 *     --rpc-url $BASE_RPC_URL --broadcast --account deployer
 */
contract DeployAgenticArena is Script {
    function run() external {
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("FEE_RECIPIENT");
        address settlementSigner = vm.envAddress("SETTLEMENT_SIGNER");

        vm.startBroadcast();

        AgenticRankingsV2 rankings = new AgenticRankingsV2(address(0));
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

        console.log("AGENTIC_RANKINGS_V2_ADDRESS=", address(rankings));
        console.log("AGENTIC_CHIPS_1155_ADDRESS=", address(chips));
        console.log("BOT_FACTORY_ADDRESS=", address(factory));
        console.log("ARENA_ADDRESS=", address(arena));
    }
}
