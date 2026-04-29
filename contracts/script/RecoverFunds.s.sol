// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IVault {
    function cancelGame(uint256 gameId, uint256 nonce, bytes calldata sig) external;
    function getGame(uint256 gameId) external view returns (
        address[8] memory players,
        uint8 playerCount,
        uint256 depositAmount,
        uint256 createdAt,
        bool finished,
        address winner
    );
    function nextGameId() external view returns (uint256);
}

/**
 * RecoverFunds — cancel all open games on the mis-deployed vault.
 *
 * The vault was deployed with serverSigner = 0x70997970... (Hardhat/Anvil account #1),
 * whose private key is publicly known. We use it here to produce valid cancel
 * signatures so that player deposits are refunded on-chain.
 *
 * The CALLER (vm.startBroadcast sender, i.e. your deployer MetaMask account)
 * pays gas. The signing uses the known anvil key — no ETH needed on that address.
 *
 * Run:
 *   cd contracts
 *   forge script script/RecoverFunds.s.sol:RecoverFunds \
 *     --rpc-url https://mainnet.base.org \
 *     --broadcast \
 *     --account deployMeta \
 *     -vvvv
 */
contract RecoverFunds is Script {
    // Hardhat / Anvil account #1 — the key that was mistakenly used as serverSigner
    uint256 constant SIGNER_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    address constant VAULT = 0x382C20bDbCcaa7E299C4aD014CfF2FeB226a3ef0;

    function run() external {
        IVault vault = IVault(VAULT);
        uint256 total = vault.nextGameId();

        console.log("Vault:", VAULT);
        console.log("Games to process:", total);

        vm.startBroadcast();

        for (uint256 gameId = 0; gameId < total; gameId++) {
            (, uint8 playerCount, uint256 deposit, , bool finished,) = vault.getGame(gameId);

            if (finished) {
                console.log("Game %d: already finished - skipping", gameId);
                continue;
            }
            if (playerCount == 0) {
                console.log("Game %d: no players - skipping", gameId);
                continue;
            }

            // Nonce: timestamp * 1000 + gameId guarantees uniqueness across games
            // in a single block, and has never been used before.
            uint256 nonce = block.timestamp * 1000 + gameId;

            // Replicate _buildCancelHash from ZaxAndMiggyVault.sol:
            //   keccak256(abi.encodePacked(block.chainid, address(vault), "cancel", gameId, nonce))
            //   then toEthSignedMessageHash
            bytes32 raw = keccak256(
                abi.encodePacked(block.chainid, VAULT, "cancel", gameId, nonce)
            );
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(raw);

            (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
            bytes memory sig = abi.encodePacked(r, s, v);

            vault.cancelGame(gameId, nonce, sig);

            console.log(
                "Game %d: cancelled - %d player(s) refunded %d USDC each",
                gameId,
                playerCount,
                deposit / 1e6
            );
        }

        vm.stopBroadcast();

        console.log("Done. All open games cancelled.");
    }
}
