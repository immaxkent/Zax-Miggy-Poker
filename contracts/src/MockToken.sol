// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockToken
/// @notice Minimal ERC20 for local dev (anvil). Deploy with DeployLocal.s.sol.
contract MockToken is ERC20 {
    constructor() ERC20("MockChip", "CHIP") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}
