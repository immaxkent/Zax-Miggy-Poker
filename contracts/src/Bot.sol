// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "./interfaces/IBot.sol";

contract Bot is IBot, Ownable, ERC1155Holder {
    address public immutable override arena;
    mapping(address => bool) public override isOperator;
    mapping(address => bool) public isArenaApproved;

    string public override metadataURI;
    string public override configURI;
    string public override historyURI;

    modifier onlyOwnerOrOperator() {
        require(owner() == msg.sender || isOperator[msg.sender], "Not owner/operator");
        _;
    }

    constructor(
        address initialOwner,
        address arenaAddress,
        string memory metadataUri_,
        string memory configUri_
    ) Ownable(initialOwner) {
        require(initialOwner != address(0), "Zero owner");
        require(arenaAddress != address(0), "Zero arena");
        arena = arenaAddress;
        metadataURI = metadataUri_;
        configURI = configUri_;
        emit MetadataURIUpdated(metadataUri_);
        emit ConfigURIUpdated(configUri_);
    }

    function owner() public view override(IBot, Ownable) returns (address) {
        return super.owner();
    }

    function setArenaApproval(address arenaAddress, bool approved) external override onlyOwner {
        require(arenaAddress != address(0), "Zero arena");
        isArenaApproved[arenaAddress] = approved;
        emit ArenaApproved(arenaAddress, approved);
    }

    function setOperator(address operator, bool approved) external override onlyOwner {
        require(operator != address(0), "Zero operator");
        isOperator[operator] = approved;
        emit OperatorUpdated(operator, approved);
    }

    function setMetadataURI(string calldata newURI) external override onlyOwnerOrOperator {
        metadataURI = newURI;
        emit MetadataURIUpdated(newURI);
    }

    function setConfigURI(string calldata newURI) external override onlyOwnerOrOperator {
        configURI = newURI;
        emit ConfigURIUpdated(newURI);
    }

    function setHistoryURI(string calldata newURI) external override onlyOwnerOrOperator {
        historyURI = newURI;
        emit HistoryURIUpdated(newURI);
    }
}

