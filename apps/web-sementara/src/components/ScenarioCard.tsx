import { sessionController } from "../session/controller";
import type { ScenarioMeta } from "../scenarios/catalog";

export function ScenarioCard({ meta }: { meta: ScenarioMeta }) {
  const locked = meta.status === "COMING_SOON";

  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => sessionController.startScenario(meta.id)}
      className={`flex flex-col gap-2 rounded-xl border border-line bg-parchment p-4 text-left transition ${
        locked ? "cursor-not-allowed opacity-55" : "hover:border-forest"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{meta.title}</h2>
        <span className="rounded-full bg-cream-2 px-2 py-0.5 text-xs text-ink-soft">
          {locked ? "Segera Hadir" : meta.difficulty}
        </span>
      </div>
      {meta.npcName && (
        <p className="text-xs text-ink-soft">NPC: {meta.npcName}</p>
      )}
      <p className="text-sm leading-relaxed">{meta.blurb}</p>
      <p className="text-sm leading-relaxed">
        <span className="font-semibold text-forest">Misi: </span>
        {meta.mission}
      </p>
    </button>
  );
}
