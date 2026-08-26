import { AuditTable } from "@/components/AuditTable";

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-body">
          Every redemption ever triggered, with its immutable on-chain record: trigger event →
          finality confirmation → compliance re-check → collected signatures → settlement.
          Filterable by trigger type and status; each row links to the full lifecycle (FR9).
        </p>
      </header>
      <AuditTable />
    </div>
  );
}