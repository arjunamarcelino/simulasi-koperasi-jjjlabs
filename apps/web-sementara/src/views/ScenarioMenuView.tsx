import { ScenarioCard } from "../components/ScenarioCard";
import { SCENARIOS } from "../scenarios/catalog";

export function ScenarioMenuView() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Koperasi Simulator</h1>
        <p className="text-sm text-ink-soft">
          FE validasi (mock) · transport:{" "}
          <code>{import.meta.env.VITE_TRANSPORT ?? "mock"}</code>. Pilih skenario
          untuk memulai sesi.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SCENARIOS.map((meta) => (
          <ScenarioCard key={meta.id} meta={meta} />
        ))}
      </div>
    </div>
  );
}
