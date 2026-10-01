#!/usr/bin/env bash
# Merges master into the scripting branch and opens the pull request - the
# forward-merge this repository does by hand after master changes (branch off
# 0.6.0-scripting-dev, merge master, fix conflicts, check the lockfiles, PR
# back into the scripting branch). The Node side of that merge is routine
# (both branches declare the same dependencies; the monthly node update lands
# on master); the Rust side is where the branches have diverged structurally
# and stays a human's job.
#
# Decision table:
#   nothing on master that the target lacks         -> summary, no PR, exit 0
#   merge clean                                     -> rebuild the wasm packages,
#                                                      re-resolve every lockfile,
#                                                      validate every project;
#                                                      READY PR if green, DRAFT +
#                                                      sync agent if red
#   only lockfiles conflict                         -> take master's, re-resolve
#                                                      from the merged manifests,
#                                                      continue as a clean merge
#   other conflicts, all in Node files              -> commit them WITH their
#                                                      markers, DRAFT PR, sync
#                                                      agent resolves them
#   any conflict in Rust, *.toml or .github/ files  -> commit them with markers,
#                                                      DRAFT PR, NO agent - the
#                                                      body says which files need
#                                                      a human
#   PR for this branch exists (same-day rerun)      -> edit it, re-sync draft/ready
#
# Required env:
#   TARGET_BRANCH, GITHUB_REPOSITORY, GH_TOKEN
# Optional env:
#   SOURCE_BRANCH (master), CONFIG (.github/dependency-update.json),
#   TEST_ENV_SCRIPT (.github/scripts/dep-test-env.sh; the wasm rebuild after
#   the merge - the harness points it at `true`), REPAIR_WORKFLOW
#   (sync-scripting-agent.lock.yml; empty disables the hand-off), LABELS
#   (scripting-sync), GIT_REMOTE (origin), GITHUB_SERVER_URL, GITHUB_RUN_ID,
#   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, RUNNER_TEMP
set -euo pipefail

: "${TARGET_BRANCH:?TARGET_BRANCH is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
SOURCE_BRANCH="${SOURCE_BRANCH:-master}"
CONFIG="${CONFIG:-.github/dependency-update.json}"
TEST_ENV_SCRIPT="${TEST_ENV_SCRIPT:-.github/scripts/dep-test-env.sh}"
REPAIR_WORKFLOW="${REPAIR_WORKFLOW-sync-scripting-agent.lock.yml}"
LABELS="${LABELS:-scripting-sync}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GITHUB_SERVER_URL="${GITHUB_SERVER_URL:-https://github.com}"
TMP="${RUNNER_TEMP:-/tmp}"; mkdir -p "$TMP"

out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; echo "sync: $1=$2"; }
summary() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
finish_empty() { out has_changes false; out conflicts 0; out source_commits "${1:-0}"; out pr_number ""; out pr_url ""; out branch ""; out validation skipped; out repair_dispatched false; }

RUN_URL=""
[ -z "${GITHUB_RUN_ID:-}" ] || RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Both tips, with the history behind them: a shallow checkout has no merge
# base and git would merge the two branches as unrelated.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  echo "Checkout is shallow - fetching full history (use fetch-depth: 0 in the workflow to skip this)"
  git fetch -q --unshallow "$GIT_REMOTE"
fi
git fetch -q "$GIT_REMOTE" "+refs/heads/${SOURCE_BRANCH}:refs/remotes/${GIT_REMOTE}/${SOURCE_BRANCH}" "+refs/heads/${TARGET_BRANCH}:refs/remotes/${GIT_REMOTE}/${TARGET_BRANCH}"
SRC="${GIT_REMOTE}/${SOURCE_BRANCH}"
TGT="${GIT_REMOTE}/${TARGET_BRANCH}"

PENDING=$(git rev-list --count --no-merges "${TGT}..${SRC}")
echo "${PENDING} commit(s) on ${SOURCE_BRANCH} are not on ${TARGET_BRANCH}"
if [ "$PENDING" -eq 0 ]; then
  summary "Up to date: every commit on \`${SOURCE_BRANCH}\` is already on \`${TARGET_BRANCH}\`. No pull request."
  finish_empty 0
  exit 0
fi

TODAY=$(date -u +%F)
BRANCH="merge-${SOURCE_BRANCH}-into-${TARGET_BRANCH}-${TODAY}"
TITLE="Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH} ${TODAY}"
git checkout -q -B "$BRANCH" "$TGT"

# ---------------------------------------------------------------------------
# The merge.
CONFLICTS=""
MERGE_RC=0
git merge --no-edit -m "Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}" "$SRC" || MERGE_RC=$?
if [ "$MERGE_RC" -ne 0 ]; then
  CONFLICTS=$(git diff --name-only --diff-filter=U)
  if [ -z "$CONFLICTS" ]; then
    echo "::error::git merge failed without reporting conflicts - see the output above. Nothing was pushed." >&2
    git merge --abort 2>/dev/null || true
    exit 1
  fi
fi

# Lockfiles are never hand-merged: take master's copy of each conflicted one
# and let `npm install` below re-resolve it from the merged package.json. If
# that was every conflict, the merge is as good as clean.
LOCK_CONFLICTS=$(printf '%s\n' "$CONFLICTS" | grep -E '(^|/)package-lock\.json$' || true)
if [ -n "$LOCK_CONFLICTS" ]; then
  while IFS= read -r lf; do
    [ -n "$lf" ] || continue
    git checkout -q --theirs -- "$lf" && git add -- "$lf"
    echo "lockfile conflict in $lf - took ${SOURCE_BRANCH}'s copy, re-resolved below"
  done <<< "$LOCK_CONFLICTS"
  CONFLICTS=$(printf '%s\n' "$CONFLICTS" | grep -vE '(^|/)package-lock\.json$' || true)
fi

# Which conflicts the agent may resolve. Rust files, any *.toml (Cargo, the
# lint configs, the guide's book.toml) and the automation under .github/ are
# a human's: the wasm build in the agent's own setup cannot
# compile a tree with markers in it, and the agent's push fence strips
# .github/** from whatever it pushes.
HUMAN_CONFLICTS=$(printf '%s\n' "$CONFLICTS" | grep -E '^(\.github/|lib/|src/|tests/|examples/|Cargo\.|.*\.rs$|.*\.toml$)' || true)
AGENT_CONFLICTS=$(printf '%s\n' "$CONFLICTS" | grep -vxF -f <(printf '%s\n' "$HUMAN_CONFLICTS"; echo '__none__') || true)

if [ "$MERGE_RC" -ne 0 ]; then
  if [ -z "$CONFLICTS" ]; then
    git commit -q --no-verify -m "Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}

Lockfile conflicts resolved by taking ${SOURCE_BRANCH}'s copy; re-resolved from the merged manifests in the next commit."
    echo "only lockfiles conflicted - continuing as a clean merge"
  else
    # Commit the rest, markers and all. `git add` of a conflicted path stages
    # the working copy as-is and clears the unmerged state, which is what lets
    # this commit exist. The agent (or a human) resolves them on the branch.
    N=$(printf '%s\n' "$CONFLICTS" | grep -c . || true)
    git add -A
    git commit -q --no-verify -m "Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}

${N} file(s) carry unresolved conflict markers:
$(printf '%s\n' "$CONFLICTS" | sed 's/^/  /')"
    echo "merge produced ${N} conflicted file(s) - committed with markers"
  fi
fi

# ---------------------------------------------------------------------------
# Clean merge (or lockfiles only): wasm rebuild from the MERGED tree, lockfile
# re-resolve per project, validation. Skipped on conflicts - npm cannot read
# a manifest with markers in it; the agent does these after resolving.
LOCK_NOTES=""
VALIDATION="skipped"
VALIDATION_MD="$TMP/sync-validation.md"; : > "$VALIDATION_MD"
if [ -z "$CONFLICTS" ]; then
  # The workflow built the wasm packages from the checkout it started on; the
  # merged lib/ is what the validate commands must see.
  echo "::group::rebuild the wasm packages from the merged tree ($TEST_ENV_SCRIPT)"
  if bash "$TEST_ENV_SCRIPT" > "$TMP/sync-test-env.log" 2>&1; then
    echo "::endgroup::"
    VALIDATION=success
    while IFS= read -r p; do
      slug=$( [ "$p" = "." ] && echo root || printf '%s' "$p" | sed 's#/#__#g' )
      lock="${p#./}/package-lock.json"; lock="${lock#./}"
      echo "::group::$p - npm install (re-resolve the lockfile from the merged package.json)"
      if (cd "$p" && npm install --ignore-scripts --no-audit --no-fund) > "$TMP/sync-install-$slug.log" 2>&1; then
        echo "::endgroup::"
        if ! git diff --quiet -- "$lock"; then
          LOCK_NOTES="${LOCK_NOTES}- \`$lock\`: $(git diff --numstat -- "$lock" | awk '{print "+"$1"/-"$2}') lines re-resolved from the merged manifest"$'\n'
          git add -- "$lock"
        else
          LOCK_NOTES="${LOCK_NOTES}- \`$lock\`: unchanged by the re-resolve"$'\n'
        fi
      else
        echo "::endgroup::"; tail -n 30 "$TMP/sync-install-$slug.log"
        echo "::error::$p: npm install failed after the merge"
        LOCK_NOTES="${LOCK_NOTES}- \`$lock\`: **npm install failed** - as the merge left it"$'\n'
        echo "- \`$p\`: \`npm install\` **FAILED** - validation not run" >> "$VALIDATION_MD"
        VALIDATION=install-failed
      fi
    done < <(jq -r '.projects[].path' "$CONFIG")
    if ! git diff --cached --quiet; then
      git commit -q --no-verify -m "Re-resolve the lockfiles after merging ${SOURCE_BRANCH}"
    fi
    # npm must not have touched anything else (build outputs are gitignored).
    if [ -n "$(git status --porcelain)" ]; then
      echo "::error::npm install left the tree dirty beyond the lockfiles:" >&2; git status --porcelain >&2; exit 1
    fi

    if [ "$VALIDATION" = success ]; then
      while IFS= read -r p; do
        slug=$( [ "$p" = "." ] && echo root || printf '%s' "$p" | sed 's#/#__#g' )
        cmd=$(jq -r --arg p "$p" '.projects[] | select(.path == $p) | .validate' "$CONFIG")
        echo "::group::$p - validate: $cmd"
        if (cd "$p" && bash -euo pipefail -c "$cmd") > "$TMP/sync-validate-$slug.log" 2>&1; then
          echo "::endgroup::"; echo "- \`$p\`: \`$cmd\` **passed**" >> "$VALIDATION_MD"
        else
          echo "::endgroup::"; tail -n 40 "$TMP/sync-validate-$slug.log"
          echo "::error::$p: validate failed: $cmd"
          echo "- \`$p\`: \`$cmd\` **FAILED**" >> "$VALIDATION_MD"; VALIDATION=failure
        fi
      done < <(jq -r '.projects[].path' "$CONFIG")
      # A validate command that edits tracked files would leave the PR's tree
      # and its commits out of step; refuse rather than publish.
      if [ -n "$(git status --porcelain)" ]; then
        echo "::error::a validate command modified tracked files - they must be read-only:" >&2; git status --porcelain >&2; exit 1
      fi
    fi
  else
    echo "::endgroup::"; tail -n 40 "$TMP/sync-test-env.log"
    echo "::error::the wasm packages do not build from the merged tree - the Rust side of this merge needs a human"
    VALIDATION=wasm-build-failed
  fi
fi

DRAFT=false; NEEDS_AGENT=false
if [ -n "$CONFLICTS" ] || [ "$VALIDATION" != "success" ]; then
  DRAFT=true
  # The agent is only useful when it can run: no Rust or .github conflicts
  # (it could not build or push them) and a wasm build that succeeds.
  if [ -z "$HUMAN_CONFLICTS" ] && [ "$VALIDATION" != "wasm-build-failed" ] && [ -n "$REPAIR_WORKFLOW" ]; then
    NEEDS_AGENT=true
  fi
fi

# ---------------------------------------------------------------------------
# PR body
BODY="$TMP/sync-pr-body.md"
{
  echo "Merges \`${SOURCE_BRANCH}\` into \`${TARGET_BRANCH}\` - the forward-merge this repository does after changes land on \`${SOURCE_BRANCH}\` (the monthly node dependency update included). Lockfiles are re-resolved from the merged manifests rather than merged textually."
  echo
  echo "## Commits from \`${SOURCE_BRANCH}\` (${PENDING})"
  echo
  echo "| Commit | Subject | Author | Date |"; echo "| --- | --- | --- | --- |"
  # Unit separator between fields so a subject containing "|" cannot break
  # the table; the subject's own pipes are escaped for markdown.
  git log --no-merges --format='%h%x1f%H%x1f%s%x1f%an%x1f%as' "${TGT}..${SRC}" \
    | awk -F "$(printf '\037')" -v base="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/" \
        '{ gsub(/\|/, "\\|", $3); printf "| [%s](%s%s) | %s | %s | %s |\n", $1, base, $2, $3, $4, $5 }'
  echo; echo "## Lockfiles"; echo
  if [ -n "$LOCK_CONFLICTS" ]; then
    echo "Conflicted in the merge; took \`${SOURCE_BRANCH}\`'s copy and re-resolved from the merged manifests:"
    printf '%s\n' "$LOCK_CONFLICTS" | sed 's/^/- `/; s/$/`/'; echo
  fi
  if [ -n "$LOCK_NOTES" ]; then printf '%s' "$LOCK_NOTES"; else echo "Not re-resolved - conflicts first."; fi
  if [ -n "$CONFLICTS" ]; then
    echo; echo "## Conflicts - this PR is not mergeable as pushed"; echo
    echo "The merge conflicted in the files below. They are committed **with their conflict markers**; the lockfiles were not re-resolved and validation did not run. Until they are resolved this stays a draft."
    if [ -n "$HUMAN_CONFLICTS" ]; then
      echo; echo "**Need a human** (Rust, or this repository's automation - the sync agent is not dispatched for these):"; echo
      printf '%s\n' "$HUMAN_CONFLICTS" | sed 's/^/- `/; s/$/`/'
      if [ -n "$AGENT_CONFLICTS" ]; then
        echo; echo "Also conflicted (Node files the agent would otherwise resolve - do these in the same pass):"; echo
        printf '%s\n' "$AGENT_CONFLICTS" | sed 's/^/- `/; s/$/`/'
      fi
      echo; echo "To finish by hand: \`git fetch origin && git checkout ${BRANCH}\`, resolve the markers, \`npm install\` in each project, validate, push."
    else
      echo; printf '%s\n' "$AGENT_CONFLICTS" | sed 's/^/- `/; s/$/`/'
    fi
  fi
  echo; echo "## Validation"; echo
  case "$VALIDATION" in
    success) cat "$VALIDATION_MD"; echo; echo "Every project's validate command passed on the merged tree." ;;
    failure) cat "$VALIDATION_MD"; echo; echo "**Validation FAILED** on at least one project - opened as a draft."; [ -z "$RUN_URL" ] || echo "Output: [workflow run](${RUN_URL})." ;;
    install-failed) cat "$VALIDATION_MD"; echo; echo "**\`npm install\` failed** after the merge (a range the merged manifests cannot satisfy) - opened as a draft."; [ -z "$RUN_URL" ] || echo "Output: [workflow run](${RUN_URL})." ;;
    wasm-build-failed) echo "**The wasm packages do not build from the merged tree** (\`${TEST_ENV_SCRIPT}\`) - the Rust side of this merge needs a human before anything on the Node side can be validated. Opened as a draft; the sync agent is not dispatched."; [ -z "$RUN_URL" ] || echo "Output: [workflow run](${RUN_URL})." ;;
    *) echo "Not run - conflicts first." ;;
  esac
  if [ "$NEEDS_AGENT" = true ]; then
    echo; echo "## Sync agent"; echo
    echo "Dispatched at this PR. It resolves the conflict markers (\`${SOURCE_BRANCH}\`'s change in \`${TARGET_BRANCH}\`'s shape; lockfiles regenerated, never hand-merged), fixes what the merge broke in lint, types or tests, re-validates every project, pushes one commit, comments here with what it did per file, and marks this ready only when the tree is green. Rust files and \`.github/\` are outside its fence."
  fi
} > "$BODY"

# ---------------------------------------------------------------------------
# Push + PR + hand-off. Force-push for same-day idempotence, but say so when
# the branch already held more than this run produced (a repair, most likely).
SUPERSEDED=0; SUPERSEDED_UNKNOWN=0
if git fetch -q "$GIT_REMOTE" "$BRANCH" 2>/dev/null; then
  if EXTRA=$(git rev-list --count "${TGT}..FETCH_HEAD" 2>/dev/null); then
    OURS=$(git rev-list --count "${TGT}..HEAD")
    [ "${EXTRA:-0}" -le "$OURS" ] || SUPERSEDED=$(( EXTRA - OURS ))
  else
    SUPERSEDED_UNKNOWN=1
  fi
fi
git push -q --force "$GIT_REMOTE" "$BRANCH"

DRAFT_ARGS=(); [ "$DRAFT" = false ] || DRAFT_ARGS=(--draft)
EXISTING_PR=$(gh pr list -R "$GITHUB_REPOSITORY" --head "$BRANCH" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)
if [ -n "$EXISTING_PR" ]; then
  gh pr edit "$BRANCH" -R "$GITHUB_REPOSITORY" --title "$TITLE" --body-file "$BODY" >/dev/null
  if [ "$DRAFT" = false ]; then gh pr ready "$BRANCH" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || true
  else gh pr ready "$BRANCH" -R "$GITHUB_REPOSITORY" --undo >/dev/null 2>&1 || true; fi
  summary "Updated the existing pull request for \`$BRANCH\` (#$EXISTING_PR)."
else
  if gh pr create -R "$GITHUB_REPOSITORY" --base "$TARGET_BRANCH" --head "$BRANCH" --title "$TITLE" --body-file "$BODY" ${DRAFT_ARGS[@]+"${DRAFT_ARGS[@]}"} >/dev/null; then
    summary "Opened pull request for \`$BRANCH\` into \`$TARGET_BRANCH\` ($([ "$DRAFT" = false ] && echo ready || echo draft))."
  else
    echo "::error::Could not open a pull request for $BRANCH. Check Settings -> Actions -> General -> \"Allow GitHub Actions to create and approve pull requests\". The branch is pushed." >&2
    exit 1
  fi
fi
IFS=',' read -ra LABEL_LIST <<< "$LABELS"
for l in "${LABEL_LIST[@]}"; do
  l="${l// /}"; [ -n "$l" ] || continue
  gh label create "$l" -R "$GITHUB_REPOSITORY" --force --description "Forward-merge of ${SOURCE_BRANCH} into the scripting branch" >/dev/null 2>&1 || true
  gh pr edit "$BRANCH" -R "$GITHUB_REPOSITORY" --add-label "$l" >/dev/null 2>&1 || true
done

PR_JSON=$(gh pr view "$BRANCH" -R "$GITHUB_REPOSITORY" --json number,url)
PR_NUMBER=$(printf '%s' "$PR_JSON" | jq -r '.number'); PR_URL=$(printf '%s' "$PR_JSON" | jq -r '.url')
out has_changes true; out conflicts "$(printf '%s' "$CONFLICTS" | grep -c . || true)"; out source_commits "$PENDING"
out pr_number "$PR_NUMBER"; out pr_url "$PR_URL"; out branch "$BRANCH"; out validation "$VALIDATION"
summary "$PR_URL"

if [ "$SUPERSEDED" -gt 0 ] || [ "$SUPERSEDED_UNKNOWN" -eq 1 ]; then
  WHAT="replacing whatever was already on the branch (count unavailable)"
  [ "$SUPERSEDED_UNKNOWN" -eq 1 ] || WHAT="replacing $SUPERSEDED commit(s) that were on the branch - most likely a resolution"
  gh pr comment "$PR_NUMBER" -R "$GITHUB_REPOSITORY" --body "This run rebuilt \`$BRANCH\` from \`$TARGET_BRANCH\` and force-pushed, $WHAT. A rerun recomputes the whole merge; if it still conflicts or fails validation the agent is dispatched again.$([ -z "$RUN_URL" ] || printf '\n\nThis run: %s' "$RUN_URL")" >/dev/null 2>&1 || true
fi

REPAIR_DISPATCHED=false
if [ "$NEEDS_AGENT" = true ]; then
  # The agent workflow lives on the source branch (master) - that is where
  # workflow_dispatch finds it, and where gh-aw snapshots .github from.
  AW_CONTEXT=$(jq -nc --argjson n "$PR_NUMBER" '{item_type:"pull_request", item_number:$n}')
  if gh workflow run "$REPAIR_WORKFLOW" -R "$GITHUB_REPOSITORY" --ref "$SOURCE_BRANCH" -f "aw_context=$AW_CONTEXT" 2>"$TMP/dispatch.err"; then
    REPAIR_DISPATCHED=true
    summary "Dispatched \`$REPAIR_WORKFLOW\` at #$PR_NUMBER (conflicts: $(printf '%s' "$CONFLICTS" | grep -c . || true); validation: $VALIDATION)."
  else
    ERR=$(cat "$TMP/dispatch.err" 2>/dev/null || true)
    echo "::warning::could not dispatch $REPAIR_WORKFLOW for #$PR_NUMBER: $ERR" >&2
    gh pr comment "$PR_NUMBER" -R "$GITHUB_REPOSITORY" --body "$(printf 'The sync agent could not be dispatched (`%s`):\n\n```\n%s\n```\n\nThis draft needs a human: `git fetch origin && git checkout %s`, resolve, `npm install` in each project, validate, push. Common causes: the agent workflow is not on `%s` yet, or this job lacks `actions: write`.' "$REPAIR_WORKFLOW" "$ERR" "$BRANCH" "$SOURCE_BRANCH")" >/dev/null 2>&1 || true
    summary "Agent could NOT be dispatched - #$PR_NUMBER needs a human."
  fi
elif [ "$DRAFT" = true ]; then
  summary "Draft left for a human (Rust/.github conflicts or a wasm build failure) - the sync agent is not dispatched for these."
fi
out repair_dispatched "$REPAIR_DISPATCHED"
