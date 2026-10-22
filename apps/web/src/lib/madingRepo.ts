/**
 * Null-safe transport for the in-game mading boards (SIM-18). Reads the admin-authored content
 * live from the public.mading_catalog view and narrows each board's jsonb payload with the closed
 * parsers in mading.types. Mirrors leaderboardRepo: `degraded` (no client) is data, not an
 * exception; an empty board is a valid `ok` with an empty list (NOT an error).
 *
 * Boards render the parsed payload TEXT-ONLY (the content is admin-authored, served to every
 * learner) — never an HTML sink.
 */
import { supabase } from "./supabase";
import { settle, type RepoResult } from "./repoResult";
import { isRecord, str } from "./parseGuards";
import {
  parseNote,
  parseSlide,
  parseKnowledge,
  parseIdentitas,
  type MadingNote,
  type MadingSlide,
  type KnowledgeCard,
  type KoperasiIdentitas,
} from "./mading.types";

export type { RepoResult };

/** A parsed block keyed by its stable block_key (used as the React key). */
export type Keyed<T> = { block_key: string; payload: T };

/** Build a list parser for a board: every row's payload must parse, and block_keys are unique. */
function listParser<T>(parse: (u: unknown) => T | null): (u: unknown) => Keyed<T>[] | null {
  return (u) => {
    if (!Array.isArray(u)) return null;
    const out: Keyed<T>[] = [];
    const keys: string[] = [];
    for (const row of u) {
      if (!isRecord(row)) return null;
      const bk = str(row["block_key"]);
      const payload = parse(row["payload"]);
      if (bk === null || payload === null) return null;
      keys.push(bk);
      out.push({ block_key: bk, payload });
    }
    if (new Set(keys).size !== keys.length) return null; // duplicate key → bad React key
    return out;
  };
}

async function readBoard<T>(
  board: "info" | "data" | "knowledge",
  parse: (u: unknown) => T | null,
): Promise<RepoResult<Keyed<T>[]>> {
  if (!supabase) return { status: "degraded" };
  const { data, error } = await supabase
    .from("mading_catalog")
    .select("block_key,payload,sort_order")
    .eq("board", board)
    .order("sort_order")
    .order("block_key");
  return settle(data, error, listParser(parse));
}

export const madingRepo = {
  info: () => readBoard<MadingNote>("info", parseNote),
  data: () => readBoard<MadingSlide>("data", parseSlide),
  knowledge: () => readBoard<KnowledgeCard>("knowledge", parseKnowledge),

  /** The single identitas header, or `ok` with null when it hasn't been set yet. */
  async identitas(): Promise<RepoResult<KoperasiIdentitas | null>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase
      .from("mading_catalog")
      .select("payload")
      .eq("board", "identitas")
      .limit(1);
    if (error) return { status: "rpcError", error };
    if (!Array.isArray(data)) return { status: "invalid", raw: data };
    if (data.length === 0) return { status: "ok", data: null };
    const row = data[0];
    const payload = isRecord(row) ? parseIdentitas(row["payload"]) : null;
    return payload ? { status: "ok", data: payload } : { status: "invalid", raw: data };
  },
};
