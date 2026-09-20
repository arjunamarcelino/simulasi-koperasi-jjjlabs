import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Unit tests run in Node (the auth store is pure logic over a mocked Supabase
  // port). The localStorage helpers guard `window` access, so game.store still
  // imports cleanly here. Explicit `vitest` imports in tests (no globals).
  test: {
    environment: "node",
  },
});
