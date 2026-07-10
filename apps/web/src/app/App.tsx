import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { MainMenuPage } from "../pages/MainMenuPage";
import { LoadingPage } from "../pages/LoadingPage";
import { HubPage } from "../pages/HubPage";
import { GamePage } from "../pages/GamePage";
import { EvaluationPage } from "../pages/EvaluationPage";
import { useGameStore, type View } from "../stores/game.store";

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

export function App() {
  const view = useGameStore((state) => state.currentView);
  return <ErrorBoundary>{renderView(view)}</ErrorBoundary>;
}
