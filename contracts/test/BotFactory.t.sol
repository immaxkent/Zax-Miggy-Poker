// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/BotFactory.sol";
import "../src/Bot.sol";

contract BotFactoryTest is Test {
    BotFactory internal factory;
    address internal arena = address(0xA11A);
    address internal owner = makeAddr("bot-owner");

    function setUp() public {
        factory = new BotFactory(arena);
    }

    function test_deployBot_onlyArena() public {
        vm.prank(owner);
        vm.expectRevert("Only arena");
        factory.deployBot(owner, "m", "c", bytes32("salt"));
    }

    function test_deployBot_setsOwnerAndArena() public {
        vm.prank(arena);
        address bot = factory.deployBot(owner, "ipfs://meta", "ipfs://cfg", bytes32("s"));

        assertEq(Bot(bot).owner(), owner);
        assertEq(Bot(bot).arena(), arena);
        assertEq(factory.botCount(owner), 1);
        assertEq(factory.botOf(owner, 0), bot);
    }

    function test_deployBot_incrementsNoncePerOwner() public {
        vm.startPrank(arena);
        address b0 = factory.deployBot(owner, "m0", "c0", bytes32("a"));
        address b1 = factory.deployBot(owner, "m1", "c1", bytes32("b"));
        vm.stopPrank();

        assertTrue(b0 != b1);
        assertEq(factory.botCount(owner), 2);
    }

    function test_setArena_revertsZero() public {
        vm.expectRevert("Zero arena");
        factory.setArena(address(0));
    }
}
