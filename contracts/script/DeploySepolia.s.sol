// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockToken.sol";
import "../src/ChipToken.sol";
import "../src/PokerVault.sol";

/**
 * Deploy MockToken, ChipToken + PokerVault to Ethereum Sepolia.
 * Set in contracts/.env: SIGNER_ADDRESS (server signer), FEE_RECIPIENT.
 *
 *   cd contracts
 *   forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url $SEPOLIA_RPC_URL --broadcast --account deployer
 *
 * Or use: node scripts/deploy-and-save.js sepolia
 */
contract DeploySepolia is Script {
    function run() external {
        address signerAddress = vm.envAddress("SIGNER_ADDRESS");
        address feeRecipient  = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast();

        MockToken token = new MockToken();
        ChipToken chipToken = new ChipToken(
            "https://api.game.com/chip/{id}.json",
            0
        );
        PokerVault vault = new PokerVault(
            address(token),
            signerAddress,
            feeRecipient
        );
        vault.setChipToken(address(chipToken));

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("ETHEREUM SEPOLIA - MockToken + ChipToken + PokerVault");
        console.log("TOKEN_ADDRESS=", address(token));
        console.log("CHIP_TOKEN_ADDRESS=", address(chipToken));
        console.log("VAULT_ADDRESS=", address(vault));
        console.log("===========================================");
        console.log("Set these in Vercel (and on your game server):");
        console.log("  VITE_TOKEN_ADDRESS=%s", address(token));
        console.log("  VITE_VAULT_ADDRESS=%s", address(vault));
        console.log("  VITE_CHIP_TOKEN_ADDRESS=%s", address(chipToken));
        console.log("  VITE_CHAIN_ID=11155111");
        console.log("===========================================");
    }
}
