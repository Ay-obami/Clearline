"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Redemption } from "@/lib/useRedemptions";
import { useRedemptions } from "@/lib/useRedemptions";
import { StatusBadge } from "@/components/StatusBadge";
import { PipelineDetail } from "@/components/PipelineDetail";

function pickDefault(list: Redemption[]): number | null {
  if (list.length === 0) return null;
  const active = list.find((r) => r.status >= 1 && r.status <= 6);
  return (active ?? list[0]).id;
}

function StatusView() {
  const params = useSearchParams();
  const fromUrl = Number(params.get("id") || 0) || null;
  const { list, loading } = useRedemptions("all");

  const selectedId = fromUrl ?? pickDefault(list);

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
      {/* Redemption picker */}
      <aside className="order-2 lg:order-1">
        <h2 className="text-sm font-medium text-ink">Redemptions</h2>
        {loading ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[52px] animate-pulse rounded-[8px] border border-line bg-card" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="mt-3 rounded-[8px] border border-dashed border-line px-3 py-4 text-xs leading-relaxed text-mute">
            No redemptions yet. Initiate one from the{" "}
            <a href="/app" className="text-brand underline-offset-2 hover:underline">Initiate</a> tab.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {list.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <a
                    href={`/app/status?id=${r.id}`}
                    className={`block rounded-[8px] border px-3 py-2.5 transition-colors ${
                      active ? "border-brand bg-brand-tint/40" : "border-line bg-card hover:bg-bg"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-ink">#{r.id}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <span className="mt-1 block text-[11px] text-mute">
                      trigger block {r.triggerBlock}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Selected redemption pipeline */}
      <section className="order-1 lg:order-2">
        {selectedId != null ? (
          <PipelineDetail id={selectedId} />
        ) : (
          !loading && (
            <div className="card p-10 text-center">
              <p className="text-sm text-body">Nothing to track yet.</p>
              <p className="mt-1 text-xs text-mute">Trigger a redemption to watch the pipeline live.</p>
            </div>
          )
        )}
      </section>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[10px] border border-line bg-card" />}>
      <StatusView />
    </Suspense>
  );
}