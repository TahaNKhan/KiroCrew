import { defineConfig } from "vitest/config";

// `passWithNoTests`: a fresh scaffold has zero test files; CI must stay green
// until later tasks (T02+) add real tests. Without this flag vitest exits 1,
// which fails `npm test` and gates downstream work. Override later tasks
// don't need it (once a test file exists, vitest runs it regardless).
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
