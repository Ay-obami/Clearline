# Clearline v2 operator runbook

This repository is a prototype with mock identity/token contracts and simulated off-chain custody. Historical HSK addresses describe v1. No public-network v2 deployment or coordinated client cutover is asserted here.

## Prepare a fresh deployment

Use distinct, explicitly provisioned signer and board addresses and validated thresholds. Public networks require exact `SIGNER_ADDRS` and `BOARD_ADDRS`; deterministic fallback roles are available only on chain 31337 for disposable development. Keep all private keys outside version control. The deployment script wires both registry and signer to the circuit breaker. Pause therefore gates new signing, but does not undo custody already authorized by a Signed instruction.

Run the Foundry suite, service tests, local service rehearsal and actual deployment-script smoke before preparing public transactions. The mock asset stack is not an issuer's production RWA integration. Chain 177 additionally requires the existing mainnet confirmation and cost-check runner; these are operational guards, not approval of a production release.

After deployment, record chain ID, deployment block/hash, nine contract addresses, role arrays/thresholds, attestor and finality policy in a public JSON manifest. Use `deployments/v2-manifest.example.json` as the schema; its addresses are placeholders. Run:

```sh
npm ci --prefix services
node scripts/verify-deployment.cjs deployments/v2-manifest.json "$RPC_URL"
```

The verifier reads one pinned block, checks code, module/identity/adapter wiring, signer VERSION 2, pause wiring, quorums and declared roles. It does not certify deployed bytecode or the backing asset. Independently compare compiler settings, verified source and bytecode with the approved release. Retain the manifest and verifier report with the release record.

## Cut over without losing history

1. Inventory every old registry ID through `redemptionCount()` / `getRedemption(id)` at a recorded block, including status, nonce, request time, signature epoch and external custody references. Preserve old chain/address/version as part of every record.
2. Stop new old-version requests and signing before moving clients. Reconcile Signed instructions with the custodian: signing or configuration rotation cannot recall an external release. Do not carry old signatures into the new v2 domain.
3. Deploy and verify the new stack and configure services/frontend together. Confirm RPC chain ID, role keys and public manifest agree. The frontend deliberately remains unconfigured without complete addresses and blocks writes to a v1 signer.
4. Preserve a read-only view/export of old records. A fresh registry does not migrate pending requests, burned tokens, locks or custody obligations. Resolve each old obligation explicitly; do not create duplicate release authority by blindly recreating requests.
5. Rehearse one disposable request through finality, compliance, quorum signing and settlement before enabling broader traffic. Record its transaction hashes and custody simulation status. Public release requires a separate real issuer/custodian acceptance process.

## Expiry, discovery and incident handling

Approval deadlines remain tied to the original request time. Services skip expired Approved work using chain time; they must not silently renew authorization. Expired requests require an explicit issuer resolution procedure. Document the resolution against the original ID.

The custodian scans registry IDs in bounded batches with a round-robin cursor, including old Signed work that falls outside recent event windows. Preserve historical exports and reconcile external references. This is not durable exactly-once custody, arbitrary-depth reorg recovery or coordinated multi-replica processing. Run one controlled custody executor; use an external idempotent release ledger before integrating real payment rails. The frontend's full-history queries are suitable for a small prototype and need pagination/indexing before a large registry.

On suspected compromise, pause new signing through the configured circuit breaker, stop off-chain executors and preserve logs, manifests and transaction references. Inventory Signed/partially executed custody separately from pending authorization. Rotate signer configuration to invalidate old pending-epoch signatures, and rotate board configuration with its vote reset semantics. Already Signed obligations still require custody reconciliation. Verify the new manifest and keys before resuming. Do not treat process health endpoints as proof of complete backlog processing or external settlement.
