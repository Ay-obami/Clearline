"use client";
import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { signerAbi, config } from "@/lib/contracts";
import { Addr } from "@/components/Addr";

const SIGNER_CONTRACT = config.signer as `0x${string}`;

/** Optional Railway service health URLs: "Label=url,Label=url" (PRD §5.8). */
export function parseHealthUrls(): { label: string; url: string }[] {
  return (process.env.NEXT_PUBLIC_HEALTH_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return { label: "service", url: pair };
      return { label: pair.slice(0, eq).trim(), url: pair.slice(eq + 1).trim() };
    });
}

type HealthState = "ok" | "down" | "unknown";

function useHealth(url: string): HealthState {
  const [state, setState] = useState<HealthState>("unknown");
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!cancelled) setState(res.ok ? "ok" : "down");
      } catch {
        if (!cancelled) setState("down");
      }
    };
    check();
    const t = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [url]);
  return state;
}

function ServiceRow({ label, url }: { label: string; url: string }) {
  const state = useHealth(url);
  const dot =
    state === "ok" ? "bg-brand" : state === "down" ? "bg-flag pulse-soft" : "bg-mute";
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2">
      <span className="flex items-center gap-2 text-sm text-ink">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        {label}
      </span>
      <span className="text-xs capitalize text-mute">{state}</span>
    </div>
  );
}

export function ServiceHealth() {
  const urls = parseHealthUrls();
  if (urls.length === 0) {
    return (
      <p className="rounded-[8px] border border-dashed border-line px-3 py-3 text-xs leading-relaxed text-mute">
        No service health endpoints configured. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_HEALTH_URLS</code> to the signer/custodian
        <code className="font-mono"> /healthz</code> endpoints after deploying them to Railway
        (§9.3–9.4). On-chain signer-set status below always reflects reality.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {urls.map((u) => (
        <ServiceRow key={u.url} label={u.label} url={u.url} />
      ))}
    </div>
  );
}

function SignerRow({
  index,
  collected,
}: {
  index: number;
  collected: Set<string>;
}) {
  const q = useReadContract({
    address: SIGNER_CONTRACT,
    abi: signerAbi,
    functionName: "signers",
    args: [BigInt(index)],
  });
  const addr = q.data ? String(q.data) : "";
  const hasSigned = addr !== "" && collected.has(addr.toLowerCase());
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2">
      <span className="flex items-center gap-2 text-sm">
        <span
          className={`h-1.5 w-1.5 rounded-full ${hasSigned ? "bg-brand" : "bg-pending"}`}
          aria-hidden
        />
        <span className="text-xs font-mono text-mute">#{index}</span>
        <Addr value={addr} />
      </span>
      <span className={`text-xs ${hasSigned ? "font-medium text-brand" : "text-mute"}`}>
        {hasSigned ? "signed" : "pending"}
      </span>
    </div>
  );
}

/**
 * Signer-status panel (PRD §5.6/5.8): each configured signer in the on-chain
 * set, whether it signed the current instruction (when `redemptionId` given),
 * and threshold progress.
 */
export function SignerSetPanel({ redemptionId }: { redemptionId?: number }) {
  const countQ = useReadContract({ address: SIGNER_CONTRACT, abi: signerAbi, functionName: "signerCount" });
  const thresholdQ = useReadContract({ address: SIGNER_CONTRACT, abi: signerAbi, functionName: "threshold" });
  const collectedQ = useReadContract({
    address: SIGNER_CONTRACT,
    abi: signerAbi,
    functionName: "collectedSigners",
    args: redemptionId != null ? [BigInt(redemptionId)] : undefined,
    query: { enabled: redemptionId != null },
  });

  const finalizedEpochQ = useReadContract({
    address: SIGNER_CONTRACT,
    abi: signerAbi,
    functionName: "signedEpochOf",
    args: redemptionId != null ? [BigInt(redemptionId)] : undefined,
    query: { enabled: redemptionId != null },
  });

  const n = Number(countQ.data ?? 0);
  const threshold = Number(thresholdQ.data ?? 0);
  const collectedList = (
    Array.isArray(collectedQ.data) ? (collectedQ.data as unknown as readonly string[]) : []
  ).map((a) => a.toLowerCase());
  const collected = new Set<string>(collectedList);
  const sigCount = collectedList.length;

  if (redemptionId != null && (finalizedEpochQ.isLoading || collectedQ.isLoading)) {
    return <p className="text-xs text-mute">Loading authorization record…</p>;
  }
  if (redemptionId != null && (finalizedEpochQ.isError || collectedQ.isError)) {
    return <p className="text-xs text-mute">Unable to read the v2 authorization record. Check the configured deployment.</p>;
  }
  if (Number(finalizedEpochQ.data ?? 0) > 0) {
    return (
      <div>
        <p className="mb-3 text-sm font-medium text-ink">Finalized authorization · {sigCount} signatures</p>
        <div className="space-y-2">
          {collectedList.map((address) => (
            <div key={address} className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2">
              <Addr value={address} />
              <span className="text-xs text-brand">signed</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-mute">Recorded signers at authorization time; later group changes do not alter this record.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-medium text-ink">Signer set</p>
        <p className="font-mono text-xs text-mute">
          {redemptionId != null ? `${sigCount}/${threshold} signatures · ` : ""}
          threshold {threshold}-of-{n}
        </p>
      </div>
      <div className="space-y-2">
        {Array.from({ length: n }, (_, i) => (
          <SignerRow key={i} index={i} collected={collected} />
        ))}
        {n === 0 && !countQ.isLoading && (
          <p className="text-xs text-mute">No signers configured on-chain.</p>
        )}
      </div>
    </div>
  );
}