import { useGameStore, gameStore } from "../../stores/game.store";
import {
  KOPERASI_IDENTITAS,
  MADING_INFO_NOTES,
  type NoteAccent,
} from "../../content/mading-info";
import { ModalShell } from "../common/ModalShell";

/**
 * Per-accent Tailwind classes. Kept here (not in the content file) and as a full
 * Record of *complete literal* class strings — Tailwind v4 is config-less with no
 * safelist, so `bg-${accent}` would never be generated. Contrast travels with the
 * background so dark accents get light text.
 */
const NOTE_ACCENT: Record<NoteAccent, { box: string; title: string; pin: string }> = {
  mustard: { box: "bg-mustard text-ink", title: "text-forest-2", pin: "bg-orange" },
  forest: { box: "bg-forest text-parchment", title: "text-mustard", pin: "bg-mustard" },
  orange: { box: "bg-orange text-ink", title: "text-forest-2", pin: "bg-forest" },
  parchment: { box: "bg-parchment text-ink", title: "text-forest", pin: "bg-orange" },
};

// Literal rotation classes (again: no interpolation, so v4 emits them).
const ROTATIONS = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2", "-rotate-1", "rotate-1"];

/** The koperasi "Papan Info Penting": identity header + a corkboard of sticky notes. */
export function MadingInfoBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_INFO");
  if (!active) return null;

  const close = () => gameStore.getState().clearSelection();

  return (
    <ModalShell
      titleId="mading-info-title"
      onClose={close}
      panelClassName="w-full max-w-2xl max-h-[85vh] overflow-y-auto"
    >
      {/* Identity plaque */}
      <header className="mb-5 text-center">
        <h2
          id="mading-info-title"
          className="font-display text-sm leading-tight text-forest md:text-base"
        >
          {KOPERASI_IDENTITAS.nama}
        </h2>
        <div className="mt-2 space-y-0.5 font-body text-lg text-ink-soft">
          <p>{KOPERASI_IDENTITAS.badanHukum}</p>
          <p>{KOPERASI_IDENTITAS.alamat}</p>
          <p>{KOPERASI_IDENTITAS.desa}</p>
        </div>
      </header>

      {/* Corkboard */}
      <div className="corkboard grid grid-cols-1 gap-5 border-3 border-brown-2 p-4 sm:grid-cols-2 md:p-6">
        {MADING_INFO_NOTES.map((note, i) => {
          const a = NOTE_ACCENT[note.accent];
          return (
            <article
              key={note.title}
              className={`pixel-panel relative p-4 !shadow-[3px_3px_0_0_rgba(43,32,22,0.35)] transition-transform duration-100 hover:rotate-0 hover:-translate-y-0.5 md:p-5 ${a.box} ${ROTATIONS[i % ROTATIONS.length]}`}
            >
              <span
                aria-hidden="true"
                className={`absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-border shadow-[1px_1px_0_0_var(--color-brown-2)] ${a.pin}`}
              />
              <h3 className={`mb-2 font-display text-[10px] leading-tight md:text-xs ${a.title}`}>
                {note.title}
              </h3>
              <div className="space-y-0.5 font-body text-lg leading-snug md:text-xl">
                {note.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </ModalShell>
  );
}
