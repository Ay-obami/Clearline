"use client";
import { useAccount, useReadContract } from "wagmi";
import { breakerAbi, config } from "@/lib/contracts";
import { useTx } from "@/lib/useTx";

const BREAKER = config.breaker as `0x${string}`;

/**
 * Multi-sig-gated manual override UI (FR7/FR8): board members vote approve or
 * reject on flagged redemptions; the contract enforces thresholds/roles, this
 * component just surfaces votes honestly.
 */
export function VoteBox({ id, compact = false }: { id: number; compact?: boolean }) {
  const { isConnected } = useAccount();
  const tx = useTx();
  const votesQ = useReadContract({
    address: BREAKER,
    abi: breakerAbi,
    functionName: "votesFor",
    args: [BigInt(id)],
  });
  const pausedQ = useReadContract({
    address: BREAKER,
    abi: breakerAbi,
    functionName: "paused",
  });

  const votesTuple = votesQ.data as unknown as [bigint, bigint] | undefined;
  const approves = Number(votesTuple?.[0] ?? 0);
  const rejects = Number(votesTuple?.[1] ?? 0);
  const paused = pausedQ.data === true;

  const vote = async (fn: "voteApprove" | "voteReject") => {
    await tx.run(BREAKER, breakerAbi, fn, [BigInt(id)]);
  };

  return (
    <div className={compact ? "" : "card p-4"}>
      <p className="text-xs font-medium text-flag">Manual review queue</p>
      <p className="mt-1 text-xs leading-relaxed text-body">
        A multi-sig board must vote to approve or reject (FR8). Votes:{" "}
        <span className="font-mono">{approves} approve · {rejects} reject</span>
        {paused && <span className="ml-1 font-medium text-flag">· breaker paused</span>}
      </p>
      {isConnected ? (
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-secondary py-1.5 text-xs" onClick={() => vote("voteReject")} disabled={tx.pending || paused}>
            Vote reject
          </button>
          <button className="btn-primary py-1.5 text-xs" onClick={() => vote("voteApprove")} disabled={tx.pending || paused}>
            Vote approve
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-mute">Connect a board member wallet to vote.</p>
      )}
      {tx.error && <p className="mt-2 text-xs text-flag">{tx.error}</p>}
      {tx.succeeded && <p className="mt-2 text-xs text-brand">Vote recorded.</p>}
    </div>
  );
}