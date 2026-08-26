"use client";
import { useReadContract } from "wagmi";
import { tokenAbi, config } from "@/lib/contracts";

/** Mock RWA token metadata used across the initiate/status views. */
export function useTokenMeta() {
  const token = config.token as `0x${string}`;
  const symbol = useReadContract({ address: token, abi: tokenAbi, functionName: "symbol" });
  const decimals = useReadContract({ address: token, abi: tokenAbi, functionName: "decimals" });
  return {
    token,
    symbol: (symbol.data as string | undefined) ?? "RWA",
    decimals: Number(decimals.data ?? 18),
  };
}