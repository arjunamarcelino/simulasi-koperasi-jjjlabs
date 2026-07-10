import { useState } from "react";
import type { ScenarioDocument } from "../scenarios/documents";

/**
 * "Periksa Dokumen" (PRD §7.3/§7.4) — fitur FE murni dengan data statis, tanpa
 * backend/AI. Shell modal generik; kontennya (tabel atau paragraf) datang dari
 * `documents.ts` per skenario.
 */
export function DocumentPanel({ doc }: { doc: ScenarioDocument }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line bg-parchment px-4 py-2 font-semibold text-ink"
      >
        {doc.buttonLabel}
      </button>

      {open && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/50 p-4">
          <div className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-xl bg-parchment p-6">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold">{doc.title}</h2>
              <span className="text-xs text-ink-soft">data statis · FE</span>
            </header>

            {doc.rows && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-1 pr-3">Nama</th>
                      <th className="py-1 pr-3">No. Anggota</th>
                      <th className="py-1">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.rows.map((row, i) => (
                      <tr key={i} className="border-b border-line/50">
                        <td className="py-1 pr-3">{row.nama}</td>
                        <td className="py-1 pr-3">{row.noAnggota}</td>
                        <td className="py-1">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {doc.paragraphs && (
              <ul className="flex flex-col gap-2 text-sm leading-relaxed">
                {doc.paragraphs.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="self-start rounded-lg bg-forest px-4 py-2 font-semibold text-cream"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
}
