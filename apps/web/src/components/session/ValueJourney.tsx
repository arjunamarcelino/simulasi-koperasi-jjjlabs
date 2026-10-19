import type { AuditorResult } from "../../session/transport/contract";
import { describeValueTrend, resolveValueLabel, valueTone, type Tone } from "./resultLabels";

const TREND_TEXT: Record<Tone, string> = {
  good: "text-forest",
  bad: "text-orange",
  warn: "text-brown",
  neutral: "text-ink-soft",
};

/**
 * "Perjalanan Nilaimu" — the personal, number-free part of a scored result: the auditor's
 * comparison with the player's past sessions, each relevant ICA value with its trend and
 * the player's own behavior as evidence, and one suggestion the next session checks.
 * Renders nothing when there is nothing personal to say (tutorial, failed audit, older
 * worker), so ResultPanel needs no scenario flag.
 */
export function ValueJourney({
  values,
  progressFeedback,
  nextStep,
}: Pick<AuditorResult, "values" | "progressFeedback" | "nextStep">) {
  const entries = Object.entries(values);
  if (entries.length === 0 && !progressFeedback) return null;

  return (
    <section className="flex flex-col gap-3 text-left" data-testid="value-journey">
      <p className="font-display text-[9px] text-ink-soft">PERJALANAN NILAIMU</p>

      {progressFeedback && (
        <p className="whitespace-pre-wrap font-body text-xl leading-snug text-ink">
          {progressFeedback}
        </p>
      )}

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map(([key, v]) => (
            <li key={key} className="pixel-raise border-3 border-border bg-parchment px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-[8px] text-ink">{resolveValueLabel(key)}</span>
                <span className={`font-display text-[8px] ${TREND_TEXT[valueTone(v)]}`}>
                  {describeValueTrend(v)}
                </span>
              </div>
              {v.evidence && (
                <p className="pt-1 font-body text-lg leading-snug text-ink-soft">{v.evidence}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextStep && (
        <p className="font-body text-lg leading-snug text-ink">
          <span className="block font-display text-[8px] text-ink-soft">Coba di sesi berikutnya</span>
          {nextStep}
        </p>
      )}
    </section>
  );
}
