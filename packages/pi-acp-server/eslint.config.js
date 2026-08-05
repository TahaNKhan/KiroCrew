// Minimal flat config. Extended by later tasks as TypeScript source lands.
// `npx eslint .` exits 0 against an empty tree (only .gitkeep markers).
import js from "@eslint/js";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
