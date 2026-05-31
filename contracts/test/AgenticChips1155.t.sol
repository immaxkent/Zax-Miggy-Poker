// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgenticChips1155.sol";

contract AgenticChips1155Test is Test {
    AgenticChips1155 internal chips;
    address internal arena = address(0xA11A);
    address internal bot1 = address(0xB01);
    address internal bot2 = address(0xB02);

    function setUp() public {
        chips = new AgenticChips1155("ipfs://chips/{id}.json");
        chips.setArena(arena);
    }

    function test_gameTokenId_encodesTierAndGame() public view {
        uint256 id0 = chips.gameTokenId(42, 0);
        uint256 id1 = chips.gameTokenId(42, 1);
        assertEq(id0 & type(uint256).max >> 8, 42);
        assertEq(id1 & type(uint256).max >> 8, 42);
        assertTrue(id0 != id1);
    }

    function test_onlyArenaCanMint() public {
        vm.prank(bot1);
        vm.expectRevert("Only arena");
        chips.mintGameChips(1, 0, bot1, 1000);
    }

    function test_onlyArenaCanBurn() public {
        vm.prank(arena);
        chips.mintGameChips(1, 0, bot1, 1000);

        vm.prank(bot1);
        vm.expectRevert("Only arena");
        chips.burnGameChips(1, 0, bot1, 1000);
    }

    function test_mintAndBurn_zeroBalance() public {
        uint256 tokenId = chips.gameTokenId(7, 2);
        vm.prank(arena);
        chips.mintGameChips(7, 2, bot1, 1000);
        assertEq(chips.balanceOf(bot1, tokenId), 1000);

        vm.prank(arena);
        chips.burnGameChips(7, 2, bot1, 1000);
        assertEq(chips.balanceOf(bot1, tokenId), 0);
    }

    function test_nonTransferable_betweenPlayers() public {
        vm.prank(arena);
        chips.mintGameChips(1, 0, bot1, 1000);
        uint256 tokenId = chips.gameTokenId(1, 0);

        vm.prank(bot1);
        vm.expectRevert("Non-transferable");
        chips.safeTransferFrom(bot1, bot2, tokenId, 1, "");
    }

    function test_setArena_revertsZero() public {
        vm.expectRevert("Zero arena");
        chips.setArena(address(0));
    }
}
