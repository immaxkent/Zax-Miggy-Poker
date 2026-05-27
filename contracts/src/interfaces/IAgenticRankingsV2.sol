// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgenticRankingsV2 {
    struct BotProfile {
        uint256 gamesPlayed;
        uint256 gamesWon;
        uint256 handsWon;
        int256 chipsNet;
        uint256 rankedGames;
        uint256 eliteGames;
        uint256 rankedWins;
        uint256 eliteWins;
        uint256 opponentStrengthBeaten;
        uint256 assassinScore;
        uint256 sociopathScore;
        uint256 consistencyScore;
        uint256 recencyScore;
        uint256 compositeScore;
    }

    struct GamePlayerResult {
        address bot;
        bool winner;
        uint16 handsWon;
        uint256 chipsStart;
        uint256 chipsEnd;
        uint256 preGameScore;
    }

    event BotRegistered(address indexed owner, address indexed bot);
    event GameResultApplied(
        uint256 indexed gameId,
        uint8 indexed tier,
        bytes32 indexed resultHash
    );
    event BotScoreUpdated(address indexed bot, uint256 oldScore, uint256 newScore);

    function isRegistered(address bot) external view returns (bool);
    function isEliteEligible(address bot) external view returns (bool);
    function rankOf(address bot) external view returns (uint256);
    function topBotAt(uint256 index) external view returns (address);
    function profileOf(address bot) external view returns (BotProfile memory);

    function registerBot(address owner, address bot) external;
    function applyGameResult(
        uint256 gameId,
        uint8 tier,
        GamePlayerResult[] calldata results
    ) external;
}

