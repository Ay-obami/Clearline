// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionRegistry} from "./interfaces/IRedemptionRegistry.sol";
import {IAuditTrail} from "./interfaces/IAuditTrail.sol";

/**
 * @title RedemptionRegistry
 * @notice Central state machine for the Clearline redemption pipeline. Single
 * source of truth for redemption status so that the audit trail is complete and
 * queryable from one contract regardless of which trigger adapter fired.
 *
 * Role model (deliberately minimal):
 *  - owner: configures modules, adapter whitelist, finality depths
 *  - adapters: may call recordTrigger / cancelByAdapter
 *  - complianceModule: may call reportCompliance
 *  - instructionSigner: may call markSigned
 *  - circuitBreaker: may call resolveReview
 *  - settlementRecorder: may call confirmSettlement
 */
contract RedemptionRegistry is IRedemptionRegistry, IAuditTrail {
    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error FinalityNotReached(uint256 redemptionId, uint256 currentBlock, uint256 requiredBlock);
    error ZeroAmount();

    /// @notice Reason code written into ManualReviewOpened when an eligible
    /// destination exceeds the configured amount threshold.
    bytes32 public constant REASON_THRESHOLD_EXCEEDED = keccak256("THRESHOLD_EXCEEDED");

    // ------------------------------------------------------------------
    // Configuration state
    // ------------------------------------------------------------------

    address public owner;

    mapping(address adapter => bool enabled) public adapters;
    address public complianceModule;
    address public instructionSigner;
    address public circuitBreaker;
    address public settlementRecorder;

    uint256 public defaultFinalityDepth = 12;
    mapping(address asset => uint256 depth) public assetFinalityDepth;

    // ------------------------------------------------------------------
    // Redemption storage
    // ------------------------------------------------------------------

    uint256 private _nextId = 1;
    mapping(uint256 => Redemption) private _redemptions;
    mapping(bytes32 sourceEventHash => bool seen) private _seenSourceEvents;
    mapping(address holder => uint256[] ids) private _holderIds;
    mapping(address asset => uint256[] ids) private _assetIds;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    // ------------------------------------------------------------------
    // Owner configuration
    // ------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function setAdapter(address adapter, bool enabled) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        adapters[adapter] = enabled;
    }

    function setComplianceModule(address module) external onlyOwner {
        if (module == address(0)) revert ZeroAddress();
        complianceModule = module;
    }

    function setInstructionSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        instructionSigner = signer;
    }

    function setCircuitBreaker(address breaker) external onlyOwner {
        if (breaker == address(0)) revert ZeroAddress();
        circuitBreaker = breaker;
    }

    function setSettlementRecorder(address recorder) external onlyOwner {
        if (recorder == address(0)) revert ZeroAddress();
        settlementRecorder = recorder;
    }

    /// @notice Configure the confirmation depth required before a trigger for
    /// `asset` is treated as final (FR5). Depth 0 removes the override.
    function setAssetFinalityDepth(address asset, uint256 depth) external onlyOwner {
        assetFinalityDepth[asset] = depth;
    }

    function setDefaultFinalityDepth(uint256 depth) external onlyOwner {
        if (depth == 0) revert ZeroAmount();
        defaultFinalityDepth = depth;
    }

    // ------------------------------------------------------------------
    // Pipeline: trigger recording (FR4 — all adapters converge here)
    // ------------------------------------------------------------------

    function recordTrigger(TriggerRequest calldata request) external returns (uint256 id) {
        if (!adapters[msg.sender]) revert NotAuthorized();
        if (
            request.asset == address(0) || request.holder == address(0)
                || request.destination == address(0)
        ) {
            revert ZeroAddress();
        }
        if (request.amount == 0) revert ZeroAmount();
        if (_seenSourceEvents[request.sourceEventHash]) revert DuplicateSourceEvent(request.sourceEventHash);

        _seenSourceEvents[request.sourceEventHash] = true;
        id = _nextId++;

        Redemption storage r = _redemptions[id];
        r.id = id;
        r.asset = request.asset;
        r.holder = request.holder;
        r.amount = request.amount;
        r.destination = request.destination;
        r.triggerType = request.triggerType;
        r.sourceEventHash = request.sourceEventHash;
        r.triggerBlock = uint64(block.number);
        r.status = Status.AwaitingFinality;

        _holderIds[request.holder].push(id);
        _assetIds[request.asset].push(id);

        emit RedemptionTriggered(
            id,
            request.asset,
            request.holder,
            request.amount,
            request.destination,
            request.triggerType,
            request.sourceEventHash
        );
    }

    // ------------------------------------------------------------------
    // Pipeline: finality (FR5, NFR3)
    // ------------------------------------------------------------------

    function finalityDepthFor(address asset) public view returns (uint256) {
        uint256 depth = assetFinalityDepth[asset];
        return depth == 0 ? defaultFinalityDepth : depth;
    }

    function finalityDeadlineBlock(uint256 redemptionId) public view returns (uint256) {
        Redemption storage r = _requireRedemption(redemptionId);
        return uint256(r.triggerBlock) + finalityDepthFor(r.asset);
    }

    /// @notice Permissionless keeper entry point. Reverts before the configured
    /// confirmation depth, which is the on-chain guarantee backing NFR3: no
    /// instruction can be signed for a non-final trigger because status can never
    /// leave AwaitingFinality early.
    function confirmFinality(uint256 redemptionId) external {
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.AwaitingFinality) revert InvalidStatus(r.status);

        uint256 depth = finalityDepthFor(r.asset);
        uint256 deadline = uint256(r.triggerBlock) + depth;
        if (block.number < deadline) revert FinalityNotReached(redemptionId, block.number, deadline);

        r.status = Status.Requested;
        r.requestedAt = uint64(block.timestamp);

        emit FinalityConfirmed(redemptionId, r.triggerBlock, depth, block.number);
        emit RedemptionRequested(redemptionId, r.asset, r.holder, r.amount, r.destination, r.triggerType);
    }

    // ------------------------------------------------------------------
    // Pipeline: compliance re-check (FR3, FR7)
    // ------------------------------------------------------------------

    function reportCompliance(
        uint256 redemptionId,
        bool passed,
        bytes32 complianceHash,
        bool needsManualReview
    ) external {
        if (msg.sender != complianceModule) revert NotAuthorized();
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.Requested) revert InvalidStatus(r.status);

        r.complianceHash = complianceHash;

        if (!passed) {
            // Failed compliance: flagged. Only a multi-sig circuit-breaker override
            // can move it forward (FR7, FR8).
            r.status = Status.Flagged;
            emit ComplianceFlagged(redemptionId, complianceHash, bytes32(0));
        } else if (needsManualReview) {
            // Destination eligible but amount threshold exceeded: manual review.
            r.status = Status.InManualReview;
            emit ManualReviewOpened(redemptionId, REASON_THRESHOLD_EXCEEDED);
        } else {
            r.status = Status.Approved;
            emit ComplianceApproved(redemptionId, complianceHash);
        }
    }

    // ------------------------------------------------------------------
    // Pipeline: instruction signing (FR6)
    // ------------------------------------------------------------------

    function markSigned(uint256 redemptionId, bytes32 instructionHash) external {
        if (msg.sender != instructionSigner) revert NotAuthorized();
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.Approved) revert InvalidStatus(r.status);

        r.instructionHash = instructionHash;
        r.status = Status.Signed;

        emit InstructionSigned(redemptionId, instructionHash, new address[](0));
    }

    // ------------------------------------------------------------------
    // Pipeline: manual review override (FR7, FR8)
    // ------------------------------------------------------------------

    function resolveReview(uint256 redemptionId, bool approve) external {
        if (msg.sender != circuitBreaker) revert NotAuthorized();
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.Flagged && r.status != Status.InManualReview) {
            revert InvalidStatus(r.status);
        }

        if (approve) {
            r.status = Status.Approved;
        } else {
            r.status = Status.Rejected;
            emit RedemptionRejected(redemptionId);
        }
        emit ReviewResolved(redemptionId, approve);
    }

    // ------------------------------------------------------------------
    // Pipeline: settlement confirmation closes the loop (FR14)
    // ------------------------------------------------------------------

    function confirmSettlement(uint256 redemptionId, bytes32 settlementRef) external {
        if (msg.sender != settlementRecorder) revert NotAuthorized();
        if (settlementRef == bytes32(0)) revert ZeroAmount();
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.Signed) revert InvalidStatus(r.status);

        r.settlementRef = settlementRef;
        r.settledAt = uint64(block.timestamp);
        r.status = Status.Settled;

        emit SettlementConfirmed(redemptionId, settlementRef);
    }

    // ------------------------------------------------------------------
    // Cancellation (request-lock pre-finalization)
    // ------------------------------------------------------------------

    function cancelByAdapter(uint256 redemptionId) external {
        if (!adapters[msg.sender]) revert NotAuthorized();
        Redemption storage r = _requireRedemption(redemptionId);
        if (r.status != Status.AwaitingFinality) revert InvalidStatus(r.status);

        r.status = Status.Cancelled;
        emit RedemptionCancelled(redemptionId);
    }

    // ------------------------------------------------------------------
    // Audit-trail reads
    // ------------------------------------------------------------------

    function getRedemption(uint256 redemptionId) external view override(IRedemptionRegistry, IAuditTrail) returns (Redemption memory) {
        return _requireRedemption(redemptionId);
    }

    function statusOf(uint256 redemptionId) external view returns (Status) {
        return _requireRedemption(redemptionId).status;
    }

    function holderRedemptions(address holder) external view override(IRedemptionRegistry, IAuditTrail) returns (uint256[] memory) {
        return _holderIds[holder];
    }

    function assetRedemptions(address asset) external view override(IRedemptionRegistry, IAuditTrail) returns (uint256[] memory) {
        return _assetIds[asset];
    }

    function redemptionCount() external view override(IRedemptionRegistry, IAuditTrail) returns (uint256) {
        return _nextId - 1;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _requireRedemption(uint256 redemptionId) internal view returns (Redemption storage r) {
        if (redemptionId == 0 || redemptionId >= _nextId) revert UnknownRedemption(redemptionId);
        r = _redemptions[redemptionId];
    }


}
