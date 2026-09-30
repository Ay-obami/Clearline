"use client";
import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { config, signerVersionAbi } from "./contracts";
import { requireDeploymentReady } from "./deployment";
import { decodeErrorResult, type Abi } from "viem";

/** Walk the viem/wagmi error cause chain for the raw revert bytes. */
function deepRevertData(e: unknown): string | undefined {
  let cur = e as (Record<string, unknown> & { cause?: unknown }) | null;
  const seen = new Set<object>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    for (const k of ["raw", "data"]) {
      const v = cur[k];
      if (typeof v === "string" && v.startsWith("0x") && v.length > 10) return v;
    }
    cur = cur.cause as typeof cur | null;
  }
  return undefined;
}

/** Format a wei bigint as a decimal token amount (e.g. 9 → "9"). */
function fmtWei(v: unknown, decimals = 18): string {
  try {
    const n = typeof v === "bigint" ? v : BigInt(String(v ?? 0));
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const s = abs.toString().padStart(decimals + 1, "0");
    const whole = s.slice(0, -decimals) || "0";
    const frac = s.slice(-decimals).replace(/0+$/, "");
    return `${neg ? "-" : ""}${Number(whole).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
  } catch {
    return String(v);
  }
}

/**
 * Decode a viem/wagmi error into an actionable message, e.g.
 * "Insufficient allowance — approve 29 first (current allowance 9)".
 * Returns undefined when the error can't be decoded against `abi`.
 */
export function revertReason(e: unknown, abi: Abi, decimals = 18): string | undefined {
  const data = deepRevertData(e);
  if (!data) return undefined;
  try {
    const d = decodeErrorResult({ abi, data: data as `0x${string}` });
    const args = (d.args ?? []) as unknown[];
    if (d.errorName === "InsufficientAllowance" && args.length >= 2) {
      return `Insufficient allowance — approve ${fmtWei(args[1], decimals)} first (current allowance ${fmtWei(args[0], decimals)})`;
    }
    if (d.errorName === "InsufficientBalance" && args.length >= 2) {
      return `Insufficient balance — have ${fmtWei(args[0], decimals)}, need ${fmtWei(args[1], decimals)}`;
    }
    const pretty = args
      .map((a) => (typeof a === "bigint" ? a.toString() : String(a)))
      .join(", ");
    return pretty ? `${d.errorName}(${pretty})` : d.errorName;
  } catch {
    return undefined;
  }
}

/** Pull the best human-readable line out of viem/wagmi error objects. */
export function errText(e: unknown, abi?: Abi, decimals = 18): string {
  if (abi) {
    const r = revertReason(e, abi, decimals);
    if (r) return r;
  }
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
 * CRITICAL: the pre-simulation must run AS THE CONNECTED ACCOUNT — an eth_call
 * without `from` executes as 0x0…0, so every allowance/balance gate reverts
 * even when the real sender would succeed.
 *
 * ABIs must already be JSON-parsed objects (parseAbi) — viem 2.55+ rejects
 * human-readable strings on the write path (`'name' in item` throws).
 */
export function useTx() {
  const { address: account, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<string | null>(null); // last successful fn name
  const [lastHash, setLastHash] = useState<string | null>(null); // mined tx hash

  async function run(
    address: string | undefined,
    abi: Abi,
    functionName: string,
    args: readonly unknown[]
  ): Promise<boolean> {
    setError(null);
    setSucceeded(null);
    setLastHash(null);
    setPending(true);
    try {
      if (!pc || !account) throw new Error("Connect a wallet before transacting");
      requireDeploymentReady(config, "2", chainId);
      const version = await pc.readContract({ address: config.signer!, abi: signerVersionAbi, functionName: "VERSION" });
      requireDeploymentReady(config, version, chainId);
      const targets = [config.token, config.registry, config.identity, config.directBurn, config.requestLock, config.compliance, config.signer, config.breaker, config.settlement];
      if (!address || !targets.some(target => target === address)) throw new Error("Transaction target is not configured");
      // Pre-flight: catch revert reasons (insufficient allowance/balance,
      // not verified, paused, etc.) before the user pays gas.
      if (pc && account) {
        try {
          await pc.simulateContract({
            address: address as `0x${string}`,
            abi,
            functionName,
            args,
            account,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        } catch (e) {
          setError(errText(e, abi));
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
      setError(errText(e, abi));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, succeeded, lastHash };
}