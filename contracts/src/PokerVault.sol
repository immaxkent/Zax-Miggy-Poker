// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PokerVault
 * @notice Holds ERC-20 and/or ERC-1155 chips for poker platform.
 *         - Players deposit tokens or chips to receive credits
 *         - Game server issues signed vouchers for withdrawals
 *         - Rake on BUY-IN and WINNER CASHOUT; nonce prevents replay
 *         - Optional chipToken: deposit/withdraw ERC-1155 chips (per tokenId)
 */
contract PokerVault is Ownable, ReentrancyGuard, ERC1155Holder {
    using ECDSA for bytes32;

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20  public immutable token;
    IERC1155 public chipToken;            // optional; address(0) = chip ops disabled
    address public serverSigner;
    address public feeRecipient;

    // Fee config (basis points, 100 = 1%)
    uint256 public buyInFeeBps   = 800;   // 8% on buy-in
    uint256 public winnerFeeBps  = 500;   // 5% on winner cashout
    uint256 public constant MAX_FEE_BPS = 2000; // 20% hard cap

    // ERC-20: player => balance
    mapping(address => uint256) public depositedBalance;
    // ERC-1155: player => chipTokenId => balance
    mapping(address => mapping(uint256 => uint256)) public depositedChips;
    // Nonces prevent voucher replay (shared for ERC-20 and chip withdraws)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed player, uint256 gross, uint256 net, uint256 fee);
    event Withdrawn(address indexed player, uint256 gross, uint256 net, uint256 fee, uint256 nonce);
    event ChipsDeposited(address indexed player, uint256 indexed tokenId, uint256 gross, uint256 net, uint256 fee);
    event ChipsWithdrawn(address indexed player, uint256 indexed tokenId, uint256 gross, uint256 net, uint256 fee, uint256 nonce);
    event ChipTokenUpdated(address indexed oldChipToken, address indexed newChipToken);
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

    /**
     * @notice Deposit ERC-1155 chips. Buy-in fee is deducted in chips; net credited.
     *         chipToken must be set.
     */
    function depositChips(uint256 tokenId, uint256 grossAmount) external nonReentrant {
        require(address(chipToken) != address(0), "Chip token not set");
        require(grossAmount > 0, "Zero amount");

        uint256 fee = (grossAmount * buyInFeeBps) / 10_000;
        uint256 net = grossAmount - fee;

        chipToken.safeTransferFrom(msg.sender, address(this), tokenId, grossAmount, "");

        if (fee > 0) {
            chipToken.safeTransferFrom(address(this), feeRecipient, tokenId, fee, "");
        }

        depositedChips[msg.sender][tokenId] += net;
        emit ChipsDeposited(msg.sender, tokenId, grossAmount, net, fee);
    }

    /**
     * @notice Withdraw chips. Server signs (player, tokenId, amount, nonce).
     */
    function withdrawChips(
        uint256 tokenId,
        uint256 grossAmount,
        uint256 nonce,
        bytes calldata sig
    ) external nonReentrant {
        require(address(chipToken) != address(0), "Chip token not set");
        require(grossAmount > 0, "Zero amount");
        require(!usedNonces[msg.sender][nonce], "Nonce reused");

        bytes32 msgHash = _buildChipsHash(msg.sender, tokenId, grossAmount, nonce);
        address recovered = msgHash.recover(sig);
        require(recovered == serverSigner, "Invalid server signature");

        usedNonces[msg.sender][nonce] = true;

        uint256 fee = (grossAmount * winnerFeeBps) / 10_000;
        uint256 net = grossAmount - fee;
        require(depositedChips[msg.sender][tokenId] >= net, "Insufficient chip balance");

        depositedChips[msg.sender][tokenId] -= net;

        if (fee > 0) {
            chipToken.safeTransferFrom(address(this), feeRecipient, tokenId, fee, "");
        }
        chipToken.safeTransferFrom(address(this), msg.sender, tokenId, net, "");

        emit ChipsWithdrawn(msg.sender, tokenId, grossAmount, net, fee, nonce);
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

    function setChipToken(address _chipToken) external onlyOwner {
        emit ChipTokenUpdated(address(chipToken), _chipToken);
        chipToken = IERC1155(_chipToken);
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

    /// @notice Off-chain helper – returns the hash a server should sign (ERC-20 withdraw)
    function buildWithdrawHash(
        address player,
        uint256 amount,
        uint256 nonce
    ) external view returns (bytes32) {
        return _buildHash(player, amount, nonce);
    }

    /**
     * @notice Hash for chip withdrawal voucher. Server signs this (EIP-191).
     */
    function _buildChipsHash(
        address player,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 raw = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                player,
                tokenId,
                amount,
                nonce
            )
        );
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    /// @notice Off-chain helper – hash for chip withdraw (server signs this)
    function buildWithdrawChipsHash(
        address player,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce
    ) external view returns (bytes32) {
        return _buildChipsHash(player, tokenId, amount, nonce);
    }

    /// @notice Accept direct transfer of chips to vault; credits "from" (no fee).
    function onERC1155Received(
        address,
        address from,
        uint256 id,
        uint256 value,
        bytes memory
    ) public virtual override returns (bytes4) {
        if (address(chipToken) != address(0) && msg.sender == address(chipToken) && from != address(0)) {
            depositedChips[from][id] += value;
        }
        return this.onERC1155Received.selector;
    }
}
