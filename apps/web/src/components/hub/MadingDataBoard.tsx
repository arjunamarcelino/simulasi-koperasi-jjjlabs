import { useEffect, useRef, useState, type KeyboardEventHandler } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { madingRepo, type Keyed, type RepoResult } from "../../lib/madingRepo";
import { fallbackMessage, wrapIndex } from "../../lib/madingBoard";
import type { MadingSlide } from "../../lib/mading.types";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

const GOOD_STATUS = new Set(["Aktif", "Lancar"]);
const BAD_STATUS = new Set(["Nonaktif", "Bermasalah"]);

/**
 * Pure view: the fallback/empty states, else the data-table carousel. Split out (like
 * `LeaderboardMadingBody`) so the ARIA is unit-testable in the repo's no-DOM env via
 * renderToStaticMarkup; the container owns the store gate, fetch, and arrow-key handler.
 *
 * Renders the dialog heading itself (the title is per-slide, so it is `aria-labelledby`'s target).
 * APG carousel semantics live on stable wrappers (korsel region + salindia slide).
 */
export function MadingDataBoardBody({
  result,
  idx,
  onSelect,
}: {
  result: RepoResult<Keyed<MadingSlide>[]> | null;
  idx: number;
  onSelect: (i: number) => void;
}) {
  const msg = fallbackMessage(result);
  const len = result?.status === "ok" ? result.data.length : 0;

  if (msg !== null || len === 0) {
    return (
      <>
        <h2 id="mading-data-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
          Papan Data
        </h2>
        <p className="py-8 text-center font-body text-xl text-ink-soft">
          {msg ?? "Belum ada data di papan ini."}
        </p>
      </>
    );
  }

  const slides = (result as Extract<RepoResult<Keyed<MadingSlide>[]>, { status: "ok" }>).data;
  const safeIdx = wrapIndex(idx, len);
  const entry = slides[safeIdx]!;
  const slide = entry.payload;

  return (
    <>
      <header className="mb-3 text-center">
        <h2 id="mading-data-title" className="font-display text-sm text-forest md:text-base">
          {slide.title}
        </h2>
        {slide.caption && <p className="mt-1 font-body text-lg text-ink-soft">{slide.caption}</p>}
      </header>

      <div role="group" aria-roledescription="korsel" aria-label="Papan Data">
        <p aria-hidden="true" className="mb-3 text-center font-display text-[10px] text-ink-soft">
          {`Slide ${safeIdx + 1} dari ${len}`}
        </p>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {`Slide ${safeIdx + 1} dari ${len}: ${slide.title}`}
        </p>

        <div role="group" aria-roledescription="salindia" aria-label={`Slide ${safeIdx + 1}: ${slide.title}`}>
          <div className="overflow-x-auto border-3 border-border">
            <table
              key={entry.block_key}
              className="w-full border-collapse font-body text-lg animate-[fadeIn_120ms_ease-out] motion-reduce:animate-none md:text-xl"
            >
              <thead>
                <tr>
                  {slide.headers.map((h, c) => (
                    <th
                      key={c}
                      className={`border-b-3 border-border bg-forest px-3 py-2 font-display text-[10px] text-parchment md:text-xs ${
                        slide.align?.[c] === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:nth-child(even)]:bg-parchment [&_tr:nth-child(odd)]:bg-cream-2">
                {slide.rows.map((row, r) => (
                  <tr key={r}>
                    {slide.headers.map((_, c) => {
                      const value = row[c] ?? "";
                      const right = slide.align?.[c] === "right";
                      return (
                        <td
                          key={c}
                          className={`border-b border-line px-3 py-1.5 ${
                            right ? "whitespace-nowrap text-right tabular-nums" : "text-left"
                          }`}
                        >
                          {GOOD_STATUS.has(value) || BAD_STATUS.has(value) ? (
                            <span
                              className={`inline-block border-2 border-border px-2 py-0.5 font-display text-[9px] ${
                                GOOD_STATUS.has(value) ? "bg-forest text-parchment" : "bg-orange text-ink"
                              }`}
                            >
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4">
          <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Slide sebelumnya" onClick={() => onSelect(safeIdx - 1)}>
            ‹
          </GameButton>
          <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Pilih slide">
            {slides.map((s, i) => (
              <button
                key={s.block_key}
                type="button"
                aria-label={`Ke slide ${i + 1}: ${s.payload.title}`}
                aria-current={i === safeIdx ? "true" : undefined}
                onClick={() => onSelect(i)}
                className={`h-3 w-3 border-2 border-border transition-colors duration-75 focus-visible:outline-none focus-visible:pixel-focus ${
                  i === safeIdx ? "bg-mustard" : "bg-cream hover:bg-parchment"
                }`}
              />
            ))}
          </div>
          <GameButton variant="ghost" className="!px-4 !py-3 font-display text-lg" aria-label="Slide berikutnya" onClick={() => onSelect(safeIdx + 1)}>
            ›
          </GameButton>
        </div>
      </div>
    </>
  );
}

/** The koperasi "Papan Data": a carousel of admin-authored tables (live from DB). */
export function MadingDataBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_DATA");
  const index = useGameStore((s) => s.madingIndex);
  const [result, setResult] = useState<RepoResult<Keyed<MadingSlide>[]> | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!active) return;
    const myReq = ++reqId.current;
    setResult(null);
    void madingRepo.data().then((r) => {
      if (myReq === reqId.current) setResult(r);
    });
  }, [active]);

  const len = result?.status === "ok" ? result.data.length : 0;

  if (!active) return null;
  const close = () => gameStore.getState().clearSelection();
  const go = (i: number) => gameStore.getState().setMadingIndex(wrapIndex(i, len));

  // Arrow nav scoped to the dialog panel (bubble phase via ModalShell), not `document`: catches
  // keys from any focus inside the dialog without hijacking arrows page-wide. Reads the live index
  // at fire-time. The Phaser scene disables its (global) keyboard while an overlay is open, so
  // nothing leaks to the game behind the modal.
  const onArrowKey: KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.repeat) return; // ignore auto-repeat so a held key doesn't strobe the table fade
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return; // never steal typing
    e.preventDefault();
    e.stopPropagation();
    const cur = gameStore.getState().madingIndex;
    gameStore.getState().setMadingIndex(wrapIndex(cur + (e.key === "ArrowRight" ? 1 : -1), len));
  };

  return (
    <ModalShell titleId="mading-data-title" onClose={close} onKeyDown={onArrowKey} panelClassName="w-full max-w-2xl">
      <MadingDataBoardBody result={result} idx={index} onSelect={go} />
    </ModalShell>
  );
}
