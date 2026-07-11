import { memo, type ReactNode } from "react";
import type { PhaseState } from "../../session/transport/contract";

/**
 * Vertical rail of icon-only action buttons on the right. Each expands on hover
 * AND keyboard focus to reveal its label (into pre-reserved space, so no layout
 * shift). Always-on: Petunjuk, Deskripsi, Akhiri. Maju-Fase appears only when the
 * scenario emits phases (RAT) — the tutorial never shows it. (Mic lives in the
 * dialogue box.) The evidence button ("Periksa Bukti" / "Periksa Dokumen") shows
 * only when the scenario declares evidence content.
 */
type Props = {
  ready: boolean;
  endLabel: string;
  hintLoading: boolean;
  phase: PhaseState | null;
  /** When false, the end button is locked (goal not yet reached). */
  canEnd: boolean;
  /** Drift at Level 1 — sustain attention on the end button (PRD §6). */
  nudgeEnd?: boolean;
  /** When true, the scenario exposes an evidence panel. */
  hasEvidence?: boolean;
  /** Label for the evidence rail button (defaults to "Periksa Bukti"). */
  evidenceLabel?: string;
  onHint: () => void;
  onToggleBriefing: () => void;
  onCheckEvidence?: () => void;
  onAdvancePhase: () => void;
  onEnd: () => void;
};

export const ActionRail = memo(function ActionRail({
  ready,
  endLabel,
  hintLoading,
  phase,
  canEnd,
  nudgeEnd = false,
  hasEvidence = false,
  evidenceLabel = "Periksa Bukti",
  onHint,
  onToggleBriefing,
  onCheckEvidence,
  onAdvancePhase,
  onEnd,
}: Props) {
  return (
    <div className="pointer-events-auto absolute right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
      <RailButton label="Deskripsi" tone="bg-cream text-forest" onClick={onToggleBriefing}>
        <BriefingIcon />
      </RailButton>
      <RailButton
        label={hintLoading ? "Memuat…" : "Petunjuk"}
        tone="bg-cream text-forest"
        onClick={onHint}
        disabled={!ready || hintLoading}
      >
        <HintIcon />
      </RailButton>
      {hasEvidence && (
        <RailButton
          label={evidenceLabel}
          tone="bg-cream text-forest"
          onClick={() => onCheckEvidence?.()}
          disabled={!ready}
        >
          <EvidenceIcon />
        </RailButton>
      )}
      {phase && (
        <RailButton
          label={phase.advanceActionLabel ?? "Maju Fase"}
          tone="bg-forest text-cream"
          onClick={onAdvancePhase}
          disabled={!ready || phase.advanceActionLabel === null}
        >
          <ArrowIcon />
        </RailButton>
      )}
      <RailButton
        label={canEnd ? endLabel : `${endLabel} (selesaikan tujuan dulu)`}
        tone="bg-mustard text-ink"
        onClick={onEnd}
        disabled={!ready || !canEnd}
        // Draw the eye the moment it unlocks.
        highlight={canEnd}
        // Sustained ring while tension is at Level 1.
        pulse={nudgeEnd}
      >
        {canEnd ? <EndIcon /> : <LockIcon />}
      </RailButton>
    </div>
  );
});

function RailButton({
  label,
  tone,
  onClick,
  disabled = false,
  highlight = false,
  pulse = false,
  children,
}: {
  label: string;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
  /** Play a one-shot pop when the button (un)locks, to draw attention. */
  highlight?: boolean;
  /** Sustained ring while a condition holds (drift L1). Distinct from highlight. */
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`group pixel-raise active:pixel-press flex h-12 items-center overflow-hidden border-3 border-border px-3 transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${
        highlight && !disabled ? "animate-[nudgePop_450ms_ease-out]" : ""
      } ${pulse && !disabled ? "drift-nudge" : ""}`}
    >
      <span aria-hidden="true" className="shrink-0">
        {children}
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap font-display text-[9px] opacity-0 transition-[max-width,opacity] duration-200 ease-out group-hover:ml-2 group-hover:max-w-[7rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[7rem] group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

/* ---- pixel-art icons (16x16, crisp; palette hexes match the tilemap) ------ */

function HintIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* bulb glass + neck + base + glint */}
      <rect x="5" y="2" width="6" height="6" fill="#d9a521" stroke="#2b2016" strokeWidth="1" />
      <rect x="6" y="8" width="4" height="2" fill="#7a4e2d" />
      <rect x="6" y="10" width="4" height="2" fill="#2b2016" />
      <rect x="6" y="3" width="2" height="2" fill="#fbf3de" />
    </svg>
  );
}

function BriefingIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* scroll sheet + two rollers + text lines */}
      <rect x="3" y="3" width="10" height="10" fill="#f4e6c8" stroke="#2b2016" strokeWidth="1" />
      <rect x="2" y="2" width="12" height="2" fill="#7a4e2d" />
      <rect x="2" y="12" width="12" height="2" fill="#7a4e2d" />
      <rect x="5" y="6" width="6" height="1" fill="#5a4a38" />
      <rect x="5" y="9" width="6" height="1" fill="#5a4a38" />
    </svg>
  );
}

function EvidenceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* magnifier glass ring + handle — "inspect the case file" */}
      <rect x="3" y="2" width="7" height="2" fill="#7a4e2d" />
      <rect x="2" y="4" width="2" height="5" fill="#7a4e2d" />
      <rect x="9" y="4" width="2" height="5" fill="#7a4e2d" />
      <rect x="3" y="9" width="7" height="2" fill="#7a4e2d" />
      <rect x="5" y="5" width="3" height="3" fill="#fbf3de" />
      <rect x="10" y="11" width="2" height="2" fill="#2b2016" />
      <rect x="12" y="13" width="2" height="1" fill="#2b2016" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* shaft + 3-step arrowhead, currentColor */}
      <rect x="3" y="7" width="6" height="2" fill="currentColor" />
      <rect x="9" y="5" width="2" height="6" fill="currentColor" />
      <rect x="11" y="6" width="2" height="4" fill="currentColor" />
      <rect x="13" y="7" width="1" height="2" fill="currentColor" />
    </svg>
  );
}

function EndIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* rounded field + check */}
      <rect x="2" y="2" width="12" height="12" fill="#1f5d3a" stroke="#2b2016" strokeWidth="1" />
      <rect x="6" y="9" width="2" height="2" fill="#fbf3de" />
      <rect x="8" y="7" width="2" height="2" fill="#fbf3de" />
      <rect x="10" y="5" width="2" height="2" fill="#fbf3de" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* shackle + body + keyhole — signals the action is locked until goal */}
      <rect x="5" y="3" width="6" height="4" fill="none" stroke="#5a4a38" strokeWidth="1" />
      <rect x="4" y="7" width="8" height="7" fill="#7a4e2d" stroke="#2b2016" strokeWidth="1" />
      <rect x="7" y="9" width="2" height="3" fill="#2b2016" />
    </svg>
  );
}
