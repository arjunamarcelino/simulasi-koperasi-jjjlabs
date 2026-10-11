import { useEffect, useRef, useState } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { madingRepo, type Keyed, type RepoResult } from "../../lib/madingRepo";
import type { KoperasiIdentitas, MadingNote, NoteAccent } from "../../lib/mading.types";
import { ModalShell } from "../common/ModalShell";

/**
 * Per-accent Tailwind classes. Kept here (not the content) and as a full Record of *complete
 * literal* class strings — Tailwind v4 is config-less with no safelist, so `bg-${accent}` would
 * never be generated. Contrast travels with the background so dark accents get light text.
 */
const NOTE_ACCENT: Record<NoteAccent, { box: string; title: string; pin: string }> = {
  mustard: { box: "bg-mustard text-ink", title: "text-forest-2", pin: "bg-orange" },
  forest: { box: "bg-forest text-parchment", title: "text-mustard", pin: "bg-mustard" },
  orange: { box: "bg-orange text-ink", title: "text-forest-2", pin: "bg-forest" },
  parchment: { box: "bg-parchment text-ink", title: "text-forest", pin: "bg-orange" },
};
const ROTATIONS = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2", "-rotate-1", "rotate-1"];

/** Loading/degraded/error message for a board read, or null when `ok`. */
function fallbackMessage(result: RepoResult<unknown> | null): string | null {
  if (result === null) return "Memuat papan…";
  if (result.status === "degraded") return "Papan ini butuh koneksi internet.";
  if (result.status === "rpcError" || result.status === "invalid") return "Gagal memuat papan.";
  return null;
}

/** The koperasi "Papan Info Penting": identity header + a corkboard of sticky notes (live from DB). */
export function MadingInfoBoard() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_INFO");
  const [notes, setNotes] = useState<RepoResult<Keyed<MadingNote>[]> | null>(null);
  const [identitas, setIdentitas] = useState<RepoResult<KoperasiIdentitas | null> | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!active) return;
    const myReq = ++reqId.current;
    setNotes(null);
    setIdentitas(null);
    void madingRepo.info().then((r) => {
      if (myReq === reqId.current) setNotes(r);
    });
    void madingRepo.identitas().then((r) => {
      if (myReq === reqId.current) setIdentitas(r);
    });
  }, [active]);

  if (!active) return null;
  const close = () => gameStore.getState().clearSelection();
  const header = identitas?.status === "ok" ? identitas.data : null;
  const msg = fallbackMessage(notes);

  return (
    <ModalShell titleId="mading-info-title" onClose={close} panelClassName="w-full max-w-2xl">
      <header className="mb-5 text-center">
        <h2 id="mading-info-title" className="font-display text-sm leading-tight text-forest md:text-base">
          {header ? header.nama : "Papan Info Penting"}
        </h2>
        {header && (
          <div className="mt-2 space-y-0.5 font-body text-lg text-ink-soft">
            <p>{header.badanHukum}</p>
            <p>{header.alamat}</p>
            <p>{header.desa}</p>
          </div>
        )}
      </header>

      {msg !== null ? (
        <p className="py-8 text-center font-body text-xl text-ink-soft">{msg}</p>
      ) : notes!.status === "ok" && notes!.data.length === 0 ? (
        <p className="py-8 text-center font-body text-xl text-ink-soft">Belum ada info di papan ini.</p>
      ) : (
        <div className="corkboard grid grid-cols-1 gap-5 border-3 border-brown-2 p-4 sm:grid-cols-2 md:p-6">
          {notes!.status === "ok" &&
            notes!.data.map(({ block_key, payload: note }, i) => {
              const a = NOTE_ACCENT[note.accent];
              return (
                <article
                  key={block_key}
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
                    {note.lines.map((line, j) => (
                      <p key={j}>{line}</p>
                    ))}
                  </div>
                </article>
              );
            })}
        </div>
      )}
    </ModalShell>
  );
}
