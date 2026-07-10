import { gameStore } from "../../stores/game.store";
import { GameButton } from "../common/GameButton";

/** Persistent chrome over the hub canvas. */
export function HubHud() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute right-4 top-4">
        <GameButton
          variant="ghost"
          onClick={() => gameStore.getState().setView("MAIN_MENU")}
        >
          ◀ Keluar
        </GameButton>
      </div>
    </div>
  );
}
