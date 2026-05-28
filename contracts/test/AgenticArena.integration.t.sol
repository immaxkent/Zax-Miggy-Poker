// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Arena.sol";
import "../src/BotFactory.sol";
import "../src/AgenticChips1155.sol";
import "../src/AgenticRankingsV2.sol";
import "../src/AgenticArenaTypes.sol";
import "../src/MockUSDC.sol";
import "../src/interfaces/IArena.sol";

contract AgenticArenaIntegrationTest is Test {
    MockUSDC usdc;
    Arena arena;
    BotFactory factory;
    AgenticChips1155 chips;
    AgenticRankingsV2 rankings;

    address treasury = address(0xBEEF);
    address settler = address(0xABCD);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
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

        usdc.mint(alice, 100 * 1e6);
        usdc.mint(bob, 100 * 1e6);

        vm.prank(alice);
        usdc.approve(address(arena), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(arena), type(uint256).max);
    }

    function test_createBot_collectsFee_and_registers() public {
        IArena.BotCreateParams memory p = IArena.BotCreateParams({
            metadataURI: "ipfs://bot/1",
            configURI: "ipfs://bot/1/config"
        });

        uint256 beforeBal = usdc.balanceOf(treasury);
        vm.prank(alice);
        address bot = arena.createBot(p);
        uint256 afterBal = usdc.balanceOf(treasury);

        assertEq(afterBal - beforeBal, AgenticArenaTypes.BOT_CREATE_FEE_USDC);
        assertTrue(rankings.isRegistered(bot));
    }

    function test_fullFlow_create_join_settle_updatesRankings_and_burnsChips() public {
        IArena.BotCreateParams memory p1 =
            IArena.BotCreateParams({ metadataURI: "ipfs://bot/alice", configURI: "ipfs://cfg/a" });
        IArena.BotCreateParams memory p2 =
            IArena.BotCreateParams({ metadataURI: "ipfs://bot/bob", configURI: "ipfs://cfg/b" });

        vm.prank(alice);
        address aliceBot = arena.createBot(p1);
        vm.prank(bob);
        address bobBot = arena.createBot(p2);

        IArena.GameCreateParams memory gp = IArena.GameCreateParams({
            tier: IArena.Tier.Unranked,
            settingsHash: keccak256("6max-unranked"),
            maxPlayers: 6
        });

        vm.prank(alice);
        uint256 gameId = arena.createGame(gp, aliceBot);

        vm.prank(bob);
        arena.joinGame(gameId, bobBot);

        uint256 tokenId = chips.gameTokenId(gameId, uint8(IArena.Tier.Unranked));
        assertEq(chips.balanceOf(aliceBot, tokenId), AgenticArenaTypes.DEFAULT_STARTING_CHIPS);
        assertEq(chips.balanceOf(bobBot, tokenId), AgenticArenaTypes.DEFAULT_STARTING_CHIPS);

        IArena.SettlementPlayer[] memory players = new IArena.SettlementPlayer[](2);
        players[0] = IArena.SettlementPlayer({
            bot: aliceBot,
            chipsStart: 1000,
            chipsEnd: 1300,
            handsWon: 8,
            winner: true,
            preGameScore: 1000
        });
        players[1] = IArena.SettlementPlayer({
            bot: bobBot,
            chipsStart: 1000,
            chipsEnd: 700,
            handsWon: 4,
            winner: false,
            preGameScore: 1100
        });

        AgenticArenaTypes.SettlementPlayer[] memory playersForHash =
            new AgenticArenaTypes.SettlementPlayer[](2);
        playersForHash[0] = AgenticArenaTypes.SettlementPlayer({
            bot: aliceBot,
            seat: 0,
            winner: true,
            handsWon: 8,
            chipsStart: 1000,
            chipsEnd: 1300,
            preGameScore: 1000
        });
        playersForHash[1] = AgenticArenaTypes.SettlementPlayer({
            bot: bobBot,
            seat: 1,
            winner: false,
            handsWon: 4,
            chipsStart: 1000,
            chipsEnd: 700,
            preGameScore: 1100
        });

        AgenticArenaTypes.SettlementPayload memory payload = AgenticArenaTypes.SettlementPayload({
            schemaVersion: AgenticArenaTypes.SETTLEMENT_SCHEMA_VERSION,
            gameId: gameId,
            tier: uint8(IArena.Tier.Unranked),
            handCount: 12,
            startedAt: 1_000_000,
            endedAt: 1_000_900,
            tableConfigHash: keccak256("6max-unranked"),
            handSummaryRoot: keccak256("hands-root"),
            nonce: 1,
            players: playersForHash
        });
        bytes32 resultHash = AgenticArenaTypes.hashSettlement(payload);

        IArena.GameSettlement memory settlement = IArena.GameSettlement({
            schemaVersion: AgenticArenaTypes.SETTLEMENT_SCHEMA_VERSION,
            gameId: gameId,
            tier: IArena.Tier.Unranked,
            handCount: 12,
            startedAt: 1_000_000,
            endedAt: 1_000_900,
            tableConfigHash: keccak256("6max-unranked"),
            players: players,
            handSummaryRoot: keccak256("hands-root"),
            nonce: 1,
            resultHash: resultHash
        });

        vm.prank(settler);
        arena.settleGame(settlement);

        assertEq(chips.balanceOf(aliceBot, tokenId), 0);
        assertEq(chips.balanceOf(bobBot, tokenId), 0);

        IAgenticRankingsV2.BotProfile memory pa = rankings.profileOf(aliceBot);
        IAgenticRankingsV2.BotProfile memory pb = rankings.profileOf(bobBot);
        assertEq(pa.gamesPlayed, 1);
        assertEq(pa.gamesWon, 1);
        assertEq(pb.gamesPlayed, 1);
        assertEq(pb.gamesWon, 0);
    }

    function test_eliteJoin_revertsUntilTop100() public {
        IArena.BotCreateParams memory p =
            IArena.BotCreateParams({ metadataURI: "ipfs://bot/x", configURI: "ipfs://cfg/x" });
        vm.prank(alice);
        address bot = arena.createBot(p);

        IArena.GameCreateParams memory gp = IArena.GameCreateParams({
            tier: IArena.Tier.Elite,
            settingsHash: keccak256("elite"),
            maxPlayers: 6
        });

        vm.prank(alice);
        vm.expectRevert("Elite gate");
        arena.createGame(gp, bot);
    }
}

