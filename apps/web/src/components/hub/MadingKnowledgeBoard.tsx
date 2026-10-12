import { useEffect, useRef, useState } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { madingRepo, type Keyed, type RepoResult } from "../../lib/madingRepo";
import { fallbackMessage, wrapIndex } from "../../lib/madingBoard";
import type { KnowledgeCard } from "../../lib/mading.types";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

/** Attribution shown under the board. Non-managed constant (rarely changes; not admin-editable). */
const KNOWLEDGE_SOURCE =
  "Sumber: Dashboard SIMKOPDES (2026), Kementerian Koperasi RI — simkopdes.go.id/pers/dashboard";

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

  useEffect(() => {
    if (!active || len === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.repeat) return; // ignore auto-repeat so a held key doesn't strobe the fade
      e.preventDefault();
      e.stopPropagation();
      const cur = gameStore.getState().madingIndex;
      gameStore.getState().setMadingIndex(wrapIndex(cur + (e.key === "ArrowRight" ? 1 : -1), len));
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active, len]);

  if (!active) return null;
  const close = () => gameStore.getState().clearSelection();
  const go = (i: number) => gameStore.getState().setMadingIndex(wrapIndex(i, len));
  const msg = fallbackMessage(result);

  if (msg !== null || len === 0) {
    return (
      <ModalShell titleId="mading-knowledge-title" onClose={close} panelClassName="w-full max-w-lg">
        <h2 id="mading-knowledge-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
          Pengetahuan Koperasi
        </h2>
        <p className="py-8 text-center font-body text-xl text-ink-soft">
          {msg ?? "Belum ada kartu di papan ini."}
        </p>
      </ModalShell>
    );
  }

  const cards = (result as Extract<RepoResult<Keyed<KnowledgeCard>[]>, { status: "ok" }>).data;
  const idx = wrapIndex(index, len);
  const card = cards[idx]!.payload;

  return (
    <ModalShell titleId="mading-knowledge-title" onClose={close} panelClassName="w-full max-w-lg">
      <h2 id="mading-knowledge-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Pengetahuan Koperasi
      </h2>

      <p aria-hidden="true" className="mb-3 text-center font-display text-[10px] text-ink-soft">
        {`Kartu ${idx + 1} dari ${len}`}
      </p>

      <div
        key={idx}
        aria-live="polite"
        aria-atomic="true"
        className="flex h-60 animate-[fadeIn_120ms_ease-out] items-center justify-center overflow-y-auto border-3 border-border bg-cream px-5 py-6 text-center motion-reduce:animate-none"
      >
        <span className="sr-only">{`Kartu ${idx + 1} dari ${len}.`}</span>
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

      <div className="mt-5 flex items-center justify-center gap-4">
        <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Kartu sebelumnya" onClick={() => go(idx - 1)}>
          ‹
        </GameButton>
        <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Pilih kartu">
          {cards.map((c, i) => (
            <button
              key={c.block_key}
              type="button"
              aria-label={`Ke kartu ${i + 1}`}
              aria-current={i === idx ? "true" : undefined}
              onClick={() => go(i)}
              className={`h-3 w-3 border-2 border-border transition-colors duration-75 focus-visible:outline-none focus-visible:pixel-focus ${
                i === idx ? "bg-mustard" : "bg-cream hover:bg-parchment"
              }`}
            />
          ))}
        </div>
        <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Kartu berikutnya" onClick={() => go(idx + 1)}>
          ›
        </GameButton>
      </div>

      <p className="mt-4 text-center font-body text-[11px] leading-snug text-ink-soft/70">{KNOWLEDGE_SOURCE}</p>
    </ModalShell>
  );
}
