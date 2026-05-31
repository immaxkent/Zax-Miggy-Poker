// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/AgenticArenaTestBase.sol";

contract AgenticArenaSettleTest is AgenticArenaTestBase {
    address internal aliceBot;
    address internal bobBot;
    uint256 internal gameId;

    function setUp() public {
        _deployArenaStack();
        aliceBot = _createBot(alice, "ipfs://alice");
        bobBot = _createBot(bob, "ipfs://bob");
        gameId = _createGame(alice, aliceBot, IArena.Tier.Unranked, keccak256("settings"));
        _joinGame(bob, gameId, bobBot);
    }

    function test_settleGame_revertsWrongSigner() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Unranked, aliceBot, bobBot, true
        );
        vm.prank(alice);
        vm.expectRevert("Not settlement signer");
        arena.settleGame(settlement);
    }

    function test_settleGame_revertsTierMismatch() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Ranked, aliceBot, bobBot, true
        );
        vm.prank(settler);
        vm.expectRevert("Tier mismatch");
        arena.settleGame(settlement);
    }

    function test_settleGame_revertsUnknownPlayer() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Unranked, aliceBot, bobBot, true
        );
        settlement.players[1].bot = address(0xDEAD);
        vm.prank(settler);
        vm.expectRevert("Unknown player");
        arena.settleGame(settlement);
    }

    function test_settleGame_revertsBadResultHash() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Unranked, aliceBot, bobBot, true
        );
        settlement.resultHash = keccak256("wrong");
        vm.prank(settler);
        vm.expectRevert("Result hash mismatch");
        arena.settleGame(settlement);
    }

    function test_settleGame_revertsDoubleSettle() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Unranked, aliceBot, bobBot, true
        );
        _settle(settlement);

        vm.prank(settler);
        vm.expectRevert("Already settled");
        arena.settleGame(settlement);
    }

    function test_settleGame_revertsAfterAlreadySettled() public {
        (IArena.GameSettlement memory settlement,) = _buildSettlement(
            gameId, IArena.Tier.Unranked, aliceBot, bobBot, true
        );
        _settle(settlement);

        vm.prank(bob);
        vm.expectRevert("Game settled");
        arena.joinGame(gameId, bobBot);
    }
}
