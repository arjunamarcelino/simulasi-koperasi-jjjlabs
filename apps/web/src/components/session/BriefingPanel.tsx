import type { ScenarioConfig } from "../../types/scenario";
import { PixelPanel } from "../common/PixelPanel";
import { CloseButton } from "./CloseButton";

/** Inline "open the case file" action on the briefing step that names it. */
export type BriefingEvidenceAction = {
  stepIndex: number;
  /** Evidence button title (e.g. "Periksa Bukti"). */
  label: string;
  opened: boolean;
  onOpen: () => void;
};

/**
 * Scenario briefing (mission + steps), toggled by the Deskripsi rail button. With an
 * `evidenceAction`, the step naming the case file is highlighted until the file is
 * opened and carries a button that opens it.
 */
export function BriefingPanel({
  config,
  onClose,
  evidenceAction,
}: {
  config: ScenarioConfig;
  onClose: () => void;
  evidenceAction?: BriefingEvidenceAction | undefined;
}) {
  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-30 w-full max-w-sm">
      <PixelPanel className="relative text-left animate-[lineIn_140ms_ease-out]">
        <CloseButton onClick={onClose} label="Tutup deskripsi" />
        <div className="mb-2 flex items-center justify-between gap-2 pr-6">
          <h2 className="font-display text-[11px] text-forest">{config.title}</h2>
        </div>
        {config.mission && (
          <p className="mb-3 font-body text-lg leading-snug text-ink">{config.mission}</p>
        )}
        {config.steps && config.steps.length > 0 && (
          <ol className="space-y-1.5 font-body text-lg leading-snug text-ink-soft">
            {config.steps.map((step, i) => {
              const fileAction = evidenceAction?.stepIndex === i ? evidenceAction : null;
              const pending = !!fileAction && !fileAction.opened;
              return (
                <li
                  key={i}
                  className={`flex gap-2 ${
                    pending ? "-mx-2 border-l-4 border-mustard bg-mustard/15 px-2 py-1 text-ink" : ""
                  }`}
                >
                  <span className="font-display text-[9px] text-mustard">{i + 1}.</span>
                  <span className="flex-1">
                    {step}
                    {fileAction && (
                      <button
                        type="button"
                        onClick={fileAction.onOpen}
                        aria-label={`Buka ${fileAction.label}`}
                        className={`pixel-raise active:pixel-press mt-1.5 flex w-fit items-center px-2 py-1 font-display text-[8px] focus-visible:pixel-focus focus-visible:outline-none ${
                          fileAction.opened ? "bg-cream text-forest" : "bg-mustard text-ink"
                        }`}
                      >
                        {fileAction.opened ? "✓ Diperiksa" : "📁 Buka"}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </PixelPanel>
    </div>
  );
}
