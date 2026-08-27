"use client";
import { useReadContract } from "wagmi";
import { tokenAbi, config } from "@/lib/contracts";

/** Mock RWA token metadata used across the initiate/status views. */
export function useTokenMeta() {
  const token = config.token as `0x${string}`;
  const symbol = useReadContract({ address: token, abi: tokenAbi, functionName: "symbol", query: { retry: 3, retryDelay: 1000 } });
  const decimals = useReadContract({ address: token, abi: tokenAbi, functionName: "decimals", query: { retry: 3, retryDelay: 1000 } });
  if (symbol.error) console.warn("[useTokenMeta] symbol read failed:", symbol.error.shortMessage || symbol.error.message);
  if (decimals.error) console.warn("[useTokenMeta] decimals read failed:", decimals.error.shortMessage || decimals.error.message);
  return {
    token,
    symbol: (symbol.data as string | undefined) ?? "RWA",
    decimals: Number(decimals.data ?? 18),
  };
}