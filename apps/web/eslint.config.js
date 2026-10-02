import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// React and Phaser communicate only through the Zustand store — never a direct import.
const noPhaserInReact = {
  group: ["phaser", "phaser/*"],
  message:
    "Phaser cannot be imported in the React layer. Communicate with the game via the Zustand store.",
};

// SIM-9: reallife unlock codes live server-side only (apps/db/seed-codes.json). The client
// bundle must never import them — ban any reach into apps/db, the @simkop/db package, or a
// seed-codes.json file (incl. deep relative paths that the workspace graph wouldn't block).
const noServerOnlyCodes = {
  group: ["@simkop/db", "@simkop/db/*", "**/apps/db/**", "**/seed-codes.json"],
  message:
    "Server-only module: reallife unlock codes must never be imported into the client bundle (SIM-9).",
};

export default tseslint.config(
  { ignores: ["dist"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": ["error", { patterns: [noServerOnlyCodes] }],
    },
  },
  // Architectural boundary: the React layer must never import Phaser directly.
  // (Flat config overrides `no-restricted-imports` per file, so this block repeats the
  // server-only ban alongside the Phaser one rather than losing it.)
  {
    files: ["src/pages/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noPhaserInReact, noServerOnlyCodes] }],
    },
  },
);
