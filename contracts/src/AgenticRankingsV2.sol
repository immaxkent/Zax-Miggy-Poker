// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgenticRankingsV2.sol";

contract AgenticRankingsV2 is IAgenticRankingsV2, Ownable {
    uint256 public constant ELITE_CUTOFF = 100;

    address public updater;

    mapping(address => bool) public override isRegistered;
    mapping(address => BotProfile) internal profiles;
    mapping(address => uint256) public override rankOf;
    address[] internal topBots;

    modifier onlyUpdater() {
        require(msg.sender == updater, "Not updater");
        _;
    }

    constructor(address initialUpdater) Ownable(msg.sender) {
        require(initialUpdater != address(0), "Zero updater");
        updater = initialUpdater;
    }

    function setUpdater(address newUpdater) external onlyOwner {
        require(newUpdater != address(0), "Zero updater");
        updater = newUpdater;
    }

    function profileOf(address bot) external view override returns (BotProfile memory) {
        return profiles[bot];
    }

    function topBotAt(uint256 index) external view override returns (address) {
        require(index < topBots.length, "Index OOB");
        return topBots[index];
    }

    function isEliteEligible(address bot) external view override returns (bool) {
        uint256 r = rankOf[bot];
        return r > 0 && r <= ELITE_CUTOFF;
    }

    function registerBot(address, address bot) external override onlyUpdater {
        require(bot != address(0), "Zero bot");
        require(!isRegistered[bot], "Already registered");
        isRegistered[bot] = true;
        emit BotRegistered(msg.sender, bot);
    }

    function applyGameResult(uint256 gameId, uint8 tier, GamePlayerResult[] calldata results)
        external
        override
        onlyUpdater
    {
        require(results.length >= 2, "Need >=2 players");

        bytes32 resultHash = keccak256(abi.encode(gameId, tier, results));
        emit GameResultApplied(gameId, tier, resultHash);

        for (uint256 i = 0; i < results.length; i++) {
            GamePlayerResult calldata r = results[i];
            require(isRegistered[r.bot], "Unregistered bot");

            BotProfile storage p = profiles[r.bot];
            uint256 oldScore = p.compositeScore;

            p.gamesPlayed += 1;
            p.handsWon += r.handsWon;

            if (tier == 1) p.rankedGames += 1;
            if (tier == 2) p.eliteGames += 1;

            if (r.winner) {
                p.gamesWon += 1;
                if (tier == 1) p.rankedWins += 1;
                if (tier == 2) p.eliteWins += 1;
            }

            int256 delta = int256(r.chipsEnd) - int256(r.chipsStart);
            p.chipsNet += delta;

            uint256 scoreDelta = _scoreDelta(r, tier);
            if (r.winner) {
                p.assassinScore += scoreDelta / 2;
                p.recencyScore += scoreDelta / 4;
                p.consistencyScore += scoreDelta / 4;
                p.compositeScore += scoreDelta;
            } else {
                uint256 penalty = scoreDelta / 3;
                p.compositeScore = p.compositeScore > penalty ? p.compositeScore - penalty : 0;
            }

            emit BotScoreUpdated(r.bot, oldScore, p.compositeScore);
            _updateRanking(r.bot);
        }
    }

    function _scoreDelta(GamePlayerResult calldata r, uint8 tier) internal pure returns (uint256) {
        uint256 tierMul = tier == 2 ? 3 : (tier == 1 ? 2 : 1);
        uint256 chipGain = r.chipsEnd > r.chipsStart ? r.chipsEnd - r.chipsStart : 0;
        return tierMul * (100 + chipGain + r.handsWon * 5 + (r.winner ? 200 : 0));
    }

    function _updateRanking(address bot) internal {
        bool exists = false;
        for (uint256 i = 0; i < topBots.length; i++) {
            if (topBots[i] == bot) {
                exists = true;
                break;
            }
        }
        if (!exists) topBots.push(bot);

        // insertion sort for small league sizes in v1
        for (uint256 i = 1; i < topBots.length; i++) {
            address key = topBots[i];
            uint256 j = i;
            while (j > 0 && profiles[topBots[j - 1]].compositeScore < profiles[key].compositeScore) {
                topBots[j] = topBots[j - 1];
                j--;
            }
            topBots[j] = key;
        }

        for (uint256 k = 0; k < topBots.length; k++) {
            rankOf[topBots[k]] = k + 1;
        }
    }
}

