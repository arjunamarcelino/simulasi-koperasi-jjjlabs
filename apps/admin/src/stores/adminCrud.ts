import { adminAuthStore } from "./adminAuth.store";

/**
 * Low-risk shared primitives for the SIM-18 admin content CRUD stores (quizContent / madingContent).
 * Deliberately does NOT genericize the whole read machine (that would force a public state-shape
 * change rippling the panels + tests, for marginal gain — review decision); it just hoists the two
 * bits that were byte-identical and carry no store-shape dependency.
 */
export type Toast = { tone: "success" | "error"; text: string };

/**
 * One-shot auth-loss bridge: route a 401/403 through the admin gate at most once per loss (the
 * `bridged` latch), fall to a manual-retry error on a second loss, and drop a superseded probe.
 * The store supplies thin accessors so this stays independent of its concrete UI-state shape.
 */
export function bridgeAuthLoss(ctx: {
  isBridged: () => boolean;
  setBridged: (v: boolean) => void;
  isCurrent: () => boolean; // myEpoch === epoch
  toAuthLost: () => void;
  toError: () => void;
}): void {
  if (ctx.isBridged()) {
    ctx.toError();
    return;
  }
  ctx.setBridged(true);
  ctx.toAuthLost();
  void (async () => {
    await adminAuthStore.getState().retry();
    if (!ctx.isCurrent()) return; // disposed / superseded → drop
    if (adminAuthStore.getState().gate.status === "authorized") {
      // Gate disagrees (still authorized) → don't sit on a spinner; offer manual retry.
      ctx.toError();
    }
  })();
}
