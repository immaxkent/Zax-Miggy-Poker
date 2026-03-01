// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./Utils.sol";

/**
 * @title ZaxAndMiggyVault
 * @notice USDC-based game vault: first player creates a game by depositing (sets table cost).
 *         Others join by depositing the same amount. On close, winner gets pot minus 10% fee.
 *         Server signs close and cancel vouchers. Cancel refunds all players.
 */
contract ZaxAndMiggyVault is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    IERC20 public immutable usdc;
    address public serverSigner;
    address public feeRecipient;

    uint256 public nextGameId;
    mapping(uint256 => Utils.Game) public games;
    mapping(uint256 => mapping(uint256 => bool)) public usedCloseNonces;
    mapping(uint256 => mapping(uint256 => bool)) public usedCancelNonces;
    uint256[] public completedGameIds;

    event GameCreated(uint256 indexed gameId, address indexed creator, uint256 depositAmount);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event GameClosed(uint256 indexed gameId, address indexed winner, uint256 payout, uint256 fee);
    event GameCancelled(uint256 indexed gameId);
    event ServerSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FeeRecipientUpdated(address indexed recipient);

    constructor(
        address _usdc,
        address _serverSigner,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Zero usdc");
        require(_serverSigner != address(0), "Zero signer");
        require(_feeRecipient != address(0), "Zero fee recipient");
        usdc = IERC20(_usdc);
        serverSigner = _serverSigner;
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Create a game by depositing USDC. First player defines the table cost.
     *         Spamming costs real USDC.
     */
    function createGame(uint256 depositAmount) external nonReentrant returns (uint256 gameId) {
        require(depositAmount > 0, "Zero amount");
        usdc.transferFrom(msg.sender, address(this), depositAmount);

        gameId = nextGameId++;
        Utils.Game storage g = games[gameId];
        g.players[0] = msg.sender;
        g.playerCount = 1;
        g.depositAmount = depositAmount;
        g.createdAt = block.timestamp;

        emit GameCreated(gameId, msg.sender, depositAmount);
    }

    /**
     * @notice Join an existing game by depositing the game's table cost.
     */
    function joinGame(uint256 gameId) external nonReentrant {
        Utils.Game storage g = games[gameId];
        require(gameId < nextGameId, "Invalid game");
        require(!g.finished, "Game finished");
        require(g.playerCount < Utils.MAX_PLAYERS, "Table full");
        require(!Utils.hasPlayer(g, msg.sender), "Already in game");

        usdc.transferFrom(msg.sender, address(this), g.depositAmount);
        g.players[g.playerCount] = msg.sender;
        g.playerCount++;

        emit PlayerJoined(gameId, msg.sender);
    }

    /**
     * @notice Close game: pay winner 90% of pot, fee recipient 10%. Server must sign (gameId, winner, nonce).
     */
    function closeGame(
        uint256 gameId,
        address winner,
        uint256 nonce,
        bytes calldata sig
    ) external nonReentrant {
        Utils.Game storage g = games[gameId];
        require(gameId < nextGameId, "Invalid game");
        require(!g.finished, "Game finished");
        require(Utils.hasPlayer(g, winner), "Winner not in game");
        require(!usedCloseNonces[gameId][nonce], "Nonce reused");

        bytes32 hash = _buildCloseHash(gameId, winner, nonce);
        require(hash.recover(sig) == serverSigner, "Invalid signature");
        usedCloseNonces[gameId][nonce] = true;

        uint256 totalPot = uint256(g.playerCount) * g.depositAmount;
        uint256 fee = (totalPot * Utils.WINNER_FEE_BPS) / 10_000;
        uint256 payout = totalPot - fee;

        g.finished = true;
        g.winner = winner;
        completedGameIds.push(gameId);

        if (fee > 0) usdc.transfer(feeRecipient, fee);
        usdc.transfer(winner, payout);

        emit GameClosed(gameId, winner, payout, fee);
    }

    /**
     * @notice Cancel game (e.g. abandoned): refund all players. Server must sign (gameId, nonce) with cancel domain.
     */
    function cancelGame(uint256 gameId, uint256 nonce, bytes calldata sig) external nonReentrant {
        Utils.Game storage g = games[gameId];
        require(gameId < nextGameId, "Invalid game");
        require(!g.finished, "Game finished");
        require(!usedCancelNonces[gameId][nonce], "Nonce reused");

        bytes32 hash = _buildCancelHash(gameId, nonce);
        require(hash.recover(sig) == serverSigner, "Invalid signature");
        usedCancelNonces[gameId][nonce] = true;

        g.finished = true;

        for (uint8 i = 0; i < g.playerCount; i++) {
            address p = g.players[i];
            if (p != address(0)) usdc.transfer(p, g.depositAmount);
        }

        emit GameCancelled(gameId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setServerSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Zero signer");
        emit ServerSignerUpdated(serverSigner, _newSigner);
        serverSigner = _newSigner;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(_recipient);
    }

    function recoverToken(address _token, uint256 _amount) external onlyOwner {
        require(_token != address(usdc), "Cannot skim vault USDC");
        IERC20(_token).transfer(owner(), _amount);
    }

    // ─── View ──────────────────────────────────────────────────────────────────

    function _buildCloseHash(
        uint256 gameId,
        address winner,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 raw = keccak256(
            abi.encodePacked(block.chainid, address(this), gameId, winner, nonce)
        );
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    function _buildCancelHash(uint256 gameId, uint256 nonce) internal view returns (bytes32) {
        bytes32 raw = keccak256(
            abi.encodePacked(block.chainid, address(this), "cancel", gameId, nonce)
        );
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    function buildCloseHash(
        uint256 gameId,
        address winner,
        uint256 nonce
    ) external view returns (bytes32) {
        return _buildCloseHash(gameId, winner, nonce);
    }

    function buildCancelHash(uint256 gameId, uint256 nonce) external view returns (bytes32) {
        return _buildCancelHash(gameId, nonce);
    }

    function getGame(uint256 gameId) external view returns (
        address[8] memory players,
        uint8 playerCount,
        uint256 depositAmount,
        uint256 createdAt,
        bool finished,
        address winner
    ) {
        Utils.Game storage g = games[gameId];
        return (
            g.players,
            g.playerCount,
            g.depositAmount,
            g.createdAt,
            g.finished,
            g.winner
        );
    }

    function getCompletedGameIds() external view returns (uint256[] memory) {
        return completedGameIds;
    }
}
