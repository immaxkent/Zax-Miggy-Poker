// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgenticChips1155.sol";
import "../src/AgenticRankingsV2.sol";
import "../src/interfaces/IAgenticRankingsV2.sol";

contract AgenticArenaUnitTest is Test {
    AgenticChips1155 chips;
    AgenticRankingsV2 rankings;

    address arena = address(0xA11A);
    address bot1 = address(0xB01);
    address bot2 = address(0xB02);

    function setUp() public {
        chips = new AgenticChips1155("ipfs://chips/{id}.json");
        chips.setArena(arena);
        rankings = new AgenticRankingsV2(address(this));
    }

    function test_chips_nonTransferable() public {
        vm.prank(arena);
        chips.mintGameChips(1, 0, bot1, 1000);
        uint256 tokenId = chips.gameTokenId(1, 0);

        vm.prank(bot1);
        vm.expectRevert("Non-transferable");
        chips.safeTransferFrom(bot1, bot2, tokenId, 1, "");
    }

    function test_rankings_register_and_apply_result() public {
        rankings.registerBot(address(0x111), bot1);
        rankings.registerBot(address(0x222), bot2);

        IAgenticRankingsV2.GamePlayerResult[] memory results =
            new IAgenticRankingsV2.GamePlayerResult[](2);
        results[0] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot1,
            winner: true,
            handsWon: 5,
            chipsStart: 1000,
            chipsEnd: 1200,
            preGameScore: 1000
        });
        results[1] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot2,
            winner: false,
            handsWon: 2,
            chipsStart: 1000,
            chipsEnd: 800,
            preGameScore: 1000
        });

        rankings.applyGameResult(1, 1, results);

        IAgenticRankingsV2.BotProfile memory p1 = rankings.profileOf(bot1);
        IAgenticRankingsV2.BotProfile memory p2 = rankings.profileOf(bot2);
        assertEq(p1.gamesPlayed, 1);
        assertEq(p1.gamesWon, 1);
        assertEq(p2.gamesPlayed, 1);
        assertEq(p2.gamesWon, 0);
        assertEq(rankings.rankOf(bot1), 1);
    }
}

