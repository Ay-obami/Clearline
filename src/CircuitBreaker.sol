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
    uint256 public boardEpoch;
    mapping(uint256 redemptionId => uint256 epoch) public resolvedEpochOf;

    bool public paused;

    mapping(uint256 epoch => mapping(uint256 id => mapping(address voter => bool))) private _hasVoted;
    mapping(uint256 epoch => mapping(uint256 id => uint256)) private _approveCount;
    mapping(uint256 epoch => mapping(uint256 id => uint256)) private _rejectCount;

    function _voteEpochFor(uint256 id) internal view returns (uint256) {
        uint256 finalized = resolvedEpochOf[id];
        return finalized == 0 ? boardEpoch : finalized;
    }

    function hasVoted(uint256 id, address account) public view returns (bool) {
        return _hasVoted[_voteEpochFor(id)][id][account];
    }

    function approveCountOf(uint256 id) public view returns (uint256) {
        return _approveCount[_voteEpochFor(id)][id];
    }

    function rejectCountOf(uint256 id) public view returns (uint256) {
        return _rejectCount[_voteEpochFor(id)][id];
    }

    function votesAtEpoch(uint256 id, uint256 epoch) external view returns (uint256, uint256) {
        return (_approveCount[epoch][id], _rejectCount[epoch][id]);
    }

    event PausedSet(bool paused);
    event BoardEpochStarted(uint256 indexed epoch);
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

        for (uint256 i = 0; i < board.length; i++) {
            isBoardMember[board[i]] = false;
        }
        delete board;
        for (uint256 i = 0; i < members.length; i++) {
            address m = members[i];
            if (m == address(0)) revert ZeroAddress();
            if (isBoardMember[m]) revert DuplicateMember();
            isBoardMember[m] = true;
            board.push(m);
        }
        overrideThreshold = threshold_;
        boardEpoch++;
        emit BoardEpochStarted(boardEpoch);
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
        if (_hasVoted[boardEpoch][redemptionId][msg.sender]) revert AlreadyVoted();
        _hasVoted[boardEpoch][redemptionId][msg.sender] = true;

        emit IRedemptionTypes.ReviewVoteCast(redemptionId, msg.sender, approve);

        if (approve) {
            thresholdReached = ++_approveCount[boardEpoch][redemptionId] >= overrideThreshold;
        } else {
            thresholdReached = ++_rejectCount[boardEpoch][redemptionId] >= overrideThreshold;
        }
        if (thresholdReached) resolvedEpochOf[redemptionId] = boardEpoch;
    }

    /// @notice View: how many approve/reject votes are recorded for a redemption.
    function votesFor(uint256 redemptionId) external view returns (uint256 approves, uint256 rejects) {
        return (approveCountOf(redemptionId), rejectCountOf(redemptionId));
    }
}
