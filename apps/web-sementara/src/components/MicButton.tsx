import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";

export function MicButton() {
  const micEnabled = useSessionStore((s) => s.micEnabled);
  const connected = useSessionStore((s) => s.connection === "connected");

  return (
    <button
      type="button"
      disabled={!connected}
      onClick={sessionController.toggleMic}
      title="Di mode mock, mic tidak merekam apa pun."
      className={`rounded-lg border border-line px-4 py-2 font-semibold disabled:opacity-40 ${
        micEnabled ? "bg-orange text-cream" : "bg-parchment text-ink"
      }`}
    >
      {micEnabled ? "Mic: on" : "Mic: off"}
    </button>
  );
}
