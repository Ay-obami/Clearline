// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITriggerAdapter} from "../interfaces/ITriggerAdapter.sol";
import {IRedemptionTypes} from "../interfaces/IRedemptionTypes.sol";
import {IRedemptionRegistry} from "../interfaces/IRedemptionRegistry.sol";
import {IBurnableAsset} from "../interfaces/IBurnableAsset.sol";

/**
 * @title RequestLockAdapter
 * @notice Two-step trigger (FR2) for products that cannot be priced or confirmed
 * instantly (NAV-priced funds, cutoff windows):
 *
 *   1. requestRedemption() — pulls tokens into escrow here. Once escrowed the
 *      position is non-transferable (the tokens have left the holder's wallet)
 *      and the holder may still cancel.
 *   2. finalizeRedemption() — after pricing/custodian confirmation, burns the
 *      escrowed tokens and feeds a `RequestLock` trigger into the shared pipeline.
 *
 * Cancellation is only possible before finalization; once burned, the redemption
 * proceeds through the same compliance -> signing -> settlement pipeline as any
 * other trigger type.
 */
contract RequestLockAdapter is ITriggerAdapter {
    struct LockRequest {
        address holder;
        uint256 amount;
        address destination;
        bool finalized;
        bool cancelled;
    }

    IRedemptionRegistry public immutable redemptionRegistry;
    IBurnableAsset public immutable asset;

    uint256 public nextRequestId = 1;
    mapping(uint256 requestId => LockRequest) public requests;
    mapping(uint256 requestId => uint256 redemptionId) public requestToRedemption;

    event RedemptionLockRequested(
        uint256 indexed requestId,
        address indexed holder,
        address indexed destination,
        uint256 amount
    );
    event RedemptionLockCancelled(uint256 indexed requestId, address indexed holder);
    event RedemptionLockFinalized(
        uint256 indexed requestId,
        uint256 indexed redemptionId,
        bytes32 sourceEventHash
    );

    error NotRequestHolder();
    error RequestNotOpen();
    error ZeroAmount();

    constructor(address asset_, address registry_) {
        if (asset_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        asset = IBurnableAsset(asset_);
        redemptionRegistry = IRedemptionRegistry(registry_);
    }

    function triggerType() external pure override returns (TriggerType) {
        return TriggerType.RequestLock;
    }

    // ------------------------------------------------------------------
    // Step 1 — lock
    // ------------------------------------------------------------------

    /// @notice Escrows `amount` tokens for redemption toward `destination`.
    /// Requires a prior ERC-20 approval from the caller to this adapter.
    function requestRedemption(uint256 amount, address destination) external returns (uint256 requestId) {
        if (amount == 0) revert ZeroAmount();

        bool ok = IBurnableAsset(asset).transferFrom(msg.sender, address(this), amount);
        require(ok, "TRANSFER_FAILED");

        if (destination == address(0)) destination = msg.sender;

        requestId = nextRequestId++;
        requests[requestId] = LockRequest({holder: msg.sender, amount: amount, destination: destination, finalized: false, cancelled: false});

        emit RedemptionLockRequested(requestId, msg.sender, destination, amount);
    }

    /// @notice Cancels an open (locked, not yet finalized) request and returns the escrow.
    function cancelRequest(uint256 requestId) external {
        LockRequest storage req = requests[requestId];
        if (req.holder != msg.sender) revert NotRequestHolder();
        if (req.finalized || req.cancelled || req.amount == 0) revert RequestNotOpen();

        req.cancelled = true;
        bool ok = IBurnableAsset(asset).transfer(req.holder, req.amount);
        require(ok, "RETURN_FAILED");

        emit RedemptionLockCancelled(requestId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Step 2 — finalize (burn + enter shared pipeline)
    // ------------------------------------------------------------------

    function finalizeRedemption(uint256 requestId) external returns (uint256 redemptionId) {
        LockRequest storage req = requests[requestId];
        if (req.holder != msg.sender) revert NotRequestHolder();
        if (req.finalized || req.cancelled || req.amount == 0) revert RequestNotOpen();

        req.finalized = true;
        IBurnableAsset(asset).burn(address(this), req.amount);

        bytes32 sourceEventHash =
            keccak256(abi.encode("Clearline.RequestLock", address(asset), requestId, req.holder, req.amount));

        redemptionId = redemptionRegistry.recordTrigger(
            IRedemptionTypes.TriggerRequest({
                asset: address(asset),
                holder: req.holder,
                amount: req.amount,
                destination: req.destination,
                triggerType: TriggerType.RequestLock,
                sourceEventHash: sourceEventHash
            })
        );
        requestToRedemption[requestId] = redemptionId;

        emit RedemptionLockFinalized(requestId, redemptionId, sourceEventHash);
    }
}
