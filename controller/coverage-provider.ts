/**
 * Custom Vitest coverage provider that wraps @vitest/coverage-v8 and preserves
 * the raw V8 JSON files that the built-in provider deletes after generating reports.
 *
 * The files are copied to coverage/tmp/ (the same directory c8 mocha uses) so
 * that a single "c8 report" pass at the end produces a combined coverage report
 * covering both Mocha unit tests and Vitest component tests.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { default as v8Module } from "@vitest/coverage-v8";

const __dirname = dirname(fileURLToPath(import.meta.url));
const c8TmpDir = resolve(__dirname, "coverage", "tmp");

export default {

async getProvider () {
  const provider = await v8Module.getProvider();
  const origCleanAfterRun = provider.cleanAfterRun.bind(provider);

  provider.cleanAfterRun = async function () {
    const vitestTmpDir = this.coverageFilesDirectory;
    if (vitestTmpDir && existsSync(vitestTmpDir)) {
      mkdirSync(c8TmpDir, { recursive: true });
      for (const file of readdirSync(vitestTmpDir)) {
        if (file.endsWith(".json")) {
          cpSync(join(vitestTmpDir, file), join(c8TmpDir, file));
        }
      }
    }
    return await origCleanAfterRun();
  };

  return provider;
}

};
