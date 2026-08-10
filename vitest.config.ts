import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/cli/program.ts", "src/cli/output.ts", "src/commands/**/*.ts"],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 75,
        lines: 70,
      },
    },
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
