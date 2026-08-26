// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRedemptionTypes
 * @notice Shared types, errors and events for the Clearline redemption pipeline.
 *
 * Clearline is a redemption-and-custody-attestation layer for tokenized RWAs.
 * Every trigger type converges on the same downstream pipeline:
 *
 *   Trigger adapter --> Finality --> Compliance re-check --> [Manual review]
 *     --> Multi-sig EIP-712 instruction --> Off-chain settlement --> Confirmation
 *
 * All lifecycle state lives in the RedemptionRegistry so that the audit trail
 * (trigger -> finality -> compliance -> instruction -> settlement) is readable
 * from a single contract, tagged by trigger type.
 */
interface IRedemptionTypes {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @dev Entry points into the shared pipeline (PRD 4.2.1).
    enum TriggerType {
        /// Holder burns directly (on-demand redemption, e.g. tokenized treasuries).
        DirectBurn,
        /// Holder locks, custodian/pricing confirms, then finalize burns (NAV-priced funds).
        RequestLock,
        /// Time/maturity-based batch trigger (extension, FR12).
        Scheduled,
        /// Agent-scoped forcedTransfer/burn initiated by issuer (extension, FR11).
        IssuerInitiated,
        /// NAV/peg/collateral-ratio bound crossing (extension, FR13).
        Threshold
    }

    /// @dev Lifecycle status of a redemption. One source of truth lives in the registry.
    enum Status {
        None,
        /// Recorded by an adapter, waiting for the configurable confirmation depth.
        AwaitingFinality,
        /// Finality reached; RedemptionRequested emitted; awaiting compliance re-check.
        Requested,
        /// Compliance re-check passed; signatures being collected.
        Approved,
        /// Compliance re-check failed; eligible for circuit-breaker override.
        Flagged,
        /// Amount threshold exceeded (or breaker engaged); multi-sig review required.
        InManualReview,
        /// Signature threshold met; instruction ready for the custodian.
        Signed,
        /// Custodian posted settlement confirmation; audit loop closed.
        Settled,
        /// Rejected via multi-sig manual override.
        Rejected,
        /// Request-lock redemption cancelled by the holder before finalization.
        Cancelled
    }

    /// @dev Payload an adapter submits into the shared pipeline.
    struct TriggerRequest {
        address asset;          // RWA token contract
        address holder;         // original token holder
        uint256 amount;         // amount redeemed (burned)
        address destination;    // claimed payout destination, re-checked by compliance
        TriggerType triggerType;
        bytes32 sourceEventHash; // adapter-defined hash of the originating event (dedup + linkage)
    }

    /// @dev Full audit record for one redemption.
    struct Redemption {
        uint256 id;
        address asset;
        address holder;
        uint256 amount;
        address destination;
        TriggerType triggerType;
        bytes32 sourceEventHash;
        bytes32 complianceHash;   // hash binding the compliance re-check result
        bytes32 instructionHash;  // EIP-712 digest of the signed release instruction
        bytes32 settlementRef;    // custodian-provided settlement reference
        uint64 triggerBlock;      // block at which the trigger was recorded
        uint64 requestedAt;       // timestamp when finality was confirmed
        uint64 settledAt;         // timestamp when settlement was recorded
        Status status;
    }

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error ZeroAddress();
    error NotAuthorized();
    error InvalidStatus(Status current);
    error UnknownRedemption(uint256 redemptionId);
    error DuplicateSourceEvent(bytes32 sourceEventHash);
    error AssetNotRegistered(address asset);

    // ------------------------------------------------------------------
    // Events — the shared event pipeline (FR4, FR9)
    // ------------------------------------------------------------------

    /// Adapter recorded a trigger into the pipeline.
    event RedemptionTriggered(
        uint256 indexed id,
        address indexed asset,
        address indexed holder,
        uint256 amount,
        address destination,
        IRedemptionTypes.TriggerType triggerType,
        bytes32 sourceEventHash
    );

    /// Finality depth reached; redemption formally enters the pipeline.
    event FinalityConfirmed(
        uint256 indexed id,
        uint256 triggerBlock,
        uint256 requiredDepth,
        uint256 confirmedAtBlock
    );

    /// Canonical "release may proceed" signal consumed by signers and the UI.
    event RedemptionRequested(
        uint256 indexed id,
        address indexed asset,
        address indexed holder,
        uint256 amount,
        address destination,
        IRedemptionTypes.TriggerType triggerType
    );

    event ComplianceApproved(uint256 indexed id, bytes32 complianceHash);
    event ComplianceFlagged(uint256 indexed id, bytes32 complianceHash, bytes32 reason);
    event ManualReviewOpened(uint256 indexed id, bytes32 reason);

    event SignatureCollected(uint256 indexed id, address indexed signer, uint256 collected, uint256 threshold);
    event InstructionSigned(uint256 indexed id, bytes32 instructionHash, address[] signers);

    event ReviewVoteCast(uint256 indexed id, address indexed voter, bool approve);
    event ReviewResolved(uint256 indexed id, bool approved);

    event SettlementConfirmed(uint256 indexed id, bytes32 settlementRef);
    event RedemptionRejected(uint256 indexed id);
    event RedemptionCancelled(uint256 indexed id);
}
