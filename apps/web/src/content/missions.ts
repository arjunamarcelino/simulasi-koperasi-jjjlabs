/**
 * Mission catalog — two kinds:
 *  - game: in-game objective, claimed manually (honor-system button).
 *  - reallife: real-world task, claimed by entering a code (soft gate — the code
 *    lives here client-side, readable in source; in a real deployment it would be
 *    printed at the KDMP). Demo codes are documented in the plan.
 *
 * Discriminated union so a real-life mission MUST carry a code (compile error
 * otherwise). All content is placeholder — edit freely.
 */

export type MissionKind = "game" | "reallife";
export type MissionReward = { xp: number; point: number };

type MissionBase = {
  id: string;
  title: string;
  description: string;
  reward: MissionReward;
};

export type GameMission = MissionBase & { kind: "game" };
export type RealLifeMission = MissionBase & { kind: "reallife"; code: string };
export type Mission = GameMission | RealLifeMission;

export const MISSIONS: readonly Mission[] = [
  // — Game (klaim manual) —
  {
    id: "main-kuis",
    kind: "game",
    title: "Main Kuis Koperasi",
    description: "Selesaikan satu sesi kuis koperasi di komputer KUIS.",
    reward: { xp: 20, point: 20 },
  },
  {
    id: "baca-mading",
    kind: "game",
    title: "Baca Papan Pengetahuan",
    description: "Buka papan pengetahuan di mading dekat pintu masuk.",
    reward: { xp: 15, point: 10 },
  },
  {
    id: "tukar-voucher",
    kind: "game",
    title: "Tukar Satu Voucher",
    description: "Tukar satu voucher dengan poin di kasir.",
    reward: { xp: 15, point: 15 },
  },
  {
    id: "keliling",
    kind: "game",
    title: "Kelilingi Interior Koperasi",
    description: "Masuk dan jelajahi seluruh ruangan koperasi.",
    reward: { xp: 10, point: 10 },
  },
  // — Real-Life (masukkan kode) —
  {
    id: "kunjungi-kdmp",
    kind: "reallife",
    title: "Kunjungi KDMP",
    description: "Kunjungi satu Koperasi Desa Merah Putih terdekat, lalu masukkan kode yang tertera di sana.",
    reward: { xp: 50, point: 100 },
    code: "KDMP2026",
  },
  {
    id: "impact-umkm",
    kind: "reallife",
    title: "Koperasi Impact Mission",
    description: "Cari satu produk UMKM lokal dan beli melalui koperasi, lalu masukkan kode dari struk.",
    reward: { xp: 60, point: 120 },
    code: "UMKM2026",
  },
  {
    id: "ajak-anggota",
    kind: "reallife",
    title: "Ajak Anggota Baru",
    description: "Ajak satu orang mendaftar menjadi anggota koperasi, lalu masukkan kode konfirmasi.",
    reward: { xp: 40, point: 80 },
    code: "ANGGOTA2026",
  },
];

/** Type guard for the persisted list of completed mission ids. */
export function isStringArray(u: unknown): u is string[] {
  return Array.isArray(u) && u.every((x) => typeof x === "string");
}
