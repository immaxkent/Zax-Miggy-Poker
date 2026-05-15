// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZaxAndMiggyVault {
    function getGame(uint256 gameId) external view returns (
        address[8] memory players,
        uint8 playerCount,
        uint256 depositAmount,
        uint256 createdAt,
        bool finished,
        address winner
    );
}
