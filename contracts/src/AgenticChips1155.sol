// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgenticChips1155.sol";

contract AgenticChips1155 is ERC1155, Ownable, IAgenticChips1155 {
    address public override arena;

    modifier onlyArena() {
        require(msg.sender == arena, "Only arena");
        _;
    }

    constructor(string memory baseURI) ERC1155(baseURI) Ownable(msg.sender) {}

    function setArena(address arenaAddress) external override onlyOwner {
        require(arenaAddress != address(0), "Zero arena");
        arena = arenaAddress;
        emit ArenaSet(arenaAddress);
    }

    function gameTokenId(uint256 gameId, uint8 tier) public pure override returns (uint256) {
        return (uint256(tier) << 248) | gameId;
    }

    function mintGameChips(uint256 gameId, uint8 tier, address bot, uint256 amount)
        external
        override
        onlyArena
    {
        uint256 tokenId = gameTokenId(gameId, tier);
        _mint(bot, tokenId, amount, "");
        emit ChipsMinted(gameId, tier, bot, tokenId, amount);
    }

    function burnGameChips(uint256 gameId, uint8 tier, address bot, uint256 amount)
        external
        override
        onlyArena
    {
        uint256 tokenId = gameTokenId(gameId, tier);
        _burn(bot, tokenId, amount);
        emit ChipsBurned(gameId, tier, bot, tokenId, amount);
    }

    /// @dev Only mint/burn allowed — chips are not transferable between players.
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        require(from == address(0) || to == address(0), "Non-transferable");
        super._update(from, to, ids, values);
    }
}

