// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockToken.sol";
import "../src/PokerVault.sol";

/**
 * Deploy MockToken + PokerVault for LOCAL ANVIL only.
 * Run with anvil up, then:
 *
 *   cd contracts
 *   forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *
 * (That key is anvil's default account #0. Deployer gets 1M CHIP; signer = anvil #1.)
 * Then set VITE_TOKEN_ADDRESS and VITE_VAULT_ADDRESS in client/.env (and server/.env).
 */
contract DeployLocal is Script {
    address constant ANVIL_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // anvil account #1

    function run() external {
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (deployer == address(0)) deployer = msg.sender;
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast();

        MockToken token = new MockToken();
        PokerVault vault = new PokerVault(
            address(token),
            ANVIL_SIGNER,
            feeRecipient
        );

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("LOCAL DEPLOY (Anvil)");
        console.log("TOKEN_ADDRESS=", address(token));
        console.log("VAULT_ADDRESS=", address(vault));
        console.log("Signer (anvil #1):", ANVIL_SIGNER);
        console.log("Deployer has 1_000_000 CHIP. Set in .env:");
        console.log("  server/.env:  TOKEN_ADDRESS=%s  VAULT_ADDRESS=%s", address(token), address(vault));
        console.log("  client/.env:  VITE_TOKEN_ADDRESS=%s  VITE_VAULT_ADDRESS=%s", address(token), address(vault));
        console.log("===========================================");
    }
}
