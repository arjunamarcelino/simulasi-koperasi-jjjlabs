import type { TranscriptItem } from "../transport/contract.provisional";

const BUBBLE: Record<TranscriptItem["speaker"], string> = {
  player: "self-end bg-forest text-cream",
  npc: "self-start bg-parchment text-ink border border-line",
  system: "self-center bg-transparent text-ink-soft italic text-sm",
};

export function TranscriptItemRow({ item }: { item: TranscriptItem }) {
  const isSystem = item.speaker === "system";

  return (
    <div
      className={`flex max-w-[80%] flex-col gap-1 rounded-lg px-3 py-2 ${BUBBLE[item.speaker]}`}
    >
      {item.name && !isSystem && (
        <span className="text-xs font-semibold opacity-70">{item.name}</span>
      )}
      <p className="whitespace-pre-wrap leading-relaxed">
        {item.text}
        {item.streaming && <span className="streaming-caret">▋</span>}
      </p>
    </div>
  );
}
