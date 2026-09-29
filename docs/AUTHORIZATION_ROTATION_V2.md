# Authorization rotation v2

This is a breaking, undeployed release-instruction change. Existing v1 deployments retain their old code and behavior. Do not point the v2 service or frontend ABI at v1 addresses.

## Policy

- `setSigners` replaces the membership mapping and array atomically. Retained addresses are valid; duplicates inside the new list still revert.
- Every successful `setSigners` or `setSigningWindow` call increments `signerEpoch`, even if the supplied values match the current values. Both change the authorization configuration; pending signatures must be collected again.
- Release instructions use EIP-712 domain version **2** and append `uint256 signerEpoch` after `deadline`. A signature from an earlier epoch is invalid even if its author remains authorized or is later re-added.
- `setBoard` replaces board membership and increments `boardEpoch`. Both pending approve and reject votes start at zero; retained board members may vote again.
- Configuration changes do not undo a redemption that already reached Signed, Settled, Approved-through-review or Rejected. Revocation of a completed off-chain release instruction is a separate operational process.
- Current getters show the current epoch for pending work and the finalized epoch for completed work. `signedEpochOf`, `signedDeadlineOf` and `resolvedEpochOf` record completion context. `collectedSignersAtEpoch` and `votesAtEpoch` expose previous collections. Configuration events identify the new epochs.
- The deadline remains **requestedAt (set when finality is confirmed) + signing window**. Completed instructions retain their finalized deadline when the global window changes. A rotation does not independently grant extra time. An expired pending redemption needs an explicit operational resolution; this patch does not invent a new expiry/recovery policy.

## Client integration

The service's typed-data schema, service ABI and frontend tuple ABI include `signerEpoch`. The service verifies `VERSION() == "2"` before polling. It skips removed signers and signatures already collected in the active epoch. The operator revisits registry IDs in batches of at most 50 per polling tick, prevents overlapping scans and isolates per-ID failures. At large registry sizes a full sweep takes proportionally longer; a production indexer/backlog is a future scaling step. Settlement confirmations remain EIP-712 version **1**; their schema is unchanged.

The repository currently tracks generated service JavaScript, so the matching generated files are included. `npm test --prefix services` builds it and runs signer regression tests. These seven mocked service tests are supplemented by `npm run test:chain --prefix services`, which builds contracts and starts a disposable local Anvil chain. The rehearsal deploys actual modules, exercises the production signer and mock-custodian scan methods, verifies service/Solidity digest agreement, invalidates old signatures and pending board votes on rotation, preserves finalized history and completes two settlements. It uses test keys and a mock RWA token; it does not move real custody assets or validate a public-network cutover. Foundry v1.8.3 must be on PATH. The service CI job runs both suites.

## Deployment and migration gate

These modules are not being upgraded in place by this change. No deployment or registry pointer change is included.

1. Review the contract changes and the breaking typed-data schema together with the service/client changes. Run Foundry, service tests and frontend typechecking in a clean checkout.
2. Run the automated local-chain rehearsal (`npm run test:chain --prefix services`) and rehearse the target testnet configuration before cutover. Configure new signer/board groups, collect partial approvals, rotate, reject old payloads and finish with new approvals. Check historical getters and settlement against the registry digest.
3. Inventory all current redemptions and any release instructions already accepted by custodians. Stop operator processes and new signing during a planned cutover. Coordinate already-signed work with custodians; a new contract cannot revoke instructions accepted off-chain.
4. Prefer a fresh testnet stack for the portfolio release. If preserving an existing registry, review each module setter and pending/finalized state explicitly. New modules do not inherit old collections; keep the old module addresses in the audit index. Do not assume pointer replacement migrates history.
5. Configure new module/registry addresses, role memberships and optional pause wiring. Update services and frontend together; retain v1 configuration for historical reads, not for new v2 signing.
6. Verify source, bytecode, schema version and sample instruction digest. Restart operators and perform one bounded testnet lifecycle before updating public release documentation.

## Validation

Seven rotation regressions were observed failing before the fix. Additional tests cover retained signers with stale payloads, window changes, finalized audit preservation, failed-update rollback and retained board voters. The complete suite has 62 tests, including the attestor membership fuzz test from the preceding patch. Seven service tests cover the version guard, removed/already-collected signers epoch-bound typed data and bounded pending-ID rediscovery. These results do not establish an independent security audit or production readiness.
