import { useGameStore, gameStore } from "../../stores/game.store";
import {
  KOPERASI_ROOMS,
  ROOM_SCENARIO_CHOICES,
  type RoomScenarioChoice,
} from "../../world/rooms.config";
import { SCENARIOS } from "../../scenarios/scenario.config";
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

  // Rooms that offer a CHOICE of scenarios show a picker (RAT vs Keanggotaan
  // Fiktif) instead of the single confirm.
  const choices =
    activeOverlay === "CONFIRM_ENTER" && room ? ROOM_SCENARIO_CHOICES[room.id] : undefined;

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

          {choices ? (
            <>
              <p className="mb-4 font-body text-xl text-ink-soft">
                Pilih simulasi yang ingin kamu jalankan:
              </p>
              <div className="flex flex-col gap-2">
                {choices.map((choice) => (
                  <ScenarioChoiceCard key={choice.scenarioId} choice={choice} />
                ))}
              </div>
              <div className="mt-4 flex justify-center">
                <GameButton variant="ghost" onClick={close}>
                  Batal
                </GameButton>
              </div>
            </>
          ) : confirmScenarioId ? (
            <>
              <p className="mb-6 font-body text-xl text-ink-soft">
                Masuk ke {room?.label} dan mulai skenario ini?
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

/**
 * One scenario option inside a room's picker. Enabled cards launch via the
 * choice's `launch` mode ("session" → in-map SESSION overlay; "game" → GAME view);
 * a COMING_SOON scenario renders locked. The panel wrapper already stops click
 * propagation, so a card click can't also fire the backdrop close.
 */
function ScenarioChoiceCard({ choice }: { choice: RoomScenarioChoice }) {
  const scenario = SCENARIOS.find((s) => s.id === choice.scenarioId);
  if (!scenario) return null;
  const locked = scenario.status !== "AVAILABLE";

  const launch = () => {
    if (locked) return;
    const store = gameStore.getState();
    if (choice.launch === "session") store.enterSessionScenario(choice.scenarioId);
    else store.enterScenario(choice.scenarioId);
  };

  return (
    <button
      type="button"
      onClick={launch}
      disabled={locked}
      className="pixel-raise active:pixel-press flex flex-col gap-1 border-3 border-border bg-cream px-4 py-3 text-left transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-display text-[11px] text-forest">{scenario.title}</span>
        <span className="font-display text-[8px] text-ink-soft">
          {locked ? "Segera Hadir" : scenario.difficulty}
        </span>
      </span>
      <span className="font-body text-base leading-snug text-ink-soft">
        {scenario.shortDescription}
      </span>
    </button>
  );
}
