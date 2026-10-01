#!/usr/bin/env bash
# Opens, updates or closes the one GitHub issue that says "this automation is
# broken" (adapted from fs-eng/perfqa-update, PERF-4615). A failed run that
# opened no pull request otherwise notifies only whoever triggered it, by
# email; an issue reaches the team's Slack channel through the existing
# `/github subscribe` - the same route a new pull request takes.
#
#   bash .github/scripts/failure-issue.sh open    the run failed: open the
#                                                 issue, or comment on the one
#                                                 already open for this workflow
#   bash .github/scripts/failure-issue.sh close   the run succeeded: close
#                                                 that issue, if open
#
# One issue per workflow (matched by exact title and label), so a failure
# that repeats every run is one issue with a comment per run, not a stream.
# Best effort throughout: this runs after the real work, and nothing here may
# turn a green run red or hide the original failure.
#
# Required env: GITHUB_REPOSITORY, GH_TOKEN (needs `issues: write`)
# Optional env:
#   ISSUE_TITLE (`<workflow> is failing`), ISSUE_LABEL (automation-failure),
#   AUTOMATION_LOG ($RUNNER_TEMP/automation.log - the steps tee into it; its
#   ::error:: lines and tail go into the issue), FAILURE_NOTE
#   ($RUNNER_TEMP/failure-note.md - markdown a script left for the human, e.g.
#   the command to run a sync locally), GITHUB_WORKFLOW, GITHUB_SERVER_URL,
#   GITHUB_RUN_ID, GITHUB_REF_NAME, GITHUB_EVENT_NAME, RUNNER_TEMP
set -uo pipefail

MODE="${1:?usage: failure-issue.sh open|close}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
TMP="${RUNNER_TEMP:-/tmp}"
WORKFLOW="${GITHUB_WORKFLOW:-automation}"
TITLE="${ISSUE_TITLE:-${WORKFLOW} is failing}"
LABEL="${ISSUE_LABEL:-automation-failure}"
LOG="${AUTOMATION_LOG:-$TMP/automation.log}"
NOTE="${FAILURE_NOTE:-$TMP/failure-note.md}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-0}"

warn() { echo "::warning::failure-issue: $1"; }

# The open issue for this workflow, by label and exact title.
existing() {
  gh issue list -R "$GITHUB_REPOSITORY" --label "$LABEL" --state open --limit 50 --json number,title 2>/dev/null \
    | jq -r --arg t "$TITLE" '.[] | select(.title == $t) | .number' 2>/dev/null | head -1
}

case "$MODE" in
  open)
    BODY="$TMP/failure-issue-body.md"
    {
      echo "The **${WORKFLOW}** run ([#${GITHUB_RUN_ID:-?}](${RUN_URL}), \`${GITHUB_EVENT_NAME:-?}\` on \`${GITHUB_REF_NAME:-?}\`) failed. If it stopped before publishing, no pull request was opened or updated - this issue is the only notice."
      if [ -s "$NOTE" ]; then echo; cat "$NOTE"; fi
      if [ -s "$LOG" ]; then
        ERRORS=$(grep -o '::error[^:]*::.*' "$LOG" | sed -E 's/^::error[^:]*:://; s/%0A/\n  /g' | head -20 || true)
        if [ -n "$ERRORS" ]; then echo; echo "### Errors"; echo; printf '%s\n' "$ERRORS" | sed 's/^/- /'; fi
        echo; echo "<details><summary>Last 40 lines of output</summary>"; echo; echo '```'
        tail -n 40 "$LOG" | sed 's/```/` ` `/g'
        echo '```'; echo; echo "</details>"
      fi
      echo; echo "This issue closes itself on the next successful run. Further failures are added here as comments."
    } > "$BODY"
    NUM=$(existing)
    if [ -n "$NUM" ]; then
      if gh issue comment "$NUM" -R "$GITHUB_REPOSITORY" --body-file "$BODY" >/dev/null 2>"$TMP/failure-issue.err"; then
        echo "failure-issue: commented on #$NUM"
      else
        warn "could not comment on #$NUM: $(cat "$TMP/failure-issue.err")"
      fi
    else
      gh label create "$LABEL" -R "$GITHUB_REPOSITORY" --force --color B60205 \
        --description "A scheduled or dispatched automation run failed" >/dev/null 2>&1 || true
      if URL=$(gh issue create -R "$GITHUB_REPOSITORY" --title "$TITLE" --label "$LABEL" --body-file "$BODY" 2>"$TMP/failure-issue.err"); then
        echo "failure-issue: opened $URL"
      else
        warn "could not open an issue - the workflow needs \`permissions: issues: write\`. $(cat "$TMP/failure-issue.err")"
      fi
    fi
    ;;
  close)
    NUM=$(existing)
    [ -n "$NUM" ] || { echo "failure-issue: nothing open for \"$TITLE\""; exit 0; }
    if gh issue close "$NUM" -R "$GITHUB_REPOSITORY" --comment "Run [#${GITHUB_RUN_ID:-?}](${RUN_URL}) succeeded - closing." >/dev/null 2>"$TMP/failure-issue.err"; then
      echo "failure-issue: closed #$NUM"
    else
      warn "could not close #$NUM: $(cat "$TMP/failure-issue.err")"
    fi
    ;;
  *) echo "failure-issue: mode must be open or close, got '$MODE'" >&2; exit 2 ;;
esac
exit 0
