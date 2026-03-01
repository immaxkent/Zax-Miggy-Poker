// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title ChipToken
 * @notice ERC-1155 "chips" fractionalized by a backing NFT. Only the owner of the
 *         backing NFT (collection, tokenId) can mint chips for that token type.
 *         Token ID is deterministic: keccak256(abi.encodePacked(collection, sourceTokenId)).
 */
contract ChipToken is ERC1155, Ownable {
    /// Optional: max chips mintable per backing NFT (0 = no cap)
    uint256 public maxSupplyPerNft;

    /// Optional: only these collections can back chips (empty = any collection)
    mapping(address => bool) public allowedCollections;
    bool public useAllowlist;

    event ChipsMinted(
        address indexed to,
        address indexed collection,
        uint256 indexed sourceTokenId,
        uint256 chipTokenId,
        uint256 amount
    );

    constructor(
        string memory uri_,
        uint256 maxSupplyPerNft_
    ) ERC1155(uri_) Ownable(msg.sender) {
        maxSupplyPerNft = maxSupplyPerNft_;
    }

    /// @notice Compute chip token ID from backing NFT (collection, sourceTokenId).
    function getTokenId(
        address collection,
        uint256 sourceTokenId
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collection, sourceTokenId)));
    }

    /// @notice Mint chips to caller. Caller must own the backing NFT.
    function mint(
        address collection,
        uint256 sourceTokenId,
        uint256 amount
    ) external {
        if (useAllowlist && !allowedCollections[collection]) {
            revert("Collection not allowed");
        }
        require(
            IERC721(collection).ownerOf(sourceTokenId) == msg.sender,
            "Not NFT owner"
        );
        require(amount > 0, "Zero amount");

        uint256 chipId = getTokenId(collection, sourceTokenId);
        if (maxSupplyPerNft > 0) {
            uint256 existing = balanceOf(msg.sender, chipId);
            require(
                existing + amount <= maxSupplyPerNft,
                "Exceeds max supply per NFT"
            );
        }

        _mint(msg.sender, chipId, amount, "");
        emit ChipsMinted(
            msg.sender,
            collection,
            sourceTokenId,
            chipId,
            amount
        );
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);
    }

    function setMaxSupplyPerNft(uint256 _max) external onlyOwner {
        maxSupplyPerNft = _max;
    }

    function setAllowlist(address collection, bool allowed) external onlyOwner {
        allowedCollections[collection] = allowed;
    }

    function setUseAllowlist(bool _use) external onlyOwner {
        useAllowlist = _use;
    }
}
