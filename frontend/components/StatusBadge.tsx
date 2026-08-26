import { statusColor, statusLabel } from "@/lib/contracts";

export function StatusBadge({ status }: { status: number }) {
  const c = statusColor(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${status <= 1 ? "pulse-soft" : ""}`} />
      {statusLabel(status)}
    </span>
  );
}