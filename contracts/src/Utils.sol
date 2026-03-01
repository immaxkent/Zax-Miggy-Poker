// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Game struct and constants for ZaxAndMiggyVault.
 *        No state; vault holds mapping(uint256 => Game).
 */
library Utils {
    uint8 public constant MAX_PLAYERS = 8;
    uint256 public constant WINNER_FEE_BPS = 1000; // 10%

    struct Game {
        address[8] players;
        uint8 playerCount;
        uint256 depositAmount; // table cost per seat (USDC units)
        uint256 createdAt;
        bool finished;
        address winner;
    }

    /// @notice Check if `account` is in the game's players (up to playerCount).
    function hasPlayer(Game storage g, address account) internal view returns (bool) {
        for (uint8 i = 0; i < g.playerCount; i++) {
            if (g.players[i] == account) return true;
        }
        return false;
    }
}
