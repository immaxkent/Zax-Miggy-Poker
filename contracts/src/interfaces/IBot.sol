// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBot {
    event ArenaApproved(address indexed arena, bool approved);
    event OperatorUpdated(address indexed operator, bool approved);
    event MetadataURIUpdated(string newURI);
    event ConfigURIUpdated(string newURI);
    event HistoryURIUpdated(string newURI);

    function owner() external view returns (address);
    function arena() external view returns (address);
    function isOperator(address account) external view returns (bool);

    function metadataURI() external view returns (string memory);
    function configURI() external view returns (string memory);
    function historyURI() external view returns (string memory);

    function setArenaApproval(address arenaAddress, bool approved) external;
    function setOperator(address operator, bool approved) external;

    function setMetadataURI(string calldata newURI) external;
    function setConfigURI(string calldata newURI) external;
    function setHistoryURI(string calldata newURI) external;
}

