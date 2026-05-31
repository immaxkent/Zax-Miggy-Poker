// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgenticRankingsV2.sol";
import "../src/interfaces/IAgenticRankingsV2.sol";

contract AgenticRankingsV2Test is Test {
    AgenticRankingsV2 internal rankings;
    address internal updater = makeAddr("rankings-updater");
    address internal bot1 = makeAddr("bot1");
    address internal bot2 = makeAddr("bot2");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        rankings = new AgenticRankingsV2(updater);
    }

    function _twoPlayerResults(bool bot1Wins)
        internal
        view
        returns (IAgenticRankingsV2.GamePlayerResult[] memory results)
    {
        results = new IAgenticRankingsV2.GamePlayerResult[](2);
        results[0] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot1,
            winner: bot1Wins,
            handsWon: bot1Wins ? 8 : 2,
            chipsStart: 1000,
            chipsEnd: bot1Wins ? 1400 : 600,
            preGameScore: 0
        });
        results[1] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot2,
            winner: !bot1Wins,
            handsWon: bot1Wins ? 2 : 8,
            chipsStart: 1000,
            chipsEnd: bot1Wins ? 600 : 1400,
            preGameScore: 0
        });
    }

    function test_registerBot_onlyUpdater() public {
        vm.prank(stranger);
        vm.expectRevert("Not updater");
        rankings.registerBot(address(this), bot1);

        vm.prank(updater);
        rankings.registerBot(address(this), bot1);
        assertTrue(rankings.isRegistered(bot1));
    }

    function test_registerBot_revertsDuplicate() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        vm.expectRevert("Already registered");
        rankings.registerBot(address(this), bot1);
        vm.stopPrank();
    }

    function test_applyGameResult_onlyUpdater() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        rankings.registerBot(address(this), bot2);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert("Not updater");
        rankings.applyGameResult(1, 0, _twoPlayerResults(true));
    }

    function test_applyGameResult_revertsUnregistered() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        vm.stopPrank();

        vm.prank(updater);
        vm.expectRevert("Unregistered bot");
        rankings.applyGameResult(1, 0, _twoPlayerResults(true));
    }

    function test_applyGameResult_revertsFewerThanTwoPlayers() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        IAgenticRankingsV2.GamePlayerResult[] memory one =
            new IAgenticRankingsV2.GamePlayerResult[](1);
        one[0] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot1,
            winner: true,
            handsWon: 1,
            chipsStart: 1000,
            chipsEnd: 1100,
            preGameScore: 0
        });
        vm.expectRevert("Need >=2 players");
        rankings.applyGameResult(1, 0, one);
        vm.stopPrank();
    }

    function test_applyGameResult_updatesWinnerAndLoserStats() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        rankings.registerBot(address(this), bot2);
        rankings.applyGameResult(1, 1, _twoPlayerResults(true));
        vm.stopPrank();

        IAgenticRankingsV2.BotProfile memory w = rankings.profileOf(bot1);
        IAgenticRankingsV2.BotProfile memory l = rankings.profileOf(bot2);
        assertEq(w.gamesPlayed, 1);
        assertEq(w.gamesWon, 1);
        assertEq(w.rankedGames, 1);
        assertEq(l.gamesPlayed, 1);
        assertEq(l.gamesWon, 0);
        assertGt(w.compositeScore, l.compositeScore);
        assertEq(rankings.rankOf(bot1), 1);
    }

    function test_isEliteEligible_requiresTop100Rank() public {
        vm.startPrank(updater);
        rankings.registerBot(address(this), bot1);
        rankings.registerBot(address(this), bot2);
        assertFalse(rankings.isEliteEligible(bot1));

        rankings.applyGameResult(1, 1, _twoPlayerResults(true));
        assertTrue(rankings.isEliteEligible(bot1));
        assertEq(rankings.rankOf(bot1), 1);
        vm.stopPrank();
    }

    function test_setUpdater_revertsZero() public {
        vm.expectRevert("Zero updater");
        rankings.setUpdater(address(0));
    }
}
