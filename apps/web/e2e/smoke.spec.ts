import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { KREDIT_MACET_SCRIPT } from "../src/session/transport/mock/scripts/kredit-macet.script";
import { SCORE_KEY_LABELS } from "../src/components/session/resultLabels";
// Side-effect import: pulls in the `declare global { interface Window { __e2e } }`
// augmentation so `window.__e2e` is typed inside page.evaluate (types-only module).
import "../src/app/e2eHarness.types";

/**
 * SIM-22 E2E smoke: anonymous auth → full `kredit-macet` scenario (mock transport,
 * good ending) → scored result rendered AND persisted. Run via `pnpm e2e` (root),
 * which boots local Supabase first and injects VITE_* env.
 */

/** Fail fast with a clear message (not an opaque assertion) if run-e2e.mjs didn't inject env. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be injected by run-e2e.mjs (run \`pnpm e2e\`)`);
  return value;
}
const SUPA_URL = requireEnv("VITE_SUPABASE_URL");
const ANON_KEY = requireEnv("VITE_SUPABASE_ANON_KEY");

/** Single source of truth for the expected scores — assert the pipeline persists
 *  faithfully what the script declares, not magic numbers. */
const GOOD = KREDIT_MACET_SCRIPT.endings.good;

/** One benign player turn: deescalate words, zero escalate words → driftLevel stays 0. */
const BENIGN_TURN =
  "Tenang saja Pak, saya paham. Boleh saya tawarkan keringanan dan perpanjang tempo sebagai solusi?";

interface SessionRow {
  ending_type: string;
  scores_json: Record<string, number>;
  state_json: Record<string, string>;
  started_at: string;
  ended_at: string | null;
}

/** REST returns untyped JSON — the single validated boundary of the test. */
async function fetchSessions(request: APIRequestContext, token: string): Promise<SessionRow[]> {
  const res = await request.get(`${SUPA_URL}/rest/v1/sessions?select=*&order=ended_at.desc`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `REST read failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as SessionRow[];
}

const authState = (page: Page) => page.evaluate(() => window.__e2e?.getAuth() ?? null);
const authStatus = (page: Page) => page.evaluate(() => window.__e2e?.getAuth().status ?? null);
const lastSpeaker = (page: Page) =>
  page.evaluate(() => window.__e2e?.getSessionState().lastSpeaker ?? null);
const npcSettled = (page: Page) =>
  page.evaluate(() => {
    const s = window.__e2e?.getSessionState();
    return !!s && s.lastSpeaker === "npc" && s.lastStreaming === false;
  });

test("auth + kredit-macet → scored result rendered & persisted", async ({ page, request }) => {
  await page.goto("/?e2e=kredit-macet");

  // --- Auth: anonymous session established (gate on "guest", not "ready") --------
  await expect.poll(() => authStatus(page), { timeout: 15_000 }).toBe("guest");
  const auth = await authState(page);
  expect(auth?.isAnonymous).toBe(true);
  expect(auth?.accessToken).toBeTruthy();
  const token = auth!.accessToken as string;

  // Precondition: the fresh anonymous user owns zero sessions (proves WE create the row).
  expect(await fetchSessions(request, token)).toHaveLength(0);

  // --- Enter + connect via the REAL "Mulai Percakapan" button -------------------
  await page.getByRole("button", { name: /Mulai Percakapan/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__e2e?.getSessionState().agentJoined ?? false), {
      timeout: 15_000,
    })
    .toBe(true);

  // --- One benign turn, gated on stream state (never a fixed sleep) --------------
  await expect.poll(() => npcSettled(page), { timeout: 15_000 }).toBe(true); // greeting done
  const input = page.getByRole("textbox");
  await input.fill(BENIGN_TURN);
  await input.press("Enter");
  await expect.poll(() => lastSpeaker(page), { timeout: 10_000 }).toBe("player"); // send registered
  await expect.poll(() => npcSettled(page), { timeout: 15_000 }).toBe(true); // reply done

  // --- End via the REAL end button (kredit-macet has no gatesEndOnGoal) ----------
  await page.getByRole("button", { name: /Keputusan Akhir/i }).click();

  // --- Rendered result: structured object is source of truth (DOM is localized) --
  await expect
    .poll(() => page.evaluate(() => window.__e2e?.getSessionState().ended?.result.endingType ?? null), {
      timeout: 10_000,
    })
    .toBe("good");
  const result = await page.evaluate(() => window.__e2e!.getSessionState().ended!.result);
  expect(result.scores).toEqual(GOOD.scores);
  expect(result.stateClassification).toEqual(GOOD.stateClassification);

  // Rendered proof: structural anchor (survives copy edits) + one centralized label.
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-ending", "good");
  await expect(page.getByText(SCORE_KEY_LABELS["member_centric"] as string)).toBeVisible();

  // --- Persisted: exactly ONE finalized owner-scoped row -------------------------
  // Existence proves record_session returned {ok:true}; {ok:false} persists nothing (and is also HTTP 200).
  // Capture rows inside the poll so the asserted row is the same response that satisfied the count (one fetch/iteration).
  let rows: SessionRow[] = [];
  await expect
    .poll(
      async () => {
        rows = await fetchSessions(request, token);
        return rows.length;
      },
      { timeout: 10_000 },
    )
    .toBe(1);
  const [row] = rows;
  expect(row?.ending_type).toBe("good");
  expect(row?.scores_json).toEqual(GOOD.scores);
  expect(row?.state_json).toEqual(GOOD.stateClassification);
  expect(row?.ended_at).not.toBeNull();
  expect(new Date(row!.ended_at as string).getTime()).toBeGreaterThan(
    new Date(row!.started_at).getTime(),
  );
});
