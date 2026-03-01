// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ChipToken.sol";

/**
 * Mint chips for a given (collection, sourceTokenId). Caller must own the NFT.
 *
 * Usage (env):
 *   CHIP_TOKEN_ADDRESS=0x...
 *   COLLECTION=0x...   (ERC721 that backs the chips)
 *   TOKEN_ID=1
 *   AMOUNT=1000
 *
 *   cd contracts
 *   forge script script/MintChips.s.sol:MintChips --rpc-url <RPC> --broadcast --account <NFT_OWNER>
 *
 * For local Anvil: deploy MockERC721, mint tokenId to deployer, then run this with
 * COLLECTION=<MockERC721>, TOKEN_ID=1, --account deployer.
 */
contract MintChips is Script {
    function run() external {
        address chipTokenAddr = vm.envAddress("CHIP_TOKEN_ADDRESS");
        address collection    = vm.envAddress("COLLECTION");
        uint256 tokenId      = vm.envOr("TOKEN_ID", uint256(1));
        uint256 amount       = vm.envOr("AMOUNT", uint256(1000 ether));

        ChipToken chipToken = ChipToken(chipTokenAddr);

        vm.startBroadcast();
        chipToken.mint(collection, tokenId, amount);
        vm.stopBroadcast();

        uint256 chipTokenId = chipToken.getTokenId(collection, tokenId);
        console.log("Minted chips: amount=%s chipTokenId=%s", amount, chipTokenId);
    }
}
