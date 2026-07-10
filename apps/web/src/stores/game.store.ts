import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import { KOPERASI_ROOMS } from "../world/rooms.config";
import { loadNumber, saveNumber, loadJson, saveJson } from "./persist";
import {
  VOUCHERS,
  isRedeemedVoucherArray,
  type RedeemedVoucher,
} from "../content/vouchers";
import { MISSIONS, isStringArray, type MissionReward } from "../content/missions";

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

/**
 * Which React overlay (if any) is shown over the hub canvas. The non-NONE values
 * partition cleanly across self-guarding components: HubOverlays renders the room
 * prompts (CONFIRM_ENTER / COMING_SOON), MadingInfoBoard renders MADING_INFO,
 * MadingDataBoard renders MADING_DATA, MadingKnowledgeBoard renders MADING_KNOWLEDGE,
 * QuizBoard renders QUIZ, KasirVoucherBoard renders KASIR_VOUCHER, ProfileModal
 * renders PROFILE, MissionBoard renders MISSION.
 */
export type OverlayKind =
  | "NONE"
  | "CONFIRM_ENTER"
  | "COMING_SOON"
  | "MADING_INFO"
  | "MADING_DATA"
  | "MADING_KNOWLEDGE"
  | "QUIZ"
  | "KASIR_VOUCHER"
  | "PROFILE"
  | "MISSION";

/** Result of completeMission — carries the granted reward on success. */
export type MissionResult =
  | { ok: true; reward: MissionReward }
  | { ok: false; reason: "already" | "wrong-code" | "unknown" };

const NAME_STORAGE_KEY = "koperasi.playerName";
const XP_STORAGE_KEY = "koperasi.xp";
const POINT_STORAGE_KEY = "koperasi.point";
const VOUCHERS_STORAGE_KEY = "koperasi.vouchers";
const MISSION_STORAGE_KEY = "koperasi.missions";

/** Trim + case-insensitive on both sides so "kdmp2026 " matches "KDMP2026". */
function codeMatches(expected: string, input?: string): boolean {
  return input != null && input.trim().toLowerCase() === expected.trim().toLowerCase();
}

function loadPlayerName(): string | null {
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Short mock voucher code, e.g. "KDMP-7X2A". Cosmetic only. */
function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `KDMP-${s}`;
}

export type GameState = {
  currentView: View;
  /** Player name (frontend only, persisted to localStorage). Null until entered. */
  playerName: string | null;
  /** Hub room selection + overlay (serializable; Phaser owns scene transitions). */
  selectedRoomId: string | null;
  activeOverlay: OverlayKind;
  /** Set on entering a scenario; read by GamePage after the view switch. */
  selectedScenarioId: string | null;
  /** Which hub scene Phaser is showing (drives the top-right exit affordance). */
  activeHubScene: "Village" | "KoperasiInterior";
  /** React→Phaser signal: leave the koperasi interior back to the village. */
  koperasiExitRequested: boolean;
  /** Trivia shown on a brief loading overlay during enter/exit; null = hidden. */
  sceneLoading: string | null;
  /** Active slide of the mading data carousel (only meaningful under MADING_DATA). */
  madingIndex: number;
  /**
   * Wall-clock (performance.now) until which the scene must ignore the E key.
   * Stamped by clearSelection on every overlay close so a still-held / just-pressed
   * E can't leak into a station's fire() the instant an overlay closes. 0 = free.
   */
  interactSuppressedUntil: number;
  /** Persisted wallet: XP (drives level, never spent), Point (spent on vouchers). */
  xp: number;
  point: number;
  redeemedVouchers: RedeemedVoucher[];
  /** Ids of missions already completed (persisted). Membership = "done". */
  completedMissionIds: string[];

  setView: (view: View) => void;
  setPlayerName: (name: string) => void;
  selectRoom: (roomId: string) => void;
  clearSelection: () => void;
  enterScenario: (scenarioId: string) => void;
  setActiveHubScene: (scene: "Village" | "KoperasiInterior") => void;
  requestKoperasiExit: () => void;
  consumeKoperasiExit: () => void;
  showSceneLoading: (text: string) => void;
  hideSceneLoading: () => void;
  /** Open the sticky-note info board (no-op if another overlay is already open). */
  openMadingInfo: () => void;
  /** Open the data carousel at slide 0 (no-op if another overlay is already open). */
  openMadingData: () => void;
  /** Open the knowledge carousel at card 0 (no-op if another overlay is open). */
  openMadingKnowledge: () => void;
  /** Jump to an absolute carousel slide/card; wrap math lives with the caller/content. */
  setMadingIndex: (index: number) => void;
  /** Open the quiz (no-op if another overlay is already open). */
  openQuiz: () => void;
  /** Open the kasir voucher catalog (no-op if another overlay is open). */
  openKasirVoucher: () => void;
  /** Open the player profile modal (no-op if another overlay is open). */
  openProfile: () => void;
  /** Bank quiz rewards once (deltas clamped ≥ 0). Persists xp + point. */
  addQuizRewards: (reward: { xp: number; point: number }) => void;
  /**
   * Redeem a voucher by id. Re-reads live point/cost as the authoritative gate
   * (the button's disabled state lags a frame). Returns the redeemed voucher
   * (carrying its fresh code) on success, or null if unknown / not affordable.
   */
  redeemVoucher: (voucherId: string) => RedeemedVoucher | null;
  /** Open the mission overlay (no-op if another overlay is already open). */
  openMission: () => void;
  /**
   * Complete a mission (one-time). Live-reads completedMissionIds as the gate;
   * real-life missions require a matching code. Banks the reward + persists in a
   * single flat transaction. Returns the reward on success, else a failure reason.
   */
  completeMission: (missionId: string, code?: string) => MissionResult;
};

/** How long (ms) the scene ignores E after an overlay closes — see interactSuppressedUntil. */
const INTERACT_SUPPRESS_MS = 250;

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
    playerName: loadPlayerName(),
    selectedRoomId: null,
    activeOverlay: "NONE",
    selectedScenarioId: null,
    activeHubScene: "Village",
    koperasiExitRequested: false,
    sceneLoading: null,
    madingIndex: 0,
    interactSuppressedUntil: 0,
    xp: Math.max(0, loadNumber(XP_STORAGE_KEY, 0)),
    point: Math.max(0, loadNumber(POINT_STORAGE_KEY, 0)),
    redeemedVouchers: loadJson<RedeemedVoucher[]>(
      VOUCHERS_STORAGE_KEY,
      [],
      isRedeemedVoucherArray,
    ),
    completedMissionIds: loadJson<string[]>(MISSION_STORAGE_KEY, [], isStringArray),

    // Reset transient hub state on any view change so re-entering the hub is clean.
    setView: (view) =>
      set({ currentView: view, activeOverlay: "NONE", selectedRoomId: null }),

    setPlayerName: (name) => {
      const clean = name.trim().slice(0, 16);
      try {
        window.localStorage.setItem(NAME_STORAGE_KEY, clean);
      } catch {
        // ignore (storage unavailable)
      }
      set({ playerName: clean });
    },

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

    // Closes any hub overlay (room prompts + mading boards). Stamps a brief E
    // suppression window so the key can't re-trigger a station on the close frame.
    clearSelection: () =>
      set({
        selectedRoomId: null,
        activeOverlay: "NONE",
        interactSuppressedUntil: performance.now() + INTERACT_SUPPRESS_MS,
      }),

    enterScenario: (scenarioId) =>
      set({
        selectedScenarioId: scenarioId,
        currentView: "GAME",
        activeOverlay: "NONE",
        selectedRoomId: null,
      }),

    setActiveHubScene: (scene) =>
      set({ activeHubScene: scene, koperasiExitRequested: false }),
    requestKoperasiExit: () => set({ koperasiExitRequested: true }),
    consumeKoperasiExit: () => set({ koperasiExitRequested: false }),
    showSceneLoading: (text) => set({ sceneLoading: text }),
    hideSceneLoading: () => set({ sceneLoading: null }),

    // Mading boards. Guarded like selectRoom so an overlay can't stack on another.
    openMadingInfo: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "MADING_INFO" });
    },
    openMadingData: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "MADING_DATA", madingIndex: 0 });
    },
    openMadingKnowledge: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "MADING_KNOWLEDGE", madingIndex: 0 });
    },
    setMadingIndex: (index) => set({ madingIndex: index }),

    // Quiz / kasir / profile overlays — guarded like the mading opens. Closed via
    // clearSelection (stamps the E-suppression window), never set() directly.
    openQuiz: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "QUIZ" });
    },
    openKasirVoucher: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "KASIR_VOUCHER" });
    },
    openProfile: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "PROFILE" });
    },

    // Wallet. In-memory is authoritative; persist is best-effort (try/catch).
    addQuizRewards: ({ xp, point }) => {
      const nextXp = get().xp + Math.max(0, xp);
      const nextPoint = get().point + Math.max(0, point);
      saveNumber(XP_STORAGE_KEY, nextXp);
      saveNumber(POINT_STORAGE_KEY, nextPoint);
      set({ xp: nextXp, point: nextPoint });
    },

    redeemVoucher: (voucherId) => {
      const voucher = VOUCHERS.find((v) => v.id === voucherId);
      if (!voucher) return null;
      const { point, redeemedVouchers } = get(); // live read — the real gate
      if (point < voucher.cost) return null;
      const redeemed: RedeemedVoucher = {
        voucherId,
        name: voucher.name,
        code: genCode(),
        redeemedAt: Date.now(),
      };
      const nextPoint = point - voucher.cost;
      const nextList = [...redeemedVouchers, redeemed];
      saveNumber(POINT_STORAGE_KEY, nextPoint);
      saveJson(VOUCHERS_STORAGE_KEY, nextList);
      set({ point: nextPoint, redeemedVouchers: nextList });
      return redeemed;
    },

    openMission: () => {
      if (get().activeOverlay !== "NONE") return;
      set({ activeOverlay: "MISSION" });
    },

    completeMission: (missionId, code) => {
      const mission = MISSIONS.find((m) => m.id === missionId);
      if (!mission) return { ok: false, reason: "unknown" };
      const { completedMissionIds, xp, point } = get(); // live read — the gate
      if (completedMissionIds.includes(missionId)) return { ok: false, reason: "already" };
      if (mission.kind === "reallife" && !codeMatches(mission.code, code)) {
        return { ok: false, reason: "wrong-code" };
      }
      const nextXp = xp + Math.max(0, mission.reward.xp);
      const nextPoint = point + Math.max(0, mission.reward.point);
      const nextIds = [...completedMissionIds, missionId];
      saveNumber(XP_STORAGE_KEY, nextXp);
      saveNumber(POINT_STORAGE_KEY, nextPoint);
      saveJson(MISSION_STORAGE_KEY, nextIds);
      set({ xp: nextXp, point: nextPoint, completedMissionIds: nextIds });
      return { ok: true, reward: mission.reward };
    },
  })),
);

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
