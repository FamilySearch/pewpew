import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["components/**/*.spec.tsx", "components/**/*.spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
    maxWorkers: 4,
    coverage: {
      provider: "custom",
      customProviderModule: "./coverage-provider",
      reporter: ["lcov", "text"],
      reportsDirectory: "coverage/vitest",
      include: ["components/**/*"],
      exclude: ["**/story.tsx", "**/*.backup", "**/*.json"]
    }
  }
});
