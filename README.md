# Clearline

**Redemption & custody attestation layer for tokenized real-world assets (RWAs) on HSK Chain.**

Tokenization solved issuance; redemption stayed in the back office. Clearline connects an
on-chain token burn to the release of the underlying asset: it waits out block finality,
re-checks destination compliance against the ERC-3643 identity registry at redemption time,
collects a 2-of-3 EIP-712 multi-sig signature set on the release instruction, and records
the custodian's settlement confirmation back on-chain — closing a fully queryable audit loop.

It is a consumer of ERC-3643 interfaces (`IdentityRegistry`, agent-scoped `burn`), not a
replacement for them. Automated *initiation*, not automated completion — real settlement
still runs on custodians' rails at T+1/T+2.

## Architecture

```
Trigger adapters                Shared pipeline (all on-chain)
┌────────────────────┐   RedemptionTriggered   ┌─────────────────────────┐
│ DirectBurnAdapter  │ ───────────────────────▶│ RedemptionRegistry      │ finality depth → REQUESTED
│ RequestLockAdapter │                         ├─────────────────────────┤
│ (issuer / sched. / │                         │ ComplianceRecheck       │ IdentityRegistry recheck → APPROVED | FLAGGED
│  threshold: next)  │                         ├─────────────────────────┤
└────────────────────┘                         │ InstructionSigner       │ 2-of-3 EIP-712 co-signs → SIGNED
                                               ├─────────────────────────┤
        CircuitBreaker ◀── FLAGGED routes here │ SettlementRecorder      │ custodian posts confirmation → SETTLED
        (multi-sig board vote)                 └─────────────────────────┘
```

Every redemption is tagged by trigger type and traceable end-to-end via
`RedemptionRegistry.getRedemption(id)` — the audit trail (FR9).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Foundry contracts: registry, adapters, compliance, signer, breaker, recorder |
| `src/interfaces/` | `ITriggerAdapter`, `IRedemptionTypes`, `IIdentityRegistry`, … |
| `src/mocks/` | `MockIdentityRegistry` (KYC/sanctions toggles), `MockRWAToken` (ERC-3643-flavored ERC-20) |
| `test/` | Foundry suite — happy paths + reorg/finality edge cases, compliance flagging, signature replay, unauthorized signer |
| `script/` | `Deploy.s.sol` (full stack to HSK testnet), `Seed.s.sol` (demo-day reset: mint + KYC wallets) |
| `services/signer/` | Node.js signer service ×3 (Railway): watches events, signs EIP-712 instructions |
| `services/custodian/` | Mock custodian/settlement service: verifies threshold signatures, settles, records on-chain |
| `frontend/` | Next.js landing page + dashboard wired to live contract state |

## Contracts (Core scope)

| Contract | Role |
| --- | --- |
| `RedemptionRegistry` | Shared pipeline state machine; configurable finality depth (FR5); emits `RedemptionRequested` |
| `DirectBurnAdapter` | Holder-initiated on-demand redemption (FR1) |
| `RequestLockAdapter` | Two-step lock → finalize flow with cancellation (FR2) |
| `ComplianceRecheck` | Fresh destination eligibility + sanctions check per redemption (FR3); permissionless keeper entry |
| `InstructionSigner` | EIP-712 `RedemptionInstruction` struct + ecrecover threshold verification, replay/nonce protected (FR6) |
| `CircuitBreaker` | Manual review queue with board-vote approve/reject override (FR7/FR8) |
| `SettlementRecorder` | Custodian-signed settlement confirmations close the lifecycle (FR14) |

Issuer-initiated (`forcedTransfer`), scheduled/batch, and NAV-threshold adapters plug in via
`ITriggerAdapter` without registry changes (FR11–FR13 spec'd in PRD §5.1 Extensions).

## Quickstart

```bash
# Contracts (Foundry)
forge install        # first time only
forge test -vvv
forge coverage

# Frontend
cd frontend && npm install && cp .env.example .env.local  # paste deployed addresses
npm run dev

# Signer / custodian services (one process each)
cd services && npm install
cp signer/.env.example signer/.env       # fill in key + addresses
cp custodian/.env.example custodian/.env # fill in key + addresses
npm run dev --workspace @clearline/signer
npm run dev --workspace @clearline/custodian

# One-command E2E replay of every pipeline path (local anvil, post-deploy):
../scripts/demo-local.sh   # happy path, KYC-revoke rejection, board override,
                           # request/lock finalize + cancel branches
```

### Local end-to-end demo (Anvil)

```bash
anvil                                          # terminal 1
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf7f268 \
  forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url local --broadcast   # terminal 2
# copy printed addresses into services .env files, start both services,
# then import an Anvil funded key (e.g. account #1) into MetaMask and use the app.
forge script script/Seed.s.sol --rpc-url local --broadcast   # reset/re-mint demo state
```

### HSK Chain testnet deployment

Chain ID `133`, RPC `https://testnet.hsk.xyz` (use a dedicated Chainstack endpoint for live
demos — the public RPC is rate-limited). Fund a deployer via the HashKey faucet or bridge,
then:

```bash
forge script script/Deploy.s.sol:ClearlineDeploy \
  --rpc-url hsk_testnet --private-key $DEPLOYER_KEY --broadcast --verify
```

Deploy order: identity registry → RWA token → Redemption Registry → adapters → compliance →
signer/breaker/settlement. Paste resulting addresses into `frontend/.env.local` and both
service `.env` files.

## Testing & status

- Foundry suite: **44 tests passing**, ~90.6% average coverage on Core contracts — including
  reorg/finality edge cases, compliance-flag routing to manual review, threshold-exceeded
  review, signature replay rejection, and unauthorized-signer rejection.
- **Live end-to-end rehearsal** (local Anvil + 3 signer services + mock custodian running):
  - Happy path: burn → 12-block finality wait → permissionless `confirmFinality` → keeper
    `runCheck` → Approved → **2-of-3 EIP-712 signatures collected by the independent signer
    processes** → custodian settlement posted → **Settled ~56s after trigger**, audit record
    fully populated (source/compliance/instruction hashes, timestamps).
  - Flagged path: redemption to an unverified destination auto-routed to manual review →
    board override approved 2-of-2 → signers resumed automatically → **Signed within ~6s,
    Settled within ~18s of override** — the human checkpoint preserved, not a dead end.
  - Signer race resilience observed: concurrent duplicate submissions revert cleanly and
    the service continues (no crashes, threshold still enforced).
- CI runs `forge test`, `forge coverage`, and typechecks for frontend + services on every push.
- Extension adapters (issuer-initiated, scheduled, threshold) are interface-ready via
  `ITriggerAdapter`; PRD §5.1 records them as documented specs rather than rushed code.

### Local demo accounts (Anvil only — zero-value dev keys)

| Role | Address | Private key |
| --- | --- | --- |
| Holder / redeemer (browser) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| Deployer / compliance keeper | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Anvil account #0 |
| Signers ×3 | #3, #4, #5 | — |
| Circuit-breaker board ×2 | #6, #7 | — |
| Settlement attestor | #8 | custodian service key |

Import the holder key into MetaMask (add network `http://127.0.0.1:8545`, chainId 31337),
open the dashboard, and you'll see redemptions #1 and #2 with their full audit trails.


## Demo-day checklist (PRD §9.9)

1. Pre-fund deployer, custodian relayer, and all signer wallets with testnet HSK.
2. Pre-deploy + pre-verify contracts; seed demo wallets (`script/Seed.s.sol`).
3. Confirm Railway services healthy (System tab shows on-chain signer set; `/healthz` if wired).
4. Keep `Seed.s.sol` handy to re-mint in case a flow needs re-running.
5. Local Anvil fork is the fallback path if testnet RPC degrades mid-demo.

