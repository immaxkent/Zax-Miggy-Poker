// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ZaxAndMiggyVault.sol";

/**
 * Deploy ZaxAndMiggyVault on Base mainnet using canonical USDC.
 * No mock: use real USDC at 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
 *
 * Set in contracts/.env: SIGNER_ADDRESS, FEE_RECIPIENT.
 *
 *   cd contracts
 *   forge script script/DeployZaxMiggyBase.s.sol:DeployZaxMiggyBase --rpc-url $BASE_RPC_URL --broadcast --account deployer
 */
contract DeployZaxMiggyBase is Script {
    // Base mainnet native USDC (Circle)
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address signerAddress = vm.envAddress("SIGNER_ADDRESS");
        address feeRecipient  = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast();

        ZaxAndMiggyVault vault = new ZaxAndMiggyVault(
            BASE_USDC,
            signerAddress,
            feeRecipient
        );

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("BASE MAINNET - ZaxAndMiggyVault");
        console.log("USDC_ADDRESS=", BASE_USDC);
        console.log("ZAX_MIGGY_VAULT_ADDRESS=", address(vault));
        console.log("===========================================");
        console.log("Set in client (Vercel) and server:");
        console.log("  VITE_USDC_ADDRESS=%s", BASE_USDC);
        console.log("  VITE_ZAX_MIGGY_VAULT_ADDRESS=%s", address(vault));
        console.log("  VITE_CHAIN_ID=8453");
        console.log("===========================================");
    }
}
