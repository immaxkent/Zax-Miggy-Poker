// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgenticRankings.sol";
import "../src/ZaxAndMiggyVault.sol";
import "../src/MockUSDC.sol";

contract AgenticRankingsTest is Test {
    MockUSDC usdc;
    ZaxAndMiggyVault vault;
    AgenticRankings rankings;

    address owner = address(this);
    uint256 signerKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address signer;
    address feeRecip = address(0xFEE);

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);
    address carol = address(0xCA401);

    uint256 constant DEPOSIT = 10 * 1e6; // $10 USDC

    function setUp() public {
        signer   = vm.addr(signerKey);
        usdc     = new MockUSDC();
        vault    = new ZaxAndMiggyVault(address(usdc), signer, feeRecip);
        rankings = new AgenticRankings(address(vault), signer, owner);

        usdc.mint(alice, 1000 * 1e6);
        usdc.mint(bob,   1000 * 1e6);
        usdc.mint(carol, 1000 * 1e6);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _createAndCloseGame(address creator, address joiner, address winner)
        internal returns (uint256 gameId)
    {
        vm.prank(creator);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(creator);
        gameId = vault.createGame(DEPOSIT);

        vm.prank(joiner);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(joiner);
        vault.joinGame(gameId);

        bytes32 hash = vault.buildCloseHash(gameId, winner, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        vault.closeGame(gameId, winner, 1, abi.encodePacked(r, s, v));
    }

    function _createAndCancelGame(address creator, address joiner)
        internal returns (uint256 gameId)
    {
        vm.prank(creator);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(creator);
        gameId = vault.createGame(DEPOSIT);

        vm.prank(joiner);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(joiner);
        vault.joinGame(gameId);

        bytes32 hash = vault.buildCancelHash(gameId, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        vault.cancelGame(gameId, 1, abi.encodePacked(r, s, v));
    }

    // ─── updateRankings — winner stats ───────────────────────────────────────

    function test_updateRankings_winnerGetsWin() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(signer);
        rankings.updateRankings(gameId);

        AgenticRankings.PlayerStats memory s = rankings.getStats(alice);
        assertEq(s.wins, 1);
        assertEq(s.gamesPlayed, 1);

        // payout = 2 * DEPOSIT * 90% = 18e6
        uint256 expectedPayout = (2 * DEPOSIT * 9_000) / 10_000;
        assertEq(s.totalWon, expectedPayout);
        assertEq(s.totalLost, DEPOSIT);
    }

    function test_updateRankings_loserStats() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(signer);
        rankings.updateRankings(gameId);

        AgenticRankings.PlayerStats memory s = rankings.getStats(bob);
        assertEq(s.wins, 0);
        assertEq(s.gamesPlayed, 1);
        assertEq(s.totalWon, 0);
        assertEq(s.totalLost, DEPOSIT);
    }

    function test_updateRankings_netWinnings() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(signer);
        rankings.updateRankings(gameId);

        AgenticRankings.PlayerStats memory s = rankings.getStats(alice);
        // net = totalWon - totalLost = 18e6 - 10e6 = 8e6
        uint256 net = s.totalWon > s.totalLost ? s.totalWon - s.totalLost : 0;
        assertEq(net, 8 * 1e6);
    }

    function test_updateRankings_threePlayer() public {
        vm.prank(alice); usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice); uint256 gameId = vault.createGame(DEPOSIT);
        vm.prank(bob);   usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);   vault.joinGame(gameId);
        vm.prank(carol); usdc.approve(address(vault), type(uint256).max);
        vm.prank(carol); vault.joinGame(gameId);

        bytes32 hash = vault.buildCloseHash(gameId, bob, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        vault.closeGame(gameId, bob, 1, abi.encodePacked(r, s, v));

        vm.prank(signer);
        rankings.updateRankings(gameId);

        // Bob wins pot of 3 * DEPOSIT * 90% = 27e6
        uint256 expectedPayout = (3 * DEPOSIT * 9_000) / 10_000;
        assertEq(rankings.getStats(bob).wins, 1);
        assertEq(rankings.getStats(bob).totalWon, expectedPayout);
        assertEq(rankings.getStats(bob).totalLost, DEPOSIT);

        assertEq(rankings.getStats(alice).wins, 0);
        assertEq(rankings.getStats(alice).totalLost, DEPOSIT);
        assertEq(rankings.getStats(carol).wins, 0);
        assertEq(rankings.getStats(carol).totalLost, DEPOSIT);
    }

    // ─── recordCancellation ───────────────────────────────────────────────────

    function test_recordCancellation_gamesPlayedOnly() public {
        uint256 gameId = _createAndCancelGame(alice, bob);

        vm.prank(signer);
        rankings.recordCancellation(gameId);

        AgenticRankings.PlayerStats memory a = rankings.getStats(alice);
        AgenticRankings.PlayerStats memory b = rankings.getStats(bob);

        assertEq(a.gamesPlayed, 1);
        assertEq(a.wins, 0);
        assertEq(a.totalWon, 0);
        assertEq(a.totalLost, 0); // refunded — no loss recorded

        assertEq(b.gamesPlayed, 1);
        assertEq(b.totalLost, 0);
    }

    // ─── Idempotency guard ────────────────────────────────────────────────────

    function test_idempotency_updateRankingsRevertsOnSecondCall() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(signer);
        rankings.updateRankings(gameId);

        vm.prank(signer);
        vm.expectRevert("Already processed");
        rankings.updateRankings(gameId);
    }

    function test_idempotency_cancellationRevertsOnSecondCall() public {
        uint256 gameId = _createAndCancelGame(alice, bob);

        vm.prank(signer);
        rankings.recordCancellation(gameId);

        vm.prank(signer);
        vm.expectRevert("Already processed");
        rankings.recordCancellation(gameId);
    }

    // ─── Access control ───────────────────────────────────────────────────────

    function test_accessControl_updateRankingsRevertsForNonSigner() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(alice);
        vm.expectRevert("Not authorized");
        rankings.updateRankings(gameId);
    }

    function test_accessControl_cancellationRevertsForNonSigner() public {
        uint256 gameId = _createAndCancelGame(alice, bob);

        vm.prank(bob);
        vm.expectRevert("Not authorized");
        rankings.recordCancellation(gameId);
    }

    // ─── Wrong function for game type ─────────────────────────────────────────

    function test_updateRankings_revertsOnCancelledGame() public {
        uint256 gameId = _createAndCancelGame(alice, bob);

        vm.prank(signer);
        vm.expectRevert("No winner: use recordCancellation");
        rankings.updateRankings(gameId);
    }

    function test_recordCancellation_revertsOnClosedGame() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);

        vm.prank(signer);
        vm.expectRevert("Has winner: use updateRankings");
        rankings.recordCancellation(gameId);
    }

    // ─── Unfinished game guard ────────────────────────────────────────────────

    function test_updateRankings_revertsIfNotFinished() public {
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        uint256 gameId = vault.createGame(DEPOSIT);

        vm.prank(signer);
        vm.expectRevert("Game not finished");
        rankings.updateRankings(gameId);
    }

    // ─── Batch view ───────────────────────────────────────────────────────────

    function test_getStatsBatch() public {
        uint256 gameId = _createAndCloseGame(alice, bob, alice);
        vm.prank(signer);
        rankings.updateRankings(gameId);

        address[] memory addrs = new address[](2);
        addrs[0] = alice;
        addrs[1] = bob;
        AgenticRankings.PlayerStats[] memory batch = rankings.getStatsBatch(addrs);

        assertEq(batch[0].wins, 1);
        assertEq(batch[1].wins, 0);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function test_setServerSigner_updatesAndEmits() public {
        address newSigner = address(0x1337);
        vm.expectEmit(true, true, false, false);
        emit AgenticRankings.ServerSignerUpdated(signer, newSigner);
        rankings.setServerSigner(newSigner);
        assertEq(rankings.serverSigner(), newSigner);
    }

    function test_setServerSigner_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        rankings.setServerSigner(address(0x1337));
    }

    function test_setServerSigner_revertsForZeroAddress() public {
        vm.expectRevert("Zero signer");
        rankings.setServerSigner(address(0));
    }
}
