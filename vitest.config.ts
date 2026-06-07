import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      include: ["source/**/*.ts"],
      exclude: ["test/**/*.test.ts"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
