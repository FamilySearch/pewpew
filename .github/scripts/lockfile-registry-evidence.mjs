#!/usr/bin/env node
// Registry evidence for gh-aw's threat-detection job on the dependency agents
// (dependency-agent.md via shared/dependency-update.md, sync-scripting-agent.md).
//
// Detection judges the agent's patch, and a lockfile patch legitimately adds
// packages the tree never had - Babel 8 brought in `obug` and detection called
// it a typosquat (#424). The patch cannot vouch for itself, though: the agent
// that wrote a new lockfile entry also wrote the entry that "declares" it. So
// this asks the registry instead. For every package that is new to a
// package-lock.json it records whether the PUBLISHED manifest of a package
// that declares it really lists it, and whether its resolved URL and integrity
// match what registry.npmjs.org serves for that version. Detection reads the
// result (see the threat-detection prompt) and flags anything not verified.
//
// Runs as a threat-detection step on the runner, before detection, from the
// workflow's own checkout (master) - not from the patch - so the patch cannot
// change what checks it. It applies the patch in a scratch worktree, never in
// the workspace detection reads, and never installs or runs anything from it:
// git, `npm view` and JSON parsing only.
//
// Fails closed: on any error it still writes the evidence file, with a
// non-"ok" status, and detection treats every new package as unverified.
//
// Usage: node .github/scripts/lockfile-registry-evidence.mjs --pr <N> [--artifacts /tmp/gh-aw] [--out <file>] [--base <rev>]
//   --base   apply the patch to this local revision instead of fetching the PR head (for testing)
// Env: GH_TOKEN (optional) - used to fetch the PR head.
// Output: { schema: 1, status: "ok"|"no-patch"|"unavailable", reason?, pr, prHead?, lockfiles: [
//   { path, newPackages: [{ key, name, version, resolved, integrity, verified,
//     registry: { exists, tarball, integrity, resolvedMatches, integrityMatches, error? },
//     declaredBy: [{ key, name, version, field, project, registryLists, error? }] }] }] }
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import console from "node:console";
import { execFile, execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REGISTRY = "https://registry.npmjs.org/";
const DEP_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
// Bounds the job: detection has ten minutes in total.
const MAX_LOOKUPS = 300;
const CONCURRENCY = 8;
const LOOKUP_TIMEOUT_MS = 30_000;

function arg (name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const pr = arg("--pr", "");
const baseOverride = arg("--base", "");
const artifacts = arg("--artifacts", "/tmp/gh-aw");
const out = arg("--out", path.join(artifacts, "threat-detection", "lockfile-registry-evidence.json"));
const evidence = { schema: 1, status: "unavailable", pr: pr || null, lockfiles: [] };

function write () {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`wrote ${out}: status ${evidence.status}${evidence.reason ? ` (${evidence.reason})` : ""}`);
}

function git (args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// "node_modules/a/node_modules/@s/b" -> "@s/b"; workspace entries carry "name".
function packageName (key, entry) {
  if (entry.name) { return entry.name; }
  const i = key.lastIndexOf("node_modules/");
  return i >= 0 ? key.slice(i + "node_modules/".length) : null;
}

function lockAt (rev, file) {
  try {
    return JSON.parse(git(["show", `${rev}:${file}`])).packages || {};
  } catch {
    return {};
  }
}

async function npmView (spec, fields) {
  const { stdout } = await execFileAsync("npm", ["view", spec, ...fields, "--json", `--registry=${REGISTRY}`],
    { encoding: "utf8", timeout: LOOKUP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  const text = stdout.trim();
  return text ? JSON.parse(text) : {};
}

// One lookup per spec, however many entries ask for it.
const lookups = new Map();
function view (spec, fields) {
  const key = `${spec} ${fields.join(" ")}`;
  let lookup = lookups.get(key);
  if (!lookup) {
    if (lookups.size >= MAX_LOOKUPS) { return Promise.reject(new Error(`lookup budget of ${MAX_LOOKUPS} exhausted`)); }
    lookup = queue(() => npmView(spec, fields));
    lookups.set(key, lookup);
  }
  return lookup;
}

let active = 0;
const waiting = [];
function queue (fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => { active--; waiting.shift()?.(); });
    };
    if (active < CONCURRENCY) { run(); } else { waiting.push(run); }
  });
}

async function checkPackage (key, entry, after) {
  const name = packageName(key, entry);
  const row = { key, name, version: entry.version ?? null, resolved: entry.resolved ?? null, integrity: entry.integrity ?? null,
    verified: false, registry: null, declaredBy: [] };

  try {
    const dist = await view(`${name}@${entry.version}`, ["dist.tarball", "dist.integrity"]);
    const tarball = dist["dist.tarball"] ?? null;
    const integrity = dist["dist.integrity"] ?? null;
    row.registry = { exists: !!tarball, tarball, integrity,
      resolvedMatches: !!tarball && tarball === entry.resolved,
      integrityMatches: !!integrity && integrity === entry.integrity };
  } catch (error) {
    row.registry = { exists: false, tarball: null, integrity: null, resolvedMatches: false, integrityMatches: false, error: String(error.message || error).slice(0, 300) };
  }

  for (const [parentKey, parent] of Object.entries(after)) {
    for (const field of DEP_FIELDS) {
      if (!parent[field] || !Object.hasOwn(parent[field], name)) { continue; }
      // The root ("") and workspace entries are the repo's own package.json
      // files: a direct dependency, visible as such in the patch, not something
      // the registry can vouch for.
      const project = parentKey === "" || !parentKey.includes("node_modules/");
      const decl = { key: parentKey, name: packageName(parentKey, parent), version: parent.version ?? null, field, project, registryLists: null };
      if (!project) {
        try {
          const manifest = await view(`${decl.name}@${decl.version}`, [field]);
          // A single field comes back as the object itself, not keyed by field.
          decl.registryLists = Object.hasOwn(manifest || {}, name);
        } catch (error) {
          decl.error = String(error.message || error).slice(0, 300);
        }
      }
      row.declaredBy.push(decl);
    }
  }

  row.verified = row.registry.resolvedMatches && row.registry.integrityMatches
    && row.declaredBy.some((d) => d.registryLists === true || d.project);
  return row;
}

async function main () {
  const patches = existsSync(artifacts)
    ? readdirSync(artifacts).filter((f) => /^aw-.+\.(patch|bundle)$/.test(f)).sort().map((f) => path.join(artifacts, f))
    : [];
  if (patches.length === 0) {
    evidence.status = "no-patch";
    return;
  }
  if (!baseOverride && !/^\d+$/.test(pr)) {
    evidence.reason = "no pull request number in this run's context, so there is no PR head to apply the patch to";
    return;
  }

  const auth = process.env.GH_TOKEN
    ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`]
    : [];
  // The bundle's prerequisites can reach back past the PR head (a merge), so
  // take some history rather than depth 1.
  if (!baseOverride) {
    git([...auth, "fetch", "--no-tags", "--depth=200", "origin", `+refs/pull/${pr}/head:refs/evidence/pr-head`]);
  }
  const prHead = git(["rev-parse", baseOverride || "refs/evidence/pr-head"]).trim();
  evidence.prHead = prHead;

  const worktree = mkdtempSync(path.join(os.tmpdir(), "lockfile-evidence-"));
  try {
    git(["worktree", "add", "--detach", worktree, prHead]);
    const env = { ...process.env, GIT_AUTHOR_NAME: "evidence", GIT_AUTHOR_EMAIL: "evidence@localhost",
      GIT_COMMITTER_NAME: "evidence", GIT_COMMITTER_EMAIL: "evidence@localhost" };
    for (const file of patches) {
      if (file.endsWith(".bundle")) {
        const head = git(["bundle", "list-heads", file]).trim().split("\n")[0]?.split(" ")[0];
        if (!head) { throw new Error(`${path.basename(file)} lists no heads`); }
        git(["fetch", "--no-tags", file, `+${head}:refs/evidence/bundle`], { cwd: worktree });
        git(["checkout", "--detach", "refs/evidence/bundle"], { cwd: worktree });
      } else {
        git(["am", "--3way", "--keep-cr", file], { cwd: worktree, env });
      }
    }
    const afterRev = git(["rev-parse", "HEAD"], { cwd: worktree }).trim();

    const changed = git(["diff", "--name-only", prHead, afterRev, "--", ":(glob)**/package-lock.json"])
      .split("\n").filter(Boolean);
    for (const file of changed) {
      const before = lockAt(prHead, file);
      const after = lockAt(afterRev, file);
      const known = new Set(Object.entries(before).map(([k, e]) => packageName(k, e)));
      const fresh = Object.entries(after).filter(([k, e]) => k.includes("node_modules/") && !e.link && !known.has(packageName(k, e)));
      const newPackages = await Promise.all(fresh.map(([k, e]) => checkPackage(k, e, after)));
      evidence.lockfiles.push({ path: file, newPackages });
    }
    evidence.status = "ok";
  } finally {
    try { git(["worktree", "remove", "--force", worktree]); } catch { rmSync(worktree, { recursive: true, force: true }); }
  }
}

try {
  await main();
} catch (error) {
  evidence.status = "unavailable";
  evidence.reason = String(error.stderr || error.message || error).trim().slice(0, 500);
} finally {
  write();
}
