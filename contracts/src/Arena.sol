// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AgenticArenaTypes.sol";
import "./interfaces/IArena.sol";
import "./interfaces/IBotFactory.sol";
import "./interfaces/IAgenticChips1155.sol";
import "./interfaces/IAgenticRankingsV2.sol";

contract Arena is IArena, Ownable, ReentrancyGuard {
    IERC20 public immutable usdcToken;
    address public override treasury;
    address public override botFactory;
    address public override rankings;
    address public override chips1155;
    address public settlementSigner;

    uint256 public override botCreationFee = AgenticArenaTypes.BOT_CREATE_FEE_USDC;
    uint256 public override gameCount;

    struct GameState {
        Tier tier;
        bytes32 settingsHash;
        bool settled;
        address creatorBot;
        address[] players;
        mapping(address => bool) joined;
    }

    mapping(uint256 => GameState) private games;
    mapping(uint8 => uint256) private _tierFee;
    mapping(bytes32 => bool) public consumedSettlementHashes;

    modifier onlySettlementSigner() {
        require(msg.sender == settlementSigner, "Not settlement signer");
        _;
    }

    constructor(
        address usdcAddress,
        address treasuryAddress,
        address botFactoryAddress,
        address rankingsAddress,
        address chipsAddress,
        address settlementSignerAddress
    ) Ownable(msg.sender) {
        require(usdcAddress != address(0), "Zero usdc");
        require(treasuryAddress != address(0), "Zero treasury");
        require(botFactoryAddress != address(0), "Zero factory");
        require(rankingsAddress != address(0), "Zero rankings");
        require(chipsAddress != address(0), "Zero chips");
        require(settlementSignerAddress != address(0), "Zero signer");
        usdcToken = IERC20(usdcAddress);
        treasury = treasuryAddress;
        botFactory = botFactoryAddress;
        rankings = rankingsAddress;
        chips1155 = chipsAddress;
        settlementSigner = settlementSignerAddress;
        _tierFee[uint8(Tier.Unranked)] = AgenticArenaTypes.UNRANKED_FEE_USDC;
        _tierFee[uint8(Tier.Ranked)] = AgenticArenaTypes.RANKED_FEE_USDC;
        _tierFee[uint8(Tier.Elite)] = AgenticArenaTypes.ELITE_FEE_USDC;
    }

    function tierFee(Tier tier) public view override returns (uint256) {
        return _tierFee[uint8(tier)];
    }

    function createBot(BotCreateParams calldata params)
        external
        override
        nonReentrant
        returns (address bot)
    {
        require(usdcToken.transferFrom(msg.sender, treasury, botCreationFee), "USDC transfer failed");
        bot = IBotFactory(botFactory).deployBot(
            msg.sender,
            params.metadataURI,
            params.configURI,
            keccak256(abi.encode(msg.sender, block.timestamp))
        );
        IAgenticRankingsV2(rankings).registerBot(msg.sender, bot);
        emit BotCreated(msg.sender, bot, botCreationFee);
    }

    function createGame(GameCreateParams calldata params, address bot)
        external
        override
        nonReentrant
        returns (uint256 gameId)
    {
        _validateTierAccess(params.tier, bot);
        uint256 fee = tierFee(params.tier);
        require(usdcToken.transferFrom(msg.sender, treasury, fee), "USDC transfer failed");

        gameId = gameCount++;
        GameState storage g = games[gameId];
        g.tier = params.tier;
        g.settingsHash = params.settingsHash;
        g.creatorBot = bot;
        g.players.push(bot);
        g.joined[bot] = true;

        IAgenticChips1155(chips1155).mintGameChips(
            gameId, uint8(params.tier), bot, AgenticArenaTypes.DEFAULT_STARTING_CHIPS
        );

        emit GameCreated(gameId, bot, params.tier, params.settingsHash);
        emit GameJoined(gameId, bot, params.tier, fee, AgenticArenaTypes.DEFAULT_STARTING_CHIPS);
    }

    function joinGame(uint256 gameId, address bot) external override nonReentrant {
        GameState storage g = games[gameId];
        require(!g.settled, "Game settled");
        require(g.creatorBot != address(0), "Game not found");
        require(!g.joined[bot], "Already joined");

        _validateTierAccess(g.tier, bot);
        uint256 fee = tierFee(g.tier);
        require(usdcToken.transferFrom(msg.sender, treasury, fee), "USDC transfer failed");

        g.players.push(bot);
        g.joined[bot] = true;
        IAgenticChips1155(chips1155).mintGameChips(
            gameId, uint8(g.tier), bot, AgenticArenaTypes.DEFAULT_STARTING_CHIPS
        );
        emit GameJoined(gameId, bot, g.tier, fee, AgenticArenaTypes.DEFAULT_STARTING_CHIPS);
    }

    function settleGame(GameSettlement calldata settlement) external override onlySettlementSigner {
        GameState storage g = games[settlement.gameId];
        require(!g.settled, "Already settled");
        require(g.creatorBot != address(0), "Game not found");
        require(g.tier == settlement.tier, "Tier mismatch");

        AgenticArenaTypes.SettlementPlayer[] memory players =
            new AgenticArenaTypes.SettlementPlayer[](settlement.players.length);
        IAgenticRankingsV2.GamePlayerResult[] memory results =
            new IAgenticRankingsV2.GamePlayerResult[](settlement.players.length);

        for (uint256 i = 0; i < settlement.players.length; i++) {
            SettlementPlayer calldata p = settlement.players[i];
            require(g.joined[p.bot], "Unknown player");
            IAgenticChips1155(chips1155).burnGameChips(
                settlement.gameId, uint8(settlement.tier), p.bot, p.chipsStart
            );

            players[i] = AgenticArenaTypes.SettlementPlayer({
                bot: p.bot,
                seat: uint16(i),
                winner: p.winner,
                handsWon: p.handsWon,
                chipsStart: p.chipsStart,
                chipsEnd: p.chipsEnd,
                preGameScore: p.preGameScore
            });
            results[i] = IAgenticRankingsV2.GamePlayerResult({
                bot: p.bot,
                winner: p.winner,
                handsWon: p.handsWon,
                chipsStart: p.chipsStart,
                chipsEnd: p.chipsEnd,
                preGameScore: p.preGameScore
            });
        }

        AgenticArenaTypes.SettlementPayload memory payload = AgenticArenaTypes.SettlementPayload({
            schemaVersion: settlement.schemaVersion,
            gameId: settlement.gameId,
            tier: uint8(settlement.tier),
            handCount: settlement.handCount,
            startedAt: settlement.startedAt,
            endedAt: settlement.endedAt,
            tableConfigHash: settlement.tableConfigHash,
            handSummaryRoot: settlement.handSummaryRoot,
            nonce: settlement.nonce,
            players: players
        });

        bytes32 resultHash = AgenticArenaTypes.hashSettlement(payload);
        require(resultHash == settlement.resultHash, "Result hash mismatch");
        require(!consumedSettlementHashes[resultHash], "Replay");
        consumedSettlementHashes[resultHash] = true;

        IAgenticRankingsV2(rankings).applyGameResult(settlement.gameId, uint8(settlement.tier), results);

        g.settled = true;
        emit GameSettled(settlement.gameId, settlement.tier, settlement.handSummaryRoot);
    }

    function setTreasury(address newTreasury) external override onlyOwner {
        require(newTreasury != address(0), "Zero treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setBotCreationFee(uint256 newFee) external override onlyOwner {
        botCreationFee = newFee;
        emit BotCreationFeeUpdated(newFee);
    }

    function setTierFee(Tier tier, uint256 newFee) external override onlyOwner {
        _tierFee[uint8(tier)] = newFee;
        emit TierFeeUpdated(tier, newFee);
    }

    function usdc() external view override returns (address) {
        return address(usdcToken);
    }

    function setSettlementSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Zero signer");
        settlementSigner = newSigner;
    }

    function getGamePlayers(uint256 gameId) external view returns (address[] memory) {
        return games[gameId].players;
    }

    function _validateTierAccess(Tier tier, address bot) internal view {
        if (tier == Tier.Elite) {
            require(IAgenticRankingsV2(rankings).isEliteEligible(bot), "Elite gate");
        }
    }
}

