// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/Arena.sol";
import "../../src/BotFactory.sol";
import "../../src/AgenticChips1155.sol";
import "../../src/AgenticRankingsV2.sol";
import "../../src/AgenticArenaTypes.sol";
import "../../src/MockUSDC.sol";
import "../../src/interfaces/IArena.sol";
import "../../src/interfaces/IAgenticRankingsV2.sol";

/// @dev Shared deploy + settlement helpers for Agentic Arena Foundry tests.
abstract contract AgenticArenaTestBase is Test {
    MockUSDC internal usdc;
    Arena internal arena;
    BotFactory internal factory;
    AgenticChips1155 internal chips;
    AgenticRankingsV2 internal rankings;

    address internal treasury = address(0xBEEF);
    address internal settler = address(0xABCD);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function _deployArenaStack() internal {
        usdc = new MockUSDC();
        rankings = new AgenticRankingsV2(address(this));
        chips = new AgenticChips1155("ipfs://chips/{id}.json");
        factory = new BotFactory(address(0));

        arena = new Arena(
            address(usdc),
            treasury,
            address(factory),
            address(rankings),
            address(chips),
            settler
        );

        factory.setArena(address(arena));
        chips.setArena(address(arena));
        rankings.setUpdater(address(arena));

        usdc.mint(alice, 1_000 * 1e6);
        usdc.mint(bob, 1_000 * 1e6);

        vm.prank(alice);
        usdc.approve(address(arena), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(arena), type(uint256).max);
    }

    function _createBot(address owner, string memory meta) internal returns (address bot) {
        vm.prank(owner);
        bot = arena.createBot(
            IArena.BotCreateParams({ metadataURI: meta, configURI: string.concat(meta, "/cfg") })
        );
    }

    function _createGame(address creator, address bot, IArena.Tier tier, bytes32 settingsHash)
        internal
        returns (uint256 gameId)
    {
        vm.prank(creator);
        gameId = arena.createGame(
            IArena.GameCreateParams({ tier: tier, settingsHash: settingsHash, maxPlayers: 8 }),
            bot
        );
    }

    function _joinGame(address payer, uint256 gameId, address bot) internal {
        vm.prank(payer);
        arena.joinGame(gameId, bot);
    }

    function _buildSettlement(
        uint256 gameId,
        IArena.Tier tier,
        address botA,
        address botB,
        bool aWins
    ) internal view returns (IArena.GameSettlement memory settlement, bytes32 resultHash) {
        IArena.SettlementPlayer[] memory players = new IArena.SettlementPlayer[](2);
        players[0] = IArena.SettlementPlayer({
            bot: botA,
            chipsStart: 1000,
            chipsEnd: aWins ? 1300 : 700,
            handsWon: aWins ? 8 : 4,
            winner: aWins,
            preGameScore: 1000
        });
        players[1] = IArena.SettlementPlayer({
            bot: botB,
            chipsStart: 1000,
            chipsEnd: aWins ? 700 : 1300,
            handsWon: aWins ? 4 : 8,
            winner: !aWins,
            preGameScore: 1000
        });

        AgenticArenaTypes.SettlementPlayer[] memory forHash =
            new AgenticArenaTypes.SettlementPlayer[](2);
        forHash[0] = AgenticArenaTypes.SettlementPlayer({
            bot: botA,
            seat: 0,
            winner: aWins,
            handsWon: players[0].handsWon,
            chipsStart: 1000,
            chipsEnd: players[0].chipsEnd,
            preGameScore: 1000
        });
        forHash[1] = AgenticArenaTypes.SettlementPlayer({
            bot: botB,
            seat: 1,
            winner: !aWins,
            handsWon: players[1].handsWon,
            chipsStart: 1000,
            chipsEnd: players[1].chipsEnd,
            preGameScore: 1000
        });

        bytes32 settings = keccak256("test-settings");
        AgenticArenaTypes.SettlementPayload memory payload = AgenticArenaTypes.SettlementPayload({
            schemaVersion: AgenticArenaTypes.SETTLEMENT_SCHEMA_VERSION,
            gameId: gameId,
            tier: uint8(tier),
            handCount: 10,
            startedAt: 1,
            endedAt: 2,
            tableConfigHash: settings,
            handSummaryRoot: keccak256("hands"),
            nonce: 1,
            players: forHash
        });
        resultHash = AgenticArenaTypes.hashSettlement(payload);

        settlement = IArena.GameSettlement({
            schemaVersion: AgenticArenaTypes.SETTLEMENT_SCHEMA_VERSION,
            gameId: gameId,
            tier: tier,
            handCount: 10,
            startedAt: 1,
            endedAt: 2,
            tableConfigHash: settings,
            players: players,
            handSummaryRoot: keccak256("hands"),
            nonce: 1,
            resultHash: resultHash
        });
    }

    function _settle(IArena.GameSettlement memory settlement) internal {
        vm.prank(settler);
        arena.settleGame(settlement);
    }

    /// @dev Put `bot` at rank 1 via a single ranked win (only works when few bots exist).
    function _makeTopRanked(address bot, address opponent) internal {
        IAgenticRankingsV2.GamePlayerResult[] memory results =
            new IAgenticRankingsV2.GamePlayerResult[](2);
        results[0] = IAgenticRankingsV2.GamePlayerResult({
            bot: bot,
            winner: true,
            handsWon: 20,
            chipsStart: 1000,
            chipsEnd: 5000,
            preGameScore: 0
        });
        results[1] = IAgenticRankingsV2.GamePlayerResult({
            bot: opponent,
            winner: false,
            handsWon: 1,
            chipsStart: 1000,
            chipsEnd: 0,
            preGameScore: 0
        });
        vm.prank(address(arena));
        rankings.applyGameResult(88_888, 1, results);
        assertTrue(rankings.isEliteEligible(bot));
    }
}
