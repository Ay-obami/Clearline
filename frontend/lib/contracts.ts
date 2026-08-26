/**
 * Clearline shared client config + contract ABI (src/).
 * On Vercel only public values are needed — no secrets (PRD §9.5).
 */
export const config = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 133),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz",
  explorer: process.env.NEXT_PUBLIC_EXPLORER || "https://explorer-testnet.hsk.xyz/",

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
// Contract ABIs
// ------------------------------------------------------------------

export const registryAbi = [
  "function statusOf(uint256 id) external view returns (uint8)",
  "function getRedemption(uint256 id) external view returns (tuple(uint256 id,address asset,address holder,uint256 amount,address destination,uint8 triggerType,bytes32 sourceEventHash,bytes32 complianceHash,bytes32 instructionHash,bytes32 settlementRef,uint64 triggerBlock,uint64 requestedAt,uint64 settledAt,uint8 status))",
  "function holderRedemptions(address h) external view returns (uint256[])",
  "function assetRedemptions(address asset) external view returns (uint256[])",
  "function redemptionCount() external view returns (uint256)",
  "function finalityDepthFor(address asset) external view returns (uint256)",
  "function finalityDeadlineBlock(uint256 id) external view returns (uint256)",
  "function confirmFinality(uint256 id) external",
  "event RedemptionTriggered(uint256 indexed id,address indexed asset,address indexed holder,uint256 amount,address destination,uint8 triggerType,bytes32 sourceEventHash)",
  "event RedemptionRequested(uint256 indexed id,address indexed asset,address indexed holder,uint256 amount,address destination,uint8 triggerType)"
] as const;

export const tokenAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
] as const;

export const directBurnAbi = [
  "function redeem(uint256 amount, address destination) returns (uint256)"
] as const;

export const requestLockAbi = [
  "function requestRedemption(uint256 amount, address destination) returns (uint256)",
  "function finalizeRedemption(uint256 requestId) returns (uint256)",
  "function cancelRequest(uint256 requestId)",
  "function requests(uint256 requestId) view returns (address holder,uint256 amount,address destination,bool finalized,bool cancelled)",
  "function nextRequestId() view returns (uint256)"
] as const;

export const complianceAbi = [
  "function runCheck(uint256 redemptionId) external"
] as const;

export const signerAbi = [
  "function getInstruction(uint256 id) view returns (tuple(bytes32 assetId,address holder,uint256 amount,address destination,uint8 triggerType,bytes32 sourceEventHash,bytes32 complianceHash,uint256 nonce,uint256 deadline), bytes32 digest)",
  "function threshold() view returns (uint256)",
  "function signerCount() view returns (uint256)",
  "function signers(uint256 index) view returns (address)",
  "function signatureCount(uint256 id) view returns (uint256)",
  "function collectedSigners(uint256 id) view returns (address[])"
] as const;

export const breakerAbi = [
  "function voteApprove(uint256 id) external",
  "function voteReject(uint256 id) external",
  "function votesFor(uint256 id) view returns (uint256 approves, uint256 rejects)",
  "function paused() view returns (bool)",
  "function boardSize() view returns (uint256)"
] as const;

export const identityAbi = [
  "function isVerified(address) view returns (bool)"
] as const;

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