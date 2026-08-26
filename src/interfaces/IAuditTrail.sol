// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionTypes} from "./IRedemptionTypes.sol";

/**
 * @title IAuditTrail
 * @notice Read-only view over the full per-redemption lifecycle (FR9):
 *
 *   trigger event -> finality confirmation -> compliance re-check ->
 *   collected signatures -> signed instruction -> settlement confirmation
 *
 * Every transition also emits a typed event, so auditors can reconstruct the
 * trail from logs alone; these views exist for cheap on-chain queries by
 * regulator dashboards and the Clearline UI.
 */
interface IAuditTrail is IRedemptionTypes {
    /// @notice Full record including status and lifecycle timestamps.
    function getRedemption(uint256 redemptionId)
        external
        view
        returns (Redemption memory redemption);

    /// @notice All redemption ids initiated by `holder` (unordered).
    function holderRedemptions(address holder) external view returns (uint256[] memory ids);

    /// @notice All redemption ids for `asset` (unordered).
    function assetRedemptions(address asset) external view returns (uint256[] memory ids);

    /// @notice Total redemptions ever recorded; valid ids are 1..redemptionCount().
    function redemptionCount() external view returns (uint256 count);
}
