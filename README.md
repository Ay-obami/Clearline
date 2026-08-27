# Clearline

**An on-chain redemption and custody-attestation layer for tokenized real-world assets.**

Tokenization solved issuance; redemption stayed in the back office. Clearline connects an on-chain token burn to the release of the underlying asset by running a verifiable, multi-step pipeline on-chain: it waits out block finality, re-checks the payout destination against an ERC-3643 identity registry at redemption time, collects a threshold EIP-712 multi-signature set on the release instruction, and records the custodian's settlement confirmation back on-chain — closing a fully queryable audit loop.

Clearline is a *consumer* of ERC-3643 interfaces (identity registry, agent-scoped token `burn`). It does not replace the issuer, the identity registry, or the custody stack; it automates **initiation and attestation**, while the movement of the underlying asset continues to run on the custodian's rails.

## Features

- **Finality-aware pipeline** — every trigger is held in *Awaiting finality* until the configured confirmation depth (12 blocks by default) is reached; no downstream step is reachable before then.
- **Multiple trigger paths, one pipeline** — on-demand direct burn and two-step request-and-lock converge on the same registry state machine, so downstream behavior is identical by design.
- **Redemption-time compliance re-check** — the payout destination is validated against the ERC-3643 identity registry at redemption time; failures route to a manual-review queue instead of stalling the pipeline.
- **Threshold multi-sig release instructions** — EIP-712 release instructions are signed by a configurable set of independent signer processes (2-of-3 by default), with nonce/deadline protection against replay.
- **Circuit breaker with board override** — flagged or threshold-exceeded redemptions can be approved or rejected by a multi-sig board vote.
- **Settlement attestation** — the custodian's confirmation is recorded on-chain with a full hash chain (source event → compliance → instruction → settlement), producing an immutable audit trail.
- **Production guardrails** — mainnet broadcasts require an explicit `CONFIRM_MAINNET=true`; the deployment runner dry-runs and cost-checks the full transaction batch before broadcasting.

## Architecture

```
                 Trigger adapters                      Shared on-chain pipeline
┌─────────────────────────────────┐  RedemptionTriggered  ┌─────────────────────────────────────────┐
│ DirectBurnAdapter  (on-demand)  │ ─────────────────────▶ │ RedemptionRegistry                       │
│ RequestLockAdapter (lock+final) │                       │  • finality wait → Requested            │
│ (interface for issuer,          │                       ├─────────────────────────────────────────┤
│  scheduled, threshold adapters) │                       │ ComplianceRecheck  → Approved | Flagged │
└─────────────────────────────────┘                       ├─────────────────────────────────────────┤
                                                          │ InstructionSigner   → Signed (2-of-3)    │
                                CircuitBreaker            ├─────────────────────────────────────────┤
                                (board vote override)    │ SettlementRecorder → Settled (attested)  │
                                                          └─────────────────────────────────────────┘
```

Every redemption is tagged by trigger type and traceable end-to-end via `RedemptionRegistry.getRedemption(id)`.

## Components

### Smart contracts — `src/`

| Contract | Responsibility |
| --- | --- |
| `RedemptionRegistry` | Pipeline state machine; configurable per-asset finality depth; emits the full lifecycle event set. |
| `DirectBurnAdapter` | Holder-initiated, on-demand redemption: burns approved tokens and triggers the pipeline. |
| `RequestLockAdapter` | Two-step lock → finalize flow with cancellation, for NAV-priced products. |
| `ComplianceRecheck` | Per-redemption destination eligibility and sanctions re-check; permissionless keeper entry. |
| `InstructionSigner` | EIP-712 `RedemptionInstruction` verification; threshold `ecrecover` with nonce/deadline protection. |
| `CircuitBreaker` | Manual-review queue; board-vote approve/reject override. |
| `SettlementRecorder` | Records custodian-signed settlement confirmations that close the lifecycle. |
| `MockIdentityRegistry` / `MockRWAToken` | ERC-3643-flavored test fixtures for validation (see *Test fixtures*). |

### Off-chain services — `services/`

- **signer-1 / signer-2 / signer-3** — independent EIP-712 signing processes (one per key). They watch the registry for requested redemptions and submit signatures until the quorum is met.
- **custodian** — settlement relayer: verifies the collected threshold signature set, then posts the settlement confirmation on-chain.

### Frontend — `frontend/`

Next.js dashboard (Initiate, Status, Audit, System views) wired to live contract state: wallet-connected balance, a two-step direct-burn flow (approve → burn), per-redemption pipeline timelines, and the on-chain audit table. The same build serves testnet and mainnet — the target network and addresses come entirely from environment variables.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Smart contracts (registry, adapters, compliance, signer, breaker, recorder). |
| `src/interfaces/` | `ITriggerAdapter`, `IRedemptionTypes`, `IIdentityRegistry`, etc. |
| `src/mocks/` | ERC-3643-flavored test fixtures (identity registry, RWA token). |
| `test/` | Foundry test suite — happy paths, finality edge cases, compliance routing, replay/unauthorized rejection. |
| `script/` | Foundry scripts: `Deploy.s.sol` (full stack), `Seed.s.sol` (re-mint / re-verify). |
| `scripts/` | Ops helpers: role-wallet generation, role funding, local E2E replay, testnet verify, one-shot mainnet deploy. |
| `services/` | Node.js signer ×3 + custodian services (deployed on Railway). |
| `frontend/` | Next.js dashboard. |
| `deployments/` | Environment files (gitignored; `.env.example` variants are committed). |


## Getting started

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) — `forge`, `cast`
- Node.js ≥ 20 for the frontend, ≥ 24 for the services
- An EIP-1193 wallet (e.g. MetaMask) for the dashboard

### Run the test suite

```bash
forge install        # first time only
forge build
forge test -vvv      # 44 tests
forge coverage       # ~90.6% line coverage on core contracts
```

### Local development (Anvil)

```bash
anvil                     # terminal 1 — local EVM (chainId 31337)

# terminal 2 — deploy the full stack to localhost (mints the demo RWA balance)
MINT_AMOUNT=20000ether \
forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url local --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf7f268

# terminal 3 — frontend
cd frontend && npm install && cp .env.example .env.local   # paste deployed addresses
npm run dev

# terminal 4 — services (one process per signer, plus the custodian)
cd services && npm install
npm run start:signer        # ×3, each with a different PRIVATE_KEY
npm run start:custodian
```

Anvil ships deterministic development accounts; the deployer (anvil account #0) receives the demo RWA balance. Add the network (`http://127.0.0.1:8545`, chainId `31337`) in MetaMask and import the anvil key above to use the dashboard.

For a scripted end-to-end replay of every pipeline branch (happy path, compliance flag + board override, request-and-lock finalize/cancel), run:

```bash
scripts/demo-local.sh
```

## Deployment

### HSK Chain testnet (chainId 133)

The full stack is deployed and Blockscout-verified on HSK testnet.

| Contract | Address |
| --- | --- |
| RedemptionRegistry | `0x2E9a0a2217B7A7c1524eeF6b4599B40AE5F891E8` |
| MockRWAToken | `0x095b47575fd7fB67dab8773fB8E01C94b0A24884` |
| MockIdentityRegistry | `0x235D438A068B75DbFC404308494ee4Fbde56852E` |
| DirectBurnAdapter | `0xCe3fA8660EFc7ec4d9d4373ed23FA26741032a21` |
| RequestLockAdapter | `0x2Fad67f598EC08ec3D48143baC28638D4eDE09FD` |
| ComplianceRecheck | `0x6A97b1913Bca9d17A57cAae1F6b5C1885bE1DAA1` |
| InstructionSigner | `0x25be872a3791a159A598C1539b0BCb22e5FCaC16` |
| CircuitBreaker | `0x8D40f9D47886f21223357874e1a99a22DD4f9E5e` |
| SettlementRecorder | `0x4CdF78C7830FE120d0c2Be8123e8AE4DEe6402bA` |

Configuration on testnet: signer threshold **2-of-3**, board **2-of-2**, finality depth **12 blocks**. Multiple redemptions have completed the full lifecycle (trigger → finality → compliance → threshold signatures → settlement) against the live RPC with the signer and custodian services running.

#### Deploying a fresh testnet stack

```bash
# 1. Generate dedicated role wallets → deployments/testnet.roles.env (gitignored)
./scripts/gen-role-wallets.sh testnet

# 2. Seed gas into each role wallet from your funded deployer
FUNDING_KEY=0x… ./scripts/fund-roles.sh testnet

# 3. Deploy + wire the stack (export HSK_TESTNET_RPC first; see foundry.toml)
DEPLOYER_KEY=0x… \
SIGNER_ADDRS=<S1>,<S2>,<S3> BOARD_ADDRS=<A>,<B> ATTESTOR_ADDR=<0x…> HOLDER=<0x…> \
MINT_AMOUNT=25000ether \
forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url hsk_testnet --broadcast --verify
```

Paste the printed addresses into `frontend/.env.local` and the service environments.

### HSK Chain mainnet (chainId 177)

The mainnet deployment is prepared but **not yet broadcast**. `Deploy.s.sol` enforces a hard guardrail — it refuses to broadcast on chainId 177 unless `CONFIRM_MAINNET=true` is set. The one-shot runner handles the rest:

```bash
# deployments/mainnet.env holds the configuration (gitignored; fill DEPLOYER_KEY)
./scripts/deploy-mainnet.sh
```

The runner: validates the chain and balances → seeds the role wallets (configurable, minimal by default) → **dry-runs the full deployment and aborts if the deployer cannot cover the estimated cost** → broadcasts → captures the deployed addresses into `deployments/mainnet.addresses.env`. After deployment, the same env-driven build serves the mainnet frontend (`clearline-mainnet` Vercel project) and a dedicated set of Railway services.


## Configuration

### Frontend (`frontend/.env.example`)

One set of values per deployment target — the same build serves testnet or mainnet.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` / `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_EXPLORER` | Network identity (133 testnet / 177 mainnet). |
| `NEXT_PUBLIC_ENVIRONMENT` / `NEXT_PUBLIC_CHAIN_NAME` | Environment pill and labels in the UI. |
| `NEXT_PUBLIC_TOKEN` … `NEXT_PUBLIC_IDENTITY` | Deployed contract addresses. |
| `NEXT_PUBLIC_HEALTH_URLS` | Optional service health-panel URLs. |

Env-provided addresses are validated (strict 40-hex, stray-character sanitized) at build time, so a malformed value fails loudly instead of silently pointing at a placeholder.

### Services

| Variable | Purpose |
| --- | --- |
| `RPC_URL` / `CHAIN_ID` | Target network. |
| `PRIVATE_KEY` | Signing key (signer) or attestor key (custodian). |
| `SIGNER_CONTRACT` / `REGISTRY_ADDRESS` / `SETTLEMENT_ADDRESS` | Deployed contract addresses. |
| `POLL_MS` / `SETTLEMENT_DELAY_MS` | Poll cadence and settlement delay. |
| `PORT` / `HEALTH_PORT` | HTTP health endpoint. |

Reference environment sets live in `deployments/` (`railway.env`, `signer-1.env` … `signer-3.env`, `custodian.env`, `local.env.example`).

## Testing & CI

- **Foundry suite** — 44 tests, ~90.6% average line coverage on core contracts, covering finality/reorg edge cases, compliance-flag routing to manual review, threshold-exceeded review, signature replay rejection, and unauthorized-signer rejection.
- **End-to-end validation** — `scripts/demo-local.sh` replays every pipeline branch against a local stack; the live testnet deployment has settled real redemptions through the full lifecycle with independent signer processes and the custodian service.
- **CI** (`.github/workflows/ci.yml`) runs `forge test`, `forge coverage`, and TypeScript typechecks for the frontend and services on every push.

## Security & operational model

- **Threshold signing** — release instructions require the configured signer quorum (2-of-3 by default); every signature is verified on-chain with nonce/deadline protection against replay.
- **Finality before action** — no downstream step is reachable until the configured block depth is reached.
- **Compliance gate** — payouts to unverified destinations are routed to a manual-review queue and require a board vote.
- **Explicit mainnet opt-in** — chainId-177 broadcasts require `CONFIRM_MAINNET=true`, and the deploy runner dry-runs and cost-checks the whole batch first.
- **Key hygiene** — role keys are generated locally, stored in gitignored `deployments/*.roles.env` (mode 600), and never committed or logged.

### Test fixtures

`MockRWAToken` (`CLRWA`) and `MockIdentityRegistry` are ERC-3643-flavored fixtures used for validation. A production deployment wires the same adapters and pipeline to a real issuer contract and identity registry, and the settlement attestor is an actual custodian process.

## Status

| Network | Contracts | Frontend | Services |
| --- | --- | --- | --- |
| HSK testnet (133) | Deployed + Blockscout-verified | Live — `clearline-testnet.vercel.app` | 4 services online (Railway) |
| HSK mainnet (177) | Prepared, not yet broadcast | Project configured | To be provisioned at go-live |

