import { useEffect, useRef } from "react";
import { useSessionStore } from "../stores/session.store";
import { TranscriptItemRow } from "./TranscriptItemRow";

export function TranscriptPanel() {
  const transcript = useSessionStore((s) => s.transcript);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Ikut turun saat teks NPC masih tumbuh, bukan hanya saat bubble baru muncul.
  const lastText = transcript.at(-1)?.text ?? "";
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length, lastText]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-cream-2/40 p-4">
      {transcript.length === 0 && (
        <p className="m-auto text-ink-soft">Menyambungkan ke sesi…</p>
      )}
      {transcript.map((item) => (
        <TranscriptItemRow key={item.id} item={item} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
