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

/**
 * Decode a registry `getRedemption` struct tuple into typed client data.
 * viem returns named struct tuples as an OBJECT ({ id, asset, holder, ... })
 * and only bare tuples as arrays — accept both shapes so this works across
 * viem versions (2.55+ returns objects for named components).
 */
export function normalizeRedemption(d: unknown): Redemption | undefined {
  if (!d || typeof d !== "object") return undefined;
  const arr = Array.isArray(d) ? (d as unknown[]) : null;
  const obj = d as Record<string, unknown>;
  const at = (i: number, name: string): unknown =>
    arr != null ? arr[i] : obj[name];
  try {
    const id = at(0, "id");
    if (id === undefined || id === null) return undefined;
    return {
      id: Number(id),
      asset: String(at(1, "asset")),
      holder: String(at(2, "holder")),
      amount: BigInt(at(3, "amount") as bigint).toString(),
      destination: String(at(4, "destination")),
      triggerType: Number(at(5, "triggerType")),
      sourceEventHash: String(at(6, "sourceEventHash")),
      complianceHash: String(at(7, "complianceHash")),
      instructionHash: String(at(8, "instructionHash")),
      settlementRef: String(at(9, "settlementRef")),
      triggerBlock: Number(at(10, "triggerBlock")),
      requestedAt: Number(at(11, "requestedAt")),
      settledAt: Number(at(12, "settledAt")),
      status: Number(at(13, "status")),
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