// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionTypes} from "./IRedemptionTypes.sol";

/**
 * @title ITriggerAdapter
 * @notice Contract interface implemented by every trigger adapter feeding the
 * shared pipeline. The generic shape lets future adapters (issuer-initiated,
 * scheduled/batch, NAV-threshold — PRD FR11-FR13) plug in without touching the
 * RedemptionRegistry.
 */
interface ITriggerAdapter is IRedemptionTypes {
    /// @notice The trigger type this adapter feeds into the pipeline.
    function triggerType() external pure returns (TriggerType);
}
