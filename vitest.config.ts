import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ['./src/__tests__/setup.ts'],
    // DB fixtures share one PostgreSQL database. Explicit race tests still run
    // competing transactions together; unrelated fixture files run separately.
    fileParallelism: false,
    // Release copies kept under .runtime are not a second test suite (they carry old fixtures against the current server).
    // The GEN2 source package has its own native node:test + legacy runner (verify.mjs).
    // Vitest must not import these as empty web suites or traverse their generated fixtures.
    exclude: ['**/node_modules/**', '**/dist/**', '.runtime/codex-release-*/**', '.runtime/fleet-m1-ui-app/**', '.runtime/fleet-round-repro/**', '.runtime/**/node_modules/**', 'integrations/gen2-monitor-canary/**'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
