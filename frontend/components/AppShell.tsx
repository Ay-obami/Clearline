"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";
import { config } from "@/lib/contracts";

/**
 * Dashboard shell for the demo app (PRD §5.8). Decision recorded from §7 open
 * items: signer/system status lives INSIDE the app as a tab (`/app/system`)
 * rather than a separate `/status` route — it keeps the judging flow linear.
 *
 * The network pill is driven purely by NEXT_PUBLIC_ENVIRONMENT so one build
 * serves either deployment target; mainnet gets the amber caution treatment.
 */
const TABS = [
  { href: "/app", label: "Initiate" },
  { href: "/app/status", label: "Status" },
  { href: "/app/audit", label: "Audit trail" },
  { href: "/app/system", label: "System" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMainnet = config.environment === "mainnet";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-brand" aria-hidden />
              <span className="text-[15px] font-semibold tracking-tight text-ink">Clearline</span>
            </Link>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                isMainnet ? "bg-pending-tint text-pending ring-1 ring-pending/40" : "bg-finality-tint text-finality"
              }`}
            >
              {!config.ready ? "Unconfigured" : isMainnet ? "Mainnet" : "Testnet"}
            </span>
            <span className="hidden text-xs text-mute sm:inline font-mono">
              {!config.ready || isMainnet ? "" : "demo"}
            </span>
          </div>
          <ConnectButton />
        </nav>
        <nav className="mx-auto flex max-w-[1120px] gap-1 overflow-x-auto px-6 pb-0">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border-brand font-medium text-ink"
                    : "border-transparent text-mute hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-[1120px] px-6 py-10">{children}</main>
    </div>
  );
}