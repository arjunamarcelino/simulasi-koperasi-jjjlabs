import { useEffect } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { MADING_KNOWLEDGE_CARDS, KNOWLEDGE_SOURCE } from "../../content/mading-knowledge";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

const LEN = MADING_KNOWLEDGE_CARDS.length;
const wrap = (i: number) => ((i % LEN) + LEN) % LEN;

/** The koperasi "Papan Pengetahuan": a carousel of stat + fact cards (entrance posters). */
export function MadingKnowledgeBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_KNOWLEDGE");
  const index = useGameStore((s) => s.madingIndex);

  // Arrow-key nav — reads the live index at fire-time so the once-attached
  // listener never goes stale (same pattern as MadingDataBoard).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      const cur = gameStore.getState().madingIndex;
      gameStore.getState().setMadingIndex(wrap(cur + (e.key === "ArrowRight" ? 1 : -1)));
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active]);

  if (!active) return null;

  const close = () => gameStore.getState().clearSelection();
  const go = (i: number) => gameStore.getState().setMadingIndex(wrap(i));
  const card = MADING_KNOWLEDGE_CARDS[index]!;

  return (
    <ModalShell titleId="mading-knowledge-title" onClose={close} panelClassName="w-full max-w-lg">
      <h2 id="mading-knowledge-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Pengetahuan Koperasi
      </h2>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Kartu ${index + 1} dari ${LEN}`}
      </p>

      {/* Card body — swaps with a quick slide-in on index change. */}
      <div
        key={index}
        className="flex min-h-44 animate-[fadeIn_120ms_ease-out] items-center justify-center border-3 border-border bg-cream px-5 py-6 text-center"
      >
        {card.kind === "stat" ? (
          <div>
            {card.group && (
              <span className="mb-3 inline-block border-2 border-border bg-mustard px-2 py-0.5 font-display text-[9px] text-ink">
                {card.group}
              </span>
            )}
            <p className="font-display text-2xl leading-tight text-forest md:text-3xl">
              {card.value}
            </p>
            <p className="mx-auto mt-3 max-w-xs font-body text-xl leading-snug text-ink md:text-2xl">
              {card.label}
            </p>
            {card.sub && <p className="mt-1 font-body text-lg text-ink-soft">{card.sub}</p>}
          </div>
        ) : (
          <div>
            <span className="pixel-panel -rotate-1 mb-4 inline-block bg-mustard px-3 py-1 font-display text-[10px] text-ink !shadow-none">
              Tahukah Kamu?
            </span>
            <p className="mx-auto max-w-sm font-body text-xl leading-snug text-ink-soft md:text-2xl">
              {card.text}
            </p>
          </div>
        )}
      </div>

      {/* Nav: arrows flanking dot indicators (loop — always enabled). */}
      <div className="mt-5 flex items-center justify-center gap-4">
        <GameButton
          variant="ghost"
          className="!px-4 !py-3 font-display text-lg"
          aria-label="Kartu sebelumnya"
          onClick={() => go(index - 1)}
        >
          ‹
        </GameButton>

        <div className="flex items-center gap-2" role="group" aria-label="Pilih kartu">
          {MADING_KNOWLEDGE_CARDS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ke kartu ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
              className={`h-3 w-3 border-2 border-border transition-colors duration-75 focus-visible:outline-none focus-visible:pixel-focus ${
                i === index ? "bg-mustard" : "bg-cream hover:bg-parchment"
              }`}
            />
          ))}
        </div>

        <GameButton
          variant="ghost"
          className="!px-4 !py-3 font-display text-lg"
          aria-label="Kartu berikutnya"
          onClick={() => go(index + 1)}
        >
          ›
        </GameButton>
      </div>

      <p className="mt-4 text-center font-body text-[11px] leading-snug text-ink-soft/70">
        {KNOWLEDGE_SOURCE}
      </p>
    </ModalShell>
  );
}
