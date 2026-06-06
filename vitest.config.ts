import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      include: ["source/**/*.ts"],
      exclude: ["test/**/*.test.ts"],
      thresholds: {
        branches: 80,
        functions: 70,
        lines: 80,
        statements: 80,
      },
    },
  },
});
