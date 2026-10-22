import { useEffect, useState } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { leaderboardRepo, type LeaderboardRow, type RepoResult } from "../../lib/leaderboardRepo";
import { ModalShell } from "../common/ModalShell";

/**
 * The koperasi "Papan Juara": the in-game mading leaderboard. Reads the latest
 * season snapshot (top 20) from public.leaderboard_current() via leaderboardRepo and
 * renders rank / name / xp / level. The snapshot is display-name only — no user_id is
 * ever requested or shown.
 *
 * Presentation is split into a pure `LeaderboardMadingBody` (branches every RepoResult
 * variant + the pre-fetch loading state) so the full matrix is unit-testable without a
 * DOM, while the container owns the store gate + fetch lifecycle.
 */

/** Pure view: `null` = still loading. Each RepoResult variant maps to its own state —
 * `degraded` (offline) and `invalid`/`rpcError` (error) are kept distinct from the
 * `ok` empty state ("no season yet"), per the mading contract. */
export function LeaderboardMadingBody({
  result,
}: {
  result: RepoResult<LeaderboardRow[]> | null;
}) {
  if (result === null) {
    return (
      <p className="py-8 text-center font-body text-xl text-ink-soft" aria-live="polite">
        Memuat papan juara…
      </p>
    );
  }

  if (result.status === "degraded") {
    return (
      <p className="py-8 text-center font-body text-xl text-ink-soft">
        Papan juara tidak tersedia saat luring. Sambungkan internet untuk melihat peringkat.
      </p>
    );
  }

  if (result.status === "rpcError" || result.status === "invalid") {
    return (
      <p className="py-8 text-center font-body text-xl text-ink-soft">
        Gagal memuat papan juara. Coba lagi nanti.
      </p>
    );
  }

  // status === "ok"
  if (result.data.length === 0) {
    return (
      <p className="py-8 text-center font-body text-xl text-ink-soft">
        Papan musim belum tersedia
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-3 border-border">
      <table className="w-full border-collapse font-body text-lg md:text-xl">
        <thead>
          <tr>
            <th className="border-b-3 border-border bg-forest px-3 py-2 text-right font-display text-[10px] text-parchment md:text-xs">
              #
            </th>
            <th className="border-b-3 border-border bg-forest px-3 py-2 text-left font-display text-[10px] text-parchment md:text-xs">
              Anggota
            </th>
            <th className="border-b-3 border-border bg-forest px-3 py-2 text-right font-display text-[10px] text-parchment md:text-xs">
              XP
            </th>
            <th className="border-b-3 border-border bg-forest px-3 py-2 text-right font-display text-[10px] text-parchment md:text-xs">
              Level
            </th>
          </tr>
        </thead>
        <tbody className="[&_tr:nth-child(even)]:bg-parchment [&_tr:nth-child(odd)]:bg-cream-2">
          {result.data.map((row) => (
            <tr key={row.rank}>
              <td className="whitespace-nowrap border-b border-line px-3 py-1.5 text-right font-display text-[11px] text-forest tabular-nums">
                {row.rank}
              </td>
              <td className="border-b border-line px-3 py-1.5 text-left">{row.display_name}</td>
              <td className="whitespace-nowrap border-b border-line px-3 py-1.5 text-right tabular-nums">
                {row.xp}
              </td>
              <td className="whitespace-nowrap border-b border-line px-3 py-1.5 text-right tabular-nums">
                {row.level}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Container: store-gated overlay that fetches the latest snapshot on open. Mirrors the
 * sibling mading boards (ModalShell + `activeOverlay` gate + clearSelection close). */
export function LeaderboardMading() {
  const active = useGameStore((s) => s.activeOverlay === "MADING_LEADERBOARD");
  const [result, setResult] = useState<RepoResult<LeaderboardRow[]> | null>(null);

  // Fetch each time the board opens; drop a late resolve after close (alive latch) so a
  // slow RPC can't paint into a reopened/closed overlay.
  useEffect(() => {
    if (!active) {
      setResult(null);
      return;
    }
    let alive = true;
    void leaderboardRepo.current().then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [active]);

  if (!active) return null;

  const close = () => gameStore.getState().clearSelection();

  return (
    <ModalShell titleId="mading-leaderboard-title" onClose={close} panelClassName="w-full max-w-lg">
      <header className="mb-4 text-center">
        <h2
          id="mading-leaderboard-title"
          className="font-display text-sm text-forest md:text-base"
        >
          Papan Juara Musim Ini
        </h2>
        <p className="mt-1 font-body text-lg text-ink-soft">Peringkat XP 20 anggota teratas</p>
      </header>
      <LeaderboardMadingBody result={result} />
    </ModalShell>
  );
}
