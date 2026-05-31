// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgenticArenaTypes.sol";

contract AgenticArenaTypesTest is Test {
    function _samplePayload() internal pure returns (AgenticArenaTypes.SettlementPayload memory p) {
        AgenticArenaTypes.SettlementPlayer[] memory players =
            new AgenticArenaTypes.SettlementPlayer[](2);
        players[0] = AgenticArenaTypes.SettlementPlayer({
            bot: address(0xA),
            seat: 0,
            winner: true,
            handsWon: 5,
            chipsStart: 1000,
            chipsEnd: 1200,
            preGameScore: 500
        });
        players[1] = AgenticArenaTypes.SettlementPlayer({
            bot: address(0xB),
            seat: 1,
            winner: false,
            handsWon: 2,
            chipsStart: 1000,
            chipsEnd: 800,
            preGameScore: 600
        });
        p = AgenticArenaTypes.SettlementPayload({
            schemaVersion: 1,
            gameId: 7,
            tier: 1,
            handCount: 15,
            startedAt: 100,
            endedAt: 200,
            tableConfigHash: keccak256("table"),
            handSummaryRoot: keccak256("root"),
            nonce: 3,
            players: players
        });
    }

    function test_hashSettlement_deterministic() public pure {
        bytes32 h1 = AgenticArenaTypes.hashSettlement(_samplePayload());
        bytes32 h2 = AgenticArenaTypes.hashSettlement(_samplePayload());
        assertEq(h1, h2);
        assertTrue(h1 != bytes32(0));
    }

    function test_hashSettlement_changesWhenPlayerOrderChanges() public pure {
        AgenticArenaTypes.SettlementPayload memory p = _samplePayload();
        bytes32 h1 = AgenticArenaTypes.hashSettlement(p);

        AgenticArenaTypes.SettlementPlayer[] memory swapped =
            new AgenticArenaTypes.SettlementPlayer[](2);
        swapped[0] = p.players[1];
        swapped[1] = p.players[0];
        p.players = swapped;
        bytes32 h2 = AgenticArenaTypes.hashSettlement(p);

        assertTrue(h1 != h2);
    }

    function test_hashSettlement_changesWhenNonceChanges() public pure {
        AgenticArenaTypes.SettlementPayload memory p = _samplePayload();
        bytes32 h1 = AgenticArenaTypes.hashSettlement(p);
        p.nonce = 99;
        bytes32 h2 = AgenticArenaTypes.hashSettlement(p);
        assertTrue(h1 != h2);
    }

    function test_feeConstants() public pure {
        assertEq(AgenticArenaTypes.BOT_CREATE_FEE_USDC, 3_000_000);
        assertEq(AgenticArenaTypes.UNRANKED_FEE_USDC, 10_000);
        assertEq(AgenticArenaTypes.RANKED_FEE_USDC, 50_000);
        assertEq(AgenticArenaTypes.ELITE_FEE_USDC, 90_000);
        assertEq(AgenticArenaTypes.DEFAULT_STARTING_CHIPS, 1000);
    }
}
