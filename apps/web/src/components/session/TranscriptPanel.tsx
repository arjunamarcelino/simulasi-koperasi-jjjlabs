import { useEffect, useRef } from "react";
import { useSessionStore } from "../../stores/session.store";
import type { Speaker, TranscriptItem } from "../../session/transport/contract";

const BUBBLE: Record<Speaker, string> = {
  player: "self-end border-3 border-border bg-mustard text-ink",
  npc: "self-start border-3 border-border bg-parchment text-ink",
  system: "self-center italic text-ink-soft",
};
const NAME_COLOR: Record<Speaker, string> = {
  player: "text-brown-2",
  npc: "text-forest",
  system: "text-ink-soft",
};

function Bubble({ item }: { item: TranscriptItem }) {
  const isSystem = item.speaker === "system";
  return (
    <div
      className={`flex max-w-[82%] flex-col gap-1 px-3 py-2 ${
        isSystem ? "max-w-[90%] text-center" : "shadow-[3px_3px_0_0_var(--color-brown-2)]"
      } ${BUBBLE[item.speaker]}`}
    >
      {item.name && (
        <span className={`font-display text-[8px] uppercase tracking-wide ${NAME_COLOR[item.speaker]}`}>
          {item.name}
        </span>
      )}
      <p className="whitespace-pre-wrap font-body text-xl leading-snug">
        {item.text}
        {item.streaming && <span className="streaming-caret">▋</span>}
      </p>
    </div>
  );
}

/** The scrolling conversation log. Auto-scrolls to the newest message. */
export function TranscriptPanel() {
  const transcript = useSessionStore((s) => s.transcript);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [transcript]);

  return (
    <section className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {transcript.length === 0 && (
          <p className="m-auto font-body text-xl text-ink-soft">Menyambungkan ke sesi…</p>
        )}
        {transcript.map((item) => (
          <Bubble key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
