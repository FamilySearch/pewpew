---
# pewpew's SCRIPTING SYNC AGENT. Dispatched by sync-scripting.yml (via
# .github/scripts/sync-scripting.sh) at the merge-master-into-<target> pull
# request when the merge needs judgment: it conflicted in Node files, or the
# merged tree does not install or validate. Compile with
# `gh aw compile sync-scripting-agent` and commit the .md, the .lock.yml and
# .github/aw/. Self-contained - no imports.
#
# This is NOT the dependency repair agent (dependency-agent.md). That one
# bisects a lockfile-only diff; a merge changes source, so a bisect would
# attribute nonsense. Nothing here bisects. What the two share is the
# wrappers under .github/scripts/ and the fence's shape.
#
# Rust files and .github/ are outside this agent on purpose: the scripting
# branch has diverged structurally from master there (workspace dependency
# inheritance, lib/config layout), the wasm build in the setup below cannot
# compile a tree with markers in it, and the push fence strips .github/**.
# sync-scripting.sh does not dispatch this when any such file conflicted.
description: Finishes a master-into-scripting merge PR - resolves conflicts in Node files, re-resolves the lockfiles, repairs what the merge broke (PERF-4615)

# To run by hand against an open merge PR (from master - that is where this
# workflow lives and where gh-aw snapshots .github from):
#   gh workflow run sync-scripting-agent.lock.yml --ref master \
#     -f aw_context='{"item_type":"pull_request","item_number":<PR>}'
on:
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

engine:
  id: copilot
  max-turns: 60

# Wasm build and two installs before the agent exists (about five minutes),
# then validation per attempt (2.5 and 3.5 minutes per project).
timeout-minutes: 120

# Behind gh-aw's egress firewall. `node` is npm's registries (this repo
# installs from registry.npmjs.org); `github` covers the pewpew binary that
# DOWNLOAD_PEWPEW fetches from this repo's releases during the tests.
network:
  allowed:
    - defaults
    - node
    - github

# Literal shell() prefix matchers over what the agent may TYPE. No bare
# `npm:*`, no `npx`, no `node`: every install goes through a wrapper that
# forces --ignore-scripts and refuses options. Every wrapper takes the
# project path first (`.` or `guide/results-viewer-react`).
tools:
  bash:
    # Wrappers are allowlisted by their PATH, and the prompt calls them that way
    # (`.github/scripts/x.sh <args>`). The Copilot CLI never matches a rule that
    # starts with `bash` - `bash <path>` is refused even as an exact match - so
    # both the plain and ./ forms of the path are listed. (Verified against CLI
    # 1.0.80; the dependency agent's first run was refused every wrapper, #415.)
    - ".github/scripts/dep-validate.sh:*"      # <project>            - that project's validate command
    - "./.github/scripts/dep-validate.sh:*"
    - ".github/scripts/dep-npm-sync.sh:*"      # <project> ci|install - restore the lockfile's tree / re-resolve the lockfile
    - "./.github/scripts/dep-npm-sync.sh:*"
    - ".github/scripts/dep-checkpoint.sh:*"    # save|restore         - the last-known-green tree
    - "./.github/scripts/dep-checkpoint.sh:*"
    - "npm ls:*"
    - "npm view:*"
    - "git:*"
    - "jq:*"
    - "diff:*"
    - "date:*"

safe-outputs:
  # Detection (gh-aw's threat-detection job) judges the patch, and a dependency
  # update legitimately adds packages the lockfile never had - Babel 8 brought
  # in `obug` and detection called it a typosquat (#424). The patch cannot
  # vouch for those itself: the agent that wrote a new entry also wrote the
  # entry that "declares" it. So the step below asks the registry, on the
  # runner and from this workflow's own checkout (not the patch), and
  # detection flags any new package the registry does not confirm. The step
  # fails closed: no evidence means unverified.
  threat-detection:
    steps:
      - name: Check packages new to a lockfile against the npm registry
        if: needs.agent.outputs.has_patch == 'true'
        continue-on-error: true
        timeout-minutes: 4
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ fromJSON(github.event.inputs.aw_context || '{}').item_number }}
        run: node .github/scripts/lockfile-registry-evidence.mjs --pr "$PR_NUMBER"
    prompt: |
      This patch comes from an npm dependency update, which legitimately adds
      packages a package-lock.json never had. A declaration in the patch proves
      nothing - the same patch wrote it. Use the registry evidence instead: a
      step outside the agent's control applied this patch to the pull request
      head and checked every package new to a package-lock.json against
      registry.npmjs.org, in
      /tmp/gh-aw/threat-detection/lockfile-registry-evidence.json. A new package
      is expected - not suspicious by itself - when its row there has
      "verified": true: the published manifest of a package that declares it
      lists it (or a project's own package.json declares it, visible in the
      patch as a direct dependency change), and its "resolved" URL and
      "integrity" match what the registry serves for that version. A new
      package with "verified": false, or with no row, IS suspicious and should
      be flagged; if the file is missing or its "status" is not "ok", treat
      every package new to a lockfile as unverified. Also flag a "resolved" URL
      on any host other than registry.npmjs.org, a missing integrity, or a
      version that changes while its integrity does not. An unfamiliar name
      alone is not evidence of a typosquat.
  # The agent's account of what it did, on the PR it did it to.
  add-comment:
    max: 2
  # Draft -> ready, only when every project validates green and no markers remain.
  mark-pull-request-as-ready-for-review: {}
  report-failure-as-issue: true
  # THE policy knob. A merge legitimately touches any Node file master
  # touched, so the fence is wide and the exclusions are the point: this
  # automation, the registry config, and everything Rust. package.json, the
  # lockfiles and README.md are in gh-aw's DEFAULT protected list and must be
  # excluded from it here - a merge that cannot push the resolved manifest
  # cannot do anything, master edits READMEs, and the guide has design.md pages. Files matching
  # excluded-files are stripped from the patch, not refused: gh-aw restores
  # master's .github/ over the PR head before the agent runs, and that
  # difference must never reach the branch.
  push-to-pull-request-branch:
    target: triggering                          # only the PR this run was dispatched at
    required-title-prefix: "Merge master into " # ...and only if the sync opened it
    allowed-files: ["**"]
    excluded-files:
      # gh-aw globs: `**/x` needs a slash, so it never matches a root file -
      # every `**/` pattern has its root form beside it.
      - ".github/**"
      - ".npmrc"
      - "**/.npmrc"
      - "lib/**"
      - "src/**"
      - "tests/**"
      - "examples/**"
      - "*.rs"
      - "**/*.rs"
      - "*.toml"
      - "**/*.toml"
      - "Cargo.lock"
      - "Cargo.lock.scripting"
    protected-files:
      policy: blocked
      exclude: [package.json, package-lock.json, guide/results-viewer-react/package-lock.json, README.md, design.md, DESIGN.md]
    if-no-changes: warn

pre-agent-steps:
  # gh-aw does not set up Node for the agent job. Same Node as
  # sync-scripting.yml and pr-ppaas.yml (engines: ^22.22.2 || ^24.15.0 || >=26.0.0).
  - name: Add Node.js toolchain
    uses: actions/setup-node@v7
    with:
      node-version: 24
  # The wasm packages are build outputs the root workspace cannot install
  # without, built here from the PR head's lib/ - the merged tree.
  - name: Prepare the runner (Rust, wasm-pack, wasm packages, controller .env)
    run: bash .github/scripts/dep-test-env.sh

  - name: Keep the agent's scratch files out of git and out of the pull request
    run: |
      set -euo pipefail
      mkdir -p .github/aw
      grep -qxF '.github/aw/dep-*' .git/info/exclude 2>/dev/null || echo '.github/aw/dep-*' >> .git/info/exclude

  # Tolerant on purpose: a manifest with conflict markers cannot install, and
  # that is the normal state when this agent is dispatched for conflicts. The
  # agent installs through the wrapper once it has resolved them.
  - name: Install every project from the committed lockfile (may fail - conflicts)
    id: install
    continue-on-error: true
    run: |
      set -euo pipefail
      # fd 3, not stdin: commands in the body (npm, the validate command) can read
      # stdin, and one that does swallows the remaining project paths - the repair
      # agent's context once listed only the root project for that reason.
      while IFS= read -r p <&3; do
        echo "::group::$p - npm ci --ignore-scripts"
        (cd "$p" && npm ci --ignore-scripts)
        echo "::endgroup::"
      done 3< <(jq -r '.projects[].path' .github/dependency-update.json)

  # Everything deterministic, before the agent exists: which PR, which files
  # still carry markers, whether each project validates when none do, and
  # the validate commands from master's config (gh-aw restored .github from
  # master, the branch this workflow runs from - never from the PR's tree).
  - name: Establish the sync context
    env:
      GH_TOKEN: ${{ github.token }}
      INSTALL_OUTCOME: ${{ steps.install.outcome }}
    run: |
      set -euo pipefail
      CFG=.github/dependency-update.json
      mkdir -p .github/aw
      # The agent execs the wrappers by path, so they must be executable. gh-aw
      # restores .github from the activation job's artifact, and artifacts do
      # not keep file modes - the scripts arrive 644 (#418). This step runs
      # after the restore: set the bit, then check it, since a lost bit reads
      # exactly like the allowlist refusal in #415.
      for s in dep-validate dep-npm-sync dep-checkpoint; do
        chmod +x ".github/scripts/$s.sh"
        [ -x ".github/scripts/$s.sh" ] || { echo "::error::.github/scripts/$s.sh is not executable - the agent cannot run it"; exit 1; }
      done
      CTX=.github/aw/sync-context.json
      PR="${GH_AW_PR_HEAD_BASE_PR_NUMBER:-}"
      if [ -z "$PR" ]; then
        jq -n '{pr:null, reason:"this run was dispatched without a pull request in its context"}' > "$CTX"
        echo "::warning::No pull request in this run's context. Dispatch with aw_context={\"item_type\":\"pull_request\",\"item_number\":N}."
        exit 0
      fi
      BASE=$(gh pr view "$PR" --json baseRefName -q .baseRefName)
      TITLE=$(gh pr view "$PR" --json title -q .title)
      # Full history, and both branches. Phase A's rule reads `git log
      # origin/master -- <file>` and `git log origin/<base> -- <file>`; the
      # job starts from a depth-1 checkout of master plus the PR's own
      # commits, so without this origin/<base> may not exist at all, and at a
      # shallow boundary a commit looks like it added every file it holds.
      # About 90 MB for this repo.
      if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
        git fetch -q --unshallow origin 2>/dev/null || git fetch -q --deepen=500 origin 2>/dev/null || true
      fi
      git fetch -q origin "+refs/heads/master:refs/remotes/origin/master" "+refs/heads/$BASE:refs/remotes/origin/$BASE" 2>/dev/null || true
      HISTORY_COMPLETE=true
      { [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "false" ] \
          && git rev-parse -q --verify "refs/remotes/origin/$BASE" >/dev/null \
          && git rev-parse -q --verify refs/remotes/origin/master >/dev/null; } || HISTORY_COMPLETE=false
      # Files still carrying conflict markers. Tracked files only, scratch excluded.
      CONFLICTS=$(git grep -l -E '^(<<<<<<< |>>>>>>> )' -- . ':(exclude).github/aw' 2>/dev/null || true)
      PROJECTS='[]'
      while IFS= read -r p <&3; do
        slug=$( [ "$p" = "." ] && echo root || printf '%s' "$p" | sed 's#/#__#g' )
        validate=$(jq -r --arg p "$p" '.projects[] | select(.path == $p) | .validate' "$CFG")
        [ -n "$validate" ] || { echo "::error::$CFG lists $p without a validate command"; exit 1; }
        printf '%s\n' "$validate" > ".github/aw/dep-validate-cmd-$slug"
        head_ok=false
        if [ -z "$CONFLICTS" ] && [ "$INSTALL_OUTCOME" = "success" ]; then
          echo "::group::$p - validate the PR head"
          if (cd "$p" && timeout --kill-after=30 1500s bash -euo pipefail -c "$validate") > ".github/aw/dep-validate-head-$slug.log" 2>&1; then
            head_ok=true; echo "validates"
          else
            echo "FAILED - see .github/aw/dep-validate-head-$slug.log"; tail -n 30 ".github/aw/dep-validate-head-$slug.log" || true
          fi
          echo "::endgroup::"
        fi
        PROJECTS=$(jq -n --argjson acc "$PROJECTS" --arg p "$p" --arg slug "$slug" --arg v "$validate" --argjson ok "$head_ok" \
                     '$acc + [{path:$p, slug:$slug, validate:$v, headValidates:$ok}]')
      done 3< <(jq -r '.projects[].path' "$CFG")
      # The checkpoint starts empty: the committed head is where we are.
      bash .github/scripts/dep-checkpoint.sh save
      jq -n --argjson pr "$PR" --arg base "$BASE" --arg title "$TITLE" --arg install "$INSTALL_OUTCOME" \
            --argjson conflicts "$(printf '%s\n' "$CONFLICTS" | sed '/^$/d' | jq -R . | jq -s .)" --argjson projects "$PROJECTS" \
            --argjson history "$HISTORY_COMPLETE" \
        '{pr:$pr, base:$base, title:$title, installOutcome:$install, conflicts:$conflicts, projects:$projects, historyComplete:$history}' > "$CTX"
      jq . "$CTX"
---

# Scripting sync repair: pewpew

You are finishing a **draft pull request** that merges `master` into this
repository's scripting branch (`0.6.0-scripting-dev`). The merge has already
happened and is committed on the PR branch; it stopped where a human doing
this by hand would have had to think: the merge conflicted in Node files, or
the merged tree does not install or validate. Everything deterministic is done.

Read `.github/aw/sync-context.json` first: `pr`, `base`, `title`,
`installOutcome`, `conflicts` (tracked files that still carry markers) and
`projects[]` - one entry per npm project with `path`, `slug`, `validate` and
`headValidates` - and `historyComplete`: whether the checkout holds full
history of both `origin/master` and `origin/<base>`, which the `git log`
checks in Phase A depend on. Then read the pull request body (`get_pull_request`): it
lists every master commit the merge brought in, with links, and the
`## Conflicts` section if there was one. That is your record of what master
intended.

Your job is the judgment: **resolve each conflict as master's change in the
scripting branch's shape, make every project install and validate, and hand
back a green PR - or a draft that says exactly where it stands.** You are
judged only by what you hand to the safe-outputs tools.

## Decide from the context first

| Situation | What to do |
|---|---|
| `pr` is `null` | `noop` - dispatched without a pull request. |
| `conflicts` is empty and every project has `headValidates: true` | Nothing to do (a re-dispatch after a fix). `mark_pull_request_as_ready_for_review` with a one-line comment. Do not touch the tree. |
| `conflicts` names anything under `lib/`, `src/`, `tests/`, `examples/`, `.github/`, or any `Cargo.*` / `*.rs` / `*.toml` | Not yours - the sync does not dispatch for these, so one here means a human is already needed. Do not touch the tree. `add_comment` naming the files and stop. |
| `conflicts` is non-empty | Phase A, then Phase B. |
| `conflicts` is empty, a project has `headValidates: false` | Phase B only: the merge was clean but the tree is red. |

## The checkpoint

Type every wrapper exactly as `.github/scripts/<name>.sh <args>`, from the
repository root. `bash`, `sh`, absolute-path and `$GITHUB_WORKSPACE` prefixes
are not allowlisted and are refused - a refusal means the prefix, not the
script; a non-zero exit from the script itself is a result to read, not a
reason to retry it another way.

`.github/scripts/dep-checkpoint.sh save` records the whole tree as the
last state known to validate; `restore` throws away everything since and
re-installs every project from its lockfile. At the start of a conflict run
it is empty: the committed head is the merge with markers, and nothing
validates yet. **Save after every change that validated green. Restore after
any that did not.**

## Phase A - resolve the conflicts

Work the files in `conflicts` one at a time. A conflict is `<<<<<<<` (ours:
the scripting branch), `=======`, `>>>>>>>` (theirs: master). The two lines
diverge in a known way - master is the released line, the scripting branch
is the same code further along - so the resolution follows from the kind of
hunk:

| File | Rule |
|---|---|
| `package.json` → `version` | **The higher of the two.** Both lines bump their own versions (master on release, the scripting branch for its previews); a merge never lowers one and never invents a third. |
| `package.json` → dependencies, `devDependencies`, `overrides`, `engines`, scripts | **master wins** - its ranges are what the monthly update and its agent chose. Keep any key that exists only on the scripting side (`guide/results-viewer-react` declares `@fs/config-gen` as a `file:` dependency master does not have). When both changed the same dependency's range, master's. |
| `package-lock.json` (any) | **never hand-merged.** After the project's `package.json` is clean: `.github/scripts/dep-npm-sync.sh <project> install` regenerates it. A lockfile with markers is not JSON and nothing can read it. |
| Source, tests and fixtures under `common/`, `agent/`, `controller/`, `guide/` | **master's change, in the scripting branch's shape.** Read both sides and `git log -3 --format='%h %s' origin/master -- <file>` / `origin/<base> -- <file>`. Port what master changed (a fix, a renamed import, a new option a dependency major required) into the code as the scripting branch has it - do not replace the scripting branch's structure with master's. A hunk where the scripting side merely lags master (it missed an earlier forward-merge) is master's. If `historyComplete` is `false` these logs are not trustworthy (a shallow boundary makes old commits look like they touched everything): port only what master's side of the conflict plainly shows, and where you cannot tell a port from a regression, leave that file under **Not resolved**. |
| A file master changed that the scripting branch moved or split | Find where that content lives on the scripting branch (`git log --follow`, `git grep` for a distinctive line) and port the change there; take the deletion of the old path. |
| A `.scripting` sibling file (`package-lock.json.scripting`, `Cargo.lock.scripting`) | Not yours; leave it exactly as the merge left it. |

After each file: confirm no markers remain (`git grep -n -E '^(<<<<<<< |=======$|>>>>>>> )' -- <file>` is empty), and for a `package.json` confirm it parses (`jq . <file>`). Only when **every** file in `conflicts` is clean: `.github/scripts/dep-npm-sync.sh <project> install` for each project whose manifest or lockfile changed. If npm refuses - a range the merged manifest cannot satisfy - read why: a peer range is a `package.json` fix per the table above; anything else is a human's call, recorded under **Not resolved** with npm's exact message.

## Phase B - make it green

If `installOutcome` is not `success` and you have not already re-resolved,
there is no usable `node_modules` yet: `.github/scripts/dep-npm-sync.sh
<project> install` first for each project and read why it failed last time.

`.github/scripts/dep-validate.sh <project>` for every project. Green →
save the checkpoint and go to *What to hand back*. Red → read the failure
and fix what **the merge** broke, not what was already wrong:

- A lint or type error in a file master changed: fix it the way the
  surrounding code does.
- A test on the scripting side that asserts on something master changed (a
  fixture, a message, a default): update it to master's behaviour, unless the
  scripting branch's behaviour is deliberately different, in which case the
  ported change is what needs adjusting.
- A dependency major master took that needs one more code change on the
  scripting side (code master does not have): the minimal change the new
  version requires, in the same shape master's own change used.

Bound: changes the merge requires, done the way the surrounding code does
them. No refactors, no drive-by cleanups, no new dependencies, nothing under
`lib/`, `src/`, `tests/`, `examples/`, `.github/`, no `Cargo.*`, no `.npmrc`.
Validate again. Green → save and hand back. Still red after a genuine attempt
→ restore the checkpoint if you saved one, and hand back a draft that says
exactly what fails and why.

## Rules

- **Versions are the merge's business, not yours.** The only time you touch
  a `version` is to resolve a conflict in it, to the higher side.
- **No new dependencies, no registry changes, nothing forced.** npm is
  reachable only through the wrappers; they force `--ignore-scripts` and
  refuse options. No `--force`, no `--legacy-peer-deps`.
- **Never** commit, push, amend, rebase, or run anything with `sudo`. Leave
  the tree as it is: `push_to_pull_request_branch` turns the whole diff into
  **one commit** appended to the PR branch. The merge commit with markers
  stays in history - that is fine and expected; your commit resolves it.
- No AI attribution or branding anywhere.

## What to hand back

1. `push_to_pull_request_branch` - **only if** the tree differs from the PR
   head. What may reach the PR is bounded structurally by this workflow's
   fence; a refused push means you edited outside it - fix that, do not work
   around it.
2. `add_comment` on the pull request, with:
   - **Resolved**: each conflicted file and the one-line rule you applied
     (e.g. `common/src/yamlparser.ts: ported master's encode() fix into the scripting parser`).
   - **Fixed after merge**: files changed in Phase B and why.
   - **Not resolved**, if anything: the file or the install error, verbatim,
     and what a human needs to decide.
   - **Validation**: each project's command and its final result.
3. `mark_pull_request_as_ready_for_review` - if and only if no markers remain
   anywhere, every project installed, and every project's final validation
   was green. A merge you could not finish stays a draft, with the comment
   saying where it stands - a documented stop is a successful run.
