"use client";
import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { registryAbi, config } from "@/lib/contracts";

export type Redemption = {
  id: number;
  asset: string;
  holder: string;
  amount: string; // raw wei string
  destination: string;
  triggerType: number;
  sourceEventHash: string;
  complianceHash: string;
  instructionHash: string;
  settlementRef: string;
  triggerBlock: number;
  requestedAt: number; // unix seconds (0 until finality confirmed)
  settledAt: number; // unix seconds (0 until settled)
  status: number; // registry Status enum
};

const REG = config.registry as `0x${string}`;

/** Decode a registry `getRedemption` struct tuple into typed client data. */
export function normalizeRedemption(d: unknown): Redemption | undefined {
  if (!Array.isArray(d) || d.length < 14) return undefined;
  try {
    return {
      id: Number(d[0]),
      asset: String(d[1]),
      holder: String(d[2]),
      amount: BigInt(d[3]).toString(),
      destination: String(d[4]),
      triggerType: Number(d[5]),
      sourceEventHash: String(d[6]),
      complianceHash: String(d[7]),
      instructionHash: String(d[8]),
      settlementRef: String(d[9]),
      triggerBlock: Number(d[10]),
      requestedAt: Number(d[11]),
      settledAt: Number(d[12]),
      status: Number(d[13]),
    };
  } catch {
    return undefined;
  }
}

async function readRedemption(pc: ReturnType<typeof usePublicClient>, id: bigint): Promise<Redemption | undefined> {
  if (!pc) return undefined;
  try {
    return normalizeRedemption(await pc.readContract({
      address: REG,
      abi: registryAbi,
      functionName: "getRedemption",
      args: [id],
    }));
  } catch {
    return undefined;
  }
}

/**
 * Live block height, polled every ~2s. Drives the finality countdown UI and
 * throttles full list refreshes to something chain-friendly.
 */
export function useLiveBlock(): number {
  const pc = usePublicClient();
  const [block, setBlock] = useState(0);
  useEffect(() => {
    if (!pc) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const n = await pc.getBlockNumber();
        if (!cancelled) setBlock(Number(n));
      } catch {
        /* transient RPC hiccup — keep last known */
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pc]);
  return block;
}

/** Read one redemption record by id (live-polling handled at query level). */
export function useRedemption(id: number | null): Redemption | undefined {
  const pc = usePublicClient();
  const block = useLiveBlock();
  const [r, setR] = useState<Redemption | undefined>(undefined);
  useEffect(() => {
    if (id == null || id < 1) {
      setR(undefined);
      return;
    }
    let cancelled = false;
    readRedemption(pc, BigInt(id)).then((v) => {
      if (!cancelled) setR(v);
    });
    return () => {
      cancelled = true;
    };
  }, [pc, id, block]);
  return r;
}

/**
 * All redemptions ("all") or just those belonging to the connected holder
 * ("holder"). Refreshes alongside the live block so statuses track reality.
 */
export function useRedemptions(scope: "all" | "holder" = "all"): {
  list: Redemption[];
  loading: boolean;
  block: number;
} {
  const { address } = useAccount();
  const pc = usePublicClient();
  const block = useLiveBlock();
  const [list, setList] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pc || block === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let ids: bigint[];
        if (scope === "holder" && address) {
          ids = (await pc.readContract({
            address: REG,
            abi: registryAbi,
            functionName: "holderRedemptions",
            args: [address],
          })) as bigint[];
        } else {
          const count = await pc.readContract({
            address: REG,
            abi: registryAbi,
            functionName: "redemptionCount",
          });
          ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
        }
        const items = await Promise.all(ids.map((id) => readRedemption(pc, id)));
        if (!cancelled) {
          setList(
            (items.filter(Boolean) as Redemption[]).sort((a, b) => b.id - a.id)
          );
        }
      } catch (e) {
        console.warn("useRedemptions:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pc, address, scope, block]);

  return { list, loading, block };
}