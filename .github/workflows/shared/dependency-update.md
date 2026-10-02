---
# pewpew's node dependency REPAIR AGENT - the shared procedure. This is NOT a
# workflow (no `on:`); dependency-agent.md imports it, and gh-aw inlines it
# into dependency-agent.lock.yml at compile time. Adapted from
# fs-eng/perfqa-update's shared/dependency-update.md (PERF-4551/PERF-4615) for
# a public monorepo on public npm with a wider mandate: this agent may take
# dependency MAJORS and make the code changes they need.
#
# Where this sits: dependency-update.yml (no AI in it) updates every listed
# project within its declared ranges, validates each, and opens the PR. It is
# READY when everything validated and nothing is out of range. Otherwise it is
# a DRAFT and this workflow is dispatched at it, for one or both of:
#   - a project's validate command went red: a deterministic bisect
#     (.github/scripts/dep-bisect.sh) has already found the culprit(s) and left
#     the best validated lockfile in the tree; the agent decides fix-or-hold.
#   - the declared ranges hold back newer versions: the agent takes them, one
#     at a time, with the code changes each needs, validating after each.
#
# Every script the agent runs is a real, tracked file under .github/scripts/,
# taken from the BASE branch by gh-aw's config-folder restore - never from the
# pull request's own tree. Runtime files live in .github/aw/dep-* (excluded
# from every push and from git via .git/info/exclude).

# The agent runs behind gh-aw's egress firewall. `node` is npm's registries -
# this repo installs from registry.npmjs.org and has no Artifactory. `github`
# covers changelog lookups and the pewpew binary that DOWNLOAD_PEWPEW fetches
# from this repo's releases during the controller/agent tests.
network:
  allowed:
    - defaults
    - node
    - github

# Each entry compiles to a literal shell() PREFIX matcher, so this list is
# structural over what the agent may TYPE. There is no bare `npm:*`: every
# install goes through a wrapper that forces --ignore-scripts and refuses
# options (a bare prefix would also admit `--registry=...`). No `npx:*`, no
# `node:*` - both are arbitrary code execution, and attacker-influenced release
# notes reach this agent through `github`. The engine keeps its own file read
# and write tools, which is the point of a repair agent; the wrappers bound
# npm, not the workspace.
tools:
  bash:
    # Wrappers are allowlisted by their PATH, and the prompt calls them that way
    # (`.github/scripts/x.sh <args>`). The Copilot CLI never matches a rule that
    # starts with `bash` - `bash <path>` is refused even as an exact match - so
    # both the plain and ./ forms of the path are listed. (Verified against CLI
    # 1.0.80; the first run of this agent was refused every wrapper, #415.)
    - ".github/scripts/dep-validate.sh:*"      # <project>            - run that project's validate command
    - "./.github/scripts/dep-validate.sh:*"
    - ".github/scripts/dep-npm-update.sh:*"    # <project> <names...> - npm update, names only
    - "./.github/scripts/dep-npm-update.sh:*"
    - ".github/scripts/dep-npm-sync.sh:*"      # <project> ci|install - restore the lockfile / re-resolve it from package.json
    - "./.github/scripts/dep-npm-sync.sh:*"
    - ".github/scripts/dep-checkpoint.sh:*"    # save|restore         - the last-known-green tree
    - "./.github/scripts/dep-checkpoint.sh:*"
    - "npm ls:*"
    - "npm view:*"
    - "npm outdated:*"
    - "npm audit --json"
    - "git:*"
    - "jq:*"
    - "diff:*"
    - "date:*"

safe-outputs:
  # Issues are for Phase A only: an in-range update that broke validation and
  # stayed rolled back, or a package the bisect held back for a reason of its
  # own. Neither survives anywhere else once the run ends. Out-of-range
  # versions the agent could NOT take do not get issues: they are listed in
  # the PR comment and come round again next month. Cap is five per run and
  # `create-issue` truncates silently - see *The issue budget*.
  create-issue:
    title-prefix: "[node dependency update] "
    labels: [dependencies, javascript]
    max: 5
  # The agent's account of what it did, on the pull request it did it to.
  add-comment:
    max: 2
  # Draft -> ready, only when the final tree validates green.
  mark-pull-request-as-ready-for-review: {}
  report-failure-as-issue: true

pre-agent-steps:
  # gh-aw does not set up Node for the agent job; without this the tests would
  # run on whatever the runner image ships. Pin what dependency-update.yml and
  # pr-ppaas.yml use, so the agent validates against the same Node the update
  # did (engines: >=20 <25).
  - name: Add Node.js toolchain
    uses: actions/setup-node@v4
    with:
      node-version: 24
  # The wasm packages are build outputs the root workspace cannot install
  # without, and the controller tests read a .env - same script the update
  # workflow uses, so both halves see the same tree.
  - name: Prepare the runner (Rust, wasm-pack, wasm packages, controller .env)
    run: bash .github/scripts/dep-test-env.sh

  - name: Keep the agent's scratch files out of git and out of the pull request
    run: |
      set -euo pipefail
      mkdir -p .github/aw
      grep -qxF '.github/aw/dep-*' .git/info/exclude 2>/dev/null || echo '.github/aw/dep-*' >> .git/info/exclude

  - name: Install every project from the committed lockfile
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

  # Per project: write the validate command (from the BASE branch's config,
  # restored above - the PR does not get to choose the command that runs with
  # the job's tokens in scope), validate the PR head, bisect if red, and survey
  # what the ranges hold back. Then checkpoint the tree. The agent reads the
  # results from .github/aw/ and never has to reconstruct them.
  - name: Establish the repair context - validate each project, bisect the red ones, survey the ranges
    env:
      GH_TOKEN: ${{ github.token }}
      # Per red project. Two red projects at 1800 s each still fit the job.
      DEP_BISECT_BUDGET_SECONDS: "1800"
    run: |
      set -euo pipefail
      CFG=.github/dependency-update.json
      ROOT=$(pwd)
      mkdir -p .github/aw
      # The agent execs the wrappers by path, so they must be executable. gh-aw
      # restores .github from the activation job's artifact, and artifacts do
      # not keep file modes - the scripts arrive 644 (#418). This step runs
      # after the restore: set the bit, then check it, since a lost bit reads
      # exactly like the allowlist refusal in #415.
      for s in dep-validate dep-npm-update dep-npm-sync dep-checkpoint; do
        chmod +x ".github/scripts/$s.sh"
        [ -x ".github/scripts/$s.sh" ] || { echo "::error::.github/scripts/$s.sh is not executable - the agent cannot run it"; exit 1; }
      done
      CTX=.github/aw/dep-repair-context.json

      PR="${GH_AW_PR_HEAD_BASE_PR_NUMBER:-}"
      if [ -z "$PR" ]; then
        jq -n '{pr:null, reason:"this run was dispatched without a pull request in its context"}' > "$CTX"
        echo "::warning::No pull request in this run's context. Dispatch with aw_context={\"item_type\":\"pull_request\",\"item_number\":N}."
        exit 0
      fi
      BASE=$(gh pr view "$PR" --json baseRefName -q .baseRefName)
      TITLE=$(gh pr view "$PR" --json title -q .title)

      # The bisect needs the commit this PR was cut from, not the base's tip,
      # or every lockfile change the base picked up since gets attributed to
      # this update. Deepen both sides so a merge base exists (the checkout is
      # depth 1). Neither fetch may be fatal: a blip must not end the run
      # before the fallback below gets to decide.
      git fetch --depth=50 origin "+$BASE:refs/remotes/origin/$BASE" \
        || echo "::warning::Could not deepen origin/$BASE. Continuing with whatever history this checkout already has."
      git fetch --deepen=50 origin 2>/dev/null || true
      if ! git rev-parse --verify -q "refs/remotes/origin/$BASE" >/dev/null; then
        echo "::error::origin/$BASE is not present in this checkout and could not be fetched - no baseline to bisect against."
        exit 1
      fi
      BASE_REF="origin/$BASE"
      if MERGE_BASE=$(git merge-base "origin/$BASE" HEAD 2>/dev/null) && [ -n "$MERGE_BASE" ]; then
        BASE_REF="$MERGE_BASE"
      else
        echo "::warning::Could not determine the merge base (shallow history); bisecting against origin/$BASE instead."
      fi

      PROJECTS='[]'
      while IFS= read -r p <&3; do
        slug=$( [ "$p" = "." ] && echo root || printf '%s' "$p" | sed 's#/#__#g' )
        validate=$(jq -r --arg p "$p" '.projects[] | select(.path == $p) | .validate' "$CFG")
        [ -n "$validate" ] || { echo "::error::$CFG lists $p without a validate command"; exit 1; }
        printf '%s\n' "$validate" > ".github/aw/dep-validate-cmd-$slug"

        echo "::group::$p - validate the PR head"
        head_ok=false
        if (cd "$p" && timeout --kill-after=30 1500s bash -euo pipefail -c "$validate") > ".github/aw/dep-validate-head-$slug.log" 2>&1; then
          head_ok=true; echo "validates"
        else
          echo "FAILED - see .github/aw/dep-validate-head-$slug.log"; tail -n 30 ".github/aw/dep-validate-head-$slug.log" || true
        fi
        echo "::endgroup::"

        bisect_rc=null; bisect_report=null
        if [ "$head_ok" = false ]; then
          echo "::group::$p - bisect"
          set +e
          (cd "$p" && bash "$ROOT/.github/scripts/dep-bisect.sh" --base "$BASE_REF" --validate "$validate" \
              --report "$ROOT/.github/aw/dep-bisect-report-$slug.json" --budget-seconds "$DEP_BISECT_BUDGET_SECONDS" \
              2> "$ROOT/.github/aw/dep-bisect-stderr-$slug.log")
          bisect_rc=$?
          set -e
          tail -n 20 ".github/aw/dep-bisect-stderr-$slug.log" || true
          if [ -f ".github/aw/dep-bisect-report-$slug.json" ]; then
            bisect_report=".github/aw/dep-bisect-report-$slug.json"
            echo "outcome: $(jq -r .outcome "$bisect_report") (exit $bisect_rc); culprits: $(jq -r '[.culprits[].name] | join(", ")' "$bisect_report")"
          else
            echo "::warning::bisect exited $bisect_rc without writing a report"
          fi
          echo "::endgroup::"
        fi

        # Out-of-range survey, read-only (dry-run touches nothing), against
        # the tree as it stands - the bisect's accepted set if it ran.
        echo "::group::$p - survey what the ranges hold back"
        survey=".github/aw/dep-report-$slug.json"
        if ! REPORT_FILE="$survey" PR_BODY_FILE="/tmp/dep-body-$slug.md" node .github/scripts/dependency-update.mjs --project "$p" --dry-run >/dev/null; then
          echo "::warning::$p: the out-of-range survey failed; the agent has no worklist for this project this run"
          survey=null
        else
          echo "$(jq -r '.agentCandidates' "$survey") candidate(s) not on the hold list"
        fi
        echo "::endgroup::"

        PROJECTS=$(jq -n --argjson acc "$PROJECTS" --arg p "$p" --arg slug "$slug" --arg v "$validate" \
                     --argjson ok "$head_ok" --argjson rc "$bisect_rc" \
                     --arg br "${bisect_report:-}" --arg sv "${survey:-}" \
                     '$acc + [{path:$p, slug:$slug, validate:$v, headValidates:$ok, bisectExit:$rc,
                                bisectReport:(if $br == "" or $br == "null" then null else $br end),
                                survey:(if $sv == "" or $sv == "null" then null else $sv end)}]')
      done 3< <(jq -r '.projects[].path' "$CFG")

      # First checkpoint: the tree the bisect(s) left, which validates by
      # construction. Empty when every head validated - normal for a
      # majors-only dispatch.
      bash .github/scripts/dep-checkpoint.sh save
      jq -n --argjson pr "$PR" --arg base "$BASE" --arg baseRef "$BASE_REF" --arg title "$TITLE" --argjson projects "$PROJECTS" \
        '{pr:$pr, base:$base, baseRef:$baseRef, title:$title, projects:$projects}' > "$CTX"
      jq . "$CTX"
---

# Node dependency repair - pewpew procedure

You are working on the **draft pull request** that this repository's monthly
node dependency update opened. Everything that needs no judgment has already
happened before you started:

- Every listed project was updated **within its declared ranges** and
  `npm audit fix` ran inside those same ranges. Only lockfiles changed.
- Each project's validate command ran against that result.
- For any project that went red, a deterministic bisect found which package(s)
  broke it, held each at its baseline version, and left **the best validated
  lockfile in the working tree**.
- For every project, the versions the declared ranges hold back were surveyed.

Read `.github/aw/dep-repair-context.json` first. It has `pr`, `base`,
`baseRef`, `title`, and `projects[]` - one entry per project with `path`,
`slug`, `validate`, `headValidates`, `bisectExit`, `bisectReport` (a path, or
null) and `survey` (a path, or null). Then, per project:

- `survey` → `dep-report-<slug>.json`: `outOfRange[]` rows with `name`, `type`,
  `wanted`, `latest`, `crossesMajor` and `held` (a reason, or null). **Rows with
  `held: null` are your Phase B worklist.** `agentCandidates` counts them.
- `bisectReport` → `dep-bisect-report-<slug>.json`: `outcome`, `accepted`,
  `culprits`, `held_back`, `trials`, `final`, `budget`, `baseline`. Every
  package that changed is in exactly one of `accepted`, `culprits` or
  `held_back`.

Every wrapper takes the **project path** first (`.` or
`guide/results-viewer-react`). You are judged only by what you hand to the
safe-outputs tools.

## Decide from the context first

| Situation | What to do |
|---|---|
| `pr` is `null` | `noop` - dispatched without a pull request. Nothing to do. |
| Every project has `headValidates: true` **and** every survey has `agentCandidates: 0` | Nothing to repair and nothing to take. `mark_pull_request_as_ready_for_review` with a one-line comment. Do not touch the tree. |
| A project's bisect `outcome` is `baseline-red` | Its **unchanged** base already fails validation - not this PR's doing. `create_issue` describing it (quote `final.log_excerpt`), say so in your comment, and **skip both phases for that project**: nothing can be validated there. Continue with the others. |
| A project's `bisectReport` is `null` although `headValidates` is `false`, or `outcome` is `aborted` | The bisect could not run (see `dep-bisect-stderr-<slug>.log`). `create_issue` with that stderr, say so in your comment, skip that project. |
| Otherwise | Phase A for every red project, then Phase B for every project with candidates, then the version bump, then the final check. |

## The checkpoint

Type every wrapper exactly as `.github/scripts/<name>.sh <args>`, from the
repository root. `bash`, `sh`, absolute-path and `$GITHUB_WORKSPACE` prefixes
are not allowlisted and are refused - a refusal means the prefix, not the
script; a non-zero exit from the script itself is a result to read, not a
reason to retry it another way.

`.github/scripts/dep-checkpoint.sh save` records the whole tree as the
last state known to validate; `restore` throws away everything since and
re-installs every project. It already holds what the bisect left. **Save after
every change that validated green. Restore after any that did not.** A fix
that is not in the checkpoint is a fix the next failure silently deletes.

## Phase A - repair the red projects

For each project with a bisect report whose `outcome` is `culprits` or
`budget-exhausted`, the tree already validates: it is the accepted set with
every culprit at baseline. For **each** culprit in that project:

1. Read its `log_excerpt` and `from -> to`. Is the failure something a
   **minimal** change fixes - one or two lines, in one or two files, of the
   kind a reviewer accepts on sight (a renamed type, a changed import, a new
   required option, a stricter annotation)? These are in-range updates, so a
   large fix means the package is not really honouring its range; that goes to
   a human.
2. Re-apply that one update on top of the checkpoint:
   `.github/scripts/dep-npm-update.sh <project> <culprit>`, then confirm
   it moved: `jq -r '.packages["node_modules/<culprit>"].version'
   <project>/package-lock.json` must equal the culprit's `to`. If it does not,
   the update is not reproducible here (a nested transitive only `npm audit
   fix` reaches): leave it rolled back and file the issue saying that, not
   that the package breaks anything.
3. Make the edit, then `.github/scripts/dep-validate.sh <project>`.
4. Green → `.github/scripts/dep-checkpoint.sh save`, record it as **Repaired**. Red, or more
   than minimal → `.github/scripts/dep-checkpoint.sh restore`, record it as **Rolled back**
   and `create_issue` for it: title `<package> <from> -> <to> breaks <validate
   command> (<project>)`, body with the excerpt, what you tried, and the PR
   link. Read *The issue budget* before opening the first one.

Everything in `held_back` gets **one combined issue** for the run (see the
budget), titled `<n> packages held back by the node dependency update`, each
with its `reason` and `detail` and what that means for a human. Never title
these `breaks ...` - most were never validated at all.

| `reason` | What the issue should say |
|---|---|
| `budget-exhausted` | Never tried - the bisect ran out of budget. Needs a rerun or a manual check. |
| `not-reproducible` | `npm update <package>` cannot reproduce the PR's move on its own (a transitive only `npm audit fix` reaches). |
| `install-failed` | The install itself failed - quote the excerpt. Not evidence the package is broken. |
| `audit-fix-failed` / `audit-fix-conflict` | A trial's `npm audit fix` failed or left the declared ranges, so a security fix the PR carried is missing from the accepted set. |
| `validate-timeout` | Validation timed out twice on that subset. |
| `validate-failed-at-finalize` | The accepted set failed its final re-validation and was rolled back. Needs a human first. |

### The issue budget

Five issues per run, `create_issue` truncates silently, so split before the
first one: with anything held back, **4** for culprits and **1** combined for
held-back; with nothing held back, **5** for culprits. Combine culprits into
one issue rather than exceed the slots. Issues are for Phase A only - Phase B
outcomes go in the comment, not in issues.

## Phase B - take what the ranges hold back

This is what makes this repository different from the downstream ones: **you
may move a dependency to a new major**, with the code, script, `overrides` or
config changes it genuinely needs. For each project with candidates, work the
worklist **one package at a time**, in this order: everything else
alphabetically first, then `@types/node`, then `typescript` - the last two
cascade into everything and are best attempted with the rest already green.
Skip anything `held` without comment beyond listing it. Skip - and say why -
anything whose `latest` drops Node 22 (`npm view <pkg>@<latest> engines`);
this repo runs 22, 24 and 26.

For each candidate:

1. **Bump the range in every `package.json` under the project that declares
   it.** For the root workspace that is the root manifest and `common/`,
   `agent/`, `controller/` - they move together, like `mocha` did. Keep the
   range operator the manifest already uses (`^`, `~`, or exact). If an
   `overrides` entry pins the old major for some dependent's copy, re-key it to
   apply only there (the accepted pattern is `"mocha@<12": {...}`) rather than
   deleting it. Never edit `holdMajors`, `engines`, or anything under `.github/`.
2. **Re-resolve:** `.github/scripts/dep-npm-sync.sh <project> install`.
   Confirm the lockfile now records `latest` for the package (`jq -r
   '.packages["node_modules/<pkg>"].version' <project>/package-lock.json`). If
   npm resolved something else, a peer range elsewhere is holding it: read the
   ERESOLVE / `npm ls` output, and if the peer is another candidate on the
   worklist try that one first; otherwise restore and record **Not taken:
   peer range** naming the dependent. Do not `--force`, do not add overrides
   to defeat a peer.
3. **Validate:** `.github/scripts/dep-validate.sh <project>`.
4. Green → `.github/scripts/dep-checkpoint.sh save`, record **Taken** (package, `from -> to`,
   files changed, one line on what the version needed). Red → read the
   failure: if it is what the new major's breaking change requires (a renamed
   API, a changed option, a stricter type, a CLI flag it now parses
   differently), make exactly that change - the way the surrounding code does
   it, no refactors, no drive-by cleanups, no new dependencies - and validate
   again. Green → save, record **Taken** with the code change described. Still
   red, or the change would be a rewrite → `.github/scripts/dep-checkpoint.sh restore`, record
   **Not taken** with the first relevant failure lines and why.
5. Keep an eye on the clock (`date -u`). Each attempt is a minute of install
   plus two to four minutes of validation. When fewer than thirty minutes of
   the job remain, stop attempting and list the rest as **Not attempted this
   month** - they come round again next month, nothing is lost.

## This repository's own version

Only after your last change, and only if the tree differs from the PR head
by more than lockfiles: bump the affected project's own `version`. The root
workspace's four manifests (`package.json`, `common/`, `agent/`,
`controller/`) share one version and move together; `guide/results-viewer-react`
has its own. **Patch** when only manifests, `overrides`, lockfiles or
build/test config changed; **minor** when source under `src/`, `pages/` or
`components/` changed. **Never a major** - `5.0.0` is a release decision for a
human. Then `.github/scripts/dep-npm-sync.sh <project> install` so the lockfile records the
new versions, validate once more, and save. A lockfile-only outcome bumps
nothing.

## Final check

Run `.github/scripts/dep-validate.sh <project>` on every project you
touched. Every one must be green. If one is not, you have a bug in your own
work: `.github/scripts/dep-checkpoint.sh restore`, validate again, and hand back that state
(re-doing the version bump if the restore predates it). Then confirm every
version you are about to report as Taken or Repaired is actually recorded in
that project's lockfile - the comment must not claim an update the lockfile
does not contain.

## Rules

- **Never edit** any `.npmrc`, anything under `lib/`, or any `Cargo.*` - the
  fence refuses the whole patch if you do. Anything under `.github/` is
  silently left out of the push, so a fix there never reaches the PR: if
  validation only passes with one, that is a **Not taken**, not a success.
- **Install scripts never run, the registry never moves, nothing is forced.**
  npm is reachable only through the wrappers; they force `--ignore-scripts`
  and refuse options. No `--force`, no `--legacy-peer-deps`.
- **No new dependencies.** A version bump is a bump of what is already
  declared. If a new package would be needed, that is Not taken.
- **Never** commit, push, amend, rebase, or run anything with `sudo`. Leave
  the tree as it is: `push_to_pull_request_branch` turns the whole diff into
  **one commit** appended to the PR branch. Your comment is therefore the
  per-package record a reviewer reads - make it carry what separate commits
  would have.
- No AI attribution or branding anywhere - commit, comment, or issue.

## What to hand back

Always, in this order:

1. `push_to_pull_request_branch` - **only if** the tree differs from the PR
   head. What may reach the PR is bounded structurally by this workflow's
   fence; a refused push means you edited outside it - fix that, do not work
   around it.
2. `add_comment` on the pull request, per project, with:
   - **Repaired** / **Rolled back** (Phase A): package, `from -> to`, the
     file(s) or the issue.
   - **Taken**: package, `from -> to`, files changed, one line on what the
     version needed. This is the record of every range change in the PR.
   - **Not taken**: package, `wanted -> latest`, the reason (peer range with
     the dependent named, failure excerpt, drops Node 22, would be a rewrite).
   - **Held** (from `holdMajors`): just the list, with the config's reasons.
   - **Not attempted this month**, if you ran out of time.
   - **Version**: what you bumped, from -> to, patch or minor and why.
   - **Validation**: each project's command and its final result.
   Copy versions and reasons from the reports rather than paraphrasing them.
3. `mark_pull_request_as_ready_for_review` - if and only if **every listed
   project** ended green: each one you touched passed its final validation,
   each one you did not touch had `headValidates: true`, and no project was
   skipped (`baseline-red`, missing or aborted bisect). A draft you could not
   make green stays a draft, with the comment saying exactly where it stands.

A documented Not taken is a successful run. A range change that "works"
because a peer was forced, or a version bump to a new major of this repo's own
packages, is not.
