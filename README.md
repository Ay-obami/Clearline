# Clearline

**RWA redemption and custody-attestation infrastructure for tokenized real-world assets.**

Clearline connects an on-chain token redemption event to the off-chain release of the underlying asset through a verifiable, security-focused pipeline. It waits for finality, re-checks payout eligibility, collects threshold EIP-712 signatures, routes exceptions through manual review, and records settlement attestations back on-chain.

> **Burn on-chain. Verify compliance. Authorize release. Attest settlement.**

## Project snapshot

- **Solidity + Foundry protocol architecture** for redemption lifecycle management
- **ERC-3643-style compliance re-checks** at redemption time
- **2-of-3 EIP-712 threshold signing** with nonce and deadline protection
- **Circuit-breaker/manual-review path** with board approval/rejection
- **Finality-aware execution** before downstream processing begins
- **On-chain settlement attestation** with a traceable audit chain
- **Regression-tested v2 authorization and deployment configuration**; historical v1 had 44 tests and ~90.6% core line coverage (v2 coverage is not remeasured)
- **Next.js frontend** plus independent Node.js signer/custodian services
- **Historical v1 HSK testnet deployment** with Blockscout-verified contracts; current v2 requires fresh deployment
- **Mainnet deployment guardrails** including explicit confirmation and pre-broadcast cost checks

## Why this exists

Tokenization makes issuance programmable, but redemption often falls back to opaque back-office workflows. Clearline makes the redemption path observable and auditable without pretending the blockchain replaces the issuer, identity registry, or custodian.

The system is a **consumer of ERC-3643 interfaces**. It automates redemption initiation, eligibility checks, release authorization, exception handling, and settlement attestation while the underlying asset still moves through the custodian's existing rails.

## Architecture

```text
                 Trigger adapters                      Shared on-chain pipeline
┌─────────────────────────────────┐  RedemptionTriggered  ┌─────────────────────────────────────────┐
│ DirectBurnAdapter  (on-demand)  │ ─────────────────────▶ │ RedemptionRegistry                       │
│ RequestLockAdapter (lock+final) │                       │  • finality wait → Requested            │
│ (interface for issuer,          │                       ├─────────────────────────────────────────┤
│  scheduled, threshold adapters) │                       │ ComplianceRecheck  → Approved | Flagged │
└─────────────────────────────────┘                       ├─────────────────────────────────────────┤
                                                          │ InstructionSigner   → Signed (2-of-3)    │
                                CircuitBreaker            ├─────────────────────────────────────────┤
                                (board vote override)     │ SettlementRecorder → Settled (attested) │
                                                          └─────────────────────────────────────────┘
```

Every redemption is tagged by trigger type and traceable end-to-end via `RedemptionRegistry.getRedemption(id)`.

## Authorization rotation v2 (unreleased)

This branch introduces signer/board configuration epochs and EIP-712 release-instruction version 2. It requires coordinated new contract addresses and updated clients; existing testnet deployments remain v1. See [rotation policy and migration gates](docs/AUTHORIZATION_ROTATION_V2.md). The v2 suite includes authorization/configuration regressions, service backlog/expiry tests and an actual local deployment-script smoke. The 44-test/coverage figures elsewhere describe the original v1 release; coverage has not been remeasured for v2.

See the [operator runbook](docs/OPERATOR_RUNBOOK.md) for manifest verification, historical record retention, cutover and incident handling.

## Security model

Clearline is designed around explicit authorization boundaries rather than a single privileged backend process.

- **Finality before action** — downstream processing is unreachable until the configured block depth is satisfied.
- **Redemption-time compliance** — payout eligibility is checked again when the redemption is processed.
- **Threshold signing** — release instructions require the configured signer quorum; signatures use EIP-712 with nonce/deadline protection.
- **Manual-review path** — flagged or threshold-exceeded redemptions require board action rather than silently bypassing policy.
- **Settlement proof** — the custodian confirmation is recorded on-chain and linked to the redemption lifecycle.
- **Mainnet safety** — chainId-177 broadcasts require `CONFIRM_MAINNET=true`; the deployment runner dry-runs and cost-checks the full batch first.
- **Key hygiene** — role keys are generated locally and kept in gitignored deployment files.

## Core components

### Smart contracts — `src/`

| Contract | Responsibility |
| --- | --- |
| `RedemptionRegistry` | Pipeline state machine, lifecycle storage, finality depth, lifecycle events |
| `DirectBurnAdapter` | Holder-initiated redemption path that burns approved tokens and triggers the pipeline |
| `RequestLockAdapter` | Two-step lock → finalize flow with cancellation for NAV-priced products |
| `ComplianceRecheck` | Per-redemption payout eligibility and sanctions re-check |
| `InstructionSigner` | EIP-712 threshold verification with nonce/deadline replay protection |
| `CircuitBreaker` | Manual-review queue and board-vote approve/reject override |
| `SettlementRecorder` | Custodian-signed settlement confirmation and lifecycle closure |
| `MockIdentityRegistry` / `MockRWAToken` | ERC-3643-flavored test fixtures used for validation |

### Off-chain services — `services/`

- **signer-1 / signer-2 / signer-3** — independent EIP-712 signing processes
- **custodian** — verifies the collected signature set and posts settlement confirmation on-chain

### Frontend — `frontend/`

Next.js dashboard with Initiate, Status, Audit, and System views. It supports wallet-connected balances, direct-burn flows, per-redemption timelines, and on-chain audit inspection. Network and contract configuration is entirely environment-driven.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Smart contracts: registry, adapters, compliance, signer, breaker, recorder |
| `src/interfaces/` | Protocol interfaces and shared redemption types |
| `src/mocks/` | ERC-3643-flavored test fixtures |
| `test/` | Foundry tests for happy paths, finality, compliance, replay and authorization failures |
| `script/` | Foundry deployment and seed scripts |
| `scripts/` | Ops helpers for local replay, role setup, funding and deployment |
| `services/` | Node.js signer processes and custodian service |
| `frontend/` | Next.js dashboard |
| `deployments/` | Environment templates and deployment configuration |

## Validation evidence

```bash
forge install
forge build
forge test -vvv      # 44 tests
forge coverage       # ~90.6% line coverage on core contracts
```

The suite covers finality/reorg edge cases, compliance-flag routing, threshold-exceeded review, replay rejection, unauthorized signers, and the core redemption state machine.

A scripted local E2E replay is also included:

```bash
scripts/demo-local.sh
```

It exercises the happy path, compliance flag + board override, and request-and-lock finalize/cancel branches.

## Quick start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/)
- Node.js 22 for the frontend (verified in CI); Node.js ≥ 20 for services
- EIP-1193 wallet such as MetaMask

### Contracts

```bash
forge install
forge build
forge test -vvv
```

### Local Anvil stack

```bash
anvil

MINT_AMOUNT=20000ether \
forge script script/Deploy.s.sol:ClearlineDeploy \
  --rpc-url local \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf7f268
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Services

```bash
cd services
npm install
npm run start:signer
npm run start:custodian
```

## Public testnet deployment

### HSK Chain testnet — chainId 133

The current stack is deployed and Blockscout-verified.

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

Configuration: **2-of-3 signer threshold**, **2-of-2 board**, **12-block finality depth**.

Multiple redemptions have completed the full lifecycle on testnet:

```text
trigger → finality → compliance → threshold signatures → settlement
```

Frontend status: `clearline-testnet.vercel.app`

## Mainnet readiness

HSK mainnet deployment is prepared but **not broadcast**.

`Deploy.s.sol` refuses to broadcast on chainId 177 unless:

```bash
CONFIRM_MAINNET=true
```

The one-shot deployment runner validates chain and balances, funds role wallets, dry-runs the deployment, checks estimated cost, broadcasts, and records resulting addresses.

## Configuration

### Frontend

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` / `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_EXPLORER` | Network identity |
| `NEXT_PUBLIC_ENVIRONMENT` / `NEXT_PUBLIC_CHAIN_NAME` | Environment labels |
| `NEXT_PUBLIC_TOKEN` … `NEXT_PUBLIC_IDENTITY` | Deployed contract addresses |
| `NEXT_PUBLIC_HEALTH_URLS` | Optional service health URLs |

### Services

| Variable | Purpose |
| --- | --- |
| `RPC_URL` / `CHAIN_ID` | Target network |
| `PRIVATE_KEY` | Signer or attestor key |
| `SIGNER_CONTRACT` / `REGISTRY_ADDRESS` / `SETTLEMENT_ADDRESS` | Deployed addresses |
| `POLL_MS` / `SETTLEMENT_DELAY_MS` | Service cadence |
| `PORT` / `HEALTH_PORT` | Health endpoint configuration |

## CI

`.github/workflows/ci.yml` runs:

- Foundry tests
- Foundry coverage
- TypeScript typechecks for frontend and services

## Scope note

`MockRWAToken` and `MockIdentityRegistry` are ERC-3643-flavored fixtures used for validation. A production deployment would connect the same redemption pipeline to a real issuer contract, identity registry, and custodian integration.

## Status

| Network | Contracts | Frontend | Services |
| --- | --- | --- | --- |
| HSK testnet (133) | Deployed + Blockscout-verified | Live | 4 services online |
| HSK mainnet (177) | Prepared, not broadcast | Project configured | Provision at go-live |
