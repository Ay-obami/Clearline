// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal token surface the Clearline adapters rely on. Implemented by
/// MockRWAToken and by real ERC-3643 tokens whose Agent-scoped burn/transfer
/// semantics match (PRD 4.4: Clearline consumes standard functions rather than
/// reimplementing them).
interface IBurnableAsset {
    function burn(address from, uint256 amount) external;

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner_, address spender_) external view returns (uint256);
}
