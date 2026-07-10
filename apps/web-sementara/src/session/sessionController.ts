import { createTransport } from "../transport/createTransport";
import type {
  DriftLevel,
  ScenarioId,
  SessionTransport,
  Unsubscribe,
} from "../transport/contract.provisional";
import { sessionStore } from "../stores/session.store";

/**
 * Lem satu arah: Transport → store. React tidak pernah menyentuh transport
 * secara langsung untuk membaca; ia hanya memanggil aksi di sini.
 *
 * Controller sengaja membuat transport BARU tiap start() supaya restart bersih
 * (timer lama sudah dibuang lewat disconnect()).
 */
export type SessionController = {
  start: () => void;
  stop: () => void;
  startScenario: (id: ScenarioId) => void;
  leaveToMenu: () => void;
  sendPlayerText: (text: string) => void;
  toggleMic: () => void;
  endSession: () => void;
  advancePhase: () => void;
  requestHint: () => void;
  dismissHint: () => void;
  restart: () => void;
  debugSetDrift: (level: DriftLevel) => void;
};

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createSessionController(): SessionController {
  let transport: SessionTransport | null = null;
  let unsubs: Unsubscribe[] = [];

  const fail = (cause: unknown): void => {
    sessionStore.getState().setError(toMessage(cause));
    sessionStore.getState().setConnection("error");
  };

  const stop = (): void => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    void transport?.disconnect();
    transport = null;
  };

  const start = (): void => {
    stop();
    const { getState } = sessionStore;

    // LiveKitTransport melempar SECARA SINKRON dari setiap method — termasuk
    // onConnectionState, jadi kegagalan bisa terjadi sebelum ada satu pun
    // subscription. try/catch harus memeluk seluruh startup, bukan cuma promise.
    try {
      const next = createTransport();
      transport = next;

      unsubs = [
        next.onConnectionState(getState().setConnection),
        next.onTranscript(getState().upsertTranscript),
        next.onDriftLevel(getState().setDriftLevel),
        next.onSessionEnded(getState().setEnded),
      ];
      // Fase hanya diemit transport yang mendukungnya (RAT). Opsional.
      if (next.onPhase) unsubs.push(next.onPhase(getState().setPhase));

      next.connect(getState().scenarioId).catch(fail);
    } catch (cause: unknown) {
      fail(cause);
    }
  };

  const guarded =
    (fn: (transport: SessionTransport) => void) =>
    (): void => {
      if (!transport) return;
      try {
        fn(transport);
      } catch (cause: unknown) {
        fail(cause);
      }
    };

  return {
    start,
    stop,

    startScenario: (id: ScenarioId) => {
      stop();
      const state = sessionStore.getState();
      state.reset();
      state.setScenarioId(id);
      state.setView("SESSION");
      start();
    },

    leaveToMenu: () => {
      stop();
      const state = sessionStore.getState();
      state.reset();
      state.setView("MENU");
    },

    sendPlayerText: (text: string) => {
      guarded((t) => t.sendText(text))();
    },

    toggleMic: () => {
      const next = !sessionStore.getState().micEnabled;
      guarded((t) => {
        t.setMicEnabled(next);
        sessionStore.getState().setMicEnabled(next);
      })();
    },

    endSession: guarded((t) => t.endSession("manual")),

    advancePhase: guarded((t) => t.advancePhase?.()),

    // Fitur Petunjuk — request→response; simpan hasilnya ke store untuk dirender.
    // Kegagalan petunjuk TIDAK menjatuhkan sesi (beda dari endSession): mentor
    // opsional, jadi degrade halus ke pesan fallback tanpa menyentuh koneksi.
    requestHint: () => {
      if (!transport) return;
      const t = transport;
      const store = sessionStore.getState();
      store.setHintLoading(true);
      const fallback = (cause: unknown): void => {
        console.error("Petunjuk gagal:", cause);
        sessionStore
          .getState()
          .setHint("Mentor belum siap menjawab. Coba lagi sebentar lagi.");
      };
      try {
        t.requestHint()
          .then((hint) =>
            sessionStore
              .getState()
              .setHint(hint || "Belum ada petunjuk untuk saat ini."),
          )
          .catch(fallback)
          .finally(() => sessionStore.getState().setHintLoading(false));
      } catch (cause: unknown) {
        fallback(cause);
        sessionStore.getState().setHintLoading(false);
      }
    },

    dismissHint: () => sessionStore.getState().setHint(null),

    restart: () => {
      stop();
      sessionStore.getState().reset();
      start();
    },

    // Alat demo (mock saja). Aman bila transport tak mendukung: no-op.
    debugSetDrift: (level: DriftLevel) => {
      guarded((t) => t.debugSetDrift?.(level))();
    },
  };
}
