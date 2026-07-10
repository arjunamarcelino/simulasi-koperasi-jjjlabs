import { sessionController } from "../session/controller";
import type { SessionEnded } from "../transport/contract.provisional";

export function ResultPanel({ ended }: { ended: SessionEnded }) {
  const { result } = ended;
  const states = Object.entries(result.stateClassification);
  const scores = Object.entries(result.scores);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink/50 p-4">
      <div className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-xl bg-parchment p-6">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">Evaluasi Sesi</h2>
          <span className="text-xs uppercase tracking-wide text-ink-soft">
            {result.endingType} · {ended.trigger}
          </span>
        </header>

        <p className="whitespace-pre-wrap leading-relaxed">
          {result.narrativeFeedback}
        </p>

        {/* Tutorial tidak punya taksonomi maupun skor (PRD 7.1) — kedua blok
            ini baru menyala untuk Skenario 2-4. */}
        {states.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {states.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-soft">{key}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {scores.length > 0 && (
          <ul className="flex flex-wrap gap-3 text-sm">
            {scores.map(([key, value]) => (
              <li key={key} className="rounded-lg bg-cream-2 px-3 py-1">
                {key}: <strong>{value}</strong>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={sessionController.restart}
          className="self-start rounded-lg bg-forest px-4 py-2 font-semibold text-cream"
        >
          Ulangi
        </button>
      </div>
    </div>
  );
}
