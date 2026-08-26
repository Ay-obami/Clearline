"use client";
import { useReadContract } from "wagmi";
import { registryAbi, config } from "@/lib/contracts";

const REG = config.registry as `0x${string}`;

/**
 * Finality progress (PRD §5.5): block confirmations counting up toward the
 * configured depth — the one place a visible waiting animation is honest.
 */
export function FinalityBar({
  id,
  triggerBlock,
  block,
}: {
  id: number;
  triggerBlock: number;
  block: number;
}) {
  const deadlineQ = useReadContract({
    address: REG,
    abi: registryAbi,
    functionName: "finalityDeadlineBlock",
    args: [BigInt(id)],
  });

  if (deadlineQ.isLoading) return null;

  let confirmed = Math.max(0, block - triggerBlock);
  const depth = Number(deadlineQ.data ?? 0);
  if (!depth) return null;
  confirmed = Math.min(confirmed, depth);
  const pct = Math.min(100, Math.round((confirmed / depth) * 100));
  const ready = confirmed >= depth;

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-mute">Block confirmations</span>
        <span className={`font-mono ${ready ? "text-brand" : "text-finality"}`}>
          {confirmed} / {depth}
          {ready ? " — final" : ""}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-finality-tint">
        <div
          className={`h-full rounded-full transition-all duration-500 ${ready ? "bg-brand" : "bg-finality pulse-soft"}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {!ready && (
        <p className="mt-1 text-[11px] text-mute">
          Waiting out finality depth (FR5) — no downstream action is possible yet, by design.
        </p>
      )}
    </div>
  );
}