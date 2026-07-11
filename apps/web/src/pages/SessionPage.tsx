import { useEffect, useState } from "react";
import { gameStore, useGameStore } from "../stores/game.store";
import { sessionStore, useSessionStore } from "../stores/session.store";
import { sessionController } from "../session/controller";
import { SCENARIOS } from "../scenarios/scenario.config";
import type { ScenarioId, ConnectionState } from "../session/transport/contract";
import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { TranscriptPanel } from "../components/session/TranscriptPanel";
import { ResultPanel } from "../components/session/ResultPanel";

const PILL: Record<ConnectionState, string> = {
  idle: "bg-cream text-ink-soft",
  connecting: "bg-mustard text-ink",
  connected: "bg-forest text-cream",
  ended: "bg-brown text-cream",
  error: "bg-orange text-cream",
};
const PILL_LABEL: Record<ConnectionState, string> = {
  idle: "Diam",
  connecting: "Menyambungkan…",
  connected: "Tersambung",
  ended: "Selesai",
  error: "Gagal",
};

/**
 * Full-screen voice conversation for a scenario (rendered in the GAME view for
 * voice scenarios). Connecting happens only on the explicit "Mulai Percakapan"
 * gesture (browser audio autoplay + mic unlock); cleanup runs on unmount.
 */
export function SessionPage({ scenarioId }: { scenarioId: ScenarioId }) {
  const connection = useSessionStore((s) => s.connection);
  const agentJoined = useSessionStore((s) => s.agentJoined);
  const micEnabled = useSessionStore((s) => s.micEnabled);
  const ended = useSessionStore((s) => s.ended);
  const error = useSessionStore((s) => s.error);
  const scenarioTitle =
    useGameStore((s) => SCENARIOS.find((sc) => sc.id === s.selectedScenarioId)?.title) ??
    "Skenario";

  const [draft, setDraft] = useState("");

  // Clean slate on mount; tear the session down on unmount (back to hub). The
  // controller's generation token makes StrictMode double-mount safe.
  useEffect(() => {
    sessionStore.getState().reset();
    sessionStore.getState().setScenarioId(scenarioId);
    return () => sessionController.stop();
  }, [scenarioId]);

  const back = () => {
    sessionController.stop();
    gameStore.getState().setView("SCENARIO_SELECTION");
  };
  const start = () => {
    sessionController.startScenario(scenarioId);
    sessionController.unlockAudio();
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sessionController.unlockAudio();
    sessionController.sendPlayerText(text);
    setDraft("");
  };

  if (ended) return <ResultPanel ended={ended} onBack={back} />;

  const Header = (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b-3 border-border bg-cream-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <GameButton variant="ghost" className="!px-4 !py-2 !text-[10px]" onClick={back}>
          ◀ Kembali
        </GameButton>
        <h1 className="font-display text-[11px] leading-tight text-forest md:text-sm">
          {scenarioTitle}
        </h1>
      </div>
      <span className={`border-3 border-border px-3 py-1 font-display text-[9px] ${PILL[connection]}`}>
        {PILL_LABEL[connection]}
      </span>
    </header>
  );

  if (connection === "idle") {
    return (
      <main className="koperasi-bg flex h-screen w-full flex-col overflow-hidden">
        {Header}
        <div className="flex flex-1 items-center justify-center p-4">
          <PixelPanel className="max-w-sm text-center">
            <p className="mb-4 font-body text-xl text-ink-soft">
              Tekan untuk menyapa pelanggan dan mengaktifkan mikrofon.
            </p>
            <GameButton variant="primary" onClick={start}>
              ▶ Mulai Percakapan
            </GameButton>
          </PixelPanel>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="koperasi-bg flex h-screen w-full flex-col overflow-hidden">
        {Header}
        <div className="flex flex-1 items-center justify-center p-4">
          <PixelPanel className="max-w-sm text-center">
            <p className="mb-4 font-body text-xl text-orange">
              Koneksi gagal. Pastikan backend berjalan, atau coba lagi.
            </p>
            <GameButton variant="primary" onClick={start}>
              Coba Lagi
            </GameButton>
          </PixelPanel>
        </div>
      </main>
    );
  }

  const ready = agentJoined;

  return (
    <main className="koperasi-bg relative flex h-screen w-full flex-col overflow-hidden">
      {Header}
      <TranscriptPanel />
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t-3 border-border bg-cream-2 px-4 py-3">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            sessionController.unlockAudio();
            sessionController.toggleMic();
          }}
          className={`pixel-raise active:pixel-press select-none border-3 border-border px-4 py-3 font-display text-[10px] transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
            micEnabled ? "bg-orange text-cream" : "bg-parchment text-ink"
          }`}
        >
          {micEnabled ? "Mic On" : "Mic Off"}
        </button>

        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!ready}
            placeholder={ready ? "Ketik jawaban Anda…" : "Menunggu koneksi…"}
            className="min-w-0 flex-1 border-3 border-border bg-parchment px-3 py-2 font-body text-xl text-ink placeholder:text-ink-soft/60 focus-visible:pixel-focus focus-visible:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!ready || draft.trim() === ""}
            className="pixel-raise active:pixel-press select-none border-3 border-border bg-forest px-4 py-3 font-display text-[10px] text-cream transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kirim
          </button>
        </form>

        <GameButton
          variant="primary"
          className="!px-5 !py-3 !text-[10px]"
          disabled={!ready}
          onClick={() => sessionController.endSession()}
        >
          Bayar &amp; Daftar
        </GameButton>
      </footer>
    </main>
  );
}
