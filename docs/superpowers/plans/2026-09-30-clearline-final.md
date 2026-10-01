# Clearline Final Followups Implementation Plan

**Goal:** Finish the source/build/operator scope before agency outreach; Phoenix CI is deferred.

**Architecture:** Keep v2 epoch authorization. Frontend fails closed for unconfigured or v1 deployments. Services validate chain/configuration and reconcile bounded registry history. Deployment scripts validate explicit public-network roles before broadcasting. Documentation separates historical v1 deployments from current source and a rehearsed v2 cutover.

**Tech Stack:** Solidity0.8.28, Foundry1.8.3, ethers services, Next15/React18 frontend.

**Spec:** User instruction to finish remaining portfolio work before outreach; docs/AUTHORIZATION_ROTATION_V2.md migration policy.

## Constraints
- No public broadcasts or real custody releases without configured credentials and inventory.
- No private keys in source or logs.
- Public role membership must be explicit; publicly derivable demo roles only on local chain31337.
- Expired approved instructions are skipped, not silently renewed.
- Each service reconciles registry IDs in bounded batches, serializes polling and isolates per-ID failures.

## Review focus
- Missing/malformed role addresses and one-/many-member demo configuration.
- v1 address/v2 ABI mismatch and absent client configuration.
- Expired/incomplete work, bigint IDs, historical rediscovery and overlapping service scans.
- Partial public-network cutover and irreversible already-accepted custody instructions.

## Tasks
- [ ] Frontend supported patched framework, lockfile, real production-build CI, deployment/version guards.
- [ ] Service configuration/expiry/history regressions and local-chain lifecycle.
- [ ] Deployment role-parser regressions, public-network role guard and local configuration controls.
- [ ] Historical deployment verification manifest, indexing and incident/cutover runbook.
- [ ] Full checks, independent review, publish CI and merge.
