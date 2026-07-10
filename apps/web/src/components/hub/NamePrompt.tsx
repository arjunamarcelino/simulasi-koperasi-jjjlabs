import { useState } from "react";
import { gameStore } from "../../stores/game.store";
import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";

/**
 * First-time welcome: asks the player's name (required, max 16 chars) before
 * they can move. Blocks keyboard from reaching the game (so typing WASD doesn't
 * move the character). Shown by HubPage while playerName is null.
 */
export function NamePrompt() {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const submit = () => {
    if (trimmed) gameStore.getState().setPlayerName(trimmed);
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-ink/60 p-4"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <PixelPanel className="max-w-md text-center">
        <h2 className="mb-3 font-display text-base text-forest">Selamat Datang!</h2>
        <p className="mb-5 font-body text-xl text-ink-soft">
          Siapa namamu, calon penggerak koperasi?
        </p>

        <input
          autoFocus
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed) submit();
          }}
          placeholder="Nama kamu"
          aria-label="Nama pemain"
          className="mb-2 w-full border-3 border-border bg-parchment px-3 py-2 text-center font-body text-2xl text-ink focus:outline-none focus-visible:pixel-focus"
        />
        <p className="mb-5 font-body text-base text-ink-soft/70">Maksimal 16 huruf</p>

        <GameButton variant="primary" onClick={submit} disabled={!trimmed}>
          Simpan
        </GameButton>
      </PixelPanel>
    </div>
  );
}
