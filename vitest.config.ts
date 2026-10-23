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
    exclude: ['**/node_modules/**', '**/dist/**', '.runtime/codex-release-*/**', '.runtime/**/node_modules/**'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
