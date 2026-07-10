import { useGameStore, gameStore } from "../../stores/game.store";
import { KOPERASI_ROOMS } from "../../world/rooms.config";
import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";

/**
 * Renders the hub's decision prompts over the Phaser canvas. The full-screen
 * backdrop also blocks pointer events from reaching the canvas while open.
 */
export function HubOverlays() {
  const activeOverlay = useGameStore((s) => s.activeOverlay);
  const selectedRoomId = useGameStore((s) => s.selectedRoomId);

  // Room prompts only — the MADING_* overlays render in their own components.
  const isRoomOverlay =
    activeOverlay === "CONFIRM_ENTER" || activeOverlay === "COMING_SOON";
  if (!isRoomOverlay) return null;

  const room = KOPERASI_ROOMS.find((r) => r.id === selectedRoomId) ?? null;
  const close = () => gameStore.getState().clearSelection();

  // A confirm-enter overlay only proceeds when the room maps to a scenario.
  const confirmScenarioId =
    activeOverlay === "CONFIRM_ENTER" ? (room?.scenarioId ?? null) : null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink/50 p-4"
      onClick={close}
    >
      {/* stop backdrop click-to-close when interacting with the panel */}
      <div onClick={(e) => e.stopPropagation()}>
        <PixelPanel className="max-w-md text-center">
          <h2 className="mb-3 font-display text-base text-forest">
            {room?.label ?? "Ruangan"}
          </h2>

          {confirmScenarioId ? (
            <>
              <p className="mb-6 font-body text-xl text-ink-soft">
                Masuk ke {room?.label} dan mulai skenario Rapat Anggota Tahunan?
              </p>
              <div className="flex justify-center gap-3">
                <GameButton variant="ghost" onClick={close}>
                  Batal
                </GameButton>
                <GameButton
                  variant="primary"
                  onClick={() => gameStore.getState().enterScenario(confirmScenarioId)}
                >
                  Masuk
                </GameButton>
              </div>
            </>
          ) : (
            <>
              <p className="mb-6 font-body text-xl text-ink-soft">
                Ruangan ini masih dalam pengembangan. Segera hadir!
              </p>
              <GameButton variant="primary" onClick={close}>
                Tutup
              </GameButton>
            </>
          )}
        </PixelPanel>
      </div>
    </div>
  );
}
