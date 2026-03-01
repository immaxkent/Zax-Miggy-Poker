// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ZaxAndMiggyVault.sol";
import "../src/Utils.sol";
import "../src/MockUSDC.sol";

contract ZaxAndMiggyVaultTest is Test {
    MockUSDC usdc;
    ZaxAndMiggyVault vault;

    address owner = address(this);
    uint256 signerKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address signer;
    address feeRecip = address(0xFEE);
    address alice = address(0xA11);
    address bob = address(0xB0B);

    function setUp() public {
        signer = vm.addr(signerKey);
        usdc = new MockUSDC();
        vault = new ZaxAndMiggyVault(address(usdc), signer, feeRecip);
        usdc.mint(alice, 1000 * 1e6);
        usdc.mint(bob, 1000 * 1e6);
    }

    function test_createGame_setsTableCost() public {
        uint256 tableCost = 5 * 1e6; // $5
        vm.prank(alice);
        usdc.approve(address(vault), tableCost);
        vm.prank(alice);
        uint256 gameId = vault.createGame(tableCost);

        (address[8] memory players, uint8 count, uint256 deposit,, bool finished,) = vault.getGame(gameId);
        assertEq(players[0], alice);
        assertEq(count, 1);
        assertEq(deposit, tableCost);
        assertFalse(finished);
        assertEq(usdc.balanceOf(address(vault)), tableCost);
    }

    function test_joinGame_fullTableThenClose() public {
        uint256 tableCost = 5 * 1e6;
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        uint256 gameId = vault.createGame(tableCost);

        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        vault.joinGame(gameId);

        (,, uint256 deposit, uint256 createdAt,,) = vault.getGame(gameId);
        assertEq(deposit, tableCost);
        assertTrue(createdAt > 0);
        assertEq(usdc.balanceOf(address(vault)), 2 * tableCost);

        // Close: winner = alice. Pot = 10, fee 10% = 1, payout = 9
        bytes32 hash = vault.buildCloseHash(gameId, alice, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.closeGame(gameId, alice, 1, sig);

        uint256 totalPot = 2 * tableCost;
        uint256 fee = (totalPot * Utils.WINNER_FEE_BPS) / 10_000;
        uint256 payout = totalPot - fee;
        assertEq(usdc.balanceOf(alice), aliceBefore + payout);
        assertEq(usdc.balanceOf(feeRecip), fee);
        assertEq(vault.completedGameIds(0), gameId);
    }

    function test_closeGame_revertsIfWinnerNotInGame() public {
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        uint256 gameId = vault.createGame(5 * 1e6);

        bytes32 hash = vault.buildCloseHash(gameId, bob, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert("Winner not in game");
        vault.closeGame(gameId, bob, 1, sig);
    }

    function test_cancelGame_refundsAll() public {
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        uint256 gameId = vault.createGame(5 * 1e6);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        vault.joinGame(gameId);

        bytes32 hash = vault.buildCancelHash(gameId, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);
        vault.cancelGame(gameId, 1, sig);

        assertEq(usdc.balanceOf(alice), aliceBefore + 5 * 1e6);
        assertEq(usdc.balanceOf(bob), bobBefore + 5 * 1e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_createGame_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        vault.createGame(0);
    }
}
