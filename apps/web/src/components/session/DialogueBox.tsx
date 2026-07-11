import { memo, useState } from "react";
import type { TranscriptItem } from "../../session/transport/contract";
import { BigCharacter } from "./BigCharacter";

/**
 * The visual-novel dialogue box: name-plate + face + the single latest line
 * (stream-driven, auto-advancing — no "Next"), plus the player's text/mic input.
 * Tokens render as they arrive; a caret blinks while streaming (suppressed once
 * the session is frozen so it never dangles after the conversation ends).
 */
type Props = {
  line: TranscriptItem | null;
  systemNote: string | null;
  npcName: string;
  ready: boolean;
  /** True once the session ended / disconnected — kills the streaming caret. */
  frozen: boolean;
  micEnabled: boolean;
  /** Which NPC sprite the face avatar shows — lets a second persona (RAT: Ibu
   *  Sri) use its hue-shifted sheet instead of the default green. */
  npcRole?: "npc" | "npc-alt";
  onSend: (text: string) => void;
  onToggleMic: () => void;
};

export const DialogueBox = memo(function DialogueBox({
  line,
  systemNote,
  npcName,
  ready,
  frozen,
  micEnabled,
  npcRole = "npc",
  onSend,
  onToggleMic,
}: Props) {
  const [draft, setDraft] = useState("");

  const isPlayer = line?.speaker === "player";
  const role: "player" | "npc" | "npc-alt" = isPlayer ? "player" : npcRole;
  const speakerLabel = isPlayer ? "Anda" : line?.name ?? npcName;
  const showCaret = !!line?.streaming && !frozen;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-3xl">
      {/* Latest system note — sits above the box, never inside the VN line. */}
      {systemNote && (
        <p className="mb-1 text-center font-body text-base text-cream/90 [text-shadow:1px_1px_0_#2b2016]">
          {systemNote}
        </p>
      )}

      <div className="pixel-panel relative bg-parchment p-4 pt-6">
        {/* Name-plate tab (forest for the NPC, mustard for the player). */}
        <span
          key={role}
          className={`absolute -top-3 left-4 animate-[lineIn_140ms_ease-out] border-3 border-border px-3 py-1 font-display text-[10px] ${
            isPlayer ? "bg-mustard text-ink" : "bg-forest text-cream"
          }`}
        >
          {speakerLabel}
        </span>

        <div className="flex items-start gap-3">
          <BigCharacter role={role} active size="face" />
          {/* Keyed by line id so the entrance only re-fires on a NEW line, not on
              every streamed token of the same line. */}
          <p
            key={line?.id ?? "empty"}
            className="min-h-[3.5rem] flex-1 animate-[lineIn_140ms_ease-out] font-body text-xl leading-snug text-ink"
          >
            {line?.text ?? "…"}
            {showCaret && <span className="streaming-caret ml-0.5 text-forest">▋</span>}
          </p>
        </div>

        {/* Player input: text fallback + mic. Disabled until the agent is ready. */}
        <form className="mt-3 flex gap-2" onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!ready}
            placeholder={ready ? "Ketik jawaban Anda…" : "Menunggu koneksi…"}
            className="min-w-0 flex-1 border-3 border-border bg-cream px-3 py-2 font-body text-xl text-ink placeholder:text-ink-soft/60 focus-visible:pixel-focus focus-visible:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onToggleMic}
            disabled={!ready}
            aria-label={micEnabled ? "Matikan mikrofon" : "Nyalakan mikrofon"}
            aria-pressed={micEnabled}
            className={`pixel-raise active:pixel-press shrink-0 border-3 border-border px-3 py-2 transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
              micEnabled ? "bg-orange text-ink" : "bg-cream text-forest"
            }`}
          >
            <MicIcon />
          </button>
          <button
            type="submit"
            disabled={!ready || draft.trim() === ""}
            className="pixel-raise active:pixel-press shrink-0 border-3 border-border bg-forest px-4 py-2 font-display text-[10px] text-cream transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kirim
          </button>
        </form>
      </div>

      {/* Announce the settled line once (not per token) for screen readers. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {line && !line.streaming ? `${speakerLabel}: ${line.text}` : ""}
      </div>
    </div>
  );
});

function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      {/* capsule + grille + stand, in currentColor so it flips with the button tone */}
      <rect x="6" y="1" width="4" height="8" fill="currentColor" />
      <rect x="7" y="3" width="2" height="1" fill="#fbf3de" />
      <rect x="7" y="5" width="2" height="1" fill="#fbf3de" />
      <rect x="5" y="8" width="6" height="2" fill="currentColor" />
      <rect x="7" y="10" width="2" height="3" fill="currentColor" />
      <rect x="5" y="13" width="6" height="1" fill="currentColor" />
    </svg>
  );
}
