/**
 * Badge / achievement catalog. Status is DERIVED real-time from existing store
 * signals (no persistence) via `isEarned(criteria, ctx)`.
 *
 * Pure data + a pure evaluator: `isEarned` and any criteria must be synchronous
 * and read only `ctx` — no store imports, no Date.now(), no side effects. The
 * BadgeContext is assembled by ProfileModal (which owns levelFromXp) and passed in.
 *
 * `criteria: null` marks a teaser — a badge whose signal doesn't exist yet
 * (e.g. RAT score, simpanan, pinjaman); it always renders locked.
 */

export type BadgeIconKind =
  | "medal"
  | "book"
  | "ticket"
  | "compass"
  | "coin"
  | "flag"
  | "trophy"
  | "piggy"
  | "check";

export type BadgeContext = {
  xp: number;
  level: number;
  point: number;
  completedMissionIds: readonly string[];
  voucherCount: number;
};

export type BadgeCriteria =
  | { kind: "level"; min: number }
  | { kind: "point"; min: number }
  | { kind: "voucherCount"; min: number }
  | { kind: "missionCount"; min: number }
  | { kind: "missionDone"; missionId: string }
  | null; // teaser — signal not trackable yet

export type Badge = {
  id: string;
  title: string;
  requirement: string; // short hint shown while locked (teaser: "Belum tersedia")
  icon: BadgeIconKind;
  criteria: BadgeCriteria;
};

/** Pure: is this badge's criteria satisfied by the current context? */
export function isEarned(criteria: BadgeCriteria, ctx: BadgeContext): boolean {
  if (!criteria) return false;
  switch (criteria.kind) {
    case "level":
      return ctx.level >= criteria.min;
    case "point":
      return ctx.point >= criteria.min;
    case "voucherCount":
      return ctx.voucherCount >= criteria.min;
    case "missionCount":
      return ctx.completedMissionIds.length >= criteria.min;
    case "missionDone":
      return ctx.completedMissionIds.includes(criteria.missionId);
  }
}

export const BADGES: readonly Badge[] = [
  {
    id: "anggota-aktif",
    title: "Anggota Aktif",
    requirement: "Capai Level 3",
    icon: "medal",
    criteria: { kind: "level", min: 3 },
  },
  {
    id: "rajin-kuis",
    title: "Rajin Kuis",
    requirement: "Selesaikan kuis",
    icon: "book",
    criteria: { kind: "missionDone", missionId: "main-kuis" },
  },
  {
    id: "kolektor-voucher",
    title: "Kolektor Voucher",
    requirement: "Tukar 1 voucher",
    icon: "ticket",
    criteria: { kind: "voucherCount", min: 1 },
  },
  {
    id: "penjelajah",
    title: "Penjelajah",
    requirement: "Jelajahi koperasi",
    icon: "compass",
    criteria: { kind: "missionDone", missionId: "keliling" },
  },
  {
    id: "hartawan",
    title: "Hartawan",
    requirement: "Kumpulkan 100 poin",
    icon: "coin",
    criteria: { kind: "point", min: 100 },
  },
  {
    id: "misi-perdana",
    title: "Misi Perdana",
    requirement: "Selesaikan 1 misi",
    icon: "flag",
    criteria: { kind: "missionCount", min: 1 },
  },
  // — Teaser (sinyal belum ada) —
  {
    id: "juara-rat",
    title: "Juara RAT",
    requirement: "Belum tersedia",
    icon: "trophy",
    criteria: null,
  },
  {
    id: "simpanan-rutin",
    title: "Simpanan Rutin",
    requirement: "Belum tersedia",
    icon: "piggy",
    criteria: null,
  },
  {
    id: "pinjaman-lancar",
    title: "Pinjaman Lancar",
    requirement: "Belum tersedia",
    icon: "check",
    criteria: null,
  },
];
