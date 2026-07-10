import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";
import type { ScenarioId } from "../transport/contract.provisional";

/**
 * PRD 7.1 menyebut sinyal selesai tutorial adalah "Bayar & Daftar"; skenario
 * lain memakai "Keputusan Akhir" (PRD Bagian 6 jalur 1).
 */
const LABEL: Record<ScenarioId, string> = {
  "tutorial-koperasi-konsumen": "Bayar & Daftar",
  "kredit-macet": "Keputusan Akhir",
  "keanggotaan-fiktif": "Keputusan Akhir",
  "rapat-anggota-tahunan": "Keputusan Akhir",
};

export function FinalDecisionButton() {
  const scenarioId = useSessionStore((s) => s.scenarioId);
  const connected = useSessionStore((s) => s.connection === "connected");
  // Level 1 (PRD §6): pemain didorong mengakhiri, tapi keputusan tetap di
  // tangannya — jadi tombolnya ditonjolkan, bukan dipaksa.
  const nudged = useSessionStore((s) => s.driftLevel >= 1);

  return (
    <button
      type="button"
      disabled={!connected}
      onClick={sessionController.endSession}
      className={`rounded-lg bg-mustard px-4 py-2 font-semibold text-ink disabled:opacity-40 ${
        nudged ? "ring-2 ring-orange ring-offset-2 ring-offset-cream" : ""
      }`}
      title={
        nudged ? "Ketegangan tinggi — pertimbangkan mengakhiri sekarang." : undefined
      }
    >
      {LABEL[scenarioId]}
    </button>
  );
}
