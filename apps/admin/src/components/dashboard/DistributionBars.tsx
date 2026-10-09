import { score } from "../../lib/formatMetrics";
import { BUCKET_LABELS, barHeightsPx, bucketsAriaLabel } from "../../lib/distribution";

const PLOT_PX = 96; // matches the h-24 plot height

/**
 * One pillar's score distribution as 5 hand-rolled Tailwind bars (SIM-16; no charting lib).
 * Ordinal forest ramp (low→high score = light→dark). Counts are printed as text (not hover-gated);
 * the whole chart carries ONE enumerated aria-label (the table-view twin for N=5), and the bars
 * are aria-hidden so AT reads the label once.
 */
export function DistributionBars({
  pillarKey,
  buckets,
  avg,
}: {
  pillarKey: string;
  buckets: number[];
  avg: number | null;
}) {
  const heights = barHeightsPx(buckets, PLOT_PX);
  const headingId = `pillar-${pillarKey}`;
  return (
    <figure className="flex flex-col gap-1" aria-labelledby={headingId}>
      <figcaption id={headingId} className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-forest">{pillarKey}</span>
        <span className="text-xs text-ink-soft">rata-rata {score(avg)}</span>
      </figcaption>
      <div role="img" aria-label={bucketsAriaLabel(pillarKey, buckets)}>
        <div className="flex h-24 items-end gap-[3px]">
          {buckets.map((c, i) => (
            <div key={i} aria-hidden="true" className="flex flex-1 flex-col justify-end gap-0.5">
              <span className="text-center text-[10px] leading-none text-ink-soft">
                {c > 0 ? c : ""}
              </span>
              <div
                className="w-full rounded-t"
                style={{ height: `${heights[i]}px`, backgroundColor: `var(--chart-bucket-${i + 1})` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px]" aria-hidden="true">
          {BUCKET_LABELS.map((l) => (
            <span key={l} className="flex-1 text-center text-[9px] text-ink-soft">
              {l}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
