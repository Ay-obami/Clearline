/**
 * Clearline shared client config + contract ABI (src/).
 * On Vercel only public values are needed — no secrets (PRD §9.5).
 *
 * NOTE: ABIs here are canonical JSON objects (not human-readable strings).
 * viem 2.55+ runs `'name' in item` in getAbiItem(), which throws on string
 * ABIs and breaks writes via useWriteContract.
 */
import type { Abi } from "viem";

export const config = {
  // Network identity comes entirely from env so the SAME build serves
  // testnet (Vercel project A) or mainnet (project B) — never hardcode here.
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 133),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz",
  explorer: process.env.NEXT_PUBLIC_EXPLORER || "https://testnet-explorer.hskchain.net/",
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "HSK Chain Testnet",
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT || "testnet", // "testnet" | "mainnet"

  // Addresses are surfaced after deployment; the values below are foundry
  // anvil-derived placeholders so the UI runs from a clean checkout.
  token: process.env.NEXT_PUBLIC_TOKEN || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  registry: process.env.NEXT_PUBLIC_REGISTRY || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  identity: process.env.NEXT_PUBLIC_IDENTITY || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  directBurn: process.env.NEXT_PUBLIC_DIRECT_BURN || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  requestLock: process.env.NEXT_PUBLIC_REQUEST_LOCK || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  compliance: process.env.NEXT_PUBLIC_COMPLIANCE || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  signer: process.env.NEXT_PUBLIC_SIGNER || "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
  breaker: process.env.NEXT_PUBLIC_BREAKER || "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
  settlement: process.env.NEXT_PUBLIC_SETTLEMENT || "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0",
} as const;

// ------------------------------------------------------------------
// Contract ABIs — JSON-parsed objects so both reads and writes work.
// ------------------------------------------------------------------

export const registryAbi = [
  {
    type: "function",
    name: "statusOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "getRedemption",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "asset", type: "address" },
          { name: "holder", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destination", type: "address" },
          { name: "triggerType", type: "uint8" },
          { name: "sourceEventHash", type: "bytes32" },
          { name: "complianceHash", type: "bytes32" },
          { name: "instructionHash", type: "bytes32" },
          { name: "settlementRef", type: "bytes32" },
          { name: "triggerBlock", type: "uint64" },
          { name: "requestedAt", type: "uint64" },
          { name: "settledAt", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "holderRedemptions",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "assetRedemptions",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  { type: "function", name: "redemptionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "finalityDepthFor", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "finalityDeadlineBlock", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "confirmFinality", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  {
    type: "event",
    name: "RedemptionTriggered",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "amount", type: "uint256" },
      { name: "destination", type: "address" },
      { name: "triggerType", type: "uint8" },
      { name: "sourceEventHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "RedemptionRequested",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "amount", type: "uint256" },
      { name: "destination", type: "address" },
      { name: "triggerType", type: "uint8" },
    ],
  },
] as const satisfies Abi;

export const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const satisfies Abi;

export const directBurnAbi = [
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "destination", type: "address" }], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

export const requestLockAbi = [
  { type: "function", name: "requestRedemption", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "destination", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "finalizeRedemption", stateMutability: "nonpayable", inputs: [{ name: "requestId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cancelRequest", stateMutability: "nonpayable", inputs: [{ name: "requestId", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "holder", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destination", type: "address" },
          { name: "finalized", type: "bool" },
          { name: "cancelled", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "nextRequestId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

export const complianceAbi = [
  { type: "function", name: "runCheck", stateMutability: "nonpayable", inputs: [{ name: "redemptionId", type: "uint256" }], outputs: [] },
] as const satisfies Abi;

export const signerAbi = [
  {
    type: "function",
    name: "getInstruction",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "assetId", type: "bytes32" },
          { name: "holder", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destination", type: "address" },
          { name: "triggerType", type: "uint8" },
          { name: "sourceEventHash", type: "bytes32" },
          { name: "complianceHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "digest", type: "bytes32" },
    ],
  },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signers", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "signatureCount", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collectedSigners", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address[]" }] },
] as const satisfies Abi;

export const breakerAbi = [
  { type: "function", name: "voteApprove", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "voteReject", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "votesFor", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "boardSize", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

export const identityAbi = [
  { type: "function", name: "isVerified", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export const Status: Record<number, string> = {
  0: "None",
  1: "Awaiting finality",
  2: "Requested",
  3: "Approved",
  4: "Flagged",
  5: "Manual review",
  6: "Signed",
  7: "Settled",
  8: "Rejected",
  9: "Cancelled",
};

export const TriggerType: Record<number, string> = {
  0: "Direct burn",
  1: "Request & lock",
  2: "Scheduled",
  3: "Issuer-initiated",
  4: "Threshold",
};

export function shortAddr(a: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function truncHash(h: string | null | undefined, n = 12): string {
  if (!h || /^0x0+$/.test(h)) return "—";
  return `${h.slice(0, n)}…`;
}

/** Status colors per PRD §5.2 — the four-state visual language. */
export function statusColor(status: number): { text: string; bg: string; dot: string } {
  switch (status) {
    case 1:
    case 2:
      return { text: "text-finality", bg: "bg-finality-tint", dot: "bg-finality" };
    case 3:
    case 6:
      return { text: "text-pending", bg: "bg-pending-tint", dot: "bg-pending" };
    case 4:
    case 5:
      return { text: "text-flag", bg: "bg-flag-tint", dot: "bg-flag" };
    case 7:
      return { text: "text-brand", bg: "bg-brand-tint", dot: "bg-brand" };
    default:
      return { text: "text-mute", bg: "bg-bg", dot: "bg-mute" };
  }
}

export function statusLabel(s: number): string {
  return Status[s] ?? `Status ${s}`;
}

export const ZERO = "0x0000000000000000000000000000000000000000";