#!/usr/bin/env bash
# Publishes the monthly node dependency update as a pull request and, when
# there is work for the repair agent, hands the draft to it.
# Adapted from fs-eng/perfqa-update's actions/update/publish.sh for pewpew.
#
# Decision table:
#   HAS_UPDATES != true, MAJORS_COUNT = 0  -> nothing to do, exit 0
#   HAS_UPDATES != true, MAJORS_COUNT > 0  -> no lockfile changed, so there is
#                                             no diff to open a PR from; the
#                                             majors are listed in the step
#                                             summary for a human (known gap)
#   any package.json dirty                 -> exit 1 (this half never edits one)
#   validation success, no majors          -> READY PR, no agent
#   validation failure OR majors waiting   -> DRAFT PR, dispatch the agent; the
#                                             agent marks it ready when green
#   PR for this branch exists              -> edit it (same-day rerun)
#
# Required env:
#   HAS_UPDATES, VALIDATION (success|failure|skipped), PR_BODY_FILE, BASE_BRANCH,
#   GITHUB_REPOSITORY, GH_TOKEN, LOCKFILES (newline-separated, root-relative)
# Optional env:
#   UPDATE_COUNT (0), MAJORS_COUNT (0), VALIDATION_DETAILS_FILE (markdown, appended),
#   REPAIR_WORKFLOW (dependency-agent.lock.yml; empty disables the hand-off),
#   LABELS (dependencies,javascript), GITHUB_SERVER_URL, GITHUB_RUN_ID,
#   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, GIT_REMOTE (origin)
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
UPDATE_COUNT="${UPDATE_COUNT:-0}"
MAJORS_COUNT="${MAJORS_COUNT:-0}"
LABELS="${LABELS:-dependencies,javascript}"
REPAIR_WORKFLOW="${REPAIR_WORKFLOW-dependency-agent.lock.yml}"
GITHUB_SERVER_URL="${GITHUB_SERVER_URL:-https://github.com}"
GIT_REMOTE="${GIT_REMOTE:-origin}"

out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; echo "publish: $1=$2"; }
summary() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }

RUN_URL=""
[ -z "${GITHUB_RUN_ID:-}" ] || RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

if [ "${HAS_UPDATES:-false}" != "true" ]; then
  if [ "$MAJORS_COUNT" -gt 0 ]; then
    summary "No in-range updates or audit fixes this month, so no lockfile changed and there is no diff to open a pull request from. **${MAJORS_COUNT} out-of-range version(s) are waiting for the repair agent** but it can only work on an open PR; see the run log for the list. This is a known gap: dispatch the agent by hand at a PR if one is wanted this month."
  else
    summary "No in-range updates, audit fixes or out-of-range versions this month - nothing to do."
  fi
  out pr_number ""; out pr_url ""; out branch ""; out repair_dispatched "false"
  exit 0
fi

: "${VALIDATION:?VALIDATION is required when HAS_UPDATES=true}"
: "${PR_BODY_FILE:?PR_BODY_FILE is required when HAS_UPDATES=true}"
: "${BASE_BRANCH:?BASE_BRANCH is required when HAS_UPDATES=true}"
: "${LOCKFILES:?LOCKFILES is required when HAS_UPDATES=true}"
[ -f "$PR_BODY_FILE" ] || { echo "::error::publish: PR body file not found: $PR_BODY_FILE" >&2; exit 1; }

# Defense in depth: the update script asserts this at every step, so a hit here
# is a bug upstream of us. Every tracked package.json in the repo, not just the
# root one. Matching on the basename keeps `my-package.json` out of it.
DIRTY_MANIFESTS=$(git diff --name-only | grep -E '(^|/)package\.json$' || true)
if [ -n "$DIRTY_MANIFESTS" ]; then
  { echo "::error::publish: package.json changed - this half only ever changes lockfiles. Refusing to publish."; printf '  %s\n' "$DIRTY_MANIFESTS"; } >&2
  exit 1
fi
CHANGED_LOCKFILES=()
while IFS= read -r lf; do
  [ -n "$lf" ] || continue
  lf="${lf#./}"
  if ! git diff --quiet -- "$lf"; then CHANGED_LOCKFILES+=("$lf"); fi
done <<< "$LOCKFILES"
if [ "${#CHANGED_LOCKFILES[@]}" -eq 0 ]; then
  echo "::error::publish: HAS_UPDATES=true but none of the listed lockfiles changed: $(printf '%s ' $LOCKFILES)" >&2
  exit 1
fi
# Anything else dirty is a bug too (build outputs are gitignored; validate must not leave tracked edits).
OTHER_DIRTY=$(git status --porcelain -uall | awk '{print $2}' | grep -vxF -f <(printf '%s\n' "${CHANGED_LOCKFILES[@]}") || true)
if [ -n "$OTHER_DIRTY" ]; then
  { echo "::error::publish: the working tree has changes outside the lockfiles - refusing to publish a partial state:"; printf '  %s\n' $OTHER_DIRTY; } >&2
  exit 1
fi

TODAY=$(date -u +%F)
BRANCH="update-node-dependencies-${TODAY}"
TITLE="Update node dependencies ${TODAY}"
NEEDS_AGENT=false
{ [ "$VALIDATION" != "success" ] || [ "$MAJORS_COUNT" -gt 0 ]; } && [ -n "$REPAIR_WORKFLOW" ] && NEEDS_AGENT=true
DRAFT=false
{ [ "$VALIDATION" != "success" ] || [ "$MAJORS_COUNT" -gt 0 ]; } && DRAFT=true

# Validation section - appended here because only this step knows the outcome.
{
  echo ""
  echo "## Validation"
  echo ""
  if [ -n "${VALIDATION_DETAILS_FILE:-}" ] && [ -s "$VALIDATION_DETAILS_FILE" ]; then cat "$VALIDATION_DETAILS_FILE"; echo ""; fi
  if [ "$VALIDATION" = "success" ]; then
    echo "Every project's validate command passed on the updated lockfile(s)."
  else
    echo "**Validation FAILED** on at least one project - opened as a draft."
    [ -z "$RUN_URL" ] || echo "Failure output: [workflow run](${RUN_URL})."
  fi
  if [ "$NEEDS_AGENT" = true ]; then
    echo ""
    echo "## Repair agent"
    echo ""
    if [ "$VALIDATION" != "success" ]; then
      echo "- Validation failed, so the agent bisects this batch to find the package(s) responsible, holds back or fixes each, and re-validates."
    fi
    if [ "$MAJORS_COUNT" -gt 0 ]; then
      echo "- **${MAJORS_COUNT} out-of-range version(s)** are on its worklist (the rows above not marked held). It attempts each in turn: bump the range, re-resolve, make the code changes the new version needs, validate; anything it cannot make green is reverted and explained."
    fi
    echo "- When a dependency change needed a code or manifest change, it bumps this repo's own package versions by a **patch or minor** (never a major)."
    echo "- It pushes one commit to this branch, comments here with exactly what it did and did not do, and marks the PR ready for review only if the final tree validates. Until then this stays a draft."
  fi
} >> "$PR_BODY_FILE"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -b "$BRANCH"
git add -- "${CHANGED_LOCKFILES[@]}"
# --no-verify: husky hooks would run a test suite without the environment the
# validate step set up. Validation already ran and decided draft-vs-ready.
git commit -q --no-verify -m "$TITLE"

# --force keeps same-day reruns idempotent: this branch is rebuilt from the
# base each run. The hazard is discarding a repair the agent pushed, so count
# what the remote has and say so rather than overwrite silently.
SUPERSEDED=0; SUPERSEDED_UNKNOWN=0
BASE_SHA=$(git rev-parse HEAD~1)
if git fetch -q "$GIT_REMOTE" "$BRANCH" 2>/dev/null; then
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
    git fetch -q --deepen=10 "$GIT_REMOTE" "$BRANCH" 2>/dev/null || true
  fi
  if EXTRA=$(git rev-list --count "$BASE_SHA..FETCH_HEAD" 2>/dev/null); then
    [ "${EXTRA:-0}" -le 1 ] || SUPERSEDED="$EXTRA"
  else
    SUPERSEDED_UNKNOWN=1
  fi
fi
git push -q --force "$GIT_REMOTE" "$BRANCH"

DRAFT_ARGS=()
[ "$DRAFT" = false ] || DRAFT_ARGS=(--draft)

EXISTING_PR=$(gh pr list -R "$GITHUB_REPOSITORY" --head "$BRANCH" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)
if [ -n "$EXISTING_PR" ]; then
  gh pr edit "$BRANCH" -R "$GITHUB_REPOSITORY" --title "$TITLE" --body-file "$PR_BODY_FILE" >/dev/null
  if [ "$DRAFT" = false ]; then gh pr ready "$BRANCH" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || true
  else gh pr ready "$BRANCH" -R "$GITHUB_REPOSITORY" --undo >/dev/null 2>&1 || true; fi
  summary "Updated the existing pull request for \`$BRANCH\` (#$EXISTING_PR)."
else
  if gh pr create -R "$GITHUB_REPOSITORY" --base "$BASE_BRANCH" --head "$BRANCH" \
       --title "$TITLE" --body-file "$PR_BODY_FILE" ${DRAFT_ARGS[@]+"${DRAFT_ARGS[@]}"} >/dev/null; then
    summary "Opened pull request for \`$BRANCH\` ($([ "$DRAFT" = false ] && echo ready || echo draft))."
  else
    echo "::error::Could not open a pull request for $BRANCH, and no open PR exists for it." >&2
    echo "::error::Check Settings -> Actions -> General -> \"Allow GitHub Actions to create and approve pull requests\". The branch is pushed, so a human can open the PR by hand." >&2
    exit 1
  fi
fi

# Labels exist in this repo; best effort so a missing one never fails the run.
IFS=',' read -ra LABEL_LIST <<< "$LABELS"
for l in "${LABEL_LIST[@]}"; do
  l="${l// /}"; [ -n "$l" ] && gh pr edit "$BRANCH" -R "$GITHUB_REPOSITORY" --add-label "$l" >/dev/null 2>&1 || true
done

PR_JSON=$(gh pr view "$BRANCH" -R "$GITHUB_REPOSITORY" --json number,url)
PR_NUMBER=$(printf '%s' "$PR_JSON" | jq -r '.number')
PR_URL=$(printf '%s' "$PR_JSON" | jq -r '.url')
out pr_number "$PR_NUMBER"; out pr_url "$PR_URL"; out branch "$BRANCH"
summary "$PR_URL"

if [ "$SUPERSEDED" -gt 0 ] || [ "$SUPERSEDED_UNKNOWN" -eq 1 ]; then
  if [ "$SUPERSEDED_UNKNOWN" -eq 1 ]; then
    WHAT="**replacing whatever was already on the branch** (how much could not be determined from this shallow checkout)"
  else
    WHAT="**replacing $SUPERSEDED commit(s)** that were on the branch - most likely a repair the agent had pushed"
  fi
  NOTE=$(printf 'This run rebuilt `%s` from `%s` and force-pushed, %s. That is what a rerun does: it recomputes the whole update from `%s`, so anything the agent had changed is in scope again and the agent is dispatched again if there is work for it.%s' \
    "$BRANCH" "$BASE_BRANCH" "$WHAT" "$BASE_BRANCH" "$([ -z "$RUN_URL" ] && printf '' || printf '\n\nThis run: %s' "$RUN_URL")")
  gh pr comment "$PR_NUMBER" -R "$GITHUB_REPOSITORY" --body "$NOTE" >/dev/null 2>&1 || true
fi

# Hand off to the repair agent. workflow_dispatch is one of the two event types
# a GITHUB_TOKEN-initiated action may trigger. aw_context is gh-aw's own input:
# it makes the agent check out this PR's head and push back to this branch.
REPAIR_DISPATCHED=false
if [ "$NEEDS_AGENT" = true ]; then
  AW_CONTEXT=$(jq -nc --argjson n "$PR_NUMBER" '{item_type:"pull_request", item_number:$n}')
  if gh workflow run "$REPAIR_WORKFLOW" -R "$GITHUB_REPOSITORY" --ref "$BASE_BRANCH" -f "aw_context=$AW_CONTEXT" 2>"${RUNNER_TEMP:-/tmp}/dispatch.err"; then
    REPAIR_DISPATCHED=true
    summary "Dispatched \`$REPAIR_WORKFLOW\` at #$PR_NUMBER (validation: $VALIDATION; out-of-range candidates: $MAJORS_COUNT)."
  else
    ERR=$(cat "${RUNNER_TEMP:-/tmp}/dispatch.err" 2>/dev/null || true)
    echo "::warning::publish: could not dispatch $REPAIR_WORKFLOW for #$PR_NUMBER: $ERR" >&2
    gh pr comment "$PR_NUMBER" -R "$GITHUB_REPOSITORY" --body "$(printf 'The repair agent could not be dispatched (`%s`):\n\n```\n%s\n```\n\nThis draft needs a human. Common causes: the agent workflow is not on `%s` yet, or this job lacks `actions: write`.' "$REPAIR_WORKFLOW" "$ERR" "$BASE_BRANCH")" >/dev/null 2>&1 || true
    summary "Agent could NOT be dispatched - #$PR_NUMBER needs a human."
  fi
fi
out repair_dispatched "$REPAIR_DISPATCHED"
