// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";

/**
 * @title MockRWAToken
 * @notice ERC-20 with ERC-3643-flavored compliance semantics, for testnet demos:
 *  - transfers gated on both sides by identity-registry verification
 *  - agent-gated `forcedTransfer` / `freeze` (ERC-3643 Agent scope)
 *  - `burn(address,uint256)` callable by the holder itself, an approved spender
 *    (allowance is spent), or an agent — which is how the direct-burn adapter
 *    consumes tokens without holding special privileges beyond user approval.
 */
contract MockRWAToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public owner;
    address public identityRegistry;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public agents;
    mapping(address => bool) public frozen;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AddressFrozen(address indexed account, bool frozen);
    event IdentityRegistrySet(address indexed registry);

    error NotAuthorized();
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 required);
    error TransferNotAllowed(address from, address to);
    error AmountExceedsAllowance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    modifier onlyAgent() {
        if (!agents[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(string memory name_, string memory symbol_, address owner_) {
        name = name_;
        symbol = symbol_;
        owner = owner_;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = registry;
        emit IdentityRegistrySet(registry);
    }

    function addAgent(address agent) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        agents[agent] = true;
    }

    function removeAgent(address agent) external onlyOwner {
        agents[agent] = false;
    }

    /// @dev ERC-3643-style freeze: blocks all transfers of the frozen account's tokens.
    function freeze(address account, bool isFrozen_) external onlyAgent {
        frozen[account] = isFrozen_;
        emit AddressFrozen(account, isFrozen_);
    }

    /// @dev Mint against a verified reserve/off-chain deposit (demo seeding).
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // ------------------------------------------------------------------
    // ERC-20
    // ------------------------------------------------------------------

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert AmountExceedsAllowance();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // ------------------------------------------------------------------
    // Burn / forced transfer (ERC-3643 agent scope)
    // ------------------------------------------------------------------

    /// @notice Burns tokens held by `from`. Allowed when:
    ///  - `from` is the caller (holder-initiated direct burn), or
    ///  - the caller is an agent, or
    ///  - the caller has a sufficient allowance (how the DirectBurnAdapter works).
    /// Burning a frozen balance stays blocked, mirroring ERC-3643 freeze semantics.
    function burn(address from, uint256 amount) external {
        bool selfBurn = msg.sender == from;
        if (!selfBurn && !agents[msg.sender]) {
            uint256 allowed = allowance[from][msg.sender];
            if (allowed < amount) revert NotAuthorized();
            if (allowed != type(uint256).max) {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        if (frozen[from]) revert TransferNotAllowed(from, address(0));

        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        balanceOf[from] = bal - amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    /// @dev ERC-3643 Agent-scoped forced transfer (issuer/regulatory action path).
    function forcedTransfer(address from, address to, uint256 amount) external onlyAgent returns (bool) {
        _transfer(from, to, amount);
        return true;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (frozen[from] || frozen[to]) revert TransferNotAllowed(from, to);

        // ERC-3643 flavor: both sides must currently verify against the registry.
        address ir = identityRegistry;
        if (ir != address(0)) {
            IIdentityRegistry registry = IIdentityRegistry(ir);
            if (!registry.isVerified(from) || !registry.isVerified(to)) {
                revert TransferNotAllowed(from, to);
            }
        }

        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        balanceOf[from] = bal - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

