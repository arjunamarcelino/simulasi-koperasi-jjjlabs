import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";

/**
 * Fitur Petunjuk (menggantikan "Tanya Mentor", PRD §9). Meminta mentor
 * kontekstual memberi satu saran langkah berikutnya. Hasil dirender oleh
 * HintPanel.
 */
export function HintButton() {
  const connected = useSessionStore((s) => s.connection === "connected");
  const loading = useSessionStore((s) => s.hintLoading);

  return (
    <button
      type="button"
      disabled={!connected || loading}
      onClick={sessionController.requestHint}
      className="rounded-lg border border-forest bg-parchment px-4 py-2 font-semibold text-forest disabled:opacity-40"
      title="Bingung harus melakukan apa? Minta petunjuk mentor."
    >
      {loading ? "Memuat…" : "💡 Petunjuk"}
    </button>
  );
}
