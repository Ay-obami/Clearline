// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IIdentityRegistry
 * @notice Minimal ERC-3643-flavored identity registry interface consumed by
 * Clearline's ComplianceRecheck module (FR3, FR10).
 *
 * Clearline deliberately consumes rather than reimplements identity/compliance:
 * `isVerified` maps to ERC-3643 IdentityRegistry investor verification, `isFrozen`
 * to the token-side freeze semantics. `isSanctioned` is an additional view the
 * sanctions reference may expose; production deployments would point this at a
 * ZK-attestation primitive (HSK-PASSPORT / ZKGate-style) per PRD NFR5.
 */
interface IIdentityRegistry {
    /// @return True if the account currently passes onboarding/KYC verification.
    function isVerified(address account) external view returns (bool);

    /// @return True if the account is currently frozen (transfers blocked).
    function isFrozen(address account) external view returns (bool);

    /// @return True if the account appears on the maintained sanctions/blocklist reference.
    function isSanctioned(address account) external view returns (bool);
}
