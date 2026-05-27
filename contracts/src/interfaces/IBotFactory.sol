// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBotFactory {
    event BotDeployed(
        address indexed owner,
        address indexed bot,
        address indexed arena,
        bytes32 salt
    );

    function arena() external view returns (address);
    function implementation() external view returns (address);
    function botOf(address owner, uint256 nonce) external view returns (address);
    function botCount(address owner) external view returns (uint256);

    function deployBot(
        address owner,
        string calldata metadataURI,
        string calldata configURI,
        bytes32 salt
    ) external returns (address bot);
}

