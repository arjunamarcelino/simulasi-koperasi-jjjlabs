/** A single headline KPI card (SIM-15). Presentational only. */
export function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-brown p-4">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-2xl font-bold text-forest">{value}</span>
      {sub && <span className="text-xs text-ink-soft">{sub}</span>}
    </div>
  );
}
