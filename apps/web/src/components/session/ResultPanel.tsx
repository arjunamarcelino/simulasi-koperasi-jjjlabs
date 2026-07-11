import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";
import type { SessionEnded } from "../../session/transport/contract";
import {
  resolveScoreLabel,
  resolveStateChip,
  scoreTone,
  type StateChip,
  type Tone,
} from "./resultLabels";

type Ending = SessionEnded["result"]["endingType"];

const TITLE: Record<Ending, string> = {
  good: "Selesai — Berhasil!",
  bad: "Sesi Berakhir",
  neutral: "Sesi Selesai",
};

const TITLE_COLOR: Record<Ending, string> = {
  good: "text-forest",
  bad: "text-orange",
  neutral: "text-brown",
};

const ACCENT: Record<Ending, string> = {
  good: "border-t-4 border-forest",
  bad: "border-t-4 border-orange",
  neutral: "border-t-4 border-mustard",
};

const CHIP_CLASS: Record<Tone, string> = {
  good: "bg-forest text-cream",
  bad: "bg-orange text-ink",
  warn: "bg-mustard text-ink",
  neutral: "bg-parchment text-ink",
};

const BAR_FILL: Record<Tone, string> = {
  good: "bg-forest",
  bad: "bg-orange",
  warn: "bg-mustard",
  neutral: "bg-parchment",
};

/**
 * Shown over the session when it ends. Data-driven: scored scenarios render
 * state chips + pillar scores; the tutorial (empty maps) collapses to
 * narrative-only — no `isTutorial` flag.
 */
export function ResultPanel({ ended, onBack }: { ended: SessionEnded; onBack: () => void }) {
  const { endingType, stateClassification, scores, narrativeFeedback } = ended.result;

  const chips: StateChip[] = Object.entries(stateClassification).map(([k, v]) =>
    resolveStateChip(k, v),
  );
  const pillars = Object.entries(scores).map(([k, v]) => ({
    label: resolveScoreLabel(k),
    value: v,
    tone: scoreTone(v),
  }));
  const scored = chips.length > 0 || pillars.length > 0;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <PixelPanel
        className={`flex max-h-full w-full flex-col gap-4 overflow-y-auto text-center ${
          scored ? "max-w-2xl" : "max-w-xl"
        } ${ACCENT[endingType]}`}
      >
        <h2 className={`font-display text-sm md:text-base ${TITLE_COLOR[endingType]}`}>
          {TITLE[endingType]}
        </h2>

        {scored && (
          <div className="flex flex-col gap-3 text-left">
            <p className="font-display text-[9px] text-ink-soft">PENILAIAN</p>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <div
                    key={chip.keyLabel}
                    className={`pixel-raise border-3 border-border px-3 py-2 ${CHIP_CLASS[chip.tone]} ${
                      chip.known ? "" : "border-dashed"
                    }`}
                  >
                    <span className="block font-display text-[8px] opacity-80">
                      {chip.keyLabel}
                    </span>
                    <span className="block font-display text-[10px]">{chip.valueLabel}</span>
                  </div>
                ))}
              </div>
            )}

            {pillars.length > 0 && (
              <div className="flex flex-col gap-2">
                {pillars.map((p) => (
                  <div key={p.label} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-[8px] text-ink-soft">{p.label}</span>
                      <span className="font-display text-[10px] text-ink">{p.value}</span>
                    </div>
                    <div className="h-4 border-3 border-border bg-parchment">
                      <div
                        className={`h-full ${BAR_FILL[p.tone]} transition-[width] duration-500 ease-out`}
                        style={{ width: `${Math.max(0, Math.min(100, p.value))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="whitespace-pre-wrap text-left font-body text-xl leading-snug text-ink">
          {narrativeFeedback}
        </p>

        <div className="flex justify-center pt-2">
          <GameButton variant="primary" onClick={onBack}>
            ◀ Kembali ke Kantor Koperasi
          </GameButton>
        </div>
      </PixelPanel>
    </div>
  );
}
