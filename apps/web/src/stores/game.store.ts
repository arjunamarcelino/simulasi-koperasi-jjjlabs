import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";

/**
 * The four top-level views. This union is the single source of truth for
 * navigation and is checked exhaustively in App.tsx.
 */
export type View = "MAIN_MENU" | "SCENARIO_SELECTION" | "GAME" | "EVALUATION";

export type GameState = {
  currentView: View;
  setView: (view: View) => void;
};

/**
 * Vanilla Zustand store — the single bridge between React and Phaser.
 *
 * - React reads via the `useGameStore` selector hook (below).
 * - Plain TS / future Phaser scenes read & write via the vanilla API:
 *     gameStore.getState().setView("EVALUATION")
 *     gameStore.subscribe(s => s.currentView, view => { ... })
 *
 * Store serializable data only — never put Phaser GameObjects here.
 */
export const gameStore = createStore<GameState>()(
  subscribeWithSelector((set) => ({
    currentView: "MAIN_MENU",
    setView: (view) => set({ currentView: view }),
  })),
);

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
