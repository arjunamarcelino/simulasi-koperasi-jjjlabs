import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Turnstile provider unit tests. Runs in Node (repo default) with stubbed `document` +
 * `window.turnstile` — no jsdom. Tests drive the widget by invoking the render options
 * (`callback`, `error-callback`, …) the module passes to `turnstile.render`.
 */

type RenderOpts = {
  sitekey: string;
  execution?: string;
  appearance?: string;
  callback?: (t: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (c?: string) => void;
  "timeout-callback"?: () => void;
};

type ScriptStub = { src: string; async: boolean; onload?: () => void; onerror?: () => void };

const h = vi.hoisted(() => ({
  render: vi.fn(() => "widget-1" as string | undefined),
  reset: vi.fn(),
  remove: vi.fn(),
  lastOpts: null as RenderOpts | null,
  scripts: [] as ScriptStub[],
  bodyAppend: vi.fn(),
  headAppend: vi.fn(),
}));

const turnstile = {
  render: (_el: unknown, o: RenderOpts) => {
    h.lastOpts = o;
    return h.render();
  },
  reset: h.reset,
  remove: h.remove,
};

/** Stub a minimal DOM. `withTurnstile:false` simulates api.js not yet loaded. */
function stubDom({ withTurnstile = true }: { withTurnstile?: boolean } = {}) {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "script") {
        const s: ScriptStub = { src: "", async: false };
        h.scripts.push(s);
        return s;
      }
      return { style: {}, remove: vi.fn() };
    },
    head: { appendChild: h.headAppend },
    body: { appendChild: h.bodyAppend },
  });
  vi.stubGlobal("window", withTurnstile ? { turnstile } : {});
}

const opts = () => h.lastOpts as RenderOpts;

/** Fresh module singleton per test (its `started`/`currentToken`/`waiters` bleed otherwise). */
async function load() {
  vi.resetModules();
  return import("./captcha");
}

beforeEach(() => {
  h.render.mockClear().mockReturnValue("widget-1");
  h.reset.mockClear();
  h.remove.mockClear();
  h.bodyAppend.mockClear();
  h.headAppend.mockClear();
  h.lastOpts = null;
  h.scripts = [];
  vi.useFakeTimers();
  stubDom();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("captcha provider", () => {
  it("renders once and is idempotent (StrictMode-safe)", async () => {
    const c = await load();
    c.startTurnstile("site");
    c.startTurnstile("site");
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.bodyAppend).toHaveBeenCalledTimes(1);
    expect(opts().sitekey).toBe("site");
    expect(opts().appearance).toBe("interaction-only");
  });

  it("returns undefined before startTurnstile (degraded / no key)", async () => {
    const c = await load();
    expect(await c.getCaptchaToken()).toBeUndefined();
  });

  it("waits for the first token, returns it, then rotates (reset)", async () => {
    const c = await load();
    c.startTurnstile("site");
    const p = c.getCaptchaToken();
    opts().callback!("A");
    expect(await p).toBe("A");
    expect(h.reset).toHaveBeenCalledTimes(1); // pre-warm the next token
  });

  it("single-use: a consumed token is never re-served (races #1/#2, TS #1)", async () => {
    const c = await load();
    c.startTurnstile("site");

    // p1 awaits → callback hands "A" to it (NOT cached).
    const p1 = c.getCaptchaToken();
    opts().callback!("A");
    expect(await p1).toBe("A");

    // Nothing cached now: a second call must NOT return the burned "A" — it waits, then
    // times out to undefined. (If the callback had also cached "A", this would wrongly return "A".)
    const p2 = c.getCaptchaToken();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p2).toBeUndefined();

    // A fresh token arrives with no waiter → cached; the next call gets it (≠ "A").
    opts().callback!("B");
    expect(await c.getCaptchaToken()).toBe("B");
  });

  it("error-callback → undefined promptly, then re-arms the widget", async () => {
    const c = await load();
    c.startTurnstile("site");
    const p = c.getCaptchaToken();
    opts()["error-callback"]!();
    expect(await p).toBeUndefined();
    h.reset.mockClear();
    await vi.advanceTimersByTimeAsync(3000); // REARM_MS
    expect(h.reset).toHaveBeenCalledTimes(1); // recovered, not wedged tokenless
  });

  it("timeout-callback behaves like error (parametrized path)", async () => {
    const c = await load();
    c.startTurnstile("site");
    const p = c.getCaptchaToken();
    opts()["timeout-callback"]!();
    expect(await p).toBeUndefined();
  });

  it("no token within WAIT_MS → undefined", async () => {
    const c = await load();
    c.startTurnstile("site");
    const p = c.getCaptchaToken();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeUndefined();
  });

  it("expired-callback resets to refresh the token", async () => {
    const c = await load();
    c.startTurnstile("site");
    opts()["expired-callback"]!();
    expect(h.reset).toHaveBeenCalledTimes(1);
  });

  it("loads api.js when window.turnstile is absent, renders on script.onload", async () => {
    vi.unstubAllGlobals();
    stubDom({ withTurnstile: false });
    const c = await load();
    c.startTurnstile("site");
    expect(h.scripts).toHaveLength(1);
    const script = h.scripts[0]!;
    expect(script.src).toContain("challenges.cloudflare.com");
    expect(h.render).not.toHaveBeenCalled(); // not until the script loads

    vi.stubGlobal("window", { turnstile }); // api.js "loaded"
    script.onload!();
    expect(h.render).toHaveBeenCalledTimes(1);
  });

  it("script onerror fails outstanding waiters (blocked/offline)", async () => {
    vi.unstubAllGlobals();
    stubDom({ withTurnstile: false });
    const c = await load();
    c.startTurnstile("site");
    const p = c.getCaptchaToken();
    h.scripts[0]!.onerror!();
    expect(await p).toBeUndefined();
  });
});
