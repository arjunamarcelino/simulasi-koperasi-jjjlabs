import { useEffect, useRef } from "react";
import { createGame } from "../../game/createGame";

/**
 * The single React↔Phaser bridge. Owns the Phaser.Game lifecycle and is
 * StrictMode-safe: the ref guard prevents a second instance on React 19's
 * dev double-mount, and cleanup destroys the canvas.
 *
 * Note: imports only `createGame` (never `phaser`) so the ESLint boundary that
 * forbids phaser in the React layer stays satisfied.
 */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ReturnType<typeof createGame> | null>(null);

  useEffect(() => {
    if (gameRef.current || !hostRef.current) return;
    gameRef.current = createGame(hostRef.current);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="h-full w-full" />;
}
