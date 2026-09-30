#!/usr/bin/env node
// The deterministic half of pewpew's monthly node dependency update.
//
// Adapted from fs-eng/perfqa-update's actions/update/dependency-update.mjs
// (PERF-4551 / PERF-4615) for a public, multi-project monorepo that installs
// from registry.npmjs.org:
//   - runs against ONE project (`--project <path>`); the workflow loops over
//     the projects listed in .github/dependency-update.json
//   - no Artifactory / curation handling - there is no curation here
//   - emits every out-of-range version (majors, and pinned packages with a
//     newer minor) as a machine-readable list for the repair agent, annotated
//     with the repo's hold list. Taking a major is the AGENT's job in this
//     repo, so this half surveys them; it never applies them.
//
// Everything about the in-range update itself is unchanged from upstream and
// enforced rather than assumed: package.json is never modified (`npm update`
// without --save, `npm audit fix` without --force, both checked afterwards),
// and the declared range is the only thing that decides what may move HERE.
// A pinned package therefore shows up under "Out-of-range versions available"
// every month - which is the standing reminder that moving it is a deliberate
// range change, and exactly the list the agent works from.
//
// Runs from the repository root. Needs node, npm, git and jq on PATH. Imports
// nothing from node_modules, so it does not care what the project installs.
//
// Usage: node .github/scripts/dependency-update.mjs --project <path> [--dry-run]
//   --project   a `projects[].path` from .github/dependency-update.json ("." is the root workspace)
//   --dry-run   report what would be updated without changing anything
// Env:
//   PR_BODY_FILE   markdown fragment for this project (default <tmpdir>/deps-<slug>-body.md)
//   REPORT_FILE    JSON report for this project (default <tmpdir>/deps-<slug>-report.json)
// The report is the contract with the workflow and the agent:
//   { schema: 2, project, slug, hasChanges, validate, updated[], outOfRange[], audit, auditFixHeldBack }
//   outOfRange[] rows: { name, type, wanted, latest, crossesMajor, held: <reason>|null }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import console from "node:console";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DRY_RUN = process.argv.includes("--dry-run");
const projectArgIndex = process.argv.indexOf("--project");
if (projectArgIndex === -1 || !process.argv[projectArgIndex + 1]) {
  console.error("usage: dependency-update.mjs --project <path> [--dry-run]");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Config - one file at the repo root, read the same way by the workflow, this
// script and the repair agent's wrappers, so the three can never disagree
// about which projects exist or how each is validated.

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const CONFIG_PATH = path.join(ROOT, ".github", "dependency-update.json");

function loadConfig () {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`${CONFIG_PATH} is missing. Every project must be listed there with its validate command.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`${CONFIG_PATH} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    throw new Error(`${CONFIG_PATH}: "projects" must be a non-empty array of { path, validate }`);
  }
  for (const p of parsed.projects) {
    if (typeof p?.path !== "string" || typeof p?.validate !== "string" || p.validate.trim() === "") {
      throw new Error(`${CONFIG_PATH}: every project needs a string "path" and a non-empty "validate" - no default is assumed`);
    }
  }
  const holds = parsed.holdMajors ?? {};
  if (typeof holds !== "object" || Array.isArray(holds) || Object.values(holds).some((v) => typeof v !== "string" || v.trim() === "")) {
    throw new Error(`${CONFIG_PATH}: "holdMajors" must map package name -> reason (non-empty string)`);
  }
  return { projects: parsed.projects, holdMajors: holds };
}

const config = loadConfig();

function normaliseProject (raw) {
  const trimmed = raw.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}
const PROJECT = normaliseProject(process.argv[projectArgIndex + 1]);
const projectConfig = config.projects.find((p) => normaliseProject(p.path) === PROJECT);
if (!projectConfig) {
  throw new Error(`--project ${PROJECT} is not listed in ${CONFIG_PATH} (have: ${config.projects.map((p) => p.path).join(", ")})`);
}
const SLUG = PROJECT === "." ? "root" : PROJECT.replaceAll("/", "__");
const VALIDATE = projectConfig.validate.trim();
const PR_BODY_FILE = process.env.PR_BODY_FILE || path.join(os.tmpdir(), `deps-${SLUG}-body.md`);
const REPORT_FILE = process.env.REPORT_FILE || path.join(os.tmpdir(), `deps-${SLUG}-report.json`);

process.chdir(path.join(ROOT, PROJECT));
if (!existsSync("package-lock.json")) {
  throw new Error(`${PROJECT}: no package-lock.json here - every listed project must be an npm project with a committed lockfile`);
}
console.log(`Project: ${PROJECT} (slug ${SLUG}); validate: ${VALIDATE}`);

// ---------------------------------------------------------------------------
// npm / git helpers

// npm outdated/audit/ls exit non-zero when they find anything; the JSON is
// still on stdout, so only a missing/empty stdout is a real failure.
function runJson (command) {
  let stdout;
  try {
    stdout = execSync(command, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (typeof error.stdout !== "string" || error.stdout.trim() === "") { throw error; }
    stdout = error.stdout;
  }
  return JSON.parse(stdout.trim() || "{}");
}

function run (command) {
  execSync(command, { encoding: "utf8", stdio: "inherit" });
}

function runWithOutput (command) {
  try {
    const stdout = execSync(command, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    if (stdout) { process.stdout.write(stdout); }
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stdout) { process.stdout.write(stdout); }
    if (stderr) { process.stderr.write(stderr); }
    return { status: Number.isInteger(error.status) ? error.status : 1, stdout, stderr };
  }
}

function npmOutdated () {
  // `npm outdated --json` reports an ARRAY for a name that is outdated in more
  // than one location - routine in a workspaces repo. An array carries no
  // `.wanted`/`.current` of its own, so collapse to one entry per name,
  // preferring one that actually moves.
  const raw = runJson("npm outdated --json");
  return Object.fromEntries(Object.entries(raw).map(([name, info]) => {
    const entries = [].concat(info ?? []);
    const moving = entries.find((e) => e && e.wanted && e.current && e.wanted !== e.current);
    return [name, moving ?? entries[0] ?? {}];
  }));
}

function auditVulnerabilityCounts () {
  return runJson("npm audit --json").metadata?.vulnerabilities || {};
}

function lockfileChanged () {
  return execSync("git diff --name-only -- package-lock.json", { encoding: "utf8" }).trim().length > 0;
}

// The semver "major" of a version, with 0.x treated the way `^` treats it:
// 0.6 -> 0.7 is a breaking change, so it counts as crossing a major.
function majorOf (version) {
  const m = /^v?(\d+)\.(\d+)/.exec(version || "");
  if (!m) { return null; }
  return m[1] === "0" ? `0.${m[2]}` : m[1];
}

// ---------------------------------------------------------------------------
// The range contract, checked rather than assumed. Every tracked package.json
// under this project (for the root workspace that includes every workspace
// member's) is snapshotted, and every exit path checks they all still match.

function trackedManifests () {
  try {
    const listed = execSync("git ls-files -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const paths = listed.split("\0").filter((p) => p === "package.json" || p.endsWith("/package.json"));
    if (paths.length > 0) { return paths; }
  } catch {
    // not a git checkout - the local manifest still matters
  }
  return ["package.json"];
}

const MANIFEST_PATHS = trackedManifests();
const MANIFESTS_AT_START = new Map(MANIFEST_PATHS.map((p) => [p, readFileSync(p, "utf8")]));
const packageJson = JSON.parse(MANIFESTS_AT_START.get("package.json") ?? readFileSync("package.json", "utf8"));
if (MANIFEST_PATHS.length > 1) {
  console.log(`Watching ${MANIFEST_PATHS.length} tracked package.json files for changes: ${MANIFEST_PATHS.join(", ")}`);
}

function assertManifestUnchanged (step) {
  const changed = [...MANIFESTS_AT_START]
    .filter(([file, contents]) => !existsSync(file) || readFileSync(file, "utf8") !== contents)
    .map(([file]) => file);
  if (changed.length > 0) {
    throw new Error(`${step} modified ${changed.join(", ")}. Only package-lock.json may change in this half:`
      + " a range bump is the repair agent's decision, in the same pull request but by a different hand. Nothing was committed.");
  }
}

function directDeps () {
  return runJson("npm ls --json --depth=0 --long=false").dependencies || {};
}

// Direct dependencies whose resolved version no longer satisfies the declared
// range: `npm ls` marks each `invalid: "<range> from the root project"`.
function outOfRangeDirectDeps (deps) {
  const violations = [];
  for (const [name, info] of Object.entries(deps)) {
    if (info && typeof info.invalid === "string") {
      violations.push({ name, resolved: info.version || null, invalid: info.invalid });
    }
  }
  return violations;
}

function dependencyType (name) {
  if (packageJson.devDependencies?.[name]) { return "devDep"; }
  if (packageJson.optionalDependencies?.[name]) { return "optionalDep"; }
  if (packageJson.dependencies?.[name]) { return "dep"; }
  return "workspace"; // declared by a workspace member rather than this manifest
}

// ---------------------------------------------------------------------------
// 1. Snapshot: what is outdated, what is vulnerable

const snapshot = npmOutdated();
const updatable = Object.entries(snapshot).filter(([, info]) => info.wanted && info.current && info.wanted !== info.current);
const auditBefore = auditVulnerabilityCounts();

// Violations are always measured against the tree as `npm ci` left it: a
// pre-existing out-of-range state is not something this run caused.
const depsAtStart = DRY_RUN ? {} : directDeps();
const violationsAtStart = outOfRangeDirectDeps(depsAtStart);
if (violationsAtStart.length > 0) {
  console.log("Already out of range before this run started (pre-existing, not caused here, not reverted):");
  for (const { name, resolved, invalid } of violationsAtStart) {
    console.log(`  ${name}: resolved ${resolved}, but package.json declares ${invalid}`);
  }
}
function newOutOfRangeDirectDeps (deps) {
  const already = new Set(violationsAtStart.map((v) => v.name));
  return outOfRangeDirectDeps(deps).filter((v) => !already.has(v.name));
}

// ---------------------------------------------------------------------------
// 2. In-range update. No --save; --ignore-scripts because these versions are
//    brand new and unvetted, and install time is where supply-chain
//    compromises land.

const packageNames = updatable.map(([name]) => name);
if (updatable.length > 0) {
  console.log(`${DRY_RUN ? "[dry-run] Would update" : "Updating"} ${packageNames.length} packages within their declared ranges:`);
  for (const [name, info] of updatable) {
    console.log(`  ${name}: ${info.current} -> ${info.wanted} (${dependencyType(name)})`);
  }
  if (!DRY_RUN) {
    const beforeUpdate = Object.fromEntries(["package-lock.json", ...MANIFEST_PATHS].map((file) => [file, readFileSync(file, "utf8")]));
    run(`npm update --ignore-scripts ${packageNames.join(" ")}`);
    assertManifestUnchanged("npm update");
    const updateViolations = newOutOfRangeDirectDeps(directDeps());
    if (updateViolations.length > 0) {
      for (const [file, contents] of Object.entries(beforeUpdate)) { writeFileSync(file, contents); }
      try { run("npm ci --ignore-scripts"); } catch { /* the throw below is the error that matters */ }
      throw new Error("npm update resolved "
        + updateViolations.map((v) => `${v.name} to ${v.resolved}, outside the declared ${v.invalid}`).join("; ")
        + ". The declared range in package.json is the contract, so there is nothing publishable here."
        + " The tree was restored and nothing was committed.");
    }
  }
} else {
  console.log("No in-range updates reported by npm outdated.");
}

// ---------------------------------------------------------------------------
// 3. Transitives: `npm audit fix` (no --force) for the vulnerable transitives
//    `npm outdated` cannot see - but the declared range still wins.

let auditFixHeldBack = null;
if (!DRY_RUN) {
  const beforeAuditFix = Object.fromEntries(["package-lock.json", ...MANIFEST_PATHS].map((file) => [file, readFileSync(file, "utf8")]));
  const auditFix = runWithOutput("npm audit fix --ignore-scripts");
  if (auditFix.status !== 0) {
    if (/ERESOLVE/.test(`${auditFix.stdout}\n${auditFix.stderr}`)) {
      throw new Error("npm audit fix failed with ERESOLVE, so the lockfile may be half-moved. Nothing was committed.");
    }
    // Exit 1 is npm's documented "unresolved vulnerabilities remain" - expected
    // and reported below. Anything else is a real failure.
    if (auditFix.status !== 1) {
      throw new Error(`npm audit fix failed with exit ${auditFix.status}. Nothing was committed.`);
    }
    try { auditVulnerabilityCounts(); } catch {
      throw new Error("npm audit fix failed with exit 1 and npm audit could not produce a follow-up report. Nothing was committed.");
    }
  }
  const changedManifests = MANIFEST_PATHS.filter((file) => readFileSync(file, "utf8") !== beforeAuditFix[file]);
  const violations = newOutOfRangeDirectDeps(directDeps());
  if (changedManifests.length > 0 || violations.length > 0) {
    for (const [file, contents] of Object.entries(beforeAuditFix)) { writeFileSync(file, contents); }
    run("npm ci --ignore-scripts");
    auditFixHeldBack = { manifestChanged: changedManifests.length > 0, changedManifests, violations };
    console.log("npm audit fix reverted: it went outside what the declared ranges allow.");
    for (const file of changedManifests) { console.log(`  - it modified ${file}`); }
    for (const { name, resolved, invalid } of violations) { console.log(`  - ${name}: resolved ${resolved}, but package.json declares ${invalid}`); }
  }
  assertManifestUnchanged("npm audit fix");
} else {
  console.log("[dry-run] Would also run: npm audit fix --ignore-scripts");
}

// ---------------------------------------------------------------------------
// 4. Survey: everything a range holds back - this is the agent's worklist.

const afterwards = DRY_RUN ? snapshot : npmOutdated();
const outOfRange = Object.entries(afterwards)
  .filter(([, info]) => info.latest && info.wanted && info.latest !== info.wanted)
  .map(([name, info]) => ({
    name,
    type: dependencyType(name),
    current: info.current ?? null,
    wanted: info.wanted,
    latest: info.latest,
    crossesMajor: majorOf(info.latest) !== majorOf(info.wanted),
    held: config.holdMajors[name] ?? null
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const agentCandidates = outOfRange.filter((o) => !o.held);
const auditAfter = DRY_RUN ? auditBefore : auditVulnerabilityCounts();
const hasChanges = DRY_RUN ? updatable.length > 0 : lockfileChanged();

const report = {
  schema: 2,
  project: PROJECT,
  slug: SLUG,
  hasChanges,
  validate: VALIDATE,
  updated: updatable.map(([name, info]) => ({ name, from: info.current, to: info.wanted, type: dependencyType(name) })),
  outOfRange,
  agentCandidates: agentCandidates.length,
  audit: { before: auditBefore, after: auditAfter },
  auditFixHeldBack
};
writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 5. PR body fragment for this project. The workflow concatenates one per
//    project under a project heading, then publish appends validation.

function markdownTable (headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function formatVulnerabilities (counts) {
  const severities = ["critical", "high", "moderate", "low", "info"];
  const total = counts.total || 0;
  if (total === 0) { return "none"; }
  return `${total} (${severities.map((s) => `${counts[s] || 0} ${s}`).join(", ")})`;
}

const sections = [];

sections.push(`#### In-range updates (${updatable.length})

${updatable.length > 0
    ? markdownTable(["Package", "From", "To", "Type"], report.updated.map((u) => [`\`${u.name}\``, u.from, u.to, u.type]))
    : hasChanges
      ? "No direct dependency was updatable in range; the lockfile change here came from `npm audit fix` - see **Security audit** below."
      : "Nothing was updatable within the declared ranges."}`);

if (auditFixHeldBack) {
  const reasons = [
    ...(auditFixHeldBack.changedManifests || []).map((file) => `it modified \`${file}\``),
    ...auditFixHeldBack.violations.map(({ name, resolved, invalid }) => `it resolved \`${name}\` to ${resolved}, but \`package.json\` declares ${invalid}`)
  ];
  sections.push(`#### Held back - \`npm audit fix\` was reverted

\`npm audit fix\` found a remediation but could not apply it within the declared ranges, so it was reverted in full:

${reasons.map((reason) => `- ${reason}`).join("\n")}

The remaining vulnerabilities are under **Security audit**. Closing them needs a range change, which is the repair agent's to attempt if the package is not on the hold list.`);
}

if (outOfRange.length > 0) {
  sections.push(`#### Out-of-range versions available (${outOfRange.length}; ${agentCandidates.length} for the agent to attempt)

Newer versions the declared ranges do not admit. **Rows not marked held are the repair agent's worklist**: for each it bumps the range, re-resolves, makes the code changes the new version needs, and validates - one at a time, reverting any it cannot make green. Held rows are deliberate (\`holdMajors\` in \`.github/dependency-update.json\`) and are never attempted.

${markdownTable(["Package", "Type", "Range allows", "Latest", "Major?", "Held"],
    outOfRange.map((o) => [`\`${o.name}\``, o.type, o.wanted, o.latest, o.crossesMajor ? "yes" : "no", o.held ? `**held** - ${o.held}` : ""]))}`);
}

if ((auditBefore.total || 0) > 0 || (auditAfter.total || 0) > 0) {
  sections.push(`#### Security audit

\`npm audit fix\` (no \`--force\`, so it stays within existing ranges) ran alongside the updates above.

- Vulnerabilities before: ${formatVulnerabilities(auditBefore)}
- Vulnerabilities after: ${formatVulnerabilities(auditAfter)}${(auditAfter.total || 0) > 0
    ? "\n\nRemaining vulnerabilities need a range change; if that package is on the agent's worklist above it will be attempted, otherwise it is left for a human."
    : ""}`);
}

writeFileSync(PR_BODY_FILE, sections.join("\n\n") + "\n");

console.log(`\n${PROJECT}: hasChanges=${hasChanges} updated=${updatable.length} outOfRange=${outOfRange.length} agentCandidates=${agentCandidates.length}`);
console.log(`PR body fragment: ${PR_BODY_FILE}`);
console.log(`Report: ${REPORT_FILE}`);
