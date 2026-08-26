"use client";
import { useState } from "react";
import { shortAddr } from "@/lib/contracts";

/** Address/hash display: monospace, truncated, copy-to-clipboard (PRD §5.6). */
export function Addr({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value || /^0x0+$/.test(value)) return <span className="text-mute">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      onClick={copy}
      title={value}
      className={`font-mono text-[13px] tracking-tight hover:text-brand ${className ?? ""}`}
    >
      {copied ? "copied ✓" : shortAddr(value)}
    </button>
  );
}