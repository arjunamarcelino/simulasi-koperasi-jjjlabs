import { useSessionStore } from "../stores/session.store";
import { ScenarioMenuView } from "../views/ScenarioMenuView";
import { SessionView } from "../views/SessionView";

/**
 * Router minimal — switch pada enum view, meniru apps/web. Sesi dimulai saat
 * kartu skenario diklik (aksi user), bukan saat mount, jadi tak ada masalah
 * double-invoke StrictMode di sini.
 */
export function App() {
  const view = useSessionStore((s) => s.view);

  switch (view) {
    case "MENU":
      return <ScenarioMenuView />;
    case "SESSION":
      return <SessionView />;
  }
}
