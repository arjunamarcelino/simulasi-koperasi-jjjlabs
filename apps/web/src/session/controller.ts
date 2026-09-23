import { createSessionController } from "./sessionController";
import { authStore } from "../stores/auth.store";

/**
 * One controller for the whole app. Safe as a singleton because only one voice
 * session runs at a time; its generation counter handles mount/unmount re-entry.
 */
export const sessionController = createSessionController();

// Identity owns the session: when the auth user changes (sign-out, account switch),
// tear down any live voice room so it isn't stranded on the old identity. A
// guest→Google upgrade keeps the same uid, so a live session survives the upgrade.
// The dependency points session→auth (this module already sits above auth.store).
authStore.subscribe(
  (s) => s.auth.user?.id ?? null,
  () => sessionController.stop(),
);
