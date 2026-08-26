// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";

/**
 * @title MockIdentityRegistry
 * @notice Faithful stand-in for an ERC-3643 IdentityRegistry for testnet demos:
 * KYC pass/fail per account, freeze semantics, plus a sanctions/blocklist toggle
 * so the ComplianceRecheck module's failure paths can be exercised on-chain.
 * Production deployments consume the real ERC-3643 registry instead (FR10).
 */
contract MockIdentityRegistry is IIdentityRegistry {
    address public owner;

    mapping(address account => bool verified) private _verified;
    mapping(address account => bool frozen) private _frozen;
    mapping(address account => bool sanctioned) private _sanctioned;

    event VerifiedSet(address indexed account, bool verified);
    event FrozenSet(address indexed account, bool frozen);
    event SanctionedSet(address indexed account, bool sanctioned);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert IIdentityRegistry__NotAuthorized();
        _;
    }

    error IIdentityRegistry__NotAuthorized();

    constructor(address owner_) {
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert IIdentityRegistry__ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /// @dev Grant/revoke KYC verification.
    function setVerified(address account, bool verified) external onlyOwner {
        _verified[account] = verified;
        emit VerifiedSet(account, verified);
    }

    /// @dev Freeze/unfreeze an account (mirrors ERC-3643 freeze semantics).
    function setFrozen(address account, bool frozen) external onlyOwner {
        _frozen[account] = frozen;
        emit FrozenSet(account, frozen);
    }

    /// @dev Toggle the sanctions/blocklist flag used by Clearline re-checks.
    function setSanctioned(address account, bool sanctioned) external onlyOwner {
        _sanctioned[account] = sanctioned;
        emit SanctionedSet(account, sanctioned);
    }

    function isVerified(address account) external view override returns (bool) {
        return _verified[account];
    }

    function isFrozen(address account) external view override returns (bool) {
        return _frozen[account];
    }

    function isSanctioned(address account) external view override returns (bool) {
        return _sanctioned[account];
    }
}

error IIdentityRegistry__ZeroAddress();
