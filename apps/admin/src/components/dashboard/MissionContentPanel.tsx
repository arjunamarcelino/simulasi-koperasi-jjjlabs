import { useState } from "react";
import { missionContentStore, useMissionContent } from "../../stores/missionContent.store";
import type { MissionRow } from "../../lib/adminApi";
import { ContentPanelShell, PanelFallback } from "./ContentPanelShell";

/**
 * Mission unlock-code panel (SIM-42). Lists reallife missions with their current redeem_code +
 * last-rotation audit, and rotates a code inline. Rotate-only: NO add/delete; `code` (the mission
 * id) and `title` are display-only. The edit draft is component-local so a failed rotate (422/503/
 * auth) keeps it for retry (the store never holds the draft). The single mutation gate (`busy` =
 * mutating OR the trailing refetch) disables every row's control together.
 */
type Editing = { code: string; value: string } | null;

/** Short, human display of the last-rotation audit (actor uuid truncated; no name resolution). */
function auditLabel(row: MissionRow): string {
  if (!row.redeem_code_updated_at) return "belum dirotasi";
  const when = row.redeem_code_updated_at.slice(0, 10); // YYYY-MM-DD
  const who = row.redeem_code_updated_by ? ` · ${row.redeem_code_updated_by.slice(0, 8)}…` : "";
  return `${when}${who}`;
}

export function MissionContentPanel() {
  const state = useMissionContent((s) => s.state);
  const toast = useMissionContent((s) => s.toast);
  const [editing, setEditing] = useState<Editing>(null);

  if (state.status !== "ready") {
    return (
      <PanelFallback
        status={state.status}
        loadingText="Memuat kode misi…"
        errorText="Tidak dapat memuat kode misi saat ini."
        onRetry={() => missionContentStore.getState().retry()}
      />
    );
  }

  const { rows, refreshing, mutating } = state;
  const busy = mutating !== null || refreshing;

  const onEdit = (row: MissionRow) => setEditing({ code: row.code, value: row.redeem_code });
  const onCancel = () => setEditing(null);

  const onSave = async () => {
    if (!editing || editing.value.trim() === "") return;
    const committed = await missionContentStore.getState().rotate(editing.code, editing.value.trim());
    if (committed) setEditing(null); // keep the draft open on failure
  };

  return (
    <ContentPanelShell title="Kode unlock misi" toast={toast}>
      <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""}`}>
        {rows.length === 0 ? (
          <p className="text-ink-soft">Belum ada misi reallife.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 pr-3">Misi</th>
                <th className="py-1 pr-3">Kode unlock</th>
                <th className="py-1 pr-3">Terakhir dirotasi</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editing?.code === row.code;
                const rotatingThis = mutating?.kind === "rotating" && mutating.code === row.code;
                return (
                  <tr key={row.code} className="border-t border-brown/30 align-top text-ink">
                    <td className="py-1.5 pr-3">
                      <div className="font-mono text-xs">{row.code}</div>
                      <div className="text-xs text-ink-soft">{row.title}</div>
                    </td>
                    <td className="py-1.5 pr-3">
                      {isEditing ? (
                        <input
                          value={editing.value}
                          onChange={(e) => setEditing({ code: row.code, value: e.target.value })}
                          disabled={busy}
                          maxLength={64}
                          aria-label={`Kode unlock untuk ${row.code}`}
                          className="rounded border border-brown bg-cream px-2 py-1 font-mono text-xs text-ink disabled:opacity-60"
                        />
                      ) : (
                        <span className="font-mono text-xs">{row.redeem_code}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-ink-soft">{auditLabel(row)}</td>
                    <td className="py-1.5">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={onSave}
                            disabled={busy || editing.value.trim() === ""}
                            className="rounded bg-forest px-2 py-1 text-xs font-semibold text-cream disabled:opacity-50"
                          >
                            {rotatingThis ? "Menyimpan…" : "Simpan"}
                          </button>
                          <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded border border-brown px-2 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          disabled={busy}
                          className="rounded border border-brown px-2 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
                        >
                          Ubah kode
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ContentPanelShell>
  );
}
