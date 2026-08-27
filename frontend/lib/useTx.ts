"use client";
import { useState } from "react";
import { useWriteContract } from "wagmi";
import type { Abi } from "viem";

/** Pull the first human-readable line out of viem/wagmi error objects. */
export function errText(e: unknown): string {
  const m = e as { shortMessage?: string; reason?: string; message?: string };
  return (
    (m?.shortMessage || m?.reason || m?.message || "Transaction failed")
      .replace(/^Error:\s*/, "")
      .split("\n")[0]
      .slice(0, 180) || "Transaction failed"
  );
}

/**
 * Small wrapper around wagmi's writeContractAsync for one-off keeper/user txs.
 * Tracks pending + error so buttons can show honest inline feedback.
 *
 * ABIs must already be JSON-parsed objects (parseAbi) — viem 2.55+ rejects
 * human-readable strings on the write path (`'name' in item` throws).
 */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<string | null>(null); // last successful fn name

  async function run(
    address: string,
    abi: Abi,
    functionName: string,
    args: readonly unknown[]
  ): Promise<boolean> {
    setError(null);
    setSucceeded(null);
    setPending(true);
    try {
      await writeContractAsync({
        address: address as `0x${string}`,
        abi,
        functionName,
        args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      setSucceeded(functionName);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, succeeded };
}