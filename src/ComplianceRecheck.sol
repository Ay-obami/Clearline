// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionRegistry} from "./interfaces/IRedemptionRegistry.sol";
import {IRedemptionTypes} from "./interfaces/IRedemptionTypes.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title ISanctionsReference
 * @notice Optional maintained sanctions/blocklist reference consulted at
 * redemption time (PRD 4.2.3). Kept separate from the identity registry so
 * deployments can swap references without touching ERC-3643 integration.
 */
interface ISanctionsReference {
    function isSanctioned(address account) external view returns (bool);
}

/**
 * @title ComplianceRecheck
 * @notice Runs a fresh eligibility re-check when a redemption becomes Requested,
 * independent of and in addition to original onboarding KYC (FR3), for every
 * trigger type:
 *
 *   - destination must currently verify against the ERC-3643 IdentityRegistry
 *   - destination must not be frozen
 *   - destination must not appear on the sanctions reference
 *   - amounts above a per-asset threshold route to manual review even when the
 *     destination passes everything above (FR7)
 *
 * The result is bound into a `complianceHash` stored in the registry so auditors
 * can verify exactly what was checked (FR9). This module reports results; it does
 * not hold redemption state — the RedemptionRegistry does.
 */
contract ComplianceRecheck {
    bytes32 public constant REASON_NOT_VERIFIED = keccak256("DESTINATION_NOT_VERIFIED");
    bytes32 public constant REASON_FROZEN = keccak256("DESTINATION_FROZEN");
    bytes32 public constant REASON_SANCTIONED = keccak256("DESTINATION_SANCTIONED");

    IRedemptionRegistry public immutable registry;

    address public owner;
    mapping(address asset => IIdentityRegistry identity) public identityFor;
    IIdentityRegistry public defaultIdentity;
    ISanctionsReference public sanctionsReference;
    mapping(address asset => uint256 threshold) public manualReviewThreshold;

    event Checked(uint256 indexed redemptionId, bool passed, bytes32 reason, bool needsManualReview);
    event ConfigUpdated(address indexed asset, address indexed identity, uint256 threshold);

    error NotAuthorized();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(address registry_, address identity_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IRedemptionRegistry(registry_);
        owner = msg.sender;
        if (identity_ != address(0)) defaultIdentity = IIdentityRegistry(identity_);
    }

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------

    function setDefaultIdentity(address identity) external onlyOwner {
        if (identity == address(0)) revert ZeroAddress();
        defaultIdentity = IIdentityRegistry(identity);
        emit ConfigUpdated(address(0), identity, 0);
    }

    function setSanctionsReference(address ref) external onlyOwner {
        // address(0) clears the reference.
        sanctionsReference = ISanctionsReference(ref);
    }

    /// @dev Per-asset overrides: a different identity registry and/or review threshold.
    function configureAsset(address asset, address identity, uint256 threshold) external onlyOwner {
        if (identity != address(0)) identityFor[asset] = IIdentityRegistry(identity);
        manualReviewThreshold[asset] = threshold;
        emit ConfigUpdated(asset, identity, threshold);
    }

    // ------------------------------------------------------------------
    // The re-check
    // ------------------------------------------------------------------

    /**
     * @notice Permissionless keeper entry point: anyone may trigger the check for
     * a Requested redemption; only this contract can report the outcome.
     */
    function runCheck(uint256 redemptionId) external {
        IRedemptionRegistry.Redemption memory r = registry.getRedemption(redemptionId);
        if (r.status != IRedemptionTypes.Status.Requested) {
            revert IRedemptionTypes.InvalidStatus(r.status);
        }

        IIdentityRegistry identity = identityFor[r.asset] != IIdentityRegistry(address(0))
            ? identityFor[r.asset]
            : defaultIdentity;
        if (address(identity) == address(0)) revert IdentityNotConfigured();

        (bool passed, bytes32 reason) = _evaluate(identity, r.destination);

        bool needsManualReview = false;
        if (passed && address(sanctionsReference) != address(0)) {
            // Belt-and-braces: a second reference source still cannot approve a
            // sanctioned destination.
            if (sanctionsReference.isSanctioned(r.destination)) {
                passed = false;
                reason = REASON_SANCTIONED;
            }
        }
        if (passed) {
            uint256 threshold = manualReviewThreshold[r.asset];
            needsManualReview = threshold != 0 && r.amount >= threshold;
        }

        bytes32 complianceHash =
            keccak256(abi.encode(redemptionId, r.destination, passed, reason, address(identity), blockhash(block.number - 1)));

        registry.reportCompliance(redemptionId, passed, complianceHash, needsManualReview);
        emit Checked(redemptionId, passed, reason, needsManualReview);
    }

    function _evaluate(IIdentityRegistry identity, address destination)
        internal
        view
        returns (bool passed, bytes32 reason)
    {
        if (!identity.isVerified(destination)) return (false, REASON_NOT_VERIFIED);
        if (identity.isFrozen(destination)) return (false, REASON_FROZEN);
        if (identity.isSanctioned(destination)) return (false, REASON_SANCTIONED);
        return (true, bytes32(0));
    }

    error IdentityNotConfigured();
}
