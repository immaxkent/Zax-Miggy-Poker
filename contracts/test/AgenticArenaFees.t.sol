// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/AgenticArenaTestBase.sol";
import "../src/AgenticArenaTypes.sol";

contract AgenticArenaFeesTest is AgenticArenaTestBase {
    function setUp() public {
        _deployArenaStack();
    }

    function test_tierFees_matchConstants() public view {
        assertEq(arena.tierFee(IArena.Tier.Unranked), AgenticArenaTypes.UNRANKED_FEE_USDC);
        assertEq(arena.tierFee(IArena.Tier.Ranked), AgenticArenaTypes.RANKED_FEE_USDC);
        assertEq(arena.tierFee(IArena.Tier.Elite), AgenticArenaTypes.ELITE_FEE_USDC);
        assertEq(arena.botCreationFee(), AgenticArenaTypes.BOT_CREATE_FEE_USDC);
    }

    function test_createGame_unrankedFeeToTreasury() public {
        address bot = _createBot(alice, "ipfs://a");
        uint256 before = usdc.balanceOf(treasury);
        _createGame(alice, bot, IArena.Tier.Unranked, keccak256("s"));
        assertEq(usdc.balanceOf(treasury) - before, AgenticArenaTypes.UNRANKED_FEE_USDC);
    }

    function test_joinGame_rankedFeeToTreasury() public {
        address botA = _createBot(alice, "ipfs://a");
        address botB = _createBot(bob, "ipfs://b");
        uint256 gameId = _createGame(alice, botA, IArena.Tier.Ranked, keccak256("s"));

        uint256 before = usdc.balanceOf(treasury);
        _joinGame(bob, gameId, botB);
        assertEq(usdc.balanceOf(treasury) - before, AgenticArenaTypes.RANKED_FEE_USDC);
    }

    function test_joinGame_revertsIfAlreadyJoined() public {
        address bot = _createBot(alice, "ipfs://a");
        uint256 gameId = _createGame(alice, bot, IArena.Tier.Unranked, keccak256("s"));

        vm.prank(alice);
        vm.expectRevert("Already joined");
        arena.joinGame(gameId, bot);
    }

    function test_joinGame_revertsUnknownGame() public {
        address bot = _createBot(alice, "ipfs://a");
        vm.prank(alice);
        vm.expectRevert("Game not found");
        arena.joinGame(999, bot);
    }

    function test_eliteCreateGame_succeedsWhenTopRanked() public {
        address botA = _createBot(alice, "ipfs://elite-a");
        address botB = _createBot(bob, "ipfs://elite-b");
        _makeTopRanked(botA, botB);

        vm.prank(alice);
        uint256 gameId = arena.createGame(
            IArena.GameCreateParams({
                tier: IArena.Tier.Elite,
                settingsHash: keccak256("elite"),
                maxPlayers: 6
            }),
            botA
        );
        assertEq(gameId, 0);
    }
}
