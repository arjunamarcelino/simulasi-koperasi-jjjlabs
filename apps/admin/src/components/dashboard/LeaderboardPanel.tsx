import { useState } from "react";
import { leaderboardStore, useLeaderboard } from "../../stores/leaderboard.store";
import { LeaderboardTable } from "./LeaderboardTable";
import { count } from "../../lib/formatMetrics";

/**
 * Seasonal leaderboard panel (SIM-17). Owns the season <select>, the capture control (optional
 * label input), and a window.confirm-guarded delete. All read it from the single leaderboard
 * store; the ONE mutation gate (`mutating`) disables capture + the label input + delete together,
 * so a double-click or capture∥delete can't fire. The season list stays visible while `switching`.
 * Collapsed (with LeaderboardTable) from the 4-component precedent to 2.
 */
export function LeaderboardPanel() {
  const state = useLeaderboard((s) => s.state);
  const toast = useLeaderboard((s) => s.toast);
  const [label, setLabel] = useState("");

  if (state.status === "loading" || state.status === "authLost") {
    return <p className="text-ink-soft">Memuat papan peringkat…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-soft">Tidak dapat memuat papan peringkat saat ini.</p>
        <button
          onClick={() => leaderboardStore.getState().retry()}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream"
        >
          Coba lagi
        </button>
      </div>
    );
  }
  if (state.status === "idle") return null;

  const { data, switching, mutating } = state;
  const busy = mutating !== null;
  const selected = data.selected;
  const deletingThis =
    selected !== null && typeof mutating === "object" && mutating?.deleting === selected.id;

  const onCapture = () => {
    const trimmed = label.trim();
    leaderboardStore.getState().capture(trimmed === "" ? null : trimmed);
    setLabel("");
  };
  const onDelete = () => {
    if (!selected) return;
    if (!window.confirm(`Hapus Musim #${selected.season_number} — tidak bisa dibatalkan`)) return;
    leaderboardStore.getState().remove(selected.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-forest">Papan peringkat musiman</h2>
      </div>

      {toast && (
        <p
          className={`text-sm ${toast.tone === "success" ? "text-forest" : "text-red-700"}`}
          role="status"
        >
          {toast.text}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Musim
          <select
            value={selected?.id ?? ""}
            disabled={data.seasons.length === 0}
            onChange={(e) => leaderboardStore.getState().select(e.target.value)}
            className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
          >
            {data.seasons.length === 0 ? (
              <option value="">Belum ada musim</option>
            ) : (
              data.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {`Musim #${s.season_number}${s.label ? ` — ${s.label}` : ""} (${count(s.entry_count)} peserta)`}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Label (opsional)
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            maxLength={120}
            placeholder="mis. Awarding Day"
            className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
          />
        </label>

        <button
          type="button"
          onClick={onCapture}
          disabled={busy}
          className="rounded bg-forest px-4 py-2 text-sm font-semibold text-cream disabled:opacity-50"
        >
          {mutating === "capturing" ? "Menyimpan…" : "Ambil snapshot"}
        </button>

        {selected && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded border border-brown px-4 py-2 text-sm font-semibold text-ink-soft disabled:opacity-50"
          >
            {deletingThis ? "Menghapus…" : "Hapus musim"}
          </button>
        )}
      </div>

      {selected ? (
        <section className={`flex flex-col gap-2 ${switching ? "opacity-60" : ""}`}>
          <h3 className="text-sm font-semibold text-forest">
            {`Musim #${selected.season_number}${selected.label ? ` — ${selected.label}` : ""}`}
          </h3>
          <p className="text-xs text-ink-soft">
            {`${count(selected.entry_count)} peserta · diambil ${selected.captured_at}`}
          </p>
          <LeaderboardTable entries={selected.entries} />
        </section>
      ) : (
        <p className="text-ink-soft">
          Belum ada musim. Ambil snapshot untuk membuat musim pertama.
        </p>
      )}
    </div>
  );
}
