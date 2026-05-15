// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgenticRankings.sol";

/**
 * Deploy AgenticRankings on Base mainnet.
 *
 * Prerequisites:
 *   - ZaxAndMiggyVault must already be deployed
 *   - contracts/.env must have ZAX_MIGGY_VAULT_ADDRESS, SIGNER_ADDRESS, FEE_RECIPIENT
 *
 * Usage:
 *   cd contracts
 *   forge script script/DeployAgenticRankings.s.sol:DeployAgenticRankings \
 *     --rpc-url $BASE_RPC_URL --broadcast --account deployer
 */
contract DeployAgenticRankings is Script {
    function run() external {
        address vaultAddress   = vm.envAddress("ZAX_MIGGY_VAULT_ADDRESS");
        address signerAddress  = vm.envAddress("SIGNER_ADDRESS");
        address feeRecipient   = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast();

        AgenticRankings rankings = new AgenticRankings(
            vaultAddress,
            signerAddress,
            feeRecipient  // owner — can update serverSigner if key is rotated
        );

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("BASE MAINNET - AgenticRankings");
        console.log("Vault:  ", vaultAddress);
        console.log("Signer: ", signerAddress);
        console.log("Owner:  ", feeRecipient);
        console.log("===========================================");
        console.log("AGENTIC_RANKINGS_ADDRESS=", address(rankings));
        console.log("===========================================");
        console.log("Add to server/.env:");
        console.log("  AGENTIC_RANKINGS_ADDRESS=%s", address(rankings));
        console.log("Add to client/.env:");
        console.log("  VITE_AGENTIC_RANKINGS_ADDRESS=%s", address(rankings));
        console.log("===========================================");
    }
}
