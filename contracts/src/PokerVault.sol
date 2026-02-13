// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PokerVault
 * @notice Holds ERC-20 tokens for poker platform on Base.
 *         - Players deposit tokens to receive chips
 *         - Game server issues signed vouchers for withdrawals
 *         - Rake is taken on BUY-IN and on WINNER CASHOUT (not per pot)
 *         - Nonce system prevents replay attacks
 *         - Server identity verified on-chain via signer address
 */
contract PokerVault is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20  public immutable token;
    address public serverSigner;          // AWS server's signing wallet
    address public feeRecipient;

    // Fee config (basis points, 100 = 1%)
    uint256 public buyInFeeBps   = 800;   // 8% on buy-in
    uint256 public winnerFeeBps  = 500;   // 5% on winner cashout
    uint256 public constant MAX_FEE_BPS = 2000; // 20% hard cap

    // Player chip balances (off-chain credits, tracked for emergency)
    mapping(address => uint256) public depositedBalance;
    // Nonces prevent voucher replay
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed player, uint256 gross, uint256 net, uint256 fee);
    event Withdrawn(address indexed player, uint256 gross, uint256 net, uint256 fee, uint256 nonce);
    event ServerSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FeeConfigUpdated(uint256 buyInFeeBps, uint256 winnerFeeBps);
    event FeeRecipientUpdated(address indexed recipient);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _token,
        address _serverSigner,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_token        != address(0), "Zero token");
        require(_serverSigner != address(0), "Zero signer");
        require(_feeRecipient != address(0), "Zero fee recipient");

        token         = IERC20(_token);
        serverSigner  = _serverSigner;
        feeRecipient  = _feeRecipient;
    }

    // ─── Player Actions ───────────────────────────────────────────────────────

    /**
     * @notice Deposit tokens. Buy-in fee is deducted immediately.
     *         Net chips are credited to the game server for the player.
     */
    function deposit(uint256 grossAmount) external nonReentrant {
        require(grossAmount > 0, "Zero amount");

        uint256 fee    = (grossAmount * buyInFeeBps) / 10_000;
        uint256 net    = grossAmount - fee;

        // Pull full amount from player
        token.transferFrom(msg.sender, address(this), grossAmount);

        // Send fee to recipient immediately
        if (fee > 0) token.transfer(feeRecipient, fee);

        depositedBalance[msg.sender] += net;
        emit Deposited(msg.sender, grossAmount, net, fee);
    }

    /**
     * @notice Withdraw winnings. Server signs a voucher authorising the amount.
     *         Winner fee is deducted at withdrawal time.
     *
     * @param grossAmount  Token amount the server is authorising
     * @param nonce        Unique per-player nonce to prevent replay
     * @param sig          ECDSA signature from serverSigner
     */
    function withdraw(
        uint256 grossAmount,
        uint256 nonce,
        bytes calldata sig
    ) external nonReentrant {
        require(grossAmount > 0, "Zero amount");
        require(!usedNonces[msg.sender][nonce], "Nonce reused");

        // ── Verify the server actually signed this voucher ──────────────────
        bytes32 msgHash = _buildHash(msg.sender, grossAmount, nonce);
        address recovered = msgHash.recover(sig);
        require(recovered == serverSigner, "Invalid server signature");

        // Mark nonce consumed
        usedNonces[msg.sender][nonce] = true;

        uint256 fee = (grossAmount * winnerFeeBps) / 10_000;
        uint256 net = grossAmount - fee;

        if (fee > 0) token.transfer(feeRecipient, fee);
        token.transfer(msg.sender, net);

        emit Withdrawn(msg.sender, grossAmount, net, fee, nonce);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setServerSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Zero signer");
        emit ServerSignerUpdated(serverSigner, _newSigner);
        serverSigner = _newSigner;
    }

    function setFeeConfig(uint256 _buyInBps, uint256 _winnerBps) external onlyOwner {
        require(_buyInBps  <= MAX_FEE_BPS, "Buy-in fee too high");
        require(_winnerBps <= MAX_FEE_BPS, "Winner fee too high");
        buyInFeeBps  = _buyInBps;
        winnerFeeBps = _winnerBps;
        emit FeeConfigUpdated(_buyInBps, _winnerBps);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(_recipient);
    }

    // Emergency: owner can recover accidentally sent tokens (NOT the game token)
    function recoverToken(address _token, uint256 _amount) external onlyOwner {
        require(_token != address(token), "Cannot skim vault token");
        IERC20(_token).transfer(owner(), _amount);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Recreate the exact hash the server must have signed.
     *         Includes chain ID to prevent cross-chain replay.
     */
    function _buildHash(
        address player,
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 raw = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                player,
                amount,
                nonce
            )
        );
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    /// @notice Off-chain helper – returns the hash a server should sign
    function buildWithdrawHash(
        address player,
        uint256 amount,
        uint256 nonce
    ) external view returns (bytes32) {
        return _buildHash(player, amount, nonce);
    }
}
