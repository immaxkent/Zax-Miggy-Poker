// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PokerVault.sol";
import "../src/MockToken.sol";

contract PokerVaultTest is Test {
    MockToken  token;
    PokerVault vault;

    address owner     = address(this);
    address signer;
    uint256 signerKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil key 0
    address player    = address(0xBEEF);
    address feeRecip  = address(0xFEE);

    function setUp() public {
        signer = vm.addr(signerKey);
        token  = new MockToken();
        vault  = new PokerVault(address(token), signer, feeRecip);

        // Fund player
        token.mint(player, 10_000 ether);
        vm.prank(player);
        token.approve(address(vault), type(uint256).max);
    }

    // ── Deposit ────────────────────────────────────────────────────────────────
    function test_deposit_deducts_buyInFee() public {
        uint256 gross = 1000 ether;
        uint256 expectedFee = (gross * 800) / 10_000; // 8%
        uint256 expectedNet = gross - expectedFee;

        vm.prank(player);
        vault.deposit(gross);

        assertEq(vault.depositedBalance(player), expectedNet);
        assertEq(token.balanceOf(feeRecip), expectedFee);
        assertEq(token.balanceOf(address(vault)), expectedNet);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(player);
        vm.expectRevert("Zero amount");
        vault.deposit(0);
    }

    // ── Withdraw ───────────────────────────────────────────────────────────────
    function test_withdraw_with_valid_sig() public {
        // First fund vault
        token.mint(address(vault), 10_000 ether);

        uint256 grossAmount = 500 ether;
        uint256 nonce       = 1;

        // Build hash exactly as contract does
        bytes32 raw = keccak256(abi.encodePacked(
            block.chainid,
            address(vault),
            player,
            grossAmount,
            nonce
        ));
        bytes32 msgHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, msgHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 before = token.balanceOf(player);

        vm.prank(player);
        vault.withdraw(grossAmount, nonce, sig);

        uint256 fee = (grossAmount * 500) / 10_000; // 5%
        uint256 net = grossAmount - fee;

        assertEq(token.balanceOf(player) - before, net);
        assertEq(token.balanceOf(feeRecip), fee);
    }

    function test_withdraw_replay_reverts() public {
        token.mint(address(vault), 10_000 ether);
        uint256 amount = 100 ether;
        uint256 nonce  = 42;

        bytes32 raw = keccak256(abi.encodePacked(block.chainid, address(vault), player, amount, nonce));
        bytes32 h   = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, h);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(player);
        vault.withdraw(amount, nonce, sig);

        // Second attempt same nonce
        vm.prank(player);
        vm.expectRevert("Nonce reused");
        vault.withdraw(amount, nonce, sig);
    }

    function test_withdraw_wrong_signer_reverts() public {
        token.mint(address(vault), 1000 ether);
        uint256 amount = 100 ether;
        uint256 nonce  = 1;

        // Sign with a different key
        uint256 badKey = 0x1234;
        bytes32 raw = keccak256(abi.encodePacked(block.chainid, address(vault), player, amount, nonce));
        bytes32 h   = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(badKey, h);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(player);
        vm.expectRevert("Invalid server signature");
        vault.withdraw(amount, nonce, sig);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────
    function test_setFeeConfig() public {
        vault.setFeeConfig(600, 400);
        assertEq(vault.buyInFeeBps(), 600);
        assertEq(vault.winnerFeeBps(), 400);
    }

    function test_setFeeConfig_too_high_reverts() public {
        vm.expectRevert("Buy-in fee too high");
        vault.setFeeConfig(2001, 400);
    }

    function test_setServerSigner() public {
        address newSigner = address(0x1234);
        vault.setServerSigner(newSigner);
        assertEq(vault.serverSigner(), newSigner);
    }
}
