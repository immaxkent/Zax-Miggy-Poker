// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Bot.sol";
import "./interfaces/IBotFactory.sol";

contract BotFactory is IBotFactory, Ownable {
    address public override arena;
    address public immutable override implementation;

    mapping(address => mapping(uint256 => address)) public override botOf;
    mapping(address => uint256) public override botCount;

    modifier onlyArena() {
        require(msg.sender == arena, "Only arena");
        _;
    }

    constructor(address arenaAddress) Ownable(msg.sender) {
        arena = arenaAddress;
        implementation = address(0); // placeholder for future clone model
    }

    function setArena(address arenaAddress) external onlyOwner {
        require(arenaAddress != address(0), "Zero arena");
        arena = arenaAddress;
    }

    function deployBot(
        address owner_,
        string calldata metadataURI,
        string calldata configURI,
        bytes32 salt
    ) external override onlyArena returns (address bot) {
        uint256 nonce = botCount[owner_];
        bytes32 derivedSalt = keccak256(abi.encode(owner_, nonce, salt));
        bot = address(new Bot{ salt: derivedSalt }(owner_, arena, metadataURI, configURI));
        botOf[owner_][nonce] = bot;
        botCount[owner_] = nonce + 1;
        emit BotDeployed(owner_, bot, arena, derivedSalt);
    }
}

