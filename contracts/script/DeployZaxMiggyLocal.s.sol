// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/ZaxAndMiggyVault.sol";

/**
 * Deploy MockUSDC + ZaxAndMiggyVault for LOCAL ANVIL.
 *
 *   cd contracts
 *   forge script script/DeployZaxMiggyLocal.s.sol:DeployZaxMiggyLocal --rpc-url http://127.0.0.1:8545 --broadcast --account deployer
 */
contract DeployZaxMiggyLocal is Script {
    address constant ANVIL_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (deployer == address(0)) deployer = msg.sender;
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        ZaxAndMiggyVault vault = new ZaxAndMiggyVault(
            address(usdc),
            ANVIL_SIGNER,
            feeRecipient
        );

        vm.stopBroadcast();

        console.log("ZaxAndMiggyVault LOCAL");
        console.log("USDC_ADDRESS=", address(usdc));
        console.log("ZAX_MIGGY_VAULT_ADDRESS=", address(vault));
        console.log("Signer:", ANVIL_SIGNER);
    }
}
