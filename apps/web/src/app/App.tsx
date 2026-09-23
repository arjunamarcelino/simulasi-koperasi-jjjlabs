import { useEffect } from "react";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { PixelPanel } from "../components/common/PixelPanel";
import { MainMenuPage } from "../pages/MainMenuPage";
import { LoadingPage } from "../pages/LoadingPage";
import { HubPage } from "../pages/HubPage";
import { GamePage } from "../pages/GamePage";
import { EvaluationPage } from "../pages/EvaluationPage";
import { useGameStore, type View } from "../stores/game.store";
import { initAuth, setCaptchaTokenProvider, useAuth } from "../stores/auth.store";
import { ENV } from "../config/env";
import { supabase } from "../lib/supabase";
import { getCaptchaToken, startTurnstile } from "../lib/captcha";

function renderView(view: View) {
  switch (view) {
    case "MAIN_MENU":
      return <MainMenuPage />;
    case "LOADING":
      return <LoadingPage />;
    case "SCENARIO_SELECTION":
      return <HubPage />;
    case "GAME":
      return <GamePage />;
    case "EVALUATION":
      return <EvaluationPage />;
    default: {
      // Exhaustiveness guard — a new View without a case fails at compile time.
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

/** Inline boot splash while auth reconciles. Degraded mode releases it too, so
 * this never blocks a no-env / offline boot (it flips within a tick / ≤3s). */
function BootGate() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-forest-2">
      <PixelPanel className="text-center">
        <p className="font-body text-2xl text-ink-soft">Memuat…</p>
      </PixelPanel>
    </main>
  );
}

export function App() {
  const view = useGameStore((state) => state.currentView);
  const ready = useAuth((state) => state.ready);

  // Start the auth bootstrap once. initAuth is idempotent (StrictMode-safe).
  useEffect(() => {
    // Wire the Turnstile provider BEFORE initAuth so it's set before the first anon
    // sign-in microtask. Gate on the live `supabase` client (url AND anon key), not
    // just the URL — and on the site key. No key / no client → tokenless, as today.
    // startTurnstile + setCaptchaTokenProvider are idempotent singletons (StrictMode-safe).
    if (ENV.turnstileSiteKey && supabase) {
      startTurnstile(ENV.turnstileSiteKey);
      setCaptchaTokenProvider(getCaptchaToken);
    }
    initAuth();
  }, []);

  return <ErrorBoundary>{ready ? renderView(view) : <BootGate />}</ErrorBoundary>;
}
