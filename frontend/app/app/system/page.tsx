"use client";
import { SignerSetPanel, ServiceHealth } from "@/components/SignerSetPanel";
import { config } from "@/lib/contracts";

const PIPELINE_CONTRACTS = [
  { label: "MockIdentityRegistry", key: "identity", note: "ERC-3643-flavored KYC/sanctions mock" },
  { label: "MockRWAToken", key: "token", note: "ERC-20 + agent-gated burn/freeze" },
  { label: "RedemptionRegistry", key: "registry", note: "finality-aware state machine (FR4/FR5)" },
  { label: "DirectBurnAdapter", key: "directBurn", note: "trigger type 0" },
  { label: "RequestLockAdapter", key: "requestLock", note: "trigger type 1" },
  { label: "ComplianceRecheck", key: "compliance", note: "destination eligibility re-check (FR3)" },
  { label: "InstructionSigner", key: "signer", note: "EIP-712 verification, threshold-gated (FR6)" },
  { label: "CircuitBreaker", key: "breaker", note: "manual review + multi-sig override (FR7/FR8)" },
  { label: "SettlementRecorder", key: "settlement", note: "closes the audit loop (FR14)" },
] as const;

export default function SystemPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">System status</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-body">
          Health of the off-chain signer set and custodian service, plus every pipeline
          contract address. On-chain state below is authoritative; service pings are a
          convenience for debugging, not a trust assumption.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Off-chain services</h2>
          <p className="mt-1 text-xs text-mute">3 signers + mock custodian (Railway)</p>
          <div className="mt-3">
            <ServiceHealth />
          </div>
        </section>
        <section className="card p-5">
          <SignerSetPanel />
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-mute">
            Signers are independent processes holding separate keys. The instruction contract
            enforces the threshold — no single signer or host can authorize a release alone
            (PRD §4.2.4).
          </p>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Pipeline contracts</h2>
        <ul className="mt-3 divide-y divide-line">
          {PIPELINE_CONTRACTS.map((c) => (
            <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span className="min-w-[190px]">
                <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                <span className="block text-[11px] text-mute">{c.note}</span>
              </span>
              <a
                href={`${config.explorer}address/${config[c.key]}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-brand underline-offset-2 hover:underline"
              >
                {config[c.key]}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}