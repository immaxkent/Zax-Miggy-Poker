// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IZaxAndMiggyVault.sol";

/**
 * @title AgenticRankings
 * @notice Tracks wins, games played, and USDC won/lost for every address
 *         (human or bot) that participates in ZaxAndMiggyVault games.
 *
 * Call flow:
 *   closeGame  confirmed → server calls updateRankings(gameId)
 *   cancelGame confirmed → server calls recordCancellation(gameId)
 *
 * Only the server signer (same key used to sign vault vouchers) may update stats.
 * The vault is the source of truth — this contract reads game data directly from it.
 */
contract AgenticRankings is Ownable {

    // ─── Types ────────────────────────────────────────────────────────────────

    struct PlayerStats {
        uint256 wins;
        uint256 gamesPlayed;
        uint256 totalWon;   // gross USDC received as winner payout (6 decimals)
        uint256 totalLost;  // gross USDC deposited per game (6 decimals), winner included
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public serverSigner;
    IZaxAndMiggyVault public immutable vault;

    mapping(address => PlayerStats) public stats;
    mapping(uint256 => bool) public processedGames;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RankingsUpdated(uint256 indexed gameId, address indexed winner, uint8 playerCount);
    event CancellationRecorded(uint256 indexed gameId, uint8 playerCount);
    event ServerSignerUpdated(address indexed oldSigner, address indexed newSigner);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyServerSigner() {
        require(msg.sender == serverSigner, "Not authorized");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _vault,
        address _serverSigner,
        address _owner
    ) Ownable(_owner) {
        require(_vault != address(0), "Zero vault");
        require(_serverSigner != address(0), "Zero signer");
        vault = IZaxAndMiggyVault(_vault);
        serverSigner = _serverSigner;
    }

    // ─── Server-callable ──────────────────────────────────────────────────────

    /**
     * @notice Record the outcome of a completed game. Reads all data trustlessly
     *         from the vault — no parameters needed beyond gameId.
     *
     *         - Winner:   wins++, gamesPlayed++, totalWon += payout, totalLost += depositAmount
     *         - Losers:   gamesPlayed++, totalLost += depositAmount
     *
     *         totalLost tracks every deposit (including the winner's entry) so that
     *         netWinnings = max(0, totalWon - totalLost) gives true profit off-chain.
     */
    function updateRankings(uint256 gameId) external onlyServerSigner {
        require(!processedGames[gameId], "Already processed");
        processedGames[gameId] = true;

        (
            address[8] memory players,
            uint8 playerCount,
            uint256 depositAmount,
            ,
            bool finished,
            address winner
        ) = vault.getGame(gameId);

        require(finished, "Game not finished");
        require(winner != address(0), "No winner: use recordCancellation");

        uint256 totalPot = uint256(playerCount) * depositAmount;
        uint256 fee      = (totalPot * 1_000) / 10_000; // 10%, mirrors WINNER_FEE_BPS
        uint256 payout   = totalPot - fee;

        for (uint8 i = 0; i < playerCount; i++) {
            address player = players[i];
            if (player == address(0)) continue;

            stats[player].gamesPlayed++;
            stats[player].totalLost += depositAmount;

            if (player == winner) {
                stats[player].wins++;
                stats[player].totalWon += payout;
            }
        }

        emit RankingsUpdated(gameId, winner, playerCount);
    }

    /**
     * @notice Record a cancelled game (host terminated before first hand).
     *         All players get gamesPlayed++ only — no win/loss, funds were refunded.
     */
    function recordCancellation(uint256 gameId) external onlyServerSigner {
        require(!processedGames[gameId], "Already processed");
        processedGames[gameId] = true;

        (
            address[8] memory players,
            uint8 playerCount,
            ,
            ,
            bool finished,
            address winner
        ) = vault.getGame(gameId);

        require(finished, "Game not finished");
        require(winner == address(0), "Has winner: use updateRankings");

        for (uint8 i = 0; i < playerCount; i++) {
            address player = players[i];
            if (player == address(0)) continue;
            stats[player].gamesPlayed++;
        }

        emit CancellationRecorded(gameId, playerCount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setServerSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Zero signer");
        emit ServerSignerUpdated(serverSigner, _newSigner);
        serverSigner = _newSigner;
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function getStats(address player) external view returns (PlayerStats memory) {
        return stats[player];
    }

    /**
     * @notice Batch fetch stats for a list of addresses. Useful for leaderboard queries.
     */
    function getStatsBatch(address[] calldata addresses) external view returns (PlayerStats[] memory) {
        PlayerStats[] memory result = new PlayerStats[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            result[i] = stats[addresses[i]];
        }
        return result;
    }
}
