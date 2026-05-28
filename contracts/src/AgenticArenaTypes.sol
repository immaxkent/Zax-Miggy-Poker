// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Shared constants and hashing helpers for Agentic Arena contracts.
library AgenticArenaTypes {
    uint8 internal constant TIER_UNRANKED = 0;
    uint8 internal constant TIER_RANKED = 1;
    uint8 internal constant TIER_ELITE = 2;

    // USDC has 6 decimals
    uint256 internal constant BOT_CREATE_FEE_USDC = 3_000_000; // $3.00
    uint256 internal constant UNRANKED_FEE_USDC = 10_000; // $0.01
    uint256 internal constant RANKED_FEE_USDC = 50_000; // $0.05
    uint256 internal constant ELITE_FEE_USDC = 90_000; // $0.09

    uint256 internal constant DEFAULT_STARTING_CHIPS = 1000;
    uint256 internal constant SETTLEMENT_SCHEMA_VERSION = 1;

    struct SettlementPlayer {
        address bot;
        uint16 seat;
        bool winner;
        uint16 handsWon;
        uint256 chipsStart;
        uint256 chipsEnd;
        uint256 preGameScore;
    }

    struct SettlementPayload {
        uint256 schemaVersion;
        uint256 gameId;
        uint8 tier;
        uint256 handCount;
        uint256 startedAt;
        uint256 endedAt;
        bytes32 tableConfigHash;
        bytes32 handSummaryRoot;
        uint256 nonce;
        SettlementPlayer[] players;
    }

    /// @notice Hashes a settlement deterministically for replay protection and auditing.
    function hashSettlement(SettlementPayload memory s) internal pure returns (bytes32) {
        bytes memory packedPlayers;
        for (uint256 i = 0; i < s.players.length; i++) {
            SettlementPlayer memory p = s.players[i];
            packedPlayers = bytes.concat(
                packedPlayers,
                abi.encode(
                    p.bot,
                    p.seat,
                    p.winner,
                    p.handsWon,
                    p.chipsStart,
                    p.chipsEnd,
                    p.preGameScore
                )
            );
        }

        return keccak256(
            abi.encode(
                s.schemaVersion,
                s.gameId,
                s.tier,
                s.handCount,
                s.startedAt,
                s.endedAt,
                s.tableConfigHash,
                s.handSummaryRoot,
                s.nonce,
                keccak256(packedPlayers)
            )
        );
    }
}

