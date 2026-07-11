import { createSessionController } from "./sessionController";

/**
 * One controller for the whole app. Safe as a singleton because only one voice
 * session runs at a time; its generation counter handles mount/unmount re-entry.
 */
export const sessionController = createSessionController();
