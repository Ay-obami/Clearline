// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITriggerAdapter} from "../interfaces/ITriggerAdapter.sol";
import {IRedemptionTypes} from "../interfaces/IRedemptionTypes.sol";
import {IRedemptionRegistry} from "../interfaces/IRedemptionRegistry.sol";
import {IBurnableAsset} from "../interfaces/IBurnableAsset.sol";

/**
 * @title DirectBurnAdapter
 * @notice Baseline trigger type (FR1): on-demand redemption for products that can
 * be priced immediately (e.g. tokenized treasuries). The holder approves this
 * adapter, then calls `redeem`; the adapter burns the tokens and feeds a
 * `DirectBurn` trigger into the shared pipeline. Finality is enforced downstream
 * by the RedemptionRegistry — nothing is treated as final until the configured
 * confirmation depth is reached (FR5).
 */
contract DirectBurnAdapter is ITriggerAdapter {
    IRedemptionRegistry public immutable redemptionRegistry;
    IBurnableAsset public immutable asset;

    uint256 private _nonce;

    event Redeemed(
        address indexed holder,
        address indexed destination,
        uint256 amount,
        bytes32 sourceEventHash,
        uint256 redemptionId
    );

    error InsufficientAllowance(uint256 allowance_, uint256 amount);
    error ZeroAmount();

    constructor(address asset_, address registry_) {
        if (asset_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        asset = IBurnableAsset(asset_);
        redemptionRegistry = IRedemptionRegistry(registry_);
    }

    function triggerType() external pure override returns (TriggerType) {
        return TriggerType.DirectBurn;
    }

    /**
     * @notice Burn `amount` of the caller's tokens and start a redemption toward
     * `destination` (the compliance-checked payout account; use the caller's own
     * address if redeeming to self).
     */
    function redeem(uint256 amount, address destination) external returns (uint256 redemptionId) {
        if (destination == address(0)) destination = msg.sender;
        if (amount == 0) revert ZeroAmount();

        // Pull + burn. The token spends the holder's allowance; no agent role needed.
        if (IBurnableAsset(asset).allowance(msg.sender, address(this)) < amount) {
            revert InsufficientAllowance(IBurnableAsset(asset).allowance(msg.sender, address(this)), amount);
        }
        IBurnableAsset(asset).burn(msg.sender, amount);

        bytes32 sourceEventHash =
            keccak256(abi.encode("Clearline.DirectBurn", address(asset), msg.sender, destination, amount, block.number, _nonce++));

        redemptionId = redemptionRegistry.recordTrigger(
            IRedemptionTypes.TriggerRequest({
                asset: address(asset),
                holder: msg.sender,
                amount: amount,
                destination: destination,
                triggerType: TriggerType.DirectBurn,
                sourceEventHash: sourceEventHash
            })
        );

        emit Redeemed(msg.sender, destination, amount, sourceEventHash, redemptionId);
    }
}
