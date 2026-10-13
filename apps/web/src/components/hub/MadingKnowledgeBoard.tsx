import { useEffect, useRef, useState, type KeyboardEventHandler } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { madingRepo, type Keyed, type RepoResult } from "../../lib/madingRepo";
import { fallbackMessage, wrapIndex } from "../../lib/madingBoard";
import type { KnowledgeCard } from "../../lib/mading.types";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

/** Attribution shown under the board. Non-managed constant (rarely changes; not admin-editable). */
const KNOWLEDGE_SOURCE =
  "Sumber: Dashboard SIMKOPDES (2026), Kementerian Koperasi RI — simkopdes.go.id/pers/dashboard";

/** Screen-reader name for a card, derived from its content (stat cards have no title field).
 * Read when navigating into the slide — the polite live region still carries the position. */
function knowledgeSlideName(card: KnowledgeCard): string {
  return card.kind === "stat"
    ? `${card.group ? `${card.group}: ` : ""}${card.value} — ${card.label}`
    : `${card.chip ?? "Tahukah Kamu?"}: ${card.text}`;
}

/**
 * Pure view: branches the fallback/empty states, else the stat/fact carousel. Split out (like
 * `LeaderboardMadingBody`) so the ARIA is unit-testable in the repo's no-DOM env via
 * renderToStaticMarkup; the container owns the store gate, fetch, and arrow-key handler.
 *
 * APG carousel semantics live on STABLE wrappers (korsel region + salindia slide), kept off the
 * `key={idx}` fade node so the polite live region's announce-on-change behavior (SIM-10 / PR #25)
 * is untouched.
 */
export function MadingKnowledgeBoardBody({
  result,
  idx,
  onSelect,
}: {
  result: RepoResult<Keyed<KnowledgeCard>[]> | null;
  idx: number;
  onSelect: (i: number) => void;
}) {
  const msg = fallbackMessage(result);
  const len = result?.status === "ok" ? result.data.length : 0;

  if (msg !== null || len === 0) {
    return (
      <p className="py-8 text-center font-body text-xl text-ink-soft">
        {msg ?? "Belum ada kartu di papan ini."}
      </p>
    );
  }

  const cards = (result as Extract<RepoResult<Keyed<KnowledgeCard>[]>, { status: "ok" }>).data;
  const safeIdx = wrapIndex(idx, len);
  const card = cards[safeIdx]!.payload;

  return (
    <>
      <div role="group" aria-roledescription="korsel" aria-label="Pengetahuan Koperasi">
        <p aria-hidden="true" className="mb-3 text-center font-display text-[10px] text-ink-soft">
          {`Kartu ${safeIdx + 1} dari ${len}`}
        </p>

        <div role="group" aria-roledescription="salindia" aria-label={knowledgeSlideName(card)}>
          <div
            key={safeIdx}
            aria-live="polite"
            aria-atomic="true"
            className="flex h-60 animate-[fadeIn_120ms_ease-out] items-center justify-center overflow-y-auto border-3 border-border bg-cream px-5 py-6 text-center motion-reduce:animate-none"
          >
            <span className="sr-only">{`Kartu ${safeIdx + 1} dari ${len}.`}</span>
            {card.kind === "stat" ? (
              <div>
                {card.group && (
                  <span className="mb-3 inline-block border-2 border-border bg-mustard px-2 py-0.5 font-display text-[9px] text-ink">
                    {card.group}
                  </span>
                )}
                <p className="font-display text-2xl leading-tight text-forest md:text-3xl">{card.value}</p>
                <p className="mx-auto mt-3 max-w-xs font-body text-xl leading-snug text-ink md:text-2xl">{card.label}</p>
                {card.sub && <p className="mt-1 font-body text-lg text-ink-soft">{card.sub}</p>}
              </div>
            ) : (
              <div>
                <span className="pixel-panel -rotate-1 mb-4 inline-block bg-mustard px-3 py-1 font-display text-[10px] text-ink !shadow-none">
                  {card.chip ?? "Tahukah Kamu?"}
                </span>
                <p className="mx-auto max-w-sm font-body text-xl leading-snug text-ink-soft md:text-2xl">{card.text}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4">
          <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Kartu sebelumnya" onClick={() => onSelect(safeIdx - 1)}>
            ‹
          </GameButton>
          <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Pilih kartu">
            {cards.map((c, i) => (
              <button
                key={c.block_key}
                type="button"
                aria-label={`Ke kartu ${i + 1}`}
                aria-current={i === safeIdx ? "true" : undefined}
                onClick={() => onSelect(i)}
                className={`h-3 w-3 border-2 border-border transition-colors duration-75 focus-visible:outline-none focus-visible:pixel-focus ${
                  i === safeIdx ? "bg-mustard" : "bg-cream hover:bg-parchment"
                }`}
              />
            ))}
          </div>
          <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Kartu berikutnya" onClick={() => onSelect(safeIdx + 1)}>
            ›
          </GameButton>
        </div>
      </div>

      <p className="mt-4 text-center font-body text-[11px] leading-snug text-ink-soft/70">{KNOWLEDGE_SOURCE}</p>
    </>
  );
}

/** The koperasi "Papan Pengetahuan": a carousel of stat + fact cards (live from DB). */
export function MadingKnowledgeBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_KNOWLEDGE");
  const index = useGameStore((s) => s.madingIndex);
  const [result, setResult] = useState<RepoResult<Keyed<KnowledgeCard>[]> | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!active) return;
    const myReq = ++reqId.current;
    setResult(null);
    void madingRepo.knowledge().then((r) => {
      if (myReq === reqId.current) setResult(r);
    });
  }, [active]);

  const len = result?.status === "ok" ? result.data.length : 0;

  if (!active) return null;
  const close = () => gameStore.getState().clearSelection();
  const go = (i: number) => gameStore.getState().setMadingIndex(wrapIndex(i, len));

  // Arrow nav scoped to the dialog panel (bubble phase via ModalShell), not `document`: catches
  // keys from any focus inside the dialog — including the close button, a sibling of the content —
  // without hijacking arrows page-wide. Reads the live index at fire-time. The Phaser scene disables
  // its (global) keyboard while an overlay is open, so nothing leaks to the game behind the modal.
  const onArrowKey: KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.repeat) return; // ignore auto-repeat so a held key doesn't strobe the fade
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return; // never steal typing
    e.preventDefault();
    e.stopPropagation();
    const cur = gameStore.getState().madingIndex;
    gameStore.getState().setMadingIndex(wrapIndex(cur + (e.key === "ArrowRight" ? 1 : -1), len));
  };

  return (
    <ModalShell
      titleId="mading-knowledge-title"
      onClose={close}
      onKeyDown={onArrowKey}
      panelClassName="w-full max-w-lg"
    >
      <h2 id="mading-knowledge-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Pengetahuan Koperasi
      </h2>
      <MadingKnowledgeBoardBody result={result} idx={index} onSelect={go} />
    </ModalShell>
  );
}
