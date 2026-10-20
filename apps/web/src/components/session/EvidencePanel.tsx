import type { EvidenceContent, EvidenceTone } from "../../types/scenario";
import { CloseButton } from "./CloseButton";

const EVIDENCE_TONE: Record<EvidenceTone, string> = {
  good: "text-forest",
  bad: "text-orange",
  neutral: "text-ink",
};

/**
 * The case file's content — framing, tabular rows and, when the scenario declares a
 * guide, what the player should look for. Shared by the in-session panel and the
 * pre-session card. It does NOT reveal the cause behind the case — the player must
 * still draw that out in conversation.
 */
export function EvidenceDossier({ evidence }: { evidence: EvidenceContent }) {
  const lookFor = evidence.guide?.lookFor ?? [];
  return (
    <>
      {evidence.eyebrow && (
        <p className="mb-1.5 pr-6 font-display text-[8px] tracking-wide text-ink-soft">
          {evidence.eyebrow}
        </p>
      )}
      <h2 className="mb-2 flex items-center gap-1.5 pr-6 font-display text-[11px] text-brown">
        <span aria-hidden="true">📁</span>
        {evidence.title}
      </h2>
      <dl className="divide-y divide-ink-soft/20 border-t-2 border-border">
        {evidence.items.map((item) => (
          <div key={item.label} className="py-2">
            <dt className="font-display text-[8px] tracking-wide text-ink-soft">{item.label}</dt>
            <dd className={`font-body text-lg leading-snug ${EVIDENCE_TONE[item.tone ?? "neutral"]}`}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {lookFor.length > 0 && (
        <section className="mt-3 border-l-4 border-mustard bg-cream/70 py-2 pl-3 pr-2">
          <h3 className="mb-1.5 font-display text-[8px] tracking-wide text-brown">
            <span aria-hidden="true">💡 </span>Yang perlu kamu perhatikan
          </h3>
          <ul className="space-y-1 font-body text-lg leading-snug text-ink">
            {lookFor.map((point) => (
              <li key={point} className="flex gap-1.5">
                <span aria-hidden="true" className="text-brown">
                  ▸
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * "Periksa Bukti" — the koperasi's static case file, toggled from the rail.
 * Styled as a dossier (parchment + brown, tabular rows) so it never reads like
 * the briefing "scroll".
 */
export function EvidencePanel({
  evidence,
  onClose,
}: {
  evidence: EvidenceContent;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-30 w-full max-w-sm">
      {/* Same padding as the briefing PixelPanel — the two share this slot (raw
          `pixel-panel` carries border + shadow only, no padding). */}
      <div className="pixel-panel relative bg-parchment p-6 text-left animate-[lineIn_140ms_ease-out] md:p-8">
        <CloseButton onClick={onClose} label="Tutup bukti" />
        {/* Scroll inside the panel (not the wrapper) so the ✕ stays unclipped. */}
        <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto">
          <EvidenceDossier evidence={evidence} />
        </div>
      </div>
    </div>
  );
}
