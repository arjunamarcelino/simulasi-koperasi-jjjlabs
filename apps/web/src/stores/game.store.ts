import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import { KOPERASI_ROOMS } from "../world/rooms.config";

/**
 * The four top-level views. This union is the single source of truth for
 * navigation and is checked exhaustively in App.tsx.
 */
export type View =
  | "MAIN_MENU"
  | "LOADING"
  | "SCENARIO_SELECTION"
  | "GAME"
  | "EVALUATION";

/** Which React overlay (if any) is shown over the hub canvas. */
export type OverlayKind = "NONE" | "CONFIRM_ENTER" | "COMING_SOON";

export type GameState = {
  currentView: View;
  /** Hub room selection + overlay (serializable; Phaser owns scene transitions). */
  selectedRoomId: string | null;
  activeOverlay: OverlayKind;
  /** Set on entering a scenario; read by GamePage after the view switch. */
  selectedScenarioId: string | null;

  setView: (view: View) => void;
  selectRoom: (roomId: string) => void;
  clearSelection: () => void;
  enterScenario: (scenarioId: string) => void;
};

/**
 * Vanilla Zustand store — the single bridge between React and Phaser.
 *
 * - React reads via the `useGameStore` selector hook (below).
 * - Plain TS / Phaser scenes push via the vanilla API:
 *     gameStore.getState().selectRoom("ruang-meeting")
 *
 * Store serializable data only — never put Phaser GameObjects here.
 */
export const gameStore = createStore<GameState>()(
  subscribeWithSelector((set, get) => ({
    currentView: "MAIN_MENU",
    selectedRoomId: null,
    activeOverlay: "NONE",
    selectedScenarioId: null,

    // Reset transient hub state on any view change so re-entering the hub is clean.
    setView: (view) =>
      set({ currentView: view, activeOverlay: "NONE", selectedRoomId: null }),

    // No-op while an overlay is open (movement-later key-spam safety).
    selectRoom: (roomId) => {
      if (get().activeOverlay !== "NONE") return;
      const room = KOPERASI_ROOMS.find((r) => r.id === roomId);
      if (!room) return;
      set({
        selectedRoomId: roomId,
        activeOverlay: room.status === "AVAILABLE" ? "CONFIRM_ENTER" : "COMING_SOON",
      });
    },

    clearSelection: () => set({ selectedRoomId: null, activeOverlay: "NONE" }),

    enterScenario: (scenarioId) =>
      set({
        selectedScenarioId: scenarioId,
        currentView: "GAME",
        activeOverlay: "NONE",
        selectedRoomId: null,
      }),
  })),
);

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
