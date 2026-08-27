"use client";
import { useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
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
 * Unlike a bare `writeContractAsync`, `run()` does NOT report success on tx
 * *submission*: it pre-simulates the call (so reverts surface as clear errors
 * before you spend gas), then waits for the mined receipt and only returns
 * true when the tx actually succeeded. This is what prevents the false
 * "Triggered" success note when a burn reverted or no-op'd on-chain.
 *
 * ABIs must already be JSON-parsed objects (parseAbi) — viem 2.55+ rejects
 * human-readable strings on the write path (`'name' in item` throws).
 */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<string | null>(null); // last successful fn name
  const [lastHash, setLastHash] = useState<string | null>(null); // mined tx hash

  async function run(
    address: string,
    abi: Abi,
    functionName: string,
    args: readonly unknown[]
  ): Promise<boolean> {
    setError(null);
    setSucceeded(null);
    setLastHash(null);
    setPending(true);
    try {
      // Pre-flight: catch revert reasons (insufficient allowance/balance,
      // not verified, paused, etc.) before the user pays gas.
      if (pc) {
        try {
          await pc.simulateContract({
            address: address as `0x${string}`,
            abi,
            functionName,
            args,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        } catch (e) {
          setError(errText(e));
          return false;
        }
      }
      const hash = await writeContractAsync({
        address: address as `0x${string}`,
        abi,
        functionName,
        args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Success = mined + status success. A tx that lands but reverts (e.g.
      // a call to a non-contract address) must not count as "Triggered".
      if (pc) {
        const receipt = await pc.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 180_000,
        });
        if (receipt.status !== "success") {
          setError(
            "Transaction was mined but reverted on-chain — nothing changed. Check the explorer for the revert reason."
          );
          return false;
        }
      }
      setSucceeded(functionName);
      setLastHash(hash);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, succeeded, lastHash };
}