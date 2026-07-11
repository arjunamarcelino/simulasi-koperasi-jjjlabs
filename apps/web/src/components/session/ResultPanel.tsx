import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";
import type { SessionEnded } from "../../session/transport/contract";

const TITLE: Record<SessionEnded["result"]["endingType"], string> = {
  good: "Selesai — Berhasil!",
  bad: "Sesi Berakhir",
  neutral: "Sesi Selesai",
};

/** Shown over the session when it ends. Tutorial only carries narrativeFeedback. */
export function ResultPanel({ ended, onBack }: { ended: SessionEnded; onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <PixelPanel className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto text-center">
        <h2 className="font-display text-sm text-forest md:text-base">
          {TITLE[ended.result.endingType]}
        </h2>
        <p className="whitespace-pre-wrap text-left font-body text-xl leading-snug text-ink">
          {ended.result.narrativeFeedback}
        </p>
        <div className="flex justify-center pt-2">
          <GameButton variant="primary" onClick={onBack}>
            ◀ Kembali ke Kantor Koperasi
          </GameButton>
        </div>
      </PixelPanel>
    </div>
  );
}
