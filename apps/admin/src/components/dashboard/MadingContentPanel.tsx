import { useState } from "react";
import { madingContentStore, useMadingContent } from "../../stores/madingContent.store";
import type { MadingBoard, MadingItem, MadingUpsertInput } from "../../lib/adminApi";
import { ContentPanelShell, PanelFallback } from "./ContentPanelShell";

/**
 * Mading content management panel (SIM-18). Four boards (info notes / data tables / knowledge
 * stat|fact cards / the identitas header), each with a board-specific editor FORM owned as
 * component-local state (so a failed save keeps the draft). The single mutation gate disables all
 * controls; delete is confirm-guarded. Payload is built per board and the server validates it.
 */
const BOARDS: { key: MadingBoard; label: string }[] = [
  { key: "info", label: "Papan Info" },
  { key: "data", label: "Papan Data" },
  { key: "knowledge", label: "Papan Pengetahuan" },
  { key: "identitas", label: "Identitas" },
];
const ACCENTS = ["mustard", "forest", "orange", "parchment"] as const;
const CHIPS = ["Prinsip Koperasi", "Landasan Hukum"] as const;
type Payload = Record<string, unknown>;

// Safe readers for an existing item's payload (validated on write, so these are defensive casts).
const pstr = (p: Payload, k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");
const parr = (p: Payload, k: string): string[] =>
  Array.isArray(p[k]) ? (p[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
const pmatrix = (p: Payload, k: string): string[][] =>
  Array.isArray(p[k])
    ? (p[k] as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : []))
    : [];

type FormState = {
  board: MadingBoard;
  id: string | null;
  blockKey: string;
  prevUpdatedAt: string | null;
  sortOrder: number;
  // union-ish fields, interpreted per board
  title: string;
  accent: (typeof ACCENTS)[number];
  lines: string[];
  caption: string;
  headers: string[];
  align: string[];
  rows: string[][];
  kind: "stat" | "fact";
  value: string;
  label: string;
  group: string;
  sub: string;
  text: string;
  chip: "" | (typeof CHIPS)[number];
  nama: string;
  badanHukum: string;
  alamat: string;
  desa: string;
};

function blankForm(board: MadingBoard, sortOrder: number): FormState {
  return {
    board,
    id: null,
    blockKey: "",
    prevUpdatedAt: null,
    sortOrder,
    title: "",
    accent: "mustard",
    lines: [""],
    caption: "",
    headers: ["Kolom 1", "Kolom 2"],
    align: ["left", "left"],
    rows: [["", ""]],
    kind: "stat",
    value: "",
    label: "",
    group: "",
    sub: "",
    text: "",
    chip: "",
    nama: "",
    badanHukum: "",
    alamat: "",
    desa: "",
  };
}

function formFromItem(board: MadingBoard, it: MadingItem): FormState {
  const f = blankForm(board, it.sort_order);
  const p = it.payload;
  f.id = it.id;
  f.blockKey = it.block_key;
  f.prevUpdatedAt = it.updated_at;
  if (board === "info") {
    f.title = pstr(p, "title");
    f.accent = (ACCENTS as readonly string[]).includes(pstr(p, "accent"))
      ? (pstr(p, "accent") as (typeof ACCENTS)[number])
      : "mustard";
    f.lines = parr(p, "lines").length ? parr(p, "lines") : [""];
  } else if (board === "data") {
    f.title = pstr(p, "title");
    f.caption = pstr(p, "caption");
    f.headers = parr(p, "headers").length ? parr(p, "headers") : ["Kolom 1"];
    f.align = parr(p, "align").length ? parr(p, "align") : f.headers.map(() => "left");
    f.rows = pmatrix(p, "rows").length ? pmatrix(p, "rows") : [f.headers.map(() => "")];
  } else if (board === "knowledge") {
    f.kind = p["kind"] === "fact" ? "fact" : "stat";
    f.value = pstr(p, "value");
    f.label = pstr(p, "label");
    f.group = pstr(p, "group");
    f.sub = pstr(p, "sub");
    f.text = pstr(p, "text");
    f.chip = (CHIPS as readonly string[]).includes(pstr(p, "chip"))
      ? (pstr(p, "chip") as (typeof CHIPS)[number])
      : "";
  } else {
    f.nama = pstr(p, "nama");
    f.badanHukum = pstr(p, "badanHukum");
    f.alamat = pstr(p, "alamat");
    f.desa = pstr(p, "desa");
  }
  return f;
}

/** Build the board-specific payload (omitting optional keys that are empty). */
function buildPayload(f: FormState): Payload {
  if (f.board === "info") {
    return { title: f.title.trim(), lines: f.lines.map((l) => l.trim()), accent: f.accent };
  }
  if (f.board === "data") {
    const p: Payload = { title: f.title.trim(), headers: f.headers, align: f.align, rows: f.rows };
    if (f.caption.trim() !== "") p["caption"] = f.caption.trim();
    return p;
  }
  if (f.board === "knowledge") {
    if (f.kind === "stat") {
      const p: Payload = { kind: "stat", value: f.value.trim(), label: f.label.trim() };
      if (f.group.trim() !== "") p["group"] = f.group.trim();
      if (f.sub.trim() !== "") p["sub"] = f.sub.trim();
      return p;
    }
    const p: Payload = { kind: "fact", text: f.text.trim() };
    if (f.chip !== "") p["chip"] = f.chip;
    return p;
  }
  return {
    nama: f.nama.trim(),
    badanHukum: f.badanHukum.trim(),
    alamat: f.alamat.trim(),
    desa: f.desa.trim(),
  };
}

function isComplete(f: FormState): boolean {
  if (f.id === null && f.blockKey.trim() === "") return false;
  if (f.sortOrder < 0) return false;
  if (f.board === "info") {
    return f.title.trim() !== "" && f.lines.length > 0 && f.lines.every((l) => l.trim() !== "");
  }
  if (f.board === "data") {
    const n = f.headers.length;
    return (
      f.title.trim() !== "" &&
      n > 0 &&
      f.headers.every((h) => h.trim() !== "") &&
      f.align.length === n &&
      f.align.every((a) => a === "left" || a === "right") &&
      f.rows.every((r) => r.length === n)
    );
  }
  if (f.board === "knowledge") {
    return f.kind === "stat" ? f.value.trim() !== "" && f.label.trim() !== "" : f.text.trim() !== "";
  }
  return [f.nama, f.badanHukum, f.alamat, f.desa].every((v) => v.trim() !== "");
}

export function MadingContentPanel() {
  const state = useMadingContent((s) => s.state);
  const toast = useMadingContent((s) => s.toast);
  const [board, setBoard] = useState<MadingBoard>("info");
  const [form, setForm] = useState<FormState | null>(null);

  if (state.status !== "ready") {
    return (
      <PanelFallback
        status={state.status}
        loadingText="Memuat mading…"
        errorText="Tidak dapat memuat mading saat ini."
        onRetry={() => madingContentStore.getState().retry()}
      />
    );
  }

  const { groups, refreshing, mutating } = state;
  const busy = mutating !== null || refreshing;
  const saving = mutating?.kind === "saving";
  const listItems: MadingItem[] =
    board === "identitas" ? (groups.identitas ? [groups.identitas] : []) : groups[board];

  const openCreate = () => {
    if (board === "identitas") {
      setForm(blankForm("identitas", 0));
    } else {
      setForm(blankForm(board, groups[board].length));
    }
  };
  const openEdit = (it: MadingItem) => setForm(formFromItem(board, it));

  const onDelete = (it: MadingItem) => {
    if (!window.confirm(`Hapus blok "${it.block_key}" — tidak bisa dibatalkan`)) return;
    madingContentStore.getState().remove(it.id);
  };

  const onSave = async () => {
    if (!form || !isComplete(form)) return;
    const input: MadingUpsertInput = {
      id: form.id,
      board: form.board,
      block_key: form.id === null ? form.blockKey.trim() : form.blockKey,
      payload: buildPayload(form),
      sort_order: form.sortOrder,
      prev_updated_at: form.id === null ? null : form.prevUpdatedAt,
    };
    const committed = await madingContentStore.getState().save(input);
    if (committed) setForm(null);
  };

  const identitasExists = board === "identitas" && groups.identitas !== null;

  const boardTabs = (
    <div className="flex flex-wrap gap-1">
      {BOARDS.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={() => {
            setBoard(b.key);
            setForm(null);
          }}
          disabled={busy}
          className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-50 ${
            board === b.key ? "bg-forest text-cream" : "border border-brown text-ink-soft"
          }`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  return (
    <ContentPanelShell title="Manajemen mading" toast={toast} headerRight={boardTabs}>
      {form === null && !(board === "identitas" && identitasExists) && (
        <button
          type="button"
          onClick={openCreate}
          disabled={busy}
          className="self-start rounded bg-forest px-3 py-1.5 text-sm font-semibold text-cream disabled:opacity-50"
        >
          {board === "identitas" ? "Isi identitas" : "Tambah blok"}
        </button>
      )}

      {form !== null && (
        <MadingForm form={form} setForm={setForm} busy={busy} saving={saving} onSave={onSave} onCancel={() => setForm(null)} />
      )}

      <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""}`}>
        {listItems.length === 0 ? (
          <p className="text-ink-soft">Belum ada konten di papan ini.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 pr-3">Kunci</th>
                <th className="py-1 pr-3">Ringkasan</th>
                <th className="py-1 pr-3">Urutan</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {listItems.map((it) => {
                const deletingThis = mutating?.kind === "deleting" && mutating.id === it.id;
                return (
                  <tr key={it.id} className="border-t border-brown/30 align-top text-ink">
                    <td className="py-1.5 pr-3 font-mono text-xs">{it.block_key}</td>
                    <td className="py-1.5 pr-3">{summarize(board, it.payload)}</td>
                    <td className="py-1.5 pr-3">{it.sort_order}</td>
                    <td className="py-1.5">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(it)}
                          disabled={busy}
                          className="rounded border border-brown px-2 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
                        >
                          Ubah
                        </button>
                        {board !== "identitas" && (
                          <button
                            type="button"
                            onClick={() => onDelete(it)}
                            disabled={busy}
                            className="rounded border border-brown px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                          >
                            {deletingThis ? "Menghapus…" : "Hapus"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ContentPanelShell>
  );
}

/** Text-only one-line summary of a payload for the list (never an HTML sink). */
function summarize(board: MadingBoard, p: Payload): string {
  if (board === "info") return pstr(p, "title");
  if (board === "data") return `${pstr(p, "title")} (${parr(p, "headers").length} kolom)`;
  if (board === "knowledge") return p["kind"] === "fact" ? pstr(p, "text").slice(0, 60) : pstr(p, "label");
  return pstr(p, "nama");
}

function MadingForm({
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
  const field = "rounded border border-brown bg-cream px-2 py-1 text-sm text-ink disabled:opacity-60";
  return (
    <section className="flex flex-col gap-3 rounded border border-brown/40 bg-cream/40 p-4">
      <h3 className="text-sm font-semibold text-forest">
        {form.id === null ? "Blok baru" : `Ubah "${form.blockKey}"`}
      </h3>

      {form.board !== "identitas" && (
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Kunci blok
            <input
              value={form.blockKey}
              onChange={(e) => setForm({ ...form, blockKey: e.target.value })}
              disabled={busy || form.id !== null}
              placeholder="mis. info-7"
              className={field}
            />
          </label>
          <label className="flex w-24 flex-col gap-1 text-xs text-ink-soft">
            Urutan
            <input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Math.max(0, Number(e.target.value) || 0) })}
              disabled={busy}
              className={field}
            />
          </label>
        </div>
      )}

      {form.board === "info" && <InfoFields form={form} setForm={setForm} busy={busy} field={field} />}
      {form.board === "data" && <DataFields form={form} setForm={setForm} busy={busy} field={field} />}
      {form.board === "knowledge" && <KnowledgeFields form={form} setForm={setForm} busy={busy} field={field} />}
      {form.board === "identitas" && <IdentitasFields form={form} setForm={setForm} busy={busy} field={field} />}

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

type FieldsProps = { form: FormState; setForm: (f: FormState) => void; busy: boolean; field: string };

function InfoFields({ form, setForm, busy, field }: FieldsProps) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Judul
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={busy} className={field} />
      </label>
      <label className="flex w-40 flex-col gap-1 text-xs text-ink-soft">
        Aksen
        <select value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value as FormState["accent"] })} disabled={busy} className={field}>
          {ACCENTS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <StringList
        legend="Baris"
        values={form.lines}
        min={1}
        busy={busy}
        field={field}
        onChange={(lines) => setForm({ ...form, lines })}
      />
    </>
  );
}

function KnowledgeFields({ form, setForm, busy, field }: FieldsProps) {
  return (
    <>
      <label className="flex w-40 flex-col gap-1 text-xs text-ink-soft">
        Jenis
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "stat" | "fact" })} disabled={busy} className={field}>
          <option value="stat">Statistik</option>
          <option value="fact">Fakta</option>
        </select>
      </label>
      {form.kind === "stat" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Nilai
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} disabled={busy} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Label
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} disabled={busy} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Grup (opsional)
            <input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} disabled={busy} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Sub (opsional)
            <input value={form.sub} onChange={(e) => setForm({ ...form, sub: e.target.value })} disabled={busy} className={field} />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            Teks
            <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} disabled={busy} rows={3} className={field} />
          </label>
          <label className="flex w-52 flex-col gap-1 text-xs text-ink-soft">
            Chip (opsional)
            <select value={form.chip} onChange={(e) => setForm({ ...form, chip: e.target.value as FormState["chip"] })} disabled={busy} className={field}>
              <option value="">(tanpa chip)</option>
              {CHIPS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </>
      )}
    </>
  );
}

function IdentitasFields({ form, setForm, busy, field }: FieldsProps) {
  const row = (key: "nama" | "badanHukum" | "alamat" | "desa", labelText: string) => (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      {labelText}
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={busy} className={field} />
    </label>
  );
  return (
    <>
      {row("nama", "Nama koperasi")}
      {row("badanHukum", "Badan hukum")}
      {row("alamat", "Alamat")}
      {row("desa", "Desa / kecamatan")}
    </>
  );
}

function DataFields({ form, setForm, busy, field }: FieldsProps) {
  const n = form.headers.length;
  const setHeader = (i: number, v: string) =>
    setForm({ ...form, headers: form.headers.map((h, j) => (j === i ? v : h)) });
  const setAlign = (i: number, v: string) =>
    setForm({ ...form, align: form.align.map((a, j) => (j === i ? v : a)) });
  const addColumn = () =>
    setForm({
      ...form,
      headers: [...form.headers, `Kolom ${n + 1}`],
      align: [...form.align, "left"],
      rows: form.rows.map((r) => [...r, ""]),
    });
  const removeColumn = (i: number) => {
    if (n <= 1) return;
    setForm({
      ...form,
      headers: form.headers.filter((_, j) => j !== i),
      align: form.align.filter((_, j) => j !== i),
      rows: form.rows.map((r) => r.filter((_, j) => j !== i)),
    });
  };
  const setCell = (ri: number, ci: number, v: string) =>
    setForm({ ...form, rows: form.rows.map((r, j) => (j === ri ? r.map((c, k) => (k === ci ? v : c)) : r)) });
  const addRow = () => setForm({ ...form, rows: [...form.rows, form.headers.map(() => "")] });
  const removeRow = (ri: number) => setForm({ ...form, rows: form.rows.filter((_, j) => j !== ri) });

  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Judul
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={busy} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        Keterangan (opsional)
        <input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} disabled={busy} className={field} />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-ink-soft">Kolom</legend>
        {form.headers.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={h} onChange={(e) => setHeader(i, e.target.value)} disabled={busy} className={`flex-1 ${field}`} />
            <select value={form.align[i] ?? "left"} onChange={(e) => setAlign(i, e.target.value)} disabled={busy} className={field}>
              <option value="left">kiri</option>
              <option value="right">kanan</option>
            </select>
            {n > 1 && (
              <button type="button" onClick={() => removeColumn(i)} disabled={busy} className="rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
                Hapus
              </button>
            )}
          </div>
        ))}
        {n < 8 && (
          <button type="button" onClick={addColumn} disabled={busy} className="self-start rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
            Tambah kolom
          </button>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-ink-soft">Baris</legend>
        {form.rows.map((r, ri) => (
          <div key={ri} className="flex items-center gap-2">
            {r.map((c, ci) => (
              <input key={ci} value={c} onChange={(e) => setCell(ri, ci, e.target.value)} disabled={busy} className={`flex-1 ${field}`} />
            ))}
            <button type="button" onClick={() => removeRow(ri)} disabled={busy} className="rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
              Hapus
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} disabled={busy} className="self-start rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
          Tambah baris
        </button>
      </fieldset>
    </>
  );
}

function StringList({
  legend,
  values,
  min,
  busy,
  field,
  onChange,
}: {
  legend: string;
  values: string[];
  min: number;
  busy: boolean;
  field: string;
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs text-ink-soft">{legend}</legend>
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} disabled={busy} className={`flex-1 ${field}`} />
          {values.length > min && (
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} disabled={busy} className="rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
              Hapus
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...values, ""])} disabled={busy} className="self-start rounded border border-brown px-2 py-1 text-xs text-ink-soft disabled:opacity-50">
        Tambah
      </button>
    </fieldset>
  );
}
