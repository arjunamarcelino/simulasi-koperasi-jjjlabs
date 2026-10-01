import { useState } from "react";
import { LEVELS } from "@simkop/catalog";
import { useGameStore, gameStore } from "../../stores/game.store";
import { useAuth, authStore, MAX_NAME } from "../../stores/auth.store";
import { KOPERASI_IDENTITAS } from "../../content/mading-info";
import { BADGES, isEarned, type BadgeContext } from "../../content/badges";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";
import { BadgeIcon } from "./BadgeIcon";
import { SessionHistoryTab } from "./SessionHistoryTab";

type ProfileTab = "profil" | "badge" | "riwayat";
const TAB_LABELS: Record<ProfileTab, string> = { profil: "Profil", badge: "Badge", riwayat: "Riwayat" };

/**
 * Level derivation. Tiers (title + XP threshold, ascending, first tier at 0) are
 * sourced from the shared `@simkop/catalog` so the FE and the DB's `level_from_xp()`
 * stay pinned to one threshold table.
 */
function levelFromXp(xp: number): {
  index: number;
  title: string;
  floor: number;
  nextXp: number | null;
} {
  const safeXp = Math.max(0, xp);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safeXp >= LEVELS[i]!.minXp) index = i;
    else break;
  }
  const level = LEVELS[index]!;
  const next = LEVELS[index + 1] ?? null;
  return { index, title: level.title, floor: level.minXp, nextXp: next ? next.minXp : null };
}

/** Player profile: name, level/title, XP progress, Point, koperasi membership,
 * plus the Google upgrade / sign-out affordances. */
export function ProfileModal() {
  const xp = useGameStore((s) => s.xp);
  const point = useGameStore((s) => s.point);
  const voucherCount = useGameStore((s) => s.redeemedVouchers.length);
  const completedMissionIds = useGameStore((s) => s.completedMissionIds);
  // Name + auth state come from auth.store (profiles.display_name); the game.store
  // playerName is only a Phaser-facing mirror of the same value.
  const displayName = useAuth((s) => s.auth.profile?.display_name ?? null);
  const authStatus = useAuth((s) => s.auth.status);
  const canEditName = authStatus === "guest" || authStatus === "authenticated";

  const [tab, setTab] = useState<ProfileTab>("profil");
  // Riwayat lazy-loads on first open, then stays mounted (CSS-hidden) so toggling tabs
  // doesn't re-fetch / flicker. The modal unmounts on close, so each open re-fetches.
  const [openedRiwayat, setOpenedRiwayat] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const selectTab = (t: ProfileTab) => {
    setTab(t);
    if (t === "riwayat") setOpenedRiwayat(true);
  };

  const close = () => gameStore.getState().clearSelection();
  const startEdit = () => {
    setNameDraft(displayName ?? "");
    setEditingName(true);
  };
  const saveName = () => {
    // setDisplayName is the authoritative validator (trim + clamp + empty no-op).
    void authStore.getState().setDisplayName(nameDraft);
    setEditingName(false);
  };
  const signInGoogle = () => {
    void (async () => {
      const result = await authStore.getState().linkGoogle();
      // Collision: this Google account already exists → sign into it directly
      // (guest data is dropped, per the settled decision).
      if (!result.ok && result.reason === "collision") {
        await authStore.getState().signInWithGoogle();
      }
    })();
  };
  const signOut = () => {
    void authStore.getState().signOut();
  };

  const { index, title, floor, nextXp } = levelFromXp(xp);
  const maxed = nextXp === null;
  const pct = maxed ? 100 : Math.round(((xp - floor) / (nextXp - floor)) * 100);

  // Assembled here (owns levelFromXp) and passed to pure badge predicates.
  const ctx: BadgeContext = { xp, level: index + 1, point, completedMissionIds, voucherCount };

  return (
    <ModalShell titleId="profile-title" onClose={close} panelClassName="w-full max-w-lg">
      <h2 id="profile-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Profil Anggota
      </h2>

      <div role="tablist" aria-label="Bagian profil" className="mb-4 flex gap-2">
        {(["profil", "badge", "riwayat"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => selectTab(t)}
            className={`flex-1 border-3 border-border px-3 py-2 font-display text-[10px] focus-visible:pixel-focus focus-visible:outline-none ${
              tab === t
                ? "pixel-press bg-forest text-cream"
                : "pixel-raise bg-cream-2 text-forest hover:bg-parchment"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "badge" && (
        <div className="grid grid-cols-3 gap-3">
          {BADGES.map((badge) => {
            const earned = isEarned(badge.criteria, ctx);
            return (
              <div
                key={badge.id}
                className="flex flex-col items-center gap-1 text-center"
                aria-label={`${badge.title} — ${earned ? "tercapai" : badge.requirement}`}
              >
                <div className="flex h-14 w-14 items-center justify-center border-3 border-border bg-mustard">
                  <div className={earned ? "" : "grayscale opacity-60"}>
                    <BadgeIcon kind={badge.icon} />
                  </div>
                </div>
                <p className="font-display text-[9px] leading-tight text-ink">{badge.title}</p>
                <p
                  className={`font-body text-[13px] leading-none ${
                    earned ? "text-forest" : "text-ink-soft"
                  }`}
                >
                  {earned ? "✓ Tercapai" : badge.requirement}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {tab === "profil" && (
        <>
      <div className="mb-5 flex items-center gap-4 border-3 border-border bg-cream px-4 py-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center border-3 border-border bg-mustard">
          <svg viewBox="0 0 16 16" width="40" height="40" shapeRendering="crispEdges" aria-hidden="true">
            <rect x="1" y="3" width="14" height="10" fill="#F4E6C8" stroke="#2B2016" strokeWidth="1" />
            <rect x="2" y="4" width="5" height="5" fill="#1F5D3A" />
            <rect x="3" y="5" width="2" height="2" fill="#D9A521" />
            <rect x="3" y="7" width="3" height="2" fill="#D9A521" />
            <rect x="8" y="5" width="5" height="1" fill="#7A4E2D" />
            <rect x="8" y="7" width="5" height="1" fill="#7A4E2D" />
            <rect x="8" y="9" width="3" height="1" fill="#7A4E2D" />
            <rect x="2" y="11" width="11" height="1" fill="#1F5D3A" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={nameDraft}
                maxLength={MAX_NAME}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  else if (e.key === "Escape") setEditingName(false);
                }}
                aria-label="Nama pemain"
                placeholder="Nama kamu"
                className="w-full border-3 border-border bg-parchment px-2 py-1 font-body text-lg text-ink focus:outline-none focus-visible:pixel-focus"
              />
              <button
                type="button"
                onClick={saveName}
                aria-label="Simpan nama"
                className="pixel-raise active:pixel-press shrink-0 bg-forest px-2 py-1 font-display text-[9px] text-cream focus-visible:pixel-focus focus-visible:outline-none"
              >
                OK
              </button>
            </div>
          ) : canEditName ? (
            <button
              type="button"
              onClick={startEdit}
              aria-label="Ubah nama"
              className="group flex max-w-full items-center gap-1 focus-visible:outline-none"
            >
              <span className="truncate font-display text-xs text-ink">{displayName ?? "Tamu"}</span>
              <span aria-hidden className="font-body text-base text-ink-soft group-hover:text-forest">
                ✎
              </span>
            </button>
          ) : (
            <p className="truncate font-display text-xs text-ink">{displayName ?? "Tamu"}</p>
          )}
          <span className="mt-2 inline-block border-2 border-border bg-forest px-2 py-0.5 font-display text-[9px] text-cream">
            Lv {index + 1} · {title}
          </span>
        </div>
      </div>

      {/* Level progress */}
      <div className="mb-2 flex items-center justify-between font-display text-[9px] text-ink-soft">
        <span>Level {index + 1}</span>
        <span>{maxed ? "MAX" : `${xp} / ${nextXp} XP`}</span>
      </div>
      <div
        className="mb-5 h-4 w-full overflow-hidden border-3 border-border bg-cream"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${maxed ? "bg-mustard" : "bg-forest"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="border-3 border-border bg-forest px-3 py-2 text-center">
          <p className="font-display text-base text-mustard">{xp}</p>
          <p className="mt-1 font-display text-[8px] text-cream/80">Total XP</p>
        </div>
        <div className="border-3 border-border bg-cream px-3 py-2 text-center">
          <p className="font-display text-base text-forest">{point}</p>
          <p className="mt-1 font-display text-[8px] text-ink-soft">Poin</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t-2 border-line pt-4 font-body text-lg">
        <span className="min-w-0 truncate text-right text-ink">{KOPERASI_IDENTITAS.nama}</span>
      </div>
      <p className="mt-1 text-right font-body text-base text-ink-soft">
        {voucherCount} voucher ditukar
      </p>

      {/* Auth: guests upgrade to Google (keeps progress); members can sign out.
          Degraded/loading shows nothing (no Supabase env). */}
      {authStatus === "guest" && (
        <div className="mt-5 border-t-2 border-line pt-4">
          <GameButton variant="primary" onClick={signInGoogle} className="w-full">
            Masuk dengan Google
          </GameButton>
          <p className="mt-2 text-center font-body text-base text-ink-soft/80">
            Simpan progres & lanjut main di perangkat lain.
          </p>
        </div>
      )}
      {authStatus === "authenticated" && (
        <div className="mt-5 border-t-2 border-line pt-4">
          <GameButton variant="ghost" onClick={signOut} className="w-full">
            Keluar
          </GameButton>
        </div>
      )}
        </>
      )}
      {openedRiwayat && (
        <div role="tabpanel" className={tab === "riwayat" ? "" : "hidden"}>
          <SessionHistoryTab active={tab === "riwayat"} />
        </div>
      )}
    </ModalShell>
  );
}
