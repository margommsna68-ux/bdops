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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
