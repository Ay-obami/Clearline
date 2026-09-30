# Bounded service audit followups

This followup examines the repository's demo operator services. It is not an independent security audit or a production custody release design. No deployment, public-network mutation, real custody release or signing-key migration is included.

## Findings and changes

- **Malformed configuration:** constructors accepted invalid chain IDs and deferred malformed contract addresses to ethers/ENS resolution; environment `Number(...)` accepted empty, fractional and nondecimal values. Shared validation now accepts nonzero Ethereum addresses, HTTP(S) RPC URLs, valid 32-byte private keys, positive safe-integer chain IDs and bounded integer timers/ports. Constructor errors do not echo a private key. Both services check the RPC chain ID against the EIP-712 domain before polling. Unknown `SERVICE_ROLE` now fails instead of starting a signer. The historical missing-role default remains signer and the historical missing-chain default remains 133. A health server is opened only after startup checks; later poll errors still do not make this basic liveness response a readiness guarantee.
- **Expired pending work:** the signer attempted signatures for every Approved instruction even after its on-chain deadline, producing avoidable reverting submissions every sweep. It now compares the instruction deadline to the latest chain block timestamp and skips only when strictly past the deadline, matching Solidity's equality boundary. It reads the current deadline every sweep, so an explicit operator window change can make work eligible again. It does not permanently cache expiry or invent automatic rejection/recovery.
- **Lost/stalled custodian work:** a rolling latest-4000-block event query could permanently lose Signed work after downtime; one failing settlement aborted later IDs; interval ticks overlapped delayed settlement; `Number(event.args.id)` lost precision for uint256 IDs. The mock custodian now reconciles registry IDs in batches of at most 50, serializes scans, isolates per-ID errors, and retains bigint IDs. It rechecks Signed after its delay and the contract still checks status/attestor authority at submission. Settled work is skipped on the next sweep.

The first five new regression cases were run against the original service implementation: five failed while the original seven passed. Additional coverage verifies decimal environment parsing, RPC chain mismatch, unknown dispatcher role, post-delay status changes, deadline equality and unavailable block fail-closed behavior. The chain rehearsal mines 4097 blocks after signing and verifies settlement still discovers that work, then advances time beyond a pending deadline and verifies that work remains Approved and unsigned.

## Verification

From the repository root:

```sh
npm ci --prefix services
npm test --prefix services
npm run typecheck --prefix services
npm run test:chain --prefix services
```

Observed locally: **18 service tests passed**, TypeScript typecheck passed, and the expanded disposable Anvil rehearsal passed all three groups (rotation/signature/settlement, board rotation/second settlement, historical backlog/expired pending work). Foundry/Anvil v1.8.3 and solc 0.8.28 were used. Forge emitted existing compiler/lint warnings; passing these commands does not resolve or dismiss those warnings. Generated service JavaScript is updated because this repository tracks it; the tracked incremental-build cache is excluded from the change.

## Limits and operational followups

- Registry reconciliation bounds IDs per tick, not elapsed time or RPC retries. A transaction confirmation/delay can hold the single scan open; a large registry makes full sweeps proportionally slower. There is no durable cursor, indexer or distributed process lock. Use one mock custodian process per key; concurrent replicas are not coordinated by this patch.
- There are no service `START_BLOCK` or additional finality-depth configuration options in the existing implementation. The event window is removed rather than replaced with a configurable start block. Redemption trigger finality is the registry's on-chain policy. Service reads and transactions use the latest chain state; no new confirmation/finality policy is imposed on Signed instructions or settlement receipts.
- Reorgs can undo status and submitted transactions; registry reconciliation will revisit canonical state, but neither service promises exactly-once off-chain release or durable receipt accounting. The mock custodian only delays and posts a settlement attestation; production custody systems need a finalized-block policy, durable idempotency references, receipt reconciliation and independent release controls. Its timestamp-generated reference remains a demo reference.
- Epoch/deadline/status can change between read, signature and mining. On-chain checks reject stale submissions; per-ID errors permit later work to continue. This followup does not add an off-chain authorization lock or change the v2 rotation/replay policy.
- Syntax and chain-ID checks do not establish contract bytecode identity, module-pointer wiring, signer/attestor membership or correct public deployment addresses. Follow the v2 migration gate and verify those before any cutover.
- Expired Approved redemptions remain pending until explicitly resolved by an operator policy. Skipping attempts prevents retries, but does not resolve the holder's claim. See `docs/AUTHORIZATION_ROTATION_V2.md`.

## Actual deployment script preflight

`npm run test:deployment --prefix services` starts a fresh local Anvil chain (31337), generates an ephemeral deployer in memory, funds it only on that local chain and broadcasts the repository's actual `script/Deploy.s.sol`. Forge output is captured privately; no private key is printed or passed in command-line arguments. Its temporary broadcast directory and public manifest are removed after the smoke test. This is separate from the lifecycle rehearsal, which deploys modules through ethers.

The initial actual-script smoke failed with `signer.circuitBreaker wiring mismatch`: the registry knew the breaker but the signer had no pause gate wired. The deployment script now wires the signer to the same breaker. The corrected smoke verifies nine deployed contracts, module/adapter/identity pointers and registration, v2 signer version, exact declared role arrays/quorums/attestor, configured finality depth and the public CLI at a pinned block. It also rejects wrong chain, absent code, swapped modules, wrong quorum, undeclared members, unauthorized attestor, wrong finality, unavailable block and a local v1-version stub. This checks code presence and configuration coherence; it does not certify bytecode identity, real assets or a production release.

Read-only preflight for a reviewed public deployment manifest:

```sh
node scripts/verify-deployment.cjs deployments/your-public-manifest.json YOUR_RPC_URL
```

See `deployments/v2-manifest.example.json` for the shape; its addresses are dummy placeholders and must be replaced. `blockNumber` is optional: omission chooses latest once, and every state/code read is pinned to that block; the final block hash must remain unchanged. Declared signer/board arrays must match on-chain ordering and membership exactly. Roles are optional, but omitted declarations only establish a positive quorum and at least one authorized attestor, not who controls them. No read-only preflight changes deployment configuration or broadcasts transactions.
