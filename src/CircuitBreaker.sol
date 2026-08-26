// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionRegistry} from "./interfaces/IRedemptionRegistry.sol";
import {IRedemptionTypes} from "./interfaces/IRedemptionTypes.sol";

/**
 * @title CircuitBreaker
 * @notice Manual review queue + multi-sig override (G5, FR7, FR8). When a
 * redemption is Flagged (failed compliance) or InManualReview (amount threshold
 * exceeded), only a threshold of configured board members voting here can move
 * it forward:
 *
 *   - voteReject  -> redemption becomes Rejected (terminal)
 *   - voteApprove -> redemption becomes Approved, re-entering the signing stage;
 *                    every override is permanently visible in the audit trail
 *                    via ReviewResolved/ReviewVoteCast events.
 *
 * The breaker also exposes a global pause switch; while paused, the
 * InstructionSigner refuses new signatures, giving operators a single lever to
 * halt release authorization during an incident.
 */
contract CircuitBreaker {
    IRedemptionRegistry public immutable registry;

    address public owner;
    address[] public board;
    mapping(address => bool) public isBoardMember;
    uint256 public overrideThreshold;

    bool public paused;

    mapping(uint256 redemptionId => mapping(address voter => bool voted)) public hasVoted;
    mapping(uint256 redemptionId => uint256 approveVotes) public approveCountOf;
    mapping(uint256 redemptionId => uint256 rejectVotes) public rejectCountOf;

    event PausedSet(bool paused);
    event BoardUpdated(address[] members, uint256 threshold);

    error NotAuthorized();
    error ZeroAddress();
    error InvalidThreshold();
    error DuplicateMember();
    error AlreadyVoted();
    error ThresholdReached();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(address registry_, address owner_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IRedemptionRegistry(registry_);
        owner = owner_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function setBoard(address[] calldata members, uint256 threshold_) external onlyOwner {
        if (members.length == 0) revert ZeroAddress();
        if (threshold_ == 0 || threshold_ > members.length) revert InvalidThreshold();

        delete board;
        for (uint256 i = 0; i < members.length; i++) {
            address m = members[i];
            if (m == address(0)) revert ZeroAddress();
            if (isBoardMember[m]) revert DuplicateMember();
            isBoardMember[m] = true;
            board.push(m);
        }
        overrideThreshold = threshold_;
        emit BoardUpdated(members, threshold_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function boardSize() external view returns (uint256) {
        return board.length;
    }

    // ------------------------------------------------------------------
    // Override votes
    // ------------------------------------------------------------------

    function voteApprove(uint256 redemptionId) external {
        if (_vote(redemptionId, true)) {
            registry.resolveReview(redemptionId, true);
        }
    }

    function voteReject(uint256 redemptionId) external {
        if (_vote(redemptionId, false)) {
            registry.resolveReview(redemptionId, false);
        }
    }

    /// @dev Records a distinct board-member vote; returns true exactly when this
    /// vote reaches the override threshold (the caller then resolves the review).
    function _vote(uint256 redemptionId, bool approve) internal returns (bool thresholdReached) {
        if (!isBoardMember[msg.sender]) revert NotAuthorized();

        IRedemptionTypes.Status status = registry.statusOf(redemptionId);
        if (status != IRedemptionTypes.Status.Flagged && status != IRedemptionTypes.Status.InManualReview) {
            revert IRedemptionTypes.InvalidStatus(status);
        }
        if (hasVoted[redemptionId][msg.sender]) revert AlreadyVoted();
        hasVoted[redemptionId][msg.sender] = true;

        emit IRedemptionTypes.ReviewVoteCast(redemptionId, msg.sender, approve);

        if (approve) {
            thresholdReached = ++approveCountOf[redemptionId] >= overrideThreshold;
        } else {
            thresholdReached = ++rejectCountOf[redemptionId] >= overrideThreshold;
        }
    }

    /// @notice View: how many approve/reject votes are recorded for a redemption.
    function votesFor(uint256 redemptionId) external view returns (uint256 approves, uint256 rejects) {
        return (approveCountOf[redemptionId], rejectCountOf[redemptionId]);
    }
}
