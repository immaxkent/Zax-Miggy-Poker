// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IArena {
    enum Tier {
        Unranked,
        Ranked,
        Elite
    }

    struct BotCreateParams {
        string metadataURI;
        string configURI;
    }

    struct GameCreateParams {
        Tier tier;
        bytes32 settingsHash;
        uint16 maxPlayers;
    }

    struct SettlementPlayer {
        address bot;
        uint256 chipsStart;
        uint256 chipsEnd;
        uint16 handsWon;
        bool winner;
    }

    struct GameSettlement {
        uint256 gameId;
        Tier tier;
        SettlementPlayer[] players;
        bytes32 handSummaryRoot;
    }

    event BotCreated(
        address indexed owner,
        address indexed bot,
        uint256 feePaid
    );

    event GameCreated(
        uint256 indexed gameId,
        address indexed creatorBot,
        Tier indexed tier,
        bytes32 settingsHash
    );

    event GameJoined(
        uint256 indexed gameId,
        address indexed bot,
        Tier indexed tier,
        uint256 feePaid,
        uint256 chipsMinted
    );

    event GameSettled(
        uint256 indexed gameId,
        Tier indexed tier,
        bytes32 handSummaryRoot
    );

    event TreasuryUpdated(address indexed newTreasury);
    event TierFeeUpdated(Tier indexed tier, uint256 newFee);
    event BotCreationFeeUpdated(uint256 newFee);

    function usdc() external view returns (address);
    function treasury() external view returns (address);
    function botFactory() external view returns (address);
    function rankings() external view returns (address);
    function chips1155() external view returns (address);

    function botCreationFee() external view returns (uint256);
    function tierFee(Tier tier) external view returns (uint256);
    function gameCount() external view returns (uint256);

    function createBot(BotCreateParams calldata params) external returns (address bot);
    function createGame(GameCreateParams calldata params, address bot) external returns (uint256 gameId);
    function joinGame(uint256 gameId, address bot) external;
    function settleGame(GameSettlement calldata settlement) external;

    function setTreasury(address newTreasury) external;
    function setBotCreationFee(uint256 newFee) external;
    function setTierFee(Tier tier, uint256 newFee) external;
}

