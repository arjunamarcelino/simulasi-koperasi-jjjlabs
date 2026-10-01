import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sessionsRepo } from "../../lib/sessionsRepo";
import {
  groupByScenario,
  hasScores,
  sumScores,
  toSessionEnded,
  type ScenarioHistory,
} from "../../lib/sessionHistory";
import type { EndingType, SessionRecord } from "../../lib/sessionsRepo.contracts";
import { pushEscape } from "../../lib/escapeStack";
import { ResultPanel } from "../session/ResultPanel";
import { ENDING_STYLE } from "../session/resultLabels";

type Phase = "loading" | "ok" | "empty" | "degraded" | "error";

const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });

/**
 * "Riwayat" tab: the authenticated user's finalized attempts, grouped by scenario, with a
 * best-result summary per group. Tapping an attempt reopens the full ResultPanel. All logic
 * lives in lib/ (sessionsRepo + sessionHistory) — this stays presentational.
 */
export function SessionHistoryTab({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [groups, setGroups] = useState<ScenarioHistory[]>([]);
  const [selected, setSelected] = useState<SessionRecord | null>(null);

  // Lazy fetch on first mount. The `active` flag drops a late/superseded response (StrictMode
  // double-mount, or the modal closing mid-flight) — each mount pairs with its own cleanup.
  useEffect(() => {
    let active = true;
    setPhase("loading");
    void sessionsRepo.listMySessions().then((res) => {
      if (!active) return;
      if (res.status === "degraded") setPhase("degraded");
      else if (res.status === "rpcError" || res.status === "invalid") setPhase("error");
      else if (res.data.length === 0) setPhase("empty");
      else {
        setGroups(groupByScenario(res.data));
        setPhase("ok");
      }
    }).catch(() => {
      // listMySessions folds mapped failures into RepoResult; a genuine throw still lands
      // in "error" instead of an unhandled rejection + a skeleton that spins forever.
      if (active) setPhase("error");
    });
    return () => {
      active = false;
    };
  }, []);

  // The detail overlay portals to document.body, so the tab's `hidden` class can't cover it.
  // Close it when the tab is switched away so it can't float over another tab.
  useEffect(() => {
    if (!active) setSelected(null);
  }, [active]);

  // Stable identity: an inline arrow would re-run DetailOverlay's effect (re-pushing the
  // escape handler and refocusing) on any unrelated ProfileModal re-render.
  const closeDetail = useCallback(() => setSelected(null), []);

  if (phase === "loading") return <HistorySkeleton />;
  if (phase === "degraded") return <HistoryMessage>Riwayat tidak tersedia saat offline.</HistoryMessage>;
  if (phase === "error") return <HistoryMessage alert>Gagal memuat riwayat.</HistoryMessage>;
  if (phase === "empty") return <HistoryMessage>Belum ada riwayat percobaan.</HistoryMessage>;

  return (
    <>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <ScenarioGroup key={g.scenarioId} group={g} onOpen={setSelected} />
        ))}
      </div>
      {selected && <DetailOverlay record={selected} onClose={closeDetail} />}
    </>
  );
}

/** Detail view: ResultPanel portalled above the modal, with Esc-to-list + focus in/restore. */
function DetailOverlay({ record, onClose }: { record: SessionRecord; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const off = pushEscape(onClose); // beats ModalShell's capture-phase Esc
    ref.current?.querySelector<HTMLElement>("button")?.focus();

    // Single-focusable overlay: keep Tab inside it rather than into the list behind.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });

    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
      off();
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref}>
      <ResultPanel
        ended={toSessionEnded(record)}
        backLabel="◀ Kembali ke Riwayat"
        overlayClassName="fixed inset-0 z-50"
        onBack={onClose}
      />
    </div>,
    document.body,
  );
}

function ScenarioGroup({
  group,
  onOpen,
}: {
  group: ScenarioHistory;
  onOpen: (r: SessionRecord) => void;
}) {
  const headingId = `hist-${group.scenarioId}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-2 border-3 border-t-4 p-3 ${ENDING_STYLE[group.best.endingType].accent}`}
    >
      <h3 id={headingId} className="font-display text-xs text-forest">
        {group.title}
      </h3>
      <BestResultSummary record={group.best} />
      <ul className="flex flex-col gap-2">
        {group.attempts.map((a) => (
          <AttemptRow key={a.id} record={a} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function BestResultSummary({ record }: { record: SessionRecord }) {
  return (
    <div className="flex items-center gap-2 border-3 border-border bg-cream px-3 py-2">
      <span className="border-2 border-border bg-forest px-2 py-0.5 font-display text-[9px] text-cream">
        TERBAIK
      </span>
      <EndingBadge type={record.endingType} />
      <span className="ml-auto">
        <ScoreText record={record} />
      </span>
    </div>
  );
}

function AttemptRow({ record, onOpen }: { record: SessionRecord; onOpen: (r: SessionRecord) => void }) {
  const label = ENDING_STYLE[record.endingType].badgeLabel;
  const when = dateFmt.format(record.startedAt);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(record)}
        aria-label={`Percobaan ${label}, ${when} — buka detail`}
        className="pixel-raise active:pixel-press flex w-full items-center gap-3 border-3 border-border bg-cream-2 px-3 py-2 text-left hover:bg-parchment focus-visible:pixel-focus focus-visible:outline-none"
      >
        <EndingBadge type={record.endingType} />
        <time className="font-body text-base text-ink-soft">{when}</time>
        <span className="ml-auto">
          <ScoreText record={record} />
        </span>
      </button>
    </li>
  );
}

function EndingBadge({ type }: { type: EndingType }) {
  const m = ENDING_STYLE[type];
  return (
    <span className={`border-2 border-border px-2 py-0.5 font-display text-[9px] ${m.chip}`}>
      {m.badgeLabel}
    </span>
  );
}

function ScoreText({ record }: { record: SessionRecord }) {
  if (!hasScores(record)) {
    return <span className="font-display text-[10px] text-ink-soft">Tutorial</span>;
  }
  return <span className="font-display text-[10px] text-ink">{sumScores(record)} poin</span>;
}

function HistoryMessage({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <p role={alert ? "alert" : undefined} className="py-8 text-center font-body text-lg text-ink-soft">
      {children}
    </p>
  );
}

function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-12 animate-pulse border-3 border-border bg-cream-2" />
      ))}
    </div>
  );
}
