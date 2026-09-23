import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import { KOPERASI_ROOMS } from "../world/rooms.config";
import {
  loadNumber,
  saveNumber,
  loadJson,
  saveJson,
  loadString,
  saveString,
} from "./persist";
import {
  VOUCHERS,
  isRedeemedVoucherArray,
  type RedeemedVoucher,
} from "../content/vouchers";
import { MISSIONS, isStringArray, type MissionReward } from "../content/missions";
import { SCENARIOS } from "../scenarios/scenario.config";

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
 * renders PROFILE, MissionBoard renders MISSION, SessionOverlay renders SESSION
 * (the visual-novel voice conversation, layered over the live koperasi map).
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
  | "MISSION"
  | "SESSION";

/** Result of completeMission — carries the granted reward on success. */
export type MissionResult =
  | { ok: true; reward: MissionReward }
  | { ok: false; reason: "already" | "wrong-code" | "unknown" };

const XP_STORAGE_KEY = "koperasi.xp";
const POINT_STORAGE_KEY = "koperasi.point";
const VOUCHERS_STORAGE_KEY = "koperasi.vouchers";
const MISSION_STORAGE_KEY = "koperasi.missions";
/** Which account currently owns the (device-local) wallet — see syncWalletOwner. */
const WALLET_OWNER_KEY = "koperasi.walletOwner";
/** sessionStorage key for the nav state stashed across an OAuth redirect. */
const NAV_STASH_KEY = "koperasi.auth.viewStash";
/** Runtime allowlist for validating a restored `currentView` (View is defined above). */
const VALID_VIEWS: readonly View[] = [
  "MAIN_MENU",
  "LOADING",
  "SCENARIO_SELECTION",
  "GAME",
  "EVALUATION",
];

/** Trim + case-insensitive on both sides so "kdmp2026 " matches "KDMP2026". */
function codeMatches(expected: string, input?: string): boolean {
  return input != null && input.trim().toLowerCase() === expected.trim().toLowerCase();
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
  /**
   * Read-only mirror of `profiles.display_name`, projected by auth.store so Phaser
   * (VillageScene/Player) keeps reading its single React↔Phaser bridge. Null until
   * the player sets a name. Never written from the game layer — see auth.store.
   */
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
  /**
   * Bind the device-local wallet to an account. Called with the Supabase user id
   * whenever auth resolves. If the id differs from the wallet's recorded owner,
   * the wallet is RESET (bounds cross-account bleed on shared devices); a
   * guest→Google upgrade keeps the same id, so progress is preserved. First run
   * with no recorded owner ADOPTS the existing wallet (one-time migration). No-op
   * while degraded/mock (no account).
   */
  syncWalletOwner: (userId: string) => void;
  /** Persist currentView + selectedScenarioId before a full-page OAuth redirect
   * (called by auth.store) so the player returns to where they were, not the menu. */
  stashNavForRedirect: () => void;
  /** Restore (once) the nav state stashed before an OAuth redirect. */
  restoreNavAfterRedirect: () => void;
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
   * Open the visual-novel voice session for a scenario (no-op if another overlay
   * is open, the scenario id is unknown, or we're still inside the post-close
   * E-suppression window — the latter blocks an immediate re-open on the same key).
   */
  openSession: (scenarioId: string) => void;
  /**
   * Launch a playable session scenario from a room's scenario picker. Transitions
   * CONFIRM_ENTER → SESSION atomically in one set() so a bubbled backdrop
   * clearSelection can't interleave, and so it isn't blocked by openSession's
   * NONE-guard / E-suppression window (both meant for the scene's E key, not a
   * deliberate in-overlay click).
   */
  enterSessionScenario: (scenarioId: string) => void;
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
 * In-memory copy of the wallet owner, seeded from storage at load. Kept in memory
 * (not re-read from storage each call) so a device with broken/unavailable
 * localStorage — where loadString always returns null — still detects a genuine
 * account switch within a session instead of perpetually "adopting" the wallet.
 */
let walletOwnerCache: string | null = loadString(WALLET_OWNER_KEY);

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
    playerName: null, // mirror; written only by auth.store's display_name projection
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

    syncWalletOwner: (userId) => {
      if (walletOwnerCache === userId) return; // same account — keep the wallet
      const hadOwner = walletOwnerCache !== null;
      walletOwnerCache = userId;
      saveString(WALLET_OWNER_KEY, userId); // best-effort persist
      // First run (no recorded owner): adopt the existing wallet for this account.
      if (!hadOwner) return;
      // Different account on this device: wipe the wallet so it can't bleed across.
      saveNumber(XP_STORAGE_KEY, 0);
      saveNumber(POINT_STORAGE_KEY, 0);
      saveJson(VOUCHERS_STORAGE_KEY, []);
      saveJson(MISSION_STORAGE_KEY, []);
      set({ xp: 0, point: 0, redeemedVouchers: [], completedMissionIds: [] });
    },

    stashNavForRedirect: () => {
      try {
        const { currentView, selectedScenarioId } = get();
        sessionStorage.setItem(NAV_STASH_KEY, JSON.stringify({ currentView, selectedScenarioId }));
      } catch {
        // sessionStorage unavailable — the redirect still works, just returns to menu
      }
    },

    restoreNavAfterRedirect: () => {
      try {
        const raw = sessionStorage.getItem(NAV_STASH_KEY);
        if (!raw) return;
        sessionStorage.removeItem(NAV_STASH_KEY);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const rec = parsed as Record<string, unknown>;
        const view = rec["currentView"];
        if (typeof view === "string" && (VALID_VIEWS as readonly string[]).includes(view)) {
          const scenarioId =
            typeof rec["selectedScenarioId"] === "string" ? rec["selectedScenarioId"] : null;
          set({ currentView: view as View, selectedScenarioId: scenarioId });
        }
      } catch {
        // malformed stash — ignore, land on the default view
      }
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

    openSession: (scenarioId) => {
      if (get().activeOverlay !== "NONE") return;
      // Belt-and-suspenders alongside the scene's E-drain: refuse to re-open
      // during the brief post-close suppression window.
      if (performance.now() < get().interactSuppressedUntil) return;
      if (!SCENARIOS.some((s) => s.id === scenarioId)) {
        console.warn(`openSession: skenario tidak dikenal: ${scenarioId}`);
        return;
      }
      set({ activeOverlay: "SESSION", selectedScenarioId: scenarioId });
    },

    enterSessionScenario: (scenarioId) => {
      if (!SCENARIOS.some((s) => s.id === scenarioId)) {
        console.warn(`enterSessionScenario: skenario tidak dikenal: ${scenarioId}`);
        return;
      }
      set({ activeOverlay: "SESSION", selectedScenarioId: scenarioId, selectedRoomId: null });
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
