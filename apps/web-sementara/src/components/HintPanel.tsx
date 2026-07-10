import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";

/**
 * Menampilkan petunjuk mentor terkini (fitur Petunjuk). Dismissible; kosong bila
 * belum ada petunjuk. Ditempatkan di badan sesi, mirip banner ketegangan drift.
 */
export function HintPanel() {
  const hint = useSessionStore((s) => s.hint);
  const ended = useSessionStore((s) => s.ended);

  if (!hint || ended) return null;

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-forest bg-forest/10 px-3 py-2 text-sm">
      <p className="leading-relaxed">
        <span className="font-semibold">💡 Petunjuk mentor: </span>
        {hint}
      </p>
      <button
        type="button"
        onClick={sessionController.dismissHint}
        className="shrink-0 rounded px-1 text-ink-soft hover:text-ink"
        aria-label="Tutup petunjuk"
        title="Tutup"
      >
        ×
      </button>
    </div>
  );
}
