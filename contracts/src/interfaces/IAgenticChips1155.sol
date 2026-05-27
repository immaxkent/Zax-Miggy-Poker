// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgenticChips1155 {
    event ArenaSet(address indexed arena);
    event ChipsMinted(
        uint256 indexed gameId,
        uint8 indexed tier,
        address indexed bot,
        uint256 tokenId,
        uint256 amount
    );
    event ChipsBurned(
        uint256 indexed gameId,
        uint8 indexed tier,
        address indexed bot,
        uint256 tokenId,
        uint256 amount
    );

    function arena() external view returns (address);
    function gameTokenId(uint256 gameId, uint8 tier) external pure returns (uint256);

    function setArena(address arenaAddress) external;
    function mintGameChips(uint256 gameId, uint8 tier, address bot, uint256 amount) external;
    function burnGameChips(uint256 gameId, uint8 tier, address bot, uint256 amount) external;
}

