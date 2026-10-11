import { useState } from "react";
import { quizContentStore, useQuizContent } from "../../stores/quizContent.store";
import type { QuizQuestion, QuizUpsertInput } from "../../lib/adminApi";

/**
 * Quiz content management panel (SIM-18). Lists questions and owns the add/edit FORM as
 * component-local state — so a failed save (409/422/503/auth) keeps the draft for retry (the store
 * never holds the draft). The single mutation gate (`busy` = mutating OR the trailing refetch)
 * disables every control together. `code` is immutable on edit (it is the answer-key join + FK).
 * Delete is window.confirm-guarded.
 */
const LETTERS = ["A", "B", "C", "D"] as const;

type FormState = {
  code: string;
  isEdit: boolean;
  prevUpdatedAt: string | null;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sortOrder: number;
};

function blankForm(sortOrder: number): FormState {
  return {
    code: "",
    isEdit: false,
    prevUpdatedAt: null,
    prompt: "",
    options: ["", ""],
    correctIndex: 0,
    explanation: "",
    sortOrder,
  };
}

function formFromRow(q: QuizQuestion): FormState {
  return {
    code: q.code,
    isEdit: true,
    prevUpdatedAt: q.updated_at,
    prompt: q.prompt,
    options: [...q.options],
    correctIndex: q.correct_index,
    explanation: q.explanation ?? "",
    sortOrder: q.sort_order,
  };
}

function isComplete(f: FormState): boolean {
  return (
    f.code.trim() !== "" &&
    f.prompt.trim() !== "" &&
    f.options.length >= 2 &&
    f.options.length <= 4 &&
    f.options.every((o) => o.trim() !== "") &&
    f.correctIndex >= 0 &&
    f.correctIndex < f.options.length &&
    f.sortOrder >= 0
  );
}

export function QuizContentPanel() {
  const state = useQuizContent((s) => s.state);
  const toast = useQuizContent((s) => s.toast);
  const [form, setForm] = useState<FormState | null>(null);

  if (state.status === "loading" || state.status === "authLost") {
    return <p className="text-ink-soft">Memuat kuis…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-soft">Tidak dapat memuat kuis saat ini.</p>
        <button
          onClick={() => quizContentStore.getState().retry()}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream"
        >
          Coba lagi
        </button>
      </div>
    );
  }
  if (state.status === "idle") return null;

  const { rows, refreshing, mutating } = state;
  const busy = mutating !== null || refreshing;
  const saving = mutating?.kind === "saving";

  const onAdd = () => setForm(blankForm(rows.length));
  const onEdit = (q: QuizQuestion) => setForm(formFromRow(q));
  const onCancel = () => setForm(null);

  const onDelete = (code: string) => {
    if (!window.confirm(`Hapus pertanyaan "${code}" — tidak bisa dibatalkan`)) return;
    quizContentStore.getState().remove(code);
  };

  const onSave = async () => {
    if (!form || !isComplete(form)) return;
    const input: QuizUpsertInput = {
      code: form.code.trim(),
      prompt: form.prompt.trim(),
      options: form.options,
      correct_index: form.correctIndex,
      explanation: form.explanation.trim() === "" ? null : form.explanation.trim(),
      sort_order: form.sortOrder,
      prev_updated_at: form.isEdit ? form.prevUpdatedAt : null,
    };
    const committed = await quizContentStore.getState().save(input);
    if (committed) setForm(null); // keep the draft open on failure
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-forest">Manajemen kuis</h2>
        {form === null && (
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded bg-forest px-3 py-1.5 text-sm font-semibold text-cream disabled:opacity-50"
          >
            Tambah pertanyaan
          </button>
        )}
      </div>

      {toast && (
        <p
          className={`text-sm ${toast.tone === "success" ? "text-forest" : "text-red-700"}`}
          role="status"
        >
          {toast.text}
        </p>
      )}

      {form !== null && (
        <QuizForm
          form={form}
          setForm={setForm}
          busy={busy}
          saving={!!saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}

      <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""}`}>
        {rows.length === 0 ? (
          <p className="text-ink-soft">Belum ada pertanyaan. Tambahkan yang pertama.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 pr-3">Kode</th>
                <th className="py-1 pr-3">Pertanyaan</th>
                <th className="py-1 pr-3">Opsi</th>
                <th className="py-1 pr-3">Benar</th>
                <th className="py-1 pr-3">Urutan</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const deletingThis = mutating?.kind === "deleting" && mutating.code === q.code;
                return (
                  <tr key={q.code} className="border-t border-brown/30 align-top text-ink">
                    <td className="py-1.5 pr-3 font-mono text-xs">{q.code}</td>
                    <td className="py-1.5 pr-3">{q.prompt}</td>
                    <td className="py-1.5 pr-3">{q.options.length}</td>
                    <td className="py-1.5 pr-3">{LETTERS[q.correct_index] ?? q.correct_index}</td>
                    <td className="py-1.5 pr-3">{q.sort_order}</td>
                    <td className="py-1.5">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(q)}
                          disabled={busy}
                          className="rounded border border-brown px-2 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(q.code)}
                          disabled={busy}
                          className="rounded border border-brown px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          {deletingThis ? "Menghapus…" : "Hapus"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function QuizForm({
  form,
  setForm,
  busy,
  saving,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  busy: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const setOption = (i: number, value: string) =>
    setForm({ ...form, options: form.options.map((o, j) => (j === i ? value : o)) });

  const addOption = () => {
    if (form.options.length >= 4) return;
    setForm({ ...form, options: [...form.options, ""] });
  };

  const removeOption = (i: number) => {
    if (form.options.length <= 2) return;
    const options = form.options.filter((_, j) => j !== i);
    // Keep correctIndex pointing at a valid option after a removal.
    let correctIndex = form.correctIndex;
    if (i === correctIndex) correctIndex = 0;
    else if (i < correctIndex) correctIndex -= 1;
    setForm({ ...form, options, correctIndex });
  };

  return (
    <section className="flex flex-col gap-3 rounded border border-brown/40 bg-cream/40 p-4">
      <h3 className="text-sm font-semibold text-forest">
        {form.isEdit ? `Ubah pertanyaan "${form.code}"` : "Pertanyaan baru"}
      </h3>

      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Kode
        <input
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          disabled={busy || form.isEdit}
          maxLength={64}
          placeholder="mis. koperasi-01"
          className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Pertanyaan
        <textarea
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          disabled={busy}
          rows={2}
          className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-ink-soft">Opsi (pilih jawaban benar)</legend>
        {form.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              checked={form.correctIndex === i}
              onChange={() => setForm({ ...form, correctIndex: i })}
              disabled={busy}
              aria-label={`Jawaban benar: opsi ${LETTERS[i] ?? i + 1}`}
            />
            <span className="w-4 text-xs font-semibold text-ink-soft">{LETTERS[i] ?? i + 1}</span>
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              disabled={busy}
              className="flex-1 rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
            />
            {form.options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={busy}
                className="rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50"
              >
                Hapus
              </button>
            )}
          </div>
        ))}
        {form.options.length < 4 && (
          <button
            type="button"
            onClick={addOption}
            disabled={busy}
            className="self-start rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50"
          >
            Tambah opsi
          </button>
        )}
      </fieldset>

      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Penjelasan (opsional)
        <textarea
          value={form.explanation}
          onChange={(e) => setForm({ ...form, explanation: e.target.value })}
          disabled={busy}
          rows={2}
          className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
        />
      </label>

      <label className="flex w-32 flex-col gap-1 text-xs text-ink-soft">
        Urutan
        <input
          type="number"
          min={0}
          value={form.sortOrder}
          onChange={(e) => setForm({ ...form, sortOrder: Math.max(0, Number(e.target.value) || 0) })}
          disabled={busy}
          className="rounded border border-brown bg-cream px-2 py-1 text-sm text-ink"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !isComplete(form)}
          className="rounded bg-forest px-4 py-2 text-sm font-semibold text-cream disabled:opacity-50"
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-brown px-4 py-2 text-sm font-semibold text-ink-soft disabled:opacity-50"
        >
          Batal
        </button>
      </div>
    </section>
  );
}
