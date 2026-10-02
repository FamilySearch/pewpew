---
# pewpew's node dependency REPAIR AGENT. Dispatched by dependency-update.yml
# (via .github/scripts/dep-publish.sh) at the monthly update's pull request
# whenever there is work that needs judgment: a validate command went red, or
# the declared ranges are holding back newer versions. Compile with
# `gh aw compile dependency-agent` and commit the .md, the .lock.yml and
# .github/aw/. The shared procedure is a LOCAL import (shared/), so this repo
# depends on nothing outside itself.
#
# What is different from the fs-eng downstream repos (ppaas-controller etc.):
# those agents may only roll a culprit back. THIS one may take dependency
# majors and make the code changes they need - see the H1 section and the
# fence below - because this is the upstream where the ranges live.
description: Repairs the monthly node dependency update PR - bisects a red validation, and takes out-of-range dependency versions with the code changes they need (PERF-4615)

# To run by hand against an open update PR:
#   gh workflow run dependency-agent.lock.yml \
#     -f aw_context='{"item_type":"pull_request","item_number":<PR>}'
on:
  workflow_dispatch:

# Read-only towards GitHub; copilot-requests lets the job token pay for Copilot.
# Every write (push, comment, issue) happens in gh-aw's separate safe-outputs
# job behind the fence below, with its own write token.
permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

engine:
  id: copilot
  # More than the downstream agents' 60: taking a major is bump, re-resolve,
  # validate, read the failure, edit, validate again - per package.
  max-turns: 90

# The pre-agent steps validate two projects (about 2.5 and 3.5 minutes each on
# a cold runner after a one-minute wasm build), then a red project gets a
# bisect with an 1800 s budget (per red project; set in
# shared/dependency-update.md). What is left is the agent's.
timeout-minutes: 150
inlined-imports: true
imports:
  - shared/dependency-update.md

# THE policy knob: what may reach the pull request. This is a ceiling, not the
# plan - the H1 section below is what the agent works from, and it is narrower.
# A patch touching anything outside allowed-files is refused WHOLE, so a
# refused push means the agent edited outside the fence. (excluded-files is
# different: gh-aw STRIPS those paths from the patch and pushes the rest. Only
# .github/** is listed there - everything else the agent must not touch is
# simply not in allowed-files, so an edit to it fails the push loudly instead
# of vanishing from it.) gh-aw globs: `**/x` needs a slash, so it never matches
# a root file - root forms are listed separately.
safe-outputs:
  push-to-pull-request-branch:
    target: triggering                                # only the PR this run was dispatched at
    required-title-prefix: "Update node dependencies " # ...and only if the update opened it
    allowed-files:
      # manifests and lockfiles of the two projects the update covers
      - package.json
      - package-lock.json
      - common/package.json
      - agent/package.json
      - controller/package.json
      - guide/results-viewer-react/package.json
      - guide/results-viewer-react/package-lock.json
      # code and config a new dependency version may require changing
      - "common/**/*.ts"
      - "common/**/*.json"
      - "agent/**/*.ts"
      - "agent/**/*.json"
      - "controller/**/*.ts"
      - "controller/**/*.tsx"
      - "controller/**/*.js"
      - "controller/**/*.mjs"
      - "controller/**/*.json"
      - "guide/results-viewer-react/**/*.ts"
      - "guide/results-viewer-react/**/*.tsx"
      - "guide/results-viewer-react/**/*.js"
      - "guide/results-viewer-react/**/*.mjs"
      - "guide/results-viewer-react/**/*.json"
      - "eslint.config.*"
      - "tsconfig*.json"
      # Dotfile configs. Globs skip dotfiles by default, so `**/*.json` does not
      # reach these - and mocha, c8, babel and storybook majors live in them.
      - ".mocharc*"
      - "**/.mocharc*"
      - ".c8rc*"
      - "**/.c8rc*"
      - ".babelrc*"
      - "**/.babelrc*"
      - "controller/.storybook/**"
      - "guide/results-viewer-react/.storybook/**"
    excluded-files:
      # Stripped, not refused: the agent's scratch lives in .github/aw/. The
      # registry (.npmrc), lib/** and Cargo.* are kept out by allowed-files.
      - ".github/**"
    protected-files:
      policy: blocked
      # package.json is in gh-aw's DEFAULT protected list, matched by basename and
      # checked separately from allowed-files - without this every manifest push
      # (range bumps, version bumps) is refused whole and Phase B cannot land.
      exclude: [package.json, package-lock.json, guide/results-viewer-react/package-lock.json]
    if-no-changes: warn
---

# Node dependency repair: pewpew

Repository specifics (the shared procedure supplies everything else):

- **Two projects**, exactly as `.github/dependency-update.json` lists them:
  the root npm workspace (`.` - members `common/`, `agent/`, `controller/` and
  the built `lib/config-wasm/pkg`) and `guide/results-viewer-react`. Every
  wrapper takes the project path as its first argument. Nothing under `lib/`
  is yours: the two `lib/**/tests` npm projects are gated by `pr-rust.yml` and
  belong to the Rust update.
- **Dependency majors: allowed.** Anything in a project's out-of-range list that
  is not marked held is yours to attempt, with whatever code, script,
  `overrides` or config change the new version genuinely requires. The hold
  list in the config (`holdMajors`) is absolute - never attempt those, and
  never edit the config.
- **This repository's own versions: patch or minor only, never major.**
  `package.json`, `common/`, `agent/` and `controller/` share one version and
  move together (they are `4.x.y` today); `guide/results-viewer-react` has its
  own (`1.x.y`). Bump the affected project's version once per run, after your
  last change: **patch** when only lockfile, `overrides` or build/test config
  changed; **minor** when source under `src/`, `pages/` or `components/`
  changed. A lockfile-only run bumps nothing. Never touch the `version` field
  of anything else, and never bump a major - `5.0.0` is a human's release
  decision.
- **Code changes: allowed where the fence above allows them**, and bounded by
  necessity rather than size: what the new version's breaking change requires,
  done the way the surrounding code does it, and nothing beyond it - no
  refactors, no drive-by cleanups, no dependency additions. Two accepted
  examples from this repo's sibling monorepo, both taken by hand and exactly
  the shape wanted here: mocha 11 → 12 (re-key the `overrides` entry to
  `mocha@<12`, replace `--project` with `TS_NODE_PROJECT=` in the scripts
  it broke) and simple-git 3 → 4 (bump the range in every workspace that
  declares it, add `allowEnvironment` and filter the guarded `GIT_*` variables
  the new version rejects).
- **Node engines** are `>=22.22.2` and CI runs 22, 24 and 26. A version that
  drops Node 22 support is a major for this repo regardless of its own semver:
  leave it, and say so.
