/**
 * Mading content types + CLOSED-shape parsers (SIM-18). Mading is admin-authored and served live
 * to every learner, so the payload is validated at the boundary and rendered TEXT-ONLY (never an
 * HTML sink) — these parsers are the client half of that contract (the FastAPI Pydantic models are
 * the authoritative half; the DB `_mading_reject_reason` is the floor).
 *
 * The parsers are CLOSED (reject foreign keys per variant) — the OPPOSITE of leaderboardRepo's
 * forward-compatible stance — because a mis-shaped card (e.g. a "stat" carrying `text`) must not
 * render as a broken card. Pure, so they unit-test without a DOM.
 */
import { isRecord, str, strArray } from "./parseGuards";

export type Board = "info" | "data" | "knowledge" | "identitas";

export type NoteAccent = "mustard" | "forest" | "orange" | "parchment";
export type MadingNote = { title: string; lines: string[]; accent: NoteAccent };

export type ColAlign = "left" | "right";
export type MadingSlide = {
  title: string;
  caption?: string;
  headers: string[];
  align?: ColAlign[];
  rows: string[][];
};

export type KnowledgeCard =
  | { kind: "stat"; value: string; label: string; group?: string; sub?: string }
  | { kind: "fact"; text: string; chip?: "Prinsip Koperasi" | "Landasan Hukum" };

export type KoperasiIdentitas = { nama: string; badanHukum: string; alamat: string; desa: string };

const ACCENTS: readonly NoteAccent[] = ["mustard", "forest", "orange", "parchment"];
const CHIPS = ["Prinsip Koperasi", "Landasan Hukum"] as const;

/** True when `o` has no keys outside `allowed` (closed-shape enforcement). */
const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(o).every((k) => allowed.includes(k));

const optStr = (u: unknown): boolean => u === undefined || typeof u === "string";

/** A row of display strings. */
function strMatrix(u: unknown): string[][] | null {
  if (!Array.isArray(u)) return null;
  const out: string[][] = [];
  for (const row of u) {
    const r = strArray(row);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

export function parseNote(u: unknown): MadingNote | null {
  if (!isRecord(u) || !onlyKeys(u, ["title", "lines", "accent"])) return null;
  const title = str(u["title"]);
  const lines = strArray(u["lines"]);
  if (title === null || title.trim() === "" || lines === null || lines.length === 0) return null;
  const accent = u["accent"];
  if (typeof accent !== "string" || !ACCENTS.includes(accent as NoteAccent)) return null;
  return { title, lines, accent: accent as NoteAccent };
}

export function parseSlide(u: unknown): MadingSlide | null {
  if (!isRecord(u) || !onlyKeys(u, ["title", "caption", "headers", "align", "rows"])) return null;
  const title = str(u["title"]);
  const headers = strArray(u["headers"]);
  if (title === null || title.trim() === "" || headers === null || headers.length === 0) return null;
  const caption = u["caption"];
  if (!optStr(caption)) return null;
  let align: ColAlign[] | undefined;
  if (u["align"] !== undefined) {
    const a = u["align"];
    if (!Array.isArray(a) || a.length !== headers.length) return null;
    if (!a.every((x) => x === "left" || x === "right")) return null;
    align = a as ColAlign[];
  }
  const rows = strMatrix(u["rows"]);
  if (rows === null || rows.some((r) => r.length !== headers.length)) return null;
  const slide: MadingSlide = { title, headers, rows };
  if (typeof caption === "string") slide.caption = caption;
  if (align) slide.align = align;
  return slide;
}

export function parseKnowledge(u: unknown): KnowledgeCard | null {
  if (!isRecord(u)) return null;
  const kind = u["kind"];
  if (kind === "stat") {
    if (!onlyKeys(u, ["kind", "value", "label", "group", "sub"])) return null;
    const value = str(u["value"]);
    const label = str(u["label"]);
    const group = u["group"];
    const sub = u["sub"];
    if (value === null || label === null || !optStr(group) || !optStr(sub)) return null;
    const card: Extract<KnowledgeCard, { kind: "stat" }> = { kind: "stat", value, label };
    if (typeof group === "string") card.group = group;
    if (typeof sub === "string") card.sub = sub;
    return card;
  }
  if (kind === "fact") {
    if (!onlyKeys(u, ["kind", "text", "chip"])) return null;
    const text = str(u["text"]);
    if (text === null || text.trim() === "") return null;
    const chip = u["chip"];
    if (chip !== undefined && !(typeof chip === "string" && (CHIPS as readonly string[]).includes(chip)))
      return null;
    const card: Extract<KnowledgeCard, { kind: "fact" }> = { kind: "fact", text };
    if (typeof chip === "string") card.chip = chip as (typeof CHIPS)[number];
    return card;
  }
  return null; // unknown kind
}

export function parseIdentitas(u: unknown): KoperasiIdentitas | null {
  if (!isRecord(u) || !onlyKeys(u, ["nama", "badanHukum", "alamat", "desa"])) return null;
  const nama = str(u["nama"]);
  const badanHukum = str(u["badanHukum"]);
  const alamat = str(u["alamat"]);
  const desa = str(u["desa"]);
  if (nama === null || badanHukum === null || alamat === null || desa === null) return null;
  return { nama, badanHukum, alamat, desa };
}

/** Dispatch a raw payload to its board parser. */
export function parsePayload(board: Board, u: unknown): MadingNote | MadingSlide | KnowledgeCard | KoperasiIdentitas | null {
  switch (board) {
    case "info":
      return parseNote(u);
    case "data":
      return parseSlide(u);
    case "knowledge":
      return parseKnowledge(u);
    case "identitas":
      return parseIdentitas(u);
  }
}
