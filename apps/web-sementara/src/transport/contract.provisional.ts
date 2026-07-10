/* ------------------------------------------------------------------------- *
 * ⚠️  PROVISIONAL — KONTRAK FE↔BE BELUM ADA (lihat PRD Bagian 9).
 *
 * Seluruh isi file ini bersifat sementara dan LOKAL untuk web-sementara.
 * Bentuk payload sebenarnya (data channel LiveKit, response /token, hasil AI
 * Auditor) ditentukan di dokumen kontrak terpisah yang belum disusun.
 *
 * Aturan main sampai dokumen itu turun:
 *   - Jangan pindahkan ke packages/contract.
 *   - Jangan tambahkan zod / validasi skema runtime.
 *   - Anggap file ini sekali pakai; mengganti isinya harus murah.
 * ------------------------------------------------------------------------- */

export type ScenarioId =
  | "tutorial-koperasi-konsumen"
  | "kredit-macet"
  | "keanggotaan-fiktif"
  | "rapat-anggota-tahunan";

export type Speaker = "player" | "npc" | "system";

export type TranscriptItem = {
  id: string;
  speaker: Speaker;
  /** Label persona, misal "Ibu Rumah Tangga". Dihilangkan untuk player/system. */
  name?: string;
  text: string;
  /** True selama teks masih mengalir masuk sepotong demi sepotong. */
  streaming: boolean;
  at: number;
};

/** PRD Bagian 6 Lapisan 2. Tutorial tidak pernah beranjak dari 0. */
export type DriftLevel = 0 | 1 | 2;

/** Fase rapat — khusus Skenario 4 (RAT), PRD §7.4. */
export type Phase = 1 | 2 | 3;

export type PhaseState = {
  phase: Phase;
  /** Label agenda fase kini, mis. "Buka Rapat". */
  label: string;
  /** Label tombol yang memajukan ke fase berikutnya; null di fase terakhir. */
  advanceActionLabel: string | null;
};

/** Tiga jalur berakhirnya sesi — PRD Bagian 6. */
export type FinalDecisionTrigger =
  | "manual"
  | "sinyal_level_1"
  | "force_quit_level_2";

/**
 * Hasil AI Auditor (PRD Bagian 6 Lapisan 3).
 *
 * Untuk tutorial ini payload TERSKRIP, bukan hasil generate gpt-5.4 — PRD 7.1.
 * `stateClassification` dan `scores` dibiarkan kosong di situ, sehingga satu
 * bentuk yang sama melayani tutorial maupun skenario berskor nanti.
 */
export type AuditorResult = {
  scenarioId: ScenarioId;
  trigger: FinalDecisionTrigger;
  stateClassification: Record<string, string>;
  scores: Record<string, number>;
  endingType: "good" | "bad" | "neutral";
  narrativeFeedback: string;
};

export type SessionEnded = {
  trigger: FinalDecisionTrigger;
  result: AuditorResult;
};

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type Unsubscribe = () => void;

/**
 * Satu-satunya titik tukar antara MockTransport (sekarang) dan LiveKitTransport
 * (nanti). Seluruh UI ditulis terhadap interface ini dan tidak mengenal
 * implementasi konkret mana pun — batasan itu ditegakkan oleh ESLint.
 *
 * Event stream memakai pola `subscribe(cb) => unsubscribe` karena itu persis
 * bentuk yang sudah dipakai LiveKit (`room.on`/`room.off`) dan Zustand
 * (`store.subscribe`), jadi kedua implementasi memetakan ke situ tanpa adaptor.
 */
export interface SessionTransport {
  /** Mint token + join room. Resolve begitu sapaan NPC diantrikan. */
  connect(scenarioId: ScenarioId): Promise<void>;

  /** Giliran teks dari pemain — jalur fallback voice (PRD Prinsip 4). */
  sendText(text: string): void;

  /** Toggle mic. No-op di mock; di LiveKit menyalakan track mikrofon. */
  setMicEnabled(enabled: boolean): void;

  onTranscript(cb: (item: TranscriptItem) => void): Unsubscribe;
  onDriftLevel(cb: (level: DriftLevel) => void): Unsubscribe;
  onConnectionState(cb: (state: ConnectionState) => void): Unsubscribe;

  /** Menyala sekali ketika sesi berakhir lewat jalur mana pun. */
  onSessionEnded(cb: (ended: SessionEnded) => void): Unsubscribe;

  /** Pemain mengakhiri sesi. Tombol tutorial mengirim "manual". */
  endSession(trigger?: FinalDecisionTrigger): void;

  /**
   * Alat demo — memaksa level drift. OPSIONAL: hanya MockTransport yang perlu
   * mengimplementasikan; LiveKitTransport tidak (drift-nya datang dari observer
   * asli). UI hanya boleh memanggilnya di mode mock.
   */
  debugSetDrift?(level: DriftLevel): void;

  /**
   * Fase rapat — khusus RAT. OPSIONAL: skenario lain tak punya fase. PRD §9
   * mencantumkan "transisi fase (khusus RAT)" sebagai event data channel masa
   * depan, jadi ini bagian sah dari kontrak, bukan sekadar mekanisme mock.
   */
  onPhase?(cb: (state: PhaseState) => void): Unsubscribe;

  /** Pemain melakukan aksi agenda (mis. "Baca LPJ") untuk maju satu fase. */
  advancePhase?(): void;

  /** Bersihkan room / batalkan seluruh timer. Idempoten. */
  disconnect(): Promise<void>;
}
