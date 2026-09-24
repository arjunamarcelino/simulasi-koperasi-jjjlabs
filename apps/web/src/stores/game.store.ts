import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import { LEVELS } from "@simkop/catalog";
import { KOPERASI_ROOMS } from "../world/rooms.config";
import { loadNumber, saveNumber, loadJson, saveJson, removeKey } from "./persist";
import {
  VOUCHERS,
  isRedeemedVoucherArray,
  type RedeemedVoucher,
} from "../content/vouchers";
import { MISSIONS, isStringArray, type MissionReward } from "../content/missions";
import { BADGES, isEarned, type BadgeContext } from "../content/badges";
import { SCENARIOS } from "../scenarios/scenario.config";
import { supabase } from "../lib/supabase";
import { progressRepo } from "../lib/progressRepo";
import type { QuizAnswer, QuizResultRow, Totals } from "../lib/progressRepo.contracts";

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

/** Result of submitQuiz. `degraded` = no server (offline/mock): the quiz cannot be
 * graded client-side because the answer key is server-only. */
export type QuizSubmitOutcome =
  | { ok: true; awarded: Totals; totals: Totals; results: QuizResultRow[] }
  | { ok: false; reason: "degraded" | "error" | "invalid" | "too_many" | "unknown_question" };

/** Wallet cache key bases; namespaced per owner uid (koperasi.<uid>.<base>) so a
 * shared device can't bleed one account's wallet into another. The un-namespaced
 * `koperasi.<base>` keys are the LEGACY (pre-migration) wallet, read once by the
 * one-time reconcile and then deleted. */
const WALLET_BASES = ["xp", "point", "vouchers", "missions"] as const;
const walletKey = (uid: string | null, base: string): string =>
  uid ? `koperasi.${uid}.${base}` : `koperasi.${base}`;

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

/** Trim + case-insensitive on both sides so "kdmp2026 " matches "KDMP2026". Used only
 * as the degraded/offline gate for reallife missions (online, claim_mission validates). */
function codeMatches(expected: string, input?: string): boolean {
  return input != null && input.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** Short mock voucher code, e.g. "KDMP-7X2A". Cosmetic; used only for the degraded
 * (offline) mint — online, redeem_voucher mints the authoritative code. */
function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `KDMP-${s}`;
}

/** 1-based level from xp (mirrors ProfileModal + the DB level_from_xp). */
function levelFromXp(xp: number): number {
  const safe = Math.max(0, xp);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (safe >= LEVELS[i]!.minXp) index = i;
  return index + 1;
}

type Wallet = {
  xp: number;
  point: number;
  redeemedVouchers: RedeemedVoucher[];
  completedMissionIds: string[];
};

function loadWallet(uid: string | null): Wallet {
  return {
    xp: Math.max(0, loadNumber(walletKey(uid, "xp"), 0)),
    point: Math.max(0, loadNumber(walletKey(uid, "point"), 0)),
    redeemedVouchers: loadJson<RedeemedVoucher[]>(walletKey(uid, "vouchers"), [], isRedeemedVoucherArray),
    completedMissionIds: loadJson<string[]>(walletKey(uid, "missions"), [], isStringArray),
  };
}

function saveWallet(uid: string | null, w: Wallet): void {
  saveNumber(walletKey(uid, "xp"), w.xp);
  saveNumber(walletKey(uid, "point"), w.point);
  saveJson(walletKey(uid, "vouchers"), w.redeemedVouchers);
  saveJson(walletKey(uid, "missions"), w.completedMissionIds);
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
  /** Persisted wallet: XP (drives level, never spent), Point (spent on vouchers).
   * Server-authoritative when online (hydrated via get_my_progress, reconciled from
   * RPC totals); optimistic + localStorage-cached in between. */
  xp: number;
  point: number;
  redeemedVouchers: RedeemedVoucher[];
  /** Ids of missions already completed. Membership = "done". */
  completedMissionIds: string[];
  /** The account that currently owns the in-memory wallet (null = degraded/no account). */
  walletUid: string | null;
  /** True once the owner's wallet has been hydrated (async); gates the one-time
   * reconcile trigger + badge re-eval so neither fires on a not-yet-loaded wallet. */
  hydrated: boolean;

  setView: (view: View) => void;
  /**
   * React to the account that owns the wallet changing (called by auth.store on
   * every uid transition, and once at boot). Resets the in-memory wallet, seeds it
   * from the new owner's cache, then hydrates from the DB, runs the one-time
   * legacy-wallet migration, and re-evaluates badges — all under an epoch+uid guard
   * so a stale async result can't stomp a newer owner/edit. Degraded/no account
   * falls back to the device-local (legacy) wallet.
   */
  onOwnerChanged: (prevUid: string | null, uid: string | null) => void;
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
  /**
   * Submit quiz answers for server-side grading. Credits only newly-correct
   * questions (server-authoritative). Returns the graded results, or a `degraded`
   * failure when offline (the answer key is server-only, so the quiz can't grade).
   */
  submitQuiz: (answers: QuizAnswer[]) => Promise<QuizSubmitOutcome>;
  /**
   * Redeem a voucher by id. Gates on the live client-known balance up front (no
   * optimistic flash on the common insufficient case), applies the debit
   * optimistically, then reconciles from the server (authoritative balance + minted
   * code). Rolls back on rejection/error. Degraded → local mint. Returns the redeemed
   * voucher on success, or null if unknown / not affordable / rejected.
   */
  redeemVoucher: (voucherId: string) => Promise<RedeemedVoucher | null>;
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
   * Complete a mission (one-time). Pre-gates locally (unknown / already / reallife
   * wrong-code) for a flash-free reject, applies the reward optimistically, then
   * claims it server-side and reconciles the authoritative totals. Degraded → local
   * credit. Returns the reward on success, else a failure reason.
   */
  completeMission: (missionId: string, code?: string) => Promise<MissionResult>;
};

/** How long (ms) the scene ignores E after an overlay closes — see interactSuppressedUntil. */
const INTERACT_SUPPRESS_MS = 250;

// — wallet write guard (epoch + uid) ——————————————————————————————————
// A monotonic epoch, bumped on every local edit and every owner change, plus the
// owner uid. An async reconcile/rollback captures the guard at fire time and no-ops
// if either changed while it was in flight — so a slow hydrate/RPC can't overwrite a
// newer wallet or a different account's wallet.
type WriteGuard = { epoch: number; uid: string | null };
let walletEpoch = 0;
const captureGuard = (): WriteGuard => ({ epoch: walletEpoch, uid: gameStore.getState().walletUid });
const guardValid = (g: WriteGuard): boolean =>
  walletEpoch === g.epoch && gameStore.getState().walletUid === g.uid;

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
    xp: 0,
    point: 0,
    redeemedVouchers: [],
    completedMissionIds: [],
    walletUid: null,
    hydrated: false,

    // Reset transient hub state on any view change so re-entering the hub is clean.
    setView: (view) =>
      set({ currentView: view, activeOverlay: "NONE", selectedRoomId: null }),

    onOwnerChanged: (_prevUid, uid) => {
      walletEpoch += 1; // invalidate any in-flight reconcile for the previous owner
      const guard: WriteGuard = { epoch: walletEpoch, uid };
      // Clear the previous owner's in-memory wallet immediately (no cross-account flash).
      set({
        walletUid: uid,
        xp: 0,
        point: 0,
        redeemedVouchers: [],
        completedMissionIds: [],
        hydrated: false,
      });

      if (!supabase || !uid) {
        // Degraded / no account: the device-local (legacy) wallet is the source.
        set({ ...loadWallet(null), hydrated: true });
        return;
      }

      // Online: paint this account's cache instantly, then hydrate authoritative
      // state from the DB and run the one-time legacy migration off the microtask.
      set({ ...loadWallet(uid) });
      queueMicrotask(() => void hydrateAndMigrate(uid, guard));
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

    submitQuiz: async (answers) => {
      if (!supabase || !get().walletUid) return { ok: false, reason: "degraded" };
      const guard = captureGuard();
      const res = await progressRepo.submitQuiz(answers);
      if (res.status === "degraded") return { ok: false, reason: "degraded" };
      if (res.status === "rpcError" || res.status === "invalid") return { ok: false, reason: "error" };
      if (!res.data.ok) return { ok: false, reason: res.data.reason };
      reconcileTotals(res.data.totals, guard);
      return { ok: true, awarded: res.data.awarded, totals: res.data.totals, results: res.data.results };
    },

    redeemVoucher: async (voucherId) => {
      const voucher = VOUCHERS.find((v) => v.id === voucherId);
      if (!voucher) return null;
      const { point, walletUid } = get(); // live read — the client-known gate
      if (point < voucher.cost) return null;
      const optimistic: RedeemedVoucher = {
        voucherId,
        name: voucher.name,
        code: genCode(),
        redeemedAt: Date.now(),
      };
      const effect = applyWalletEffect({ xp: 0, point: -voucher.cost, addVoucher: optimistic });
      const guard = captureGuard(); // AFTER the apply — its epoch bump is this op's baseline

      if (!supabase || !walletUid) return optimistic; // degraded: local mint stays

      const res = await progressRepo.redeemVoucher(voucherId);
      if (!guardValid(guard)) return optimistic; // account switched mid-flight
      if (res.status === "ok" && res.data.ok) {
        reconcileAfterRedeem(optimistic, res.data.code, res.data.balance, guard);
        return { ...optimistic, code: res.data.code };
      }
      if (res.status === "degraded") return optimistic;
      rollbackWalletEffect(effect, guard);
      return null;
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

    completeMission: async (missionId, code) => {
      const mission = MISSIONS.find((m) => m.id === missionId);
      if (!mission) return { ok: false, reason: "unknown" };
      const { completedMissionIds, walletUid } = get(); // live read — the gate
      if (completedMissionIds.includes(missionId)) return { ok: false, reason: "already" };
      if (mission.kind === "reallife" && !codeMatches(mission.code, code)) {
        return { ok: false, reason: "wrong-code" };
      }
      const reward = mission.reward;
      const effect = applyWalletEffect({ xp: reward.xp, point: reward.point, addMission: missionId });
      const guard = captureGuard(); // AFTER the apply — its epoch bump is this op's baseline

      if (!supabase || !walletUid) {
        void syncBadgesFromState();
        return { ok: true, reward }; // degraded: local credit
      }

      const res = await progressRepo.claimMission(
        missionId,
        mission.kind === "reallife" ? code : undefined,
      );
      if (!guardValid(guard)) return { ok: true, reward }; // account switched
      if (res.status === "ok" && res.data.ok) {
        reconcileTotals(res.data.totals, guard);
        return { ok: true, reward: res.data.reward };
      }
      if (res.status === "degraded") {
        void syncBadgesFromState();
        return { ok: true, reward };
      }
      rollbackWalletEffect(effect, guard);
      const reason = res.status === "ok" && !res.data.ok ? res.data.reason : "unknown";
      return { ok: false, reason };
    },
  })),
);

// — wallet effect helpers (module scope; hoisted; run only post-init) ——————————
type WalletEffect = {
  xp: number;
  point: number;
  addedMission: string | null;
  addedVoucher: RedeemedVoucher | null;
};

/** Apply an optimistic delta to state + cache; return the ACTUAL effect (for rollback:
 * a mission already present adds nothing, so it isn't recorded as added). */
function applyWalletEffect(intent: {
  xp: number;
  point: number;
  addMission?: string;
  addVoucher?: RedeemedVoucher;
}): WalletEffect {
  const st = gameStore.getState();
  const addedMission =
    intent.addMission && !st.completedMissionIds.includes(intent.addMission) ? intent.addMission : null;
  const addedVoucher = intent.addVoucher ?? null;
  const wallet: Wallet = {
    xp: st.xp + intent.xp,
    point: st.point + intent.point,
    completedMissionIds: addedMission ? [...st.completedMissionIds, addedMission] : st.completedMissionIds,
    redeemedVouchers: addedVoucher ? [...st.redeemedVouchers, addedVoucher] : st.redeemedVouchers,
  };
  walletEpoch += 1; // a local edit — invalidate any older in-flight reconcile
  gameStore.setState(wallet);
  saveWallet(st.walletUid, wallet);
  return { xp: intent.xp, point: intent.point, addedMission, addedVoucher };
}

/** Reverse exactly the recorded effect (relative, no clamp — the pre-state was ≥0
 * and we added `effect`, so subtracting it returns to the pre-state). No-op if the
 * owner/epoch moved on. */
function rollbackWalletEffect(effect: WalletEffect, guard: WriteGuard): void {
  if (!guardValid(guard)) return;
  const st = gameStore.getState();
  const wallet: Wallet = {
    xp: st.xp - effect.xp,
    point: st.point - effect.point,
    completedMissionIds: effect.addedMission
      ? st.completedMissionIds.filter((id) => id !== effect.addedMission)
      : st.completedMissionIds,
    redeemedVouchers: effect.addedVoucher
      ? st.redeemedVouchers.filter((v) => v !== effect.addedVoucher)
      : st.redeemedVouchers,
  };
  gameStore.setState(wallet);
  saveWallet(st.walletUid, wallet);
}

/** Adopt the server's authoritative {xp, point} after a successful mutating RPC. */
function reconcileTotals(totals: Totals, guard: WriteGuard): void {
  if (!guardValid(guard)) return;
  const st = gameStore.getState();
  const wallet: Wallet = {
    xp: totals.xp,
    point: totals.point,
    completedMissionIds: st.completedMissionIds,
    redeemedVouchers: st.redeemedVouchers,
  };
  gameStore.setState({ xp: totals.xp, point: totals.point });
  saveWallet(st.walletUid, wallet);
  void syncBadgesFromState();
}

/** After a server redeem: set the authoritative balance and swap the optimistic
 * voucher's cosmetic code for the server-minted one (matched by reference). */
function reconcileAfterRedeem(
  target: RedeemedVoucher,
  code: string,
  balance: number,
  guard: WriteGuard,
): void {
  if (!guardValid(guard)) return;
  const st = gameStore.getState();
  const redeemedVouchers = st.redeemedVouchers.map((v) => (v === target ? { ...v, code } : v));
  const wallet: Wallet = {
    xp: st.xp,
    point: balance,
    completedMissionIds: st.completedMissionIds,
    redeemedVouchers,
  };
  gameStore.setState({ point: balance, redeemedVouchers });
  saveWallet(st.walletUid, wallet);
  void syncBadgesFromState();
}

/** Recompute the currently-earned badge set from live wallet signals and persist it
 * (idempotent server-side). No-op when degraded / no account. */
async function syncBadgesFromState(): Promise<void> {
  const st = gameStore.getState();
  if (!supabase || !st.walletUid) return;
  const ctx: BadgeContext = {
    xp: st.xp,
    level: levelFromXp(st.xp),
    point: st.point,
    completedMissionIds: st.completedMissionIds,
    voucherCount: st.redeemedVouchers.length,
  };
  const earned = BADGES.filter((b) => isEarned(b.criteria, ctx)).map((b) => b.id);
  if (earned.length > 0) await progressRepo.syncBadges(earned);
}

/** Hydrate the owner's authoritative wallet from the DB, run the one-time migration
 * of a pre-existing legacy (device-local) wallet, then persist earned badges — all
 * guarded so a newer owner/edit wins. */
async function hydrateAndMigrate(uid: string, guard: WriteGuard): Promise<void> {
  const applyMyProgress = (data: {
    xp: number;
    point: number;
    missions: string[];
    vouchers: RedeemedVoucher[];
  }): void => {
    const wallet: Wallet = {
      xp: data.xp,
      point: data.point,
      completedMissionIds: data.missions,
      redeemedVouchers: data.vouchers,
    };
    gameStore.setState(wallet);
    saveWallet(uid, wallet);
  };

  // The boot hydrate can race the just-issued anon JWT's propagation and get a
  // transient 401 (PostgREST rejects the not-yet-valid token). Retry once so a
  // returning player's progress still loads rather than silently showing zero.
  let hydrate = await progressRepo.getMyProgress();
  if (hydrate.status === "rpcError") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!guardValid(guard)) return;
    hydrate = await progressRepo.getMyProgress();
  }
  if (!guardValid(guard)) return;
  if (hydrate.status === "ok") applyMyProgress(hydrate.data);

  // One-time migration: push a pre-existing legacy (un-namespaced) wallet once, then
  // delete the legacy keys so it never re-runs. The server guards double-credit via
  // reconciled_at; we only clear the keys on a definitive server response.
  const legacy = loadWallet(null);
  const hasLegacy =
    legacy.xp > 0 ||
    legacy.point > 0 ||
    legacy.completedMissionIds.length > 0 ||
    legacy.redeemedVouchers.length > 0;
  if (hasLegacy) {
    // Only xp + game-mission state migrate; point/vouchers are intentionally dropped.
    const rec = await progressRepo.reconcile(uid, legacy.xp, legacy.completedMissionIds);
    if (!guardValid(guard)) return;
    if (rec.status === "ok") {
      const after = await progressRepo.getMyProgress();
      if (!guardValid(guard)) return;
      if (after.status === "ok") applyMyProgress(after.data);
      for (const base of WALLET_BASES) removeKey(walletKey(null, base));
    }
  }

  if (!guardValid(guard)) return;
  await syncBadgesFromState();
  if (!guardValid(guard)) return;
  gameStore.setState({ hydrated: true });
}

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
