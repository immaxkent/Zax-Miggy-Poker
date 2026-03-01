// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockToken.sol";
import "../src/ChipToken.sol";
import "../src/MockERC721.sol";
import "../src/PokerVault.sol";

/**
 * Deploy MockToken, ChipToken, MockERC721 + PokerVault for LOCAL ANVIL only.
 * Run with anvil up, then:
 *
 *   cd contracts
 *   forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --account deployer
 *
 * (Import key first: cast wallet import deployer --private-key <key>. Anvil default #0: 0xac09...f80. Signer = anvil #1.)
 * Then set VITE_TOKEN_ADDRESS, VITE_VAULT_ADDRESS, CHIP_TOKEN_ADDRESS in client/.env (and server/.env).
 * To mint chips: COLLECTION=<MOCK_NFT_ADDRESS> TOKEN_ID=1 CHIP_TOKEN_ADDRESS=... forge script script/MintChips.s.sol:MintChips --rpc-url http://127.0.0.1:8545 --broadcast --account deployer
 */
contract DeployLocal is Script {
    address constant ANVIL_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // anvil account #1

    function run() external {
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (deployer == address(0)) deployer = msg.sender;
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast();

        MockToken token = new MockToken();
        ChipToken chipToken = new ChipToken(
            "https://api.game.com/chip/{id}.json",
            0 // maxSupplyPerNft: 0 = no cap
        );
        MockERC721 mockNft = new MockERC721("MockMembership", "MEMBER");
        mockNft.mint(deployer, 1); // tokenId 1 so deployer can mint chips

        PokerVault vault = new PokerVault(
            address(token),
            ANVIL_SIGNER,
            feeRecipient
        );
        vault.setChipToken(address(chipToken));

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("LOCAL DEPLOY (Anvil)");
        console.log("TOKEN_ADDRESS=", address(token));
        console.log("VAULT_ADDRESS=", address(vault));
        console.log("CHIP_TOKEN_ADDRESS=", address(chipToken));
        console.log("MOCK_NFT_ADDRESS=", address(mockNft));
        console.log("Signer (anvil #1):", ANVIL_SIGNER);
        console.log("Deployer has 1_000_000 CHIP and owns MockERC721 #1. Set in .env:");
        console.log("  server/.env:  TOKEN_ADDRESS=%s  VAULT_ADDRESS=%s  CHIP_TOKEN_ADDRESS=%s", address(token), address(vault), address(chipToken));
        console.log("  client/.env:  VITE_TOKEN_ADDRESS=%s  VITE_VAULT_ADDRESS=%s", address(token), address(vault));
        console.log("  Mint chips: COLLECTION=%s TOKEN_ID=1 CHIP_TOKEN_ADDRESS=%s", address(mockNft), address(chipToken));
        console.log("===========================================");
    }
}
