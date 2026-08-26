/** Formatting helpers for amounts and timestamps. */

export function fmtAmount(raw: string, decimals = 18, sigDigits = 6): string {
  try {
    const n = Number(BigInt(raw)) / 10 ** decimals;
    if (!Number.isFinite(n)) return raw;
    return n.toLocaleString("en-US", { maximumFractionDigits: sigDigits });
  } catch {
    return raw;
  }
}

export function fmtTimestamp(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}