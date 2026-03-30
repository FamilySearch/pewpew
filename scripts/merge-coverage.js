#!/usr/bin/env node

/**
 * Copy raw V8 coverage data from all packages into a single directory
 * for c8 to merge. Run "npm run coverage:merge" to generate merged reports.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rimrafSync } from 'rimraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packages = [
  'common',
  'agent',
  'controller'
];

console.log('Copying coverage data from all packages...\n');

// Create merged coverage directory
const mergedTmpDir = join(rootDir, 'coverage', 'tmp');

// Clean up old merged coverage
rimrafSync(mergedTmpDir);
mkdirSync(mergedTmpDir, { recursive: true });

let packagesWithCoverage = 0;

// Copy coverage data from each package
for (const pkg of packages) {
  const coverageTmpDir = join(rootDir, pkg, 'coverage', 'tmp');

  if (existsSync(coverageTmpDir)) {
    console.log(`✓ Found coverage for ${pkg}`);

    // Copy all JSON coverage files to merged directory with package prefix
    try {
      const files = readdirSync(coverageTmpDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const src = join(coverageTmpDir, file);
          const dest = join(mergedTmpDir, `${pkg}-${file}`);
          cpSync(src, dest);
        }
      }
      packagesWithCoverage++;
    } catch (err) {
      console.error(`  Error copying coverage from ${pkg}:`, err instanceof Error ? err.message : `${err}`);
    }
  } else {
    console.log(`⚠ No coverage found for ${pkg}`);
  }
}

if (packagesWithCoverage === 0) {
  console.error('\n❌ No coverage reports found. Run "npm run coverage" or tests first.');
  process.exit(1);
}

console.log(`\n✓ Copied coverage from ${packagesWithCoverage} packages to coverage/tmp/`);
console.log('  Now running c8 report to generate merged reports...\n');
