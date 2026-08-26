// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionTypes} from "./IRedemptionTypes.sol";

/**
 * @title IRedemptionRegistry
 * @notice The shared pipeline every trigger adapter feeds into and every downstream
 * module (compliance, signing, circuit breaker, settlement) reports back to.
 */
interface IRedemptionRegistry is IRedemptionTypes {
    // ------------------------------------------------------------------
    // Pipeline writes (each role-gated; see RedemptionRegistry)
    // ------------------------------------------------------------------

    /// @notice Called by whitelisted adapters to record a trigger. Returns the redemption id.
    function recordTrigger(TriggerRequest calldata request) external returns (uint256 redemptionId);

    /// @notice Permissionless: once `block.number >= triggerBlock + finalityDepth(asset)`,
    ///  marks the redemption Requested and emits RedemptionRequested.
    function confirmFinality(uint256 redemptionId) external;

    /// @notice Compliance module reports the re-check result for a Requested redemption.
    /// @param passed Whether the destination currently passes eligibility checks.
    /// @param complianceHash Hash binding the exact inputs of the check.
    /// @param needsManualReview True when amount thresholds route the flow to manual review
    ///        even though the destination passed.
    function reportCompliance(
        uint256 redemptionId,
        bool passed,
        bytes32 complianceHash,
        bool needsManualReview
    ) external;

    /// @notice InstructionSigner marks an Approved redemption as Signed once the
    /// multi-sig signature threshold is met.
    function markSigned(uint256 redemptionId, bytes32 instructionHash) external;

    /// @notice Circuit breaker resolves a Flagged / InManualReview redemption.
    function resolveReview(uint256 redemptionId, bool approve) external;

    /// @notice SettlementRecorder records custodian settlement, closing the audit loop.
    function confirmSettlement(uint256 redemptionId, bytes32 settlementRef) external;

    /// @notice Adapter cancels its own AwaitingFinality redemption (request-lock cancellations).
    function cancelByAdapter(uint256 redemptionId) external;

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    function getRedemption(uint256 redemptionId) external view returns (Redemption memory);

    function statusOf(uint256 redemptionId) external view returns (Status status);

    /// @dev Block number at which confirmFinality() becomes callable.
    function finalityDeadlineBlock(uint256 redemptionId) external view returns (uint256);

    /// @dev The configured confirmation depth for the asset (falls back to the default).
    function finalityDepthFor(address asset) external view returns (uint256);

    function holderRedemptions(address holder) external view returns (uint256[] memory);

    function assetRedemptions(address asset) external view returns (uint256[] memory);

    function redemptionCount() external view returns (uint256);
}
