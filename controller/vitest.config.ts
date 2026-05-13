import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fs/hdr-histogram-wasm": resolve(__dirname, "__mocks__/hdr-histogram-wasm.ts")
    }
  },
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
      exclude: ["**/story.tsx", "**/*.backup", "**/*.json", "**/*.spec.ts", "**/*.spec.tsx"]
    }
  }
});
