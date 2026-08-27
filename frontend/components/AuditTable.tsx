"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Addr } from "@/components/Addr";
import { fmtAmount, fmtTimestamp } from "@/lib/format";
import { TriggerType } from "@/lib/contracts";
import type { Redemption } from "@/lib/useRedemptions";
import { useRedemptions } from "@/lib/useRedemptions";

const TRIGGER_FILTERS = ["all", "directBurn", "requestLock"] as const;
const STATUS_FILTERS = ["all", "awaiting", "requested", "flagged", "signed", "settled"] as const;

const TRIGGER_MATCH: Record<string, number[]> = {
  directBurn: [0], // TriggerType.Direct burn
  requestLock: [1], // TriggerType.Request & lock
};

const STATUS_MATCH: Record<string, number[]> = {
  awaiting: [1],
  requested: [2],
  flagged: [4, 5],
  signed: [6],
  settled: [7],
};

type SortKey = "id" | "date" | "amount";

function Th({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-line px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-mute ${
        onClick ? "cursor-pointer select-none hover:text-ink" : ""
      } ${active ? "text-ink" : ""}`}
      onClick={onClick}
    >
      {label}
      {active && <span className="ml-1">↓</span>}
    </th>
  );
}

/**
 * Audit trail data table (PRD §5.6/§5.8): every past redemption, filterable by
 * trigger type and status, sortable; each row links into its full pipeline
 * record (trigger → finality → compliance → signatures → settlement).
 */
export function AuditTable({ holderScope = false }: { holderScope?: boolean }) {
  const { list, loading } = useRedemptions(holderScope ? "holder" : "all");
  const [triggerF, setTriggerF] = useState<(typeof TRIGGER_FILTERS)[number]>("all");
  const [statusF, setStatusF] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    let out = [...list];
    if (triggerF !== "all") {
      const allowed = TRIGGER_MATCH[triggerF] ?? [];
      out = out.filter((r) => allowed.includes(r.triggerType));
    }
    if (statusF !== "all") {
      const allowed = STATUS_MATCH[statusF] ?? [];
      out = out.filter((r) => allowed.includes(r.status));
    }
    out.sort((a, b) => {
      let d = 0;
      if (sortKey === "id") d = a.id - b.id;
      else if (sortKey === "amount") d = Number(BigInt(a.amount) - BigInt(b.amount));
      else d = Math.max(a.settledAt, a.requestedAt) - Math.max(b.settledAt, b.requestedAt);
      return desc ? -d : d;
    });
    return out;
  }, [list, triggerF, statusF, sortKey, desc]);

  function clickSort(k: SortKey) {
    if (k === sortKey) setDesc((d) => !d);
    else {
      setSortKey(k);
      setDesc(true);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <FilterGroup label="Trigger" options={TRIGGER_FILTERS} value={triggerF} onChange={setTriggerF} />
        <FilterGroup label="Status" options={STATUS_FILTERS} value={statusF} onChange={setStatusF} />
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <Th label="#" onClick={() => clickSort("id")} active={sortKey === "id"} />
              <Th label="Trigger" />
              <Th label="Holder" />
              <Th label="Amount" onClick={() => clickSort("amount")} active={sortKey === "amount"} />
              <Th label="Destination" />
              <Th label="Date" onClick={() => clickSort("date")} active={sortKey === "date"} />
              <Th label="Status" />
              <th className="border-b border-line px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading &&
              [0, 1, 2].map((i) => (
                <tr key={`sk-${i}`} className="border-b border-line last:border-0">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
                    <td key={c} className="px-3 py-2.5">
                      <span className="block h-4 w-full animate-pulse rounded bg-bg" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <p className="text-sm text-body">No redemptions match these filters.</p>
                  <p className="mt-1 text-xs text-mute">
                    Records appear here permanently once triggered — this trail is the point.
                  </p>
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-bg/60">
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-ink">#{r.id}</td>
                  <td className="px-3 py-2.5 text-xs">{TriggerType[r.triggerType] ?? r.triggerType}</td>
                  <td className="px-3 py-2.5"><Addr value={r.holder} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtAmount(r.amount)}</td>
                  <td className="px-3 py-2.5"><Addr value={r.destination} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-mute">
                    {fmtTimestamp(r.requestedAt || r.settledAt)}
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={`/app/status?id=${r.id}`} className="text-xs text-brand hover:underline">
                      view chain
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[11px] text-mute">
        {rows.length} record{rows.length === 1 ? "" : "s"} · read live from on-chain events · immutable
      </p>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-mute">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
            value === o ? "bg-ink text-white" : "bg-card text-body ring-1 ring-line hover:text-ink"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

