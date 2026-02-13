// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PokerVault.sol";

/**
 * Deploy script for PokerVault.
 *
 * LOCAL (anvil):
 *   forge script script/Deploy.s.sol --rpc-url anvil --broadcast \
 *     --sender $DEPLOYER_ADDRESS --account $KEYSTORE_ACCOUNT
 *
 * BASE SEPOLIA:
 *   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify \
 *     --sender $DEPLOYER_ADDRESS --account $KEYSTORE_ACCOUNT
 *
 * BASE MAINNET:
 *   forge script script/Deploy.s.sol --rpc-url base --broadcast --verify \
 *     --sender $DEPLOYER_ADDRESS --account $KEYSTORE_ACCOUNT
 */
contract Deploy is Script {
    function run() external {
        // Loaded from .env
        address tokenAddress    = vm.envAddress("TOKEN_ADDRESS");
        address signerAddress   = vm.envAddress("SIGNER_ADDRESS");
        address feeRecipient    = vm.envAddress("FEE_RECIPIENT");

        // Uses encrypted keystore — cast prompts for password, no plaintext key needed
        vm.startBroadcast();

        PokerVault vault = new PokerVault(
            tokenAddress,
            signerAddress,
            feeRecipient
        );

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("PokerVault deployed at:", address(vault));
        console.log("Token:        ", tokenAddress);
        console.log("Signer:       ", signerAddress);
        console.log("FeeRecipient: ", feeRecipient);
        console.log("===========================================");
        console.log("Next: set VAULT_ADDRESS=%s in server/.env and client/.env", address(vault));
    }
}
