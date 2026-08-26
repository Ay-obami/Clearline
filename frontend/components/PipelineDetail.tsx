"use client";
import { useAccount, useReadContract } from "wagmi";
import { StatusBadge } from "@/components/StatusBadge";
import { Addr } from "@/components/Addr";
import { Stepper } from "@/components/Stepper";
import { FinalityBar } from "@/components/FinalityBar";
import { VoteBox } from "@/components/VoteBox";
import { SignerSetPanel } from "@/components/SignerSetPanel";
import {
  registryAbi,
  complianceAbi,
  identityAbi,
  config,
  TriggerType,
} from "@/lib/contracts";
import type { Redemption } from "@/lib/useRedemptions";
import { useLiveBlock, useRedemption } from "@/lib/useRedemptions";
import { useTx } from "@/lib/useTx";
import { fmtTimestamp } from "@/lib/format";

const REG = config.registry as `0x${string}`;
const COMPLIANCE = config.compliance as `0x${string}`;
const IDENTITY = config.identity as `0x${string}`;

const ST_AWAITING_FINALITY = 1;
const ST_REQUESTED = 2;
const ST_APPROVED = 3;
const ST_FLAGGED = 4;
const ST_IN_REVIEW = 5;
const ST_SIGNED = 6;
const ST_SETTLED = 7;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-mute">{label}</span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}

export function PipelineDetail({ id }: { id: number }) {
  const r0: Redemption | undefined = useRedemption(id);
  const block = useLiveBlock();
  const { address } = useAccount();
  const txFin = useTx();
  const txCheck = useTx();

  // Destination eligibility now — mirrors the FR3 re-check the module runs.
  const verifiedQ = useReadContract({
    address: IDENTITY,
    abi: identityAbi,
    functionName: "isVerified",
    args: [(r0?.destination ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
    query: { enabled: !!r0 },
  });

  if (!r0) return <p className="text-sm text-mute">Loading redemption #{id}…</p>;
  const r = r0;

  const awaitingFinality = r.status === ST_AWAITING_FINALITY;
  const depthQReady = block >= r.triggerBlock && block > 0;

  return (
    <div className="space-y-6">
      {/* Header card — identity, stepper, live per-state action area */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-lg font-semibold text-ink">#{r.id}</h2>
            <StatusBadge status={r.status} />
          </div>
          <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-medium text-body ring-1 ring-line">
            {TriggerType[r.triggerType] ?? `Trigger ${r.triggerType}`}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-mute">trigger block {r.triggerBlock || "—"}</p>

        <div className="mt-5">
          <Stepper status={r.status} />
        </div>

        {/* Awaiting finality → confirmation countdown + keeper action */}
        {awaitingFinality && (
          <div className="mt-6 border-t border-line pt-5">
            <FinalityBar id={r.id} triggerBlock={r.triggerBlock} block={block} />
            {address && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  className="btn-secondary py-1.5 text-xs"
                  disabled={!depthQReady || txFin.pending}
                  onClick={() => void txFin.run(REG, registryAbi, "confirmFinality", [BigInt(r.id)])}
                >
                  Confirm finality
                </button>
                {!depthQReady && <span className="text-xs text-mute">enabled once depth is reached</span>}
              </div>
            )}
            {txFin.error && <p className="mt-2 text-xs text-flag">{txFin.error}</p>}
          </div>
        )}

        {/* Requested → compliance re-check (permissionless keeper entry) */}
        {r.status === ST_REQUESTED && (
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-xs leading-relaxed text-body">
              Trigger is final and requested. The compliance module runs a fresh
              destination check (FR3) — the signer services do this automatically; you can
              also fire it here to watch it happen.
            </p>
            {address && (
              <button
                className="btn-primary mt-3 py-1.5 text-xs"
                disabled={txCheck.pending}
                onClick={() => void txCheck.run(COMPLIANCE, complianceAbi, "runCheck", [BigInt(r.id)])}
              >
                Run compliance re-check
              </button>
            )}
            {txCheck.error && <p className="mt-2 text-xs text-flag">{txCheck.error}</p>}
          </div>
        )}

        {/* Flagged / manual review → multi-sig override */}
        {(r.status === ST_FLAGGED || r.status === ST_IN_REVIEW) && (
          <div className="mt-6 border-t border-line pt-5">
            <VoteBox id={r.id} compact />
          </div>
        )}

        {/* Approved → signature collection in progress */}
        {r.status === ST_APPROVED && (
          <div className="mt-6 border-t border-line pt-5">
            <SignerSetPanel redemptionId={r.id} />
          </div>
        )}

        {/* Signed → custodian settling off-chain */}
        {r.status === ST_SIGNED && (
          <div className="mt-6 rounded-[8px] border border-pending/30 bg-pending-tint px-4 py-3 text-xs leading-relaxed text-body">
            Instruction fully co-signed. The custodian service simulates its T+
            settlement delay, then posts confirmation back on-chain.
          </div>
        )}

        {/* Settled → loop closed */}
        {r.status === ST_SETTLED && (
          <div className="mt-6 rounded-[8px] border border-brand/30 bg-brand-tint px-4 py-3 text-xs leading-relaxed text-body">
            Settlement recorded on-chain — the audit trail for this redemption is closed.
          </div>
        )}
      </div>

      {/* Audit detail rows — the immutable per-redemption record (FR9) */}
      <div className="card p-6">
        <p className="mb-2 text-sm font-medium text-ink">Audit record</p>
        <div className="divide-y divide-line">
          <Row label="Asset token"><Addr value={r.asset} /></Row>
          <Row label="Holder"><Addr value={r.holder} /></Row>
          <Row label="Amount">
            <span className="font-mono">{r.amount.slice(0, 24)}</span>
          </Row>
          <Row label="Destination">
            <span className="inline-flex items-center gap-2">
              <Addr value={r.destination} />
              {verifiedQ.data === true ? (
                <span className="rounded-full bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium text-brand">
                  verified now
                </span>
              ) : verifiedQ.data === false ? (
                <span className="rounded-full bg-flag-tint px-1.5 py-0.5 text-[10px] font-medium text-flag">
                  not verified now
                </span>
              ) : null}
            </span>
          </Row>
          <Row label="Source event hash">
            <span className="break-all font-mono text-xs">{r.sourceEventHash}</span>
          </Row>
          <Row label="Compliance hash">
            <span className="break-all font-mono text-xs">{r.complianceHash}</span>
          </Row>
          <Row label="Instruction hash">
            <span className="break-all font-mono text-xs">{r.instructionHash}</span>
          </Row>
          <Row label="Settlement ref">
            <span className="break-all font-mono text-xs">{r.settlementRef}</span>
          </Row>
          <Row label="Requested at">
            <span className="font-mono text-xs">{fmtTimestamp(r.requestedAt)}</span>
          </Row>
          <Row label="Settled at">
            <span className="font-mono text-xs">{fmtTimestamp(r.settledAt)}</span>
          </Row>
        </div>
      </div>
    </div>
  );
}