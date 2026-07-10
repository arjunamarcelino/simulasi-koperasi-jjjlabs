import { useEffect } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { MADING_DATA_SLIDES } from "../../content/mading-data";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

const LEN = MADING_DATA_SLIDES.length;
const GOOD_STATUS = new Set(["Aktif", "Lancar"]);
const BAD_STATUS = new Set(["Nonaktif", "Bermasalah"]);

const wrap = (i: number) => ((i % LEN) + LEN) % LEN;

/** The koperasi "Papan Data": a 3-slide carousel of dummy tables (ruang rapat). */
export function MadingDataBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_DATA");
  const index = useGameStore((s) => s.madingIndex);

  // Arrow-key navigation. Reads the live index from the store at fire-time (not
  // the render closure) so the once-attached listener never goes stale.
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
  const slide = MADING_DATA_SLIDES[index]!;

  return (
    <ModalShell titleId="mading-data-title" onClose={close} panelClassName="w-full max-w-2xl">
      <header className="mb-3 text-center">
        <h2 id="mading-data-title" className="font-display text-sm text-forest md:text-base">
          {slide.title}
        </h2>
        {slide.caption && (
          <p className="mt-1 font-body text-lg text-ink-soft">{slide.caption}</p>
        )}
      </header>

      {/* Slide announcement for screen readers. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Slide ${index + 1} dari ${LEN}: ${slide.title}`}
      </p>

      <div className="overflow-x-auto border-3 border-border">
        <table
          key={slide.id}
          className="w-full border-collapse font-body text-lg animate-[fadeIn_120ms_ease-out] md:text-xl"
        >
          <thead>
            <tr>
              {slide.headers.map((h, c) => (
                <th
                  key={h}
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
                            GOOD_STATUS.has(value)
                              ? "bg-forest text-parchment"
                              : "bg-orange text-ink"
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

      {/* Nav: arrows flanking dot indicators (loop — always enabled). */}
      <div className="mt-5 flex items-center justify-center gap-4">
        <GameButton
          variant="ghost"
          className="!px-4 !py-3 font-display text-lg"
          aria-label="Slide sebelumnya"
          onClick={() => go(index - 1)}
        >
          ‹
        </GameButton>

        <div className="flex items-center gap-2" role="group" aria-label="Pilih slide">
          {MADING_DATA_SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Ke slide ${i + 1}: ${s.title}`}
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
          aria-label="Slide berikutnya"
          onClick={() => go(index + 1)}
        >
          ›
        </GameButton>
      </div>
    </ModalShell>
  );
}
