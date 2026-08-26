"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseUnits } from "viem";
import { useReadContract } from "wagmi";
import {
  tokenAbi,
  directBurnAbi,
  requestLockAbi,
  config,
} from "@/lib/contracts";
import { useTokenMeta } from "@/lib/useToken";
import { useRedemptions } from "@/lib/useRedemptions";
import { useTx } from "@/lib/useTx";

const TOKEN = config.token as `0x${string}`;
const DIRECT_BURN = config.directBurn as `0x${string}`;
const REQUEST_LOCK = config.requestLock as `0x${string}`;

function useClientOnly(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function WalletPrompt() {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-medium text-ink">Connect a wallet to begin</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-mute">
        The demo wallet holds a mock RWA token. Trigger a redemption and watch it move through
        finality, compliance re-check, multi-sig instruction signing, and settlement recording.
      </p>
    </div>
  );
}

function AmountDestFields({
  amount,
  setAmount,
  destination,
  setDestination,
  symbol,
}: {
  amount: string;
  setAmount: (v: string) => void;
  destination: string;
  setDestination: (v: string) => void;
  symbol: string;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div>
        <label className="mb-1 block text-xs text-mute" htmlFor={`amt-${symbol}`}>
          Amount ({symbol})
        </label>
        <input
          id={`amt-${symbol}`}
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="h-9 w-full rounded-[8px] border border-line bg-card px-3 font-mono text-sm text-ink outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-mute" htmlFor={`dest-${symbol}`}>
          Payout destination (compliance-checked at redemption time)
        </label>
        <input
          id={`dest-${symbol}`}
          spellCheck={false}
          placeholder="0x…"
          value={destination}
          onChange={(e) => setDestination(e.target.value.trim())}
          className="h-9 w-full rounded-[8px] border border-line bg-card px-3 font-mono text-xs text-ink outline-none focus:border-brand"
        />
      </div>
    </div>
  );
}

function BalanceCard({ balanceRaw }: { balanceRaw?: bigint }) {
  const { symbol } = useTokenMeta();
  return (
    <div className="card flex items-baseline justify-between p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-mute">Mock RWA token balance</p>
        <p className="mt-1 font-mono text-lg font-semibold text-ink">
          {balanceRaw === undefined ? "—" : (Number(balanceRaw) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
          <span className="text-sm font-normal text-body">{symbol}</span>
        </p>
      </div>
      <p className="font-mono text-[11px] text-mute">{config.explorer}token/{TOKEN}</p>
    </div>
  );
}

function DirectBurnCard() {
  const { symbol, decimals } = useTokenMeta();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [doneId, setDoneId] = useState<number | null>(null);

  const countQ = useReadContract({
    address: config.registry as `0x${string}`,
    abi: [
      { name: "redemptionCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    ],
    functionName: "redemptionCount",
    query: { enabled: doneId === null },
  });

  const valid = amount !== "" && Number(amount) > 0 && destination.startsWith("0x") && destination.length === 42;
  const submit = async () => {
    if (!valid) return;
    const ok = await tx.run(
      DIRECT_BURN,
      directBurnAbi,
      "redeem",
      [parseUnits(amount as `${number}`, decimals), destination]
    );
    if (ok) {
      const c = Number(countQ.data ?? 0);
      setDoneId(c + 1); // this burn becomes the next redemption id
      setAmount("");
      setDestination("");
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Redeem now — direct burn</h3>
        <StatusPill text="on-demand" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-body">
        Burns your tokens immediately and starts the pipeline at once. Suited to assets priced
        on demand (e.g. tokenized treasuries). The burn cannot be undone once submitted.
      </p>
      {doneId != null ? (
        <div className="mt-4">
          <SuccessNote id={doneId} />
        </div>
      ) : (
        <>
          <AmountDestFields amount={amount} setAmount={setAmount} destination={destination} setDestination={setDestination} symbol={symbol} />
          <button className="btn-primary mt-4 w-full py-2 text-[13px]" onClick={() => void submit()} disabled={!valid || tx.pending}>
            {tx.pending ? "Submitting…" : "Burn & trigger redemption"}
          </button>
        </>
      )}
      {tx.error && <p className="mt-3 text-xs text-flag">{tx.error}</p>}
    </div>
  );
}

function StatusPill({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-mute ring-1 ring-line">
      {text}
    </span>
  );
}

function SuccessNote({ id }: { id: number }) {
  return (
    <div className="rounded-[8px] border border-brand/30 bg-brand-tint px-4 py-3">
      <p className="text-xs font-medium text-brand">Triggered — redemption #{id}</p>
      <Link href={`/app/status?id=${id}`} className="mt-1 inline-block text-xs text-brand underline-offset-2 hover:underline">
        Track it through the pipeline →
      </Link>
    </div>
  );
}

function RequestLockCard() {
  const { address } = useAccount();
  const { symbol, decimals } = useTokenMeta();
  const txApprove = useTx();
  const txLock = useTx();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [doneId, setDoneId] = useState<number | null>(null);

  const parsed = (() => {
    try {
      return amount !== "" && Number(amount) > 0 ? parseUnits(amount as `${number}`, decimals) : undefined;
    } catch {
      return undefined;
    }
  })();

  const allowanceQ = useReadContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "allowance",
    args: [(address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`, REQUEST_LOCK],
    query: { enabled: !!address && parsed !== undefined },
  });
  const countQ = useReadContract({
    address: config.registry as `0x${string}`,
    abi: [
      { name: "redemptionCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    ],
    functionName: "redemptionCount",
  });

  const valid = parsed !== undefined && destination.startsWith("0x") && destination.length === 42;
  const needsAllowance =
    valid && (allowanceQ.data === undefined || BigInt(allowanceQ.data as bigint) < parsed!);

  function rememberRequest(addr: string, id: number) {
    const key = `clearline:req:${addr.toLowerCase()}`;
    let arr: number[] = [];
    try {
      arr = JSON.parse(window.localStorage.getItem(key) ?? "[]") as number[];
    } catch { /* ignore */ }
    if (!arr.includes(id)) arr.push(id);
    window.localStorage.setItem(key, JSON.stringify(arr.slice(-10)));
  }

  async function lock() {
    if (!valid || needsAllowance || !address) return;
    const ok = await txLock.run(REQUEST_LOCK, requestLockAbi, "requestRedemption", [parsed!, destination]);
    if (ok) {
      const id = Number(countQ.data ?? 0) + 1;
      rememberRequest(address, id);
      setDoneId(id);
      setAmount("");
      setDestination("");
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Request redemption — lock</h3>
        <StatusPill text="two-step" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-body">
        Locks your tokens (non-transferable while locked, cancellable until finalization) and
        records the request. The actual burn happens later at{" "}
        <span className="font-mono text-[11px]">finalizeRedemption()</span> once pricing or
        custodian confirmation lands — the NAV-priced funds pattern.
      </p>
      {doneId != null ? (
        <div className="mt-4"><SuccessNote id={doneId} /></div>
      ) : (
        <>
          <AmountDestFields amount={amount} setAmount={setAmount} destination={destination} setDestination={setDestination} symbol={symbol} />
          {needsAllowance ? (
            <button
              className="btn-secondary mt-4 w-full py-2 text-[13px]"
              disabled={!valid || txApprove.pending}
              onClick={() => void txApprove.run(TOKEN, tokenAbi, "approve", [REQUEST_LOCK, parsed!])}
            >
              {txApprove.pending ? "Approving…" : `Step 1 — approve ${symbol} spend`}
            </button>
          ) : (
            <button className="btn-primary mt-4 w-full py-2 text-[13px]" onClick={() => void lock()} disabled={!valid || txLock.pending}>
              {needsAllowance ? "Waiting for approval…" : txLock.pending ? "Submitting…" : "Step 2 — lock & submit request"}
            </button>
          )}
        </>
      )}
      {(txApprove.error || txLock.error) && (
        <p className="mt-3 text-xs text-flag">{txApprove.error ?? txLock.error}</p>
      )}
    </div>
  );
}

function RequestRow({ id }: { id: number }) {
  const txCancel = useTx();
  const q = useReadContract({
    address: REQUEST_LOCK,
    abi: requestLockAbi,
    functionName: "requests",
    args: [BigInt(id)],
  });
  const d = q.data as unknown[] | undefined;
  const cancelled = d?.[4] === true;
  const finalized = d?.[3] === true;
  const state = finalized ? "finalized" : cancelled ? "cancelled" : "locked";
  return (
    <li className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2">
      <span className="font-mono text-xs text-ink">request #{id}</span>
      <span className={`text-xs ${finalized ? "text-brand" : cancelled ? "text-flag" : "text-pending"}`}>
        {state}
      </span>
      {!finalized && !cancelled && (
        <button
          className="btn-secondary px-2 py-1 text-[11px]"
          disabled={txCancel.pending}
          onClick={() => void txCancel.run(REQUEST_LOCK, requestLockAbi, "cancelRequest", [BigInt(id)])}
        >
          cancel
        </button>
      )}
    </li>
  );
}

function MyRequests({ account }: { account: string }) {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    let arr: number[] = [];
    try {
      arr = JSON.parse(window.localStorage.getItem(`clearline:req:${account.toLowerCase()}`) ?? "[]") as number[];
    } catch { /* ignore */ }
    setIds(arr);
  }, [account]);
  if (ids.length === 0) return null;
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink">Your recent requests</h3>
      <p className="mt-1 text-xs leading-relaxed text-mute">
        Locked requests await off-chain pricing/confirmation; the service then calls finalize
        and the shared pipeline takes over. Cancellation is possible until then.
      </p>
      <ul className="mt-3 space-y-2">
        {ids.map((id) => <RequestRow key={id} id={id} />)}
      </ul>
    </div>
  );
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export default function InitiatePage() {
  const mounted = useClientOnly();
  const { address, isConnected } = useAccount();

  // All hooks run unconditionally — gating happens at render time only.
  const balanceQ = useReadContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [(address ?? ZERO_ADDR) as `0x${string}`],
    query: { enabled: !!address },
  });

  if (!mounted) return null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Initiate a redemption</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-body">
          Two entry points into the same pipeline. What follows the trigger — finality wait,
          compliance re-check, multi-sig instruction signing, settlement recording — is
          identical by design.
        </p>
      </header>

      {!isConnected ? (
        <WalletPrompt />
      ) : (
        <>
          <BalanceCard balanceRaw={balanceQ.data as bigint | undefined} />
          <div className="grid gap-5 md:grid-cols-2">
            <DirectBurnCard />
            <RequestLockCard />
          </div>
          {address && <MyRequests account={address} />}
        </>
      )}
    </div>
  );
}


