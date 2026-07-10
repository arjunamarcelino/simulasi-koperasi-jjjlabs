import { GameCanvas } from "../components/game/GameCanvas";
import { HubOverlays } from "../components/hub/HubOverlays";
import { HubGuide } from "../components/hub/HubGuide";
import { KoperasiExitButton } from "../components/hub/KoperasiExitButton";
import { SceneLoadingOverlay } from "../components/hub/SceneLoadingOverlay";
import { MadingInfoBoard } from "../components/hub/MadingInfoBoard";
import { MadingDataBoard } from "../components/hub/MadingDataBoard";
import { MadingKnowledgeBoard } from "../components/hub/MadingKnowledgeBoard";
import { QuizBoard } from "../components/hub/QuizBoard";
import { KasirVoucherBoard } from "../components/hub/KasirVoucherBoard";
import { ProfileModal } from "../components/hub/ProfileModal";
import { ProfileButton } from "../components/hub/ProfileButton";
import { NamePrompt } from "../components/hub/NamePrompt";
import { useGameStore } from "../stores/game.store";

/**
 * The spatial hub (Village → Koperasi Interior). Hosts the Phaser canvas with
 * React chrome (HUD) and decision overlays layered on top. Rendered for the
 * SCENARIO_SELECTION view.
 */
export function HubPage() {
  const needsName = useGameStore((s) => s.playerName === null);
  const activeOverlay = useGameStore((s) => s.activeOverlay);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-forest-2">
      <GameCanvas />
      <HubGuide />
      <ProfileButton />
      <KoperasiExitButton />
      <HubOverlays />
      <MadingInfoBoard />
      <MadingDataBoard />
      <MadingKnowledgeBoard />
      {/* Conditionally mounted so local run-state resets on each open. */}
      {activeOverlay === "QUIZ" && <QuizBoard />}
      {activeOverlay === "KASIR_VOUCHER" && <KasirVoucherBoard />}
      {activeOverlay === "PROFILE" && <ProfileModal />}
      <SceneLoadingOverlay />
      {needsName && <NamePrompt />}
    </main>
  );
}
