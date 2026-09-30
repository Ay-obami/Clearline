/**
 * Clearline shared client config + contract ABI (src/).
 * On Vercel only public values are needed — no secrets (PRD §9.5).
 *
 * NOTE: ABIs here are canonical JSON objects (not human-readable strings).
 * viem 2.55+ runs `'name' in item` in getAbiItem(), which throws on string
 * ABIs and breaks writes via useWriteContract.
 */
import type { Abi } from "viem";

import { deploymentConfig } from "./deployment";

export const config = {
  ...deploymentConfig({
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
    token: process.env.NEXT_PUBLIC_TOKEN,
    registry: process.env.NEXT_PUBLIC_REGISTRY,
    identity: process.env.NEXT_PUBLIC_IDENTITY,
    directBurn: process.env.NEXT_PUBLIC_DIRECT_BURN_ADAPTER || process.env.NEXT_PUBLIC_DIRECT_BURN,
    requestLock: process.env.NEXT_PUBLIC_REQUEST_LOCK_ADAPTER || process.env.NEXT_PUBLIC_REQUEST_LOCK,
    compliance: process.env.NEXT_PUBLIC_COMPLIANCE,
    signer: process.env.NEXT_PUBLIC_SIGNER,
    breaker: process.env.NEXT_PUBLIC_BREAKER,
    settlement: process.env.NEXT_PUBLIC_SETTLEMENT,
  }),
  explorer: process.env.NEXT_PUBLIC_EXPLORER?.trim() || "",
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME?.trim() || "Unconfigured network",
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT?.trim() || "unconfigured",
} as const;

export const signerVersionAbi = [
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const satisfies Abi;

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
  // RedemptionRegistry / IRedemptionTypes custom errors.
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "NotAuthorized", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "InvalidStatus", inputs: [{ name: "current", type: "uint8" }] },
  { type: "error", name: "UnknownRedemption", inputs: [{ name: "redemptionId", type: "uint256" }] },
  { type: "error", name: "DuplicateSourceEvent", inputs: [{ name: "sourceEventHash", type: "bytes32" }] },
  { type: "error", name: "AssetNotRegistered", inputs: [{ name: "asset", type: "address" }] },
  { type: "error", name: "FinalityNotReached", inputs: [{ name: "redemptionId", type: "uint256" }, { name: "currentBlock", type: "uint256" }, { name: "requiredBlock", type: "uint256" }] },
] as const satisfies Abi;

export const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  // MockRWAToken custom errors — lets decodeErrorResult name a revert.
  { type: "error", name: "NotAuthorized", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [{ name: "available", type: "uint256" }, { name: "required", type: "uint256" }] },
  { type: "error", name: "TransferNotAllowed", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }] },
  { type: "error", name: "AmountExceedsAllowance", inputs: [] },
] as const satisfies Abi;

export const directBurnAbi = [
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "destination", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "InsufficientAllowance", inputs: [{ name: "allowance_", type: "uint256" }, { name: "amount", type: "uint256" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
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
  { type: "error", name: "NotRequestHolder", inputs: [] },
  { type: "error", name: "RequestNotOpen", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
] as const satisfies Abi;

export const complianceAbi = [
  { type: "function", name: "runCheck", stateMutability: "nonpayable", inputs: [{ name: "redemptionId", type: "uint256" }], outputs: [] },
  { type: "error", name: "NotAuthorized", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "IdentityNotConfigured", inputs: [] },
  { type: "error", name: "InvalidStatus", inputs: [{ name: "current", type: "uint8" }] },
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
          { name: "signerEpoch", type: "uint256" },
        ],
      },
      { name: "digest", type: "bytes32" },
    ],
  },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signers", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "signedEpochOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
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

export function shortAddr(a: string | undefined): string {
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