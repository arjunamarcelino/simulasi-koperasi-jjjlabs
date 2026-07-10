import { createSessionController } from "./sessionController";

/**
 * Satu controller untuk seluruh app. Aman sebagai singleton karena harness ini
 * hanya pernah menjalankan satu sesi pada satu waktu.
 */
export const sessionController = createSessionController();
