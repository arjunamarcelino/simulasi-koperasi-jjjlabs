import { DocumentPanel } from "../components/DocumentPanel";
import { DriftDebug } from "../components/DriftDebug";
import { DriftMeter } from "../components/DriftMeter";
import { FinalDecisionButton } from "../components/FinalDecisionButton";
import { MicButton } from "../components/MicButton";
import { PhaseBar } from "../components/PhaseBar";
import { ResultPanel } from "../components/ResultPanel";
import { TextInputBar } from "../components/TextInputBar";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { getScenarioMeta } from "../scenarios/catalog";
import { SCENARIO_DOCUMENTS } from "../scenarios/documents";
import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";
import type { ConnectionState } from "../transport/contract.provisional";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Diam",
  connecting: "Menyambung…",
  connected: "Tersambung",
  ended: "Selesai",
  error: "Gagal",
};

export function SessionView() {
  const scenarioId = useSessionStore((s) => s.scenarioId);
  const connection = useSessionStore((s) => s.connection);
  const driftLevel = useSessionStore((s) => s.driftLevel);
  const phase = useSessionStore((s) => s.phase);
  const ended = useSessionStore((s) => s.ended);
  const error = useSessionStore((s) => s.error);

  const meta = getScenarioMeta(scenarioId);
  const doc = SCENARIO_DOCUMENTS[scenarioId];
  // Dokumen tampil: skenario non-fase (Keanggotaan Fiktif) kapan saja; RAT hanya
  // di Fase 3 (Ambil Keputusan), sesuai PRD §7.4.
  const showDocuments = Boolean(doc) && (!phase || phase.phase === 3);

  return (
    <div className="relative mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={sessionController.leaveToMenu}
            className="rounded-lg border border-line bg-parchment px-3 py-1 text-sm"
          >
            ← Menu
          </button>
          <div>
            <h1 className="text-lg font-bold">{meta.title}</h1>
            <p className="text-sm text-ink-soft">
              {meta.npcName ? `NPC: ${meta.npcName} · ` : ""}transport:{" "}
              <code>{import.meta.env.VITE_TRANSPORT ?? "mock"}</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <DriftMeter />
          <span className="rounded-full border border-line px-3 py-1 text-sm">
            {CONNECTION_LABEL[connection]}
          </span>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-orange bg-orange/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {phase && <PhaseBar />}

      {driftLevel >= 1 && !ended && (
        <p className="rounded-lg border border-orange bg-orange/10 px-3 py-2 text-sm">
          Ketegangan meningkat. Pertimbangkan mengambil Keputusan Akhir sekarang
          — atau turunkan nada bicara untuk memperbaiki keadaan.
        </p>
      )}

      <TranscriptPanel />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DriftDebug />
        {showDocuments && doc && <DocumentPanel doc={doc} />}
      </div>

      <footer className="flex flex-wrap items-center gap-2">
        <MicButton />
        <TextInputBar />
        <FinalDecisionButton />
      </footer>

      {ended && <ResultPanel ended={ended} />}
    </div>
  );
}
