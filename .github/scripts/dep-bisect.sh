#!/usr/bin/env bash
# Deterministic bisect for the shared dependency-update procedure (PERF-4551).
#
# Why this exists: this used to be prose (rule 6 of shared/dependency-update.md)
# - a stateful loop (restore baseline, maintain an accepted set and a work
# queue of package subsets, trial-and-split on failure) described in English
# for an agent to execute by hand. Three rounds of review found a distinct
# algorithm defect in it almost every round: a missing state reset between
# trials, a loop invariant violated (work silently dropped from the queue), a
# missing precondition (baseline never validated before attribution started),
# trial state that didn't match what actually failed (audit fix never
# replayed), and a fix that could silently vanish from the final lockfile.
# That is the standard defect taxonomy for an untested loop. This script is
# the fix: the algorithm now executes, instead of being re-stated in prose
# every time a new edge case is found. Its unit tests live with the original in
# fs-eng/perfqa-update and were not copied here; the cwd-aware change made in
# this copy (GIT_PREFIX) was verified by hand from a subdirectory.
#
# Scope: this script runs ONLY after an in-range update + audit fix has
# already been applied and the validate command has failed on it. It does not
# perform the update itself - it discovers what changed by diffing the
# current lockfile against a known-good baseline, which is what closes the
# "how does the bisect know what to bisect" gap without needing to be told.
#
# Two shapes of caller, one flag:
#   - the failing lockfile is UNCOMMITTED in the working tree: the baseline is
#     HEAD (the default) - nothing has been committed, so HEAD is exactly the
#     pre-update state.
#   - the failing lockfile is COMMITTED on a draft pull-request branch (the
#     repair agent's case): HEAD *is* the failure, so the baseline must be the
#     PR's base - pass `--base origin/<default-branch>`. Whatever ref is given
#     must already be fetched; this script does not talk to the network.
#
# Invariants (asserted at runtime, not just documented - this is the point):
#   I1 - every trial starts from a lockfile byte-identical to a previously
#        validated-green state; never tested on top of a failure.
#   I2 - every trial's outcome is attributed to its ENTIRE lockfile delta
#        versus that green state, never just the requested subset - this is
#        what makes a transitive knock-on or an audit-fix move attributable
#        at all, instead of silently vanishing.
#   I3 - every package name in the initial changed set ends in exactly one
#        bucket: accepted, culprits, or held_back{reason}. Checked at exit;
#        a violation is a hard exit 2 with an accounting dump. This is the
#        executable form of the exact property review kept finding broken.
#   I4 - install failures never convict. Only a validate-command failure can
#        produce a culprit; a 403/ERESOLVE/network failure becomes held_back
#        with the raw log - an unrecognized failure mode degrades to a safe
#        hold, never a false conviction.
#   I5 - package.json (root and every workspace) is unchanged, and every
#        root direct dependency's resolved version still satisfies its
#        declared range, at every trial/restore cycle - the same check rule
#        3 performs for its own npm audit fix pass, run again here since a
#        trial's audit fix can hit the identical failure mode.
#
# Usage:
#   dep-bisect.sh --validate <cmd> --report <path>
#                 [--base <git-ref>] [--budget-seconds <n>]
#                 [--validate-timeout <n>]
#
# There is no --exclude: every package in the delta is a candidate. What may be
# updated at all was already decided by package.json's declared ranges, upstream
# of this script, and nothing here gets a second opinion about it.
#
# Exit 0: a report was written to --report and is authoritative (read its
#         "outcome" field). Exit 2: could not complete at all, or an
#         internal invariant failed - a report may still have been written
#         with outcome "aborted", but treat exit 2 as the primary signal.
#
# This repo stays dependency-free on purpose - bash, git, npm and jq only, no
# new runtime dependency, and no package.json for its own updater to update.
set -uo pipefail

# ---------------------------------------------------------------------------
# Mockable clock: DEP_BISECT_FAKE_CLOCK_FILE lets the test harness advance
# time without sleeping. Designed in from the start rather than retrofitted.
now_s() {
  if [ -n "${DEP_BISECT_FAKE_CLOCK_FILE:-}" ] && [ -f "$DEP_BISECT_FAKE_CLOCK_FILE" ]; then
    cat "$DEP_BISECT_FAKE_CLOCK_FILE"
  else
    date +%s
  fi
}

log() { printf '%s\n' "$*" >&2; }

usage() {
  cat >&2 <<'USAGE'
Usage: dep-bisect.sh --validate <cmd> --report <path> [--base <git-ref>]
                      [--budget-seconds <n>] [--validate-timeout <n>]
USAGE
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || { log "::error::dep-bisect: required command not found: $c"; exit 2; }
  done
}

# ---------------------------------------------------------------------------
# Args
VALIDATE_CMD=""
REPORT_PATH=""
BASE_REF="HEAD"
BUDGET_SECONDS=3600
VALIDATE_TIMEOUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --validate) VALIDATE_CMD="${2:-}"; shift 2 ;;
    --report) REPORT_PATH="${2:-}"; shift 2 ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --budget-seconds) BUDGET_SECONDS="${2:-}"; shift 2 ;;
    --validate-timeout) VALIDATE_TIMEOUT="${2:-}"; shift 2 ;;
    *) log "::error::dep-bisect: unknown argument: $1"; usage; exit 2 ;;
  esac
done

[ -n "$VALIDATE_CMD" ] || { log "::error::dep-bisect: --validate is required"; usage; exit 2; }
[ -n "$REPORT_PATH" ] || { log "::error::dep-bisect: --report is required"; usage; exit 2; }
[ -n "$BASE_REF" ] || { log "::error::dep-bisect: --base needs a git ref"; usage; exit 2; }

if [ -z "$VALIDATE_TIMEOUT" ]; then
  VALIDATE_TIMEOUT=$(( BUDGET_SECONDS / 4 ))
  [ "$VALIDATE_TIMEOUT" -ge 300 ] || VALIDATE_TIMEOUT=300
fi

require_cmd git npm jq

# GNU coreutils `timeout`, which is what bounds a single validate run. On the
# runners it is `timeout`; macOS ships no BSD equivalent, so a hand-run there
# needs coreutils (`brew install coreutils`) and gets it as `gtimeout`. Both
# take --kill-after, which is the only flag used.
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN=gtimeout
else
  log "::error::dep-bisect: required command not found: timeout (on macOS: brew install coreutils)"
  exit 2
fi

[ -f package-lock.json ] || { log "::error::dep-bisect: no package-lock.json in the current directory"; exit 2; }
[ -f package.json ] || { log "::error::dep-bisect: no package.json in the current directory"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { log "::error::dep-bisect: not a git repository"; exit 2; }
# This script is cwd-based: it bisects the package-lock.json in the directory it
# is run from, which in pewpew may be a sub-project (guide/results-viewer-react)
# rather than the repository root. Two git commands below need the cwd's path
# WITHIN the repository: `git status --porcelain` prints root-relative paths
# even when scoped with `-- .`, and `<sha>:<path>` in `git show` is
# root-relative. Empty at the root, "guide/results-viewer-react/" in a subdir.
GIT_PREFIX=$(git rev-parse --show-prefix)

T0=$(now_s)
WORK="$(mktemp -d)"
# On any abnormal exit (2: an install failed mid-trial, a revert went wrong)
# put the PR's full lockfile back, so a trial's half-way lockfile is never left
# for the agent's first checkpoint to save - and push. checkout first, so a
# stray tracked-file write is undone without clobbering the restored lockfile.
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ -f "$FULL_LOCK" ]; then git checkout -- . 2>/dev/null || true; cp "$FULL_LOCK" package-lock.json; fi; rm -rf "$WORK"' EXIT

FULL_LOCK="$WORK/full.json"
HEAD_LOCK="$WORK/head.json"
ACCEPTED_LOCK="$WORK/accepted.json"
STATE="$WORK/state.json"
echo '{"accepted":[],"culprits":[],"held_back":[],"trials":[]}' > "$STATE"

# ---------------------------------------------------------------------------
# State-file helpers. A JSON scratch file is the source of truth for
# accumulating records instead of parallel bash arrays - simpler to reason
# about, and it IS the report almost verbatim.
state_add() {
  # $1 = bucket name, $2 = json object (already valid JSON text) to append
  local tmp="$WORK/state.tmp.json"
  jq --argjson item "$2" ".$1 += [\$item]" "$STATE" > "$tmp" && mv "$tmp" "$STATE"
}

name_is_terminal() {
  jq -e --arg n "$1" '(.accepted + .culprits + .held_back) | any(.name == $n)' "$STATE" >/dev/null
}

# The one place that builds a held_back record, so it carries the versions the
# issue title needs. Every call site used to hardcode from:null,to:null while
# only the culprit path looked them up in the delta - so every held-back issue
# came out titled "<pkg> null -> null held back: <reason>", destroying the one
# fact the issue exists to carry (which bump curation blocked, which version
# failed to install). Falls back to nulls only when the name genuinely is not
# in the changed set.
held_back_entry() { # held_back_entry <name> <reason> [detail]
  local n="$1" reason="$2" detail="${3:-}"
  jq --arg n "$n" --arg reason "$reason" --arg detail "$detail" \
    '(map(select(.name == $n)) | .[0] // {name:$n, from:null, to:null})
     + {reason:$reason, detail:$detail}' "${CHANGED_FILE:-/dev/null}" 2>/dev/null \
    || jq -n --arg n "$n" --arg reason "$reason" --arg detail "$detail" \
         '{name:$n, from:null, to:null, reason:$reason, detail:$detail}'
}

# ---------------------------------------------------------------------------
# Lockfile helpers
assert_only_lockfile_dirty() {
  # Covers every workspace automatically (git status scans the whole working
  # tree), unlike a root-only `git diff -- package.json` check would.
  #
  # `-uall` so git never collapses an untracked directory into a single entry
  # (`?? .github/`), which it does when the directory holds no tracked files.
  # The assert then names the actual file, and a path-based judgement about it
  # is possible at all.
  #
  # The workflow's own staged wrappers are NOT filtered out here, and must not
  # be: it writes `.github/aw/dep-*` to `.git/info/exclude` before invoking
  # this script, so they are already invisible to `git status`. A
  # directory-wide filter would additionally hide a genuinely unexpected file
  # such as `.github/aw/rogue`, weakening the assert for a case the workflow
  # already handles.
  local bad
  bad=$(git status --porcelain -uall --ignore-submodules -- . | sed -E 's/^.{3}//' | grep -vxF "${GIT_PREFIX}package-lock.json" || true)
  if [ -n "$bad" ]; then
    log "::error::dep-bisect: unexpected changes outside package-lock.json:"
    printf '%s\n' "$bad" >&2
    return 1
  fi
  return 0
}

# Pragmatic range check: confirms every ROOT direct dependency still resolves
# within its declared range. One `npm ls --json` does the comparison npm
# already knows how to make - it marks each offender
# `invalid: "<range> from the root project"` - which is why this needs no
# semver implementation, and is the same check dependency-update.mjs's
# outOfRangeDirectDeps() performs.
#
# Reading package.json section by section, as this used to, covered only
# `dependencies` and `devDependencies`: an audit trial could move a root
# `optionalDependencies` (or `peerDependencies`) entry outside its declared
# range and still be accepted, despite the claim to cover every root direct
# dependency. Asking npm covers every declared section for free. A
# declared-but-absent optional dependency reports no `invalid` at all, so it
# is not a false positive - and this is one npm call per trial instead of one
# per direct dependency.
#
# Workspace-level range checks remain a known simplification for this first
# version - assert_only_lockfile_dirty above is the primary defense for
# workspaces and it does cover every workspace's package.json.
# Names already out of range at the baseline. Not this run's doing, so not
# attributable to any trial - dependency-update.mjs makes exactly the same
# allowance (violationsAtStart / newOutOfRangeDirectDeps) because a range
# someone hand-narrowed without reinstalling leaves the repo out of range
# before anything here runs. This used to be a hard exit 2, which killed the
# repair path outright for such a repo: weekly PRs kept opening and every
# dispatch aborted attributing nothing, with nothing saying why. Only NEW
# violations fail now. A dirty package.json still aborts unconditionally -
# that is a different claim.
BASELINE_RANGE_VIOLATIONS=""

# Prints one offending direct-dependency name per line. rc 2 = the tree could
# not be read at all, which is not a pass: holding a subset back costs a week,
# publishing an out-of-range lockfile is what this exists to stop.
range_violations() {
  local out bad
  out=$(npm ls --json --depth=0 --long=false 2>/dev/null)
  [ -n "$out" ] || return 2
  bad=$(printf '%s' "$out" | jq -r '
    [ (.dependencies // {}) | to_entries[]
      | select(((.value // {}).invalid // null) | type == "string") | .key ] | .[]' 2>/dev/null) || return 2
  [ -z "$bad" ] || printf '%s\n' "$bad"
  return 0
}

assert_range_conformance() {
  local cur rc nm new=""
  cur=$(range_violations)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    RANGE_VIOLATION="could not read 'npm ls --json' output to verify declared ranges"
    return 1
  fi
  while IFS= read -r nm; do
    [ -n "$nm" ] || continue
    case ",$BASELINE_RANGE_VIOLATIONS," in
      *",$nm,"*) continue ;;   # already broken at the baseline
    esac
    new="${new:+$new, }$nm"
  done <<< "$cur"
  if [ -n "$new" ]; then
    RANGE_VIOLATION="$new"
    return 1
  fi
  return 0
}

assert_manifest_and_range_clean() {
  MANIFEST_VIOLATION=""
  RANGE_VIOLATION=""
  if ! assert_only_lockfile_dirty; then
    MANIFEST_VIOLATION="package.json changed outside declared updates"
    return 1
  fi
  if ! assert_range_conformance; then
    MANIFEST_VIOLATION="direct dependency resolved outside its declared range: $RANGE_VIOLATION"
    return 1
  fi
  return 0
}

restore_from() {
  # I1: every trial starts from a state byte-identical to a previously
  # validated-green one - the whole tree, not just the lockfile. A prior
  # trial's npm update/audit fix can leave a workspace package.json dirty
  # (rule 1 says that never happens, but this is the enforcement, not the
  # trust); `git checkout` resets every tracked file to HEAD before the
  # target lockfile snapshot is overlaid, so a stray write never survives
  # into the next trial.
  local snap="$1"
  git checkout -- . 2>/dev/null || true
  cp "$snap" package-lock.json
  local out rc
  out=$(npm ci --ignore-scripts 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    # Distinguish the one cause a human can act on immediately. The baseline is
    # the PR's BASE branch lockfile, so when curation starts blocking a version
    # that is committed there, this install 403s and the bisect cannot start -
    # and "restoring from a known-good snapshot" reads as a corrupt snapshot,
    # sending the reader looking in the wrong place. actions/update/install.sh
    # clears this on the head; the base is cleared by merging that PR.
    # awk, not `printf | grep -q`: a blocked baseline is the multi-package
    # curation case, so its log clears the pipe buffer, grep closes early and
    # pipefail returns 141. Both branches exit 2 either way, but the reader
    # would get "npm ci failed restoring from a known-good snapshot" instead
    # of the message that names the real cause.
    if printf '%s\n' "$out" | awk '/blocked by [^ ]* ?packages curation/ || /blocked by.*curation service/ { f=1 } END { exit !f }'; then
      log "::error::dep-bisect: the baseline lockfile ($BASE_REF) is itself blocked by Artifactory curation, so no trial can be installed and nothing can be attributed. Merge the pull request that unblocks the base, then rerun."
    else
      log "::error::dep-bisect: npm ci failed while restoring from a known-good snapshot"
    fi
    log "$out"
    exit 2
  fi
}

lock_delta() {
  # $1 = old lockfile, $2 = new lockfile -> JSON array of
  # {path,name,from,to} for every changed, real (non-workspace, resolved)
  # node_modules entry. An added entry has from:null, a REMOVED one to:null.
  #
  # Built from the union of both key sets, not the new file's keys alone. A
  # dedup or an audit remediation that deletes a package is a real lockfile
  # change, and iterating only the new keys made those invisible: a diff whose
  # only change was a removal came back empty, which the caller reports as
  # "package-lock.json is unchanged - not a dependency issue" and aborts the
  # repair; and per-trial, a removal of an already-terminal entry went
  # unnoticed, so the trial validated against a lockfile that had silently
  # dropped it and the blame landed on whatever else was in the subset.
  jq -n --slurpfile old "$1" --slurpfile new "$2" '
    def real($e): ($e != null) and (($e.resolved // null) != null) and (($e.link // false) | not);
    ($old[0].packages // {}) as $o
    | ($new[0].packages // {}) as $n
    | [ (($o | keys) + ($n | keys)) | unique | .[]
        | select(startswith("node_modules/")) as $k
        | select(real($o[$k]) or real($n[$k]))
        | { path: $k,
            name: ($k | split("node_modules/") | last),
            from: (if real($o[$k]) then $o[$k].version else null end),
            to:   (if real($n[$k]) then $n[$k].version else null end) }
        | select(.to != .from)
      ]
  '
}

names_from_delta() {
  jq -r '[.[].name] | unique | .[]' "$1"
}

# ---------------------------------------------------------------------------
# npm helpers
classify_install_failure() {
  local out="$1"
  # ONE awk pass, not a chain of `printf | grep -q`. Every such pipeline is a
  # SIGPIPE trap here: `grep -q` exits at the first match, the upstream printf
  # then dies of SIGPIPE, and with `pipefail` on (see the `set` line above) the
  # pipeline returns 141. That is not 0, so an EARLY match followed by a large
  # log fell through to the next branch and ultimately to install-error -
  # silently turning both a curation 403 and a fatal ERESOLVE into "benign".
  # Measured threshold: between 64 and 128 KB of trailing output, which
  # `npm audit fix` and a multi-package curation block both exceed easily.
  # awk reads to EOF, so there is nothing to signal.
  #
  # `npm warn`/`npm notice` lines are skipped for ERESOLVE only: npm recovers
  # from `npm warn ERESOLVE overriding peer dependency`, so treating it as a
  # failure held back every trial. Curation must still see notice lines,
  # because curation's own claim is only ever printed on one.
  printf '%s\n' "$out" | awk '
    {
      low = tolower($0)
      if ($0 ~ /E403|403 Forbidden/ || $0 ~ /blocked by.*curation/) curation = 1
      if (low !~ /^npm (warn|notice)/ && $0 ~ /ERESOLVE/)           eresolve = 1
    }
    END {
      if (curation)      print "curation-403"
      else if (eresolve) print "eresolve"
      else               print "install-error"
    }
  '
}

# Runs `npm update` for the given names. On a curation-403 naming specific
# packages, holds those names (reported by the caller) and retries with the
# rest - a single 403 must not fail the whole update (rule 4, made
# deterministic instead of leaving the agent to recover by hand).
# Sets: RU_OK (0/1), RU_LOG, RU_HELD_403 (space-separated names).
resilient_update() {
  local -a names=("$@")
  RU_HELD_403=""
  local pass=0
  while [ ${#names[@]} -gt 0 ] && [ $pass -lt 10 ]; do
    pass=$((pass+1))
    local out rc
    out=$(npm update --ignore-scripts "${names[@]}" 2>&1)
    rc=$?
    if [ $rc -eq 0 ]; then
      RU_OK=0; RU_LOG="$out"; return 0
    fi
    local kind
    kind=$(classify_install_failure "$out")
    if [ "$kind" != "curation-403" ]; then
      RU_OK=1; RU_LOG="$out"; RU_KIND="$kind"; return 1
    fi
    # The optional (@scope/) group is load-bearing: without it `[^/ ]+` stops
    # at the scope slash, so /@fs/zion/-/zion-2.0.0.tgz extracted as "zion",
    # never matched the subset name "@fs/zion", the name list never shrank,
    # the loop burned all its passes on an identical set and held the whole
    # subset back - innocent packages included. @fs/* under curation is the
    # case this script's own header leads with.
    local bad
    bad=$(printf '%s\n' "$out" | grep -oE '/(@[^/ ]+/)?[^/ ]+/-/[^ ]+\.tgz' | sed -E 's#^/##; s#/-/.*$##' | sort -u)
    if [ -z "$bad" ]; then
      RU_OK=1; RU_LOG="$out"; RU_KIND="curation-403"; return 1
    fi
    local -a next=()
    local n
    for n in "${names[@]}"; do
      if printf '%s\n' "$bad" | awk -v n="$n" '$0 == n { f=1 } END { exit !f }'; then
        RU_HELD_403="$RU_HELD_403 $n"
      else
        next+=("$n")
      fi
    done
    # ${a[@]+"${a[@]}"}, not "${a[@]}": `next` is empty when curation held every
    # remaining name back - the case the loop exit below exists for - and bash
    # before 4.4 (macOS ships 3.2) counts expanding an empty array under
    # `set -u` as an unbound variable.
    names=(${next[@]+"${next[@]}"})
  done
  if [ ${#names[@]} -eq 0 ]; then
    RU_OK=0; RU_LOG="all requested names held back by curation"; return 0
  fi
  RU_OK=1; RU_LOG="exceeded curation-retry passes"; RU_KIND="curation-403"; return 1
}

validate() {
  # Writes its log to a file rather than a global variable: this is always
  # invoked as `result=$(validate)`, which runs it in a subshell, and a
  # subshell's variable assignments never reach the caller - the exact
  # defect class this script exists to close, and worth naming so nobody
  # "fixes" this back to a global var later.
  local out rc
  # -euo pipefail, matching actions/update/action.yml's validate step and the
  # staged dep-validate.sh wrapper. Same command string executed three places;
  # a laxer shell here would let the bisect see green where the real validate
  # step sees red (`npm test | tee log`, or `a; b`), and then attribute nothing.
  out=$("$TIMEOUT_BIN" --kill-after=30 "${VALIDATE_TIMEOUT}s" bash -euo pipefail -c "$VALIDATE_CMD" 2>&1)
  rc=$?
  printf '%s' "$out" > "$WORK/last-validate.log"
  if [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
    echo "timeout"
  elif [ $rc -eq 0 ]; then
    echo "pass"
  else
    echo "fail"
  fi
}

split_into_two() {
  # $@ = names (already sorted by the caller for reproducibility). Prints
  # two lines: first half, second half, each a comma-joined list.
  local -a names=("$@")
  local n=${#names[@]}
  local half=$(( n / 2 ))
  local -a a=("${names[@]:0:half}")
  local -a b=("${names[@]:half}")
  (IFS=,; echo "${a[*]}")
  (IFS=,; echo "${b[*]}")
}

log_excerpt() {
  printf '%s' "$1" | tail -n 40
}

last_validate_log() {
  [ -f "$WORK/last-validate.log" ] && cat "$WORK/last-validate.log" || true
}

# ---------------------------------------------------------------------------
# Queue: bash array, each element a comma-joined subset of names. FIFO.
QUEUE=()
queue_push() { [ -n "$1" ] && QUEUE+=("$1"); }
queue_pop() {
  QUEUE_POPPED="${QUEUE[0]}"
  QUEUE=("${QUEUE[@]:1}")
}

# Drop names from a comma-joined subset that are already terminal (settled
# by an earlier trial's wider delta, or already held/convicted).
prune_subset() {
  local csv="$1"
  local -a names
  IFS=, read -ra names <<< "$csv"
  local -a keep=()
  local n
  for n in "${names[@]}"; do
    name_is_terminal "$n" || keep+=("$n")
  done
  (IFS=,; echo "${keep[*]}")
}

TRIAL_N=0

trial() {
  local subset_csv
  subset_csv=$(prune_subset "$1")
  [ -n "$subset_csv" ] || return 0
  TRIAL_N=$((TRIAL_N+1))
  local trial_no=$TRIAL_N
  local -a subset
  IFS=, read -ra subset <<< "$subset_csv"

  restore_from "$ACCEPTED_LOCK"

  resilient_update "${subset[@]}"
  local held403="$RU_HELD_403"
  local n
  for n in $held403; do
    state_add held_back "$(held_back_entry "$n" "curation-403" "blocked by curation while resolving")"
  done

  if [ "$RU_OK" != "0" ]; then
    if [ "${RU_KIND:-}" = "curation-403" ]; then
      # everything in this subset was held by curation already (RU_HELD_403
      # covers what could be identified); anything left unidentified is
      # reported as a generic curation hold rather than convicted.
      for n in "${subset[@]}"; do
        name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "curation-403" "blocked by curation")"
      done
      state_add trials "$(jq -n --arg req "$subset_csv" --arg res curation-403 --argjson n "$trial_no" '{n:$n, requested:$req, result:$res}')"
      return 0
    fi
    # I4: an install failure never convicts.
    if [ ${#subset[@]} -eq 1 ]; then
      state_add held_back "$(held_back_entry "${subset[0]}" "install-failed" "$(log_excerpt "$RU_LOG")")"
    else
      local h1 h2
      { read -r h1; read -r h2; } < <(split_into_two "${subset[@]}")
      queue_push "$h1"; queue_push "$h2"
    fi
    state_add trials "$(jq -n --arg req "$subset_csv" --arg res "${RU_KIND:-install-error}" --argjson n "$trial_no" '{n:$n, requested:$req, result:$res}')"
    return 0
  fi

  # `npm audit fix` exiting 1 means "unresolved vulnerabilities remain" - the
  # expected, benign case. Any other status is a real failure (curation 403, a
  # registry blip, corrupt state), and discarding it was not safe: the trial
  # then validated a lockfile missing the audit remediations the PR head
  # carries, so a green result "cleared" the subset against a state that was
  # never the state under test, and the accepted lockfile silently dropped
  # those security fixes.
  #
  # Two things have to agree before exit 1 is trusted, because either alone
  # lets the same silent drop back in:
  #   - npm can still produce an audit report. A real failure that happens to
  #     exit 1 usually cannot.
  #   - npm's own output does not NAME a failure. A curation 403 exits 1 and
  #     leaves `npm audit --json` perfectly readable, so the report probe says
  #     "benign" while a remediation was actually refused. dependency-update.mjs
  #     classifies this (it gained classify_install_failure's JS twin for
  #     exactly this case); this script has to make the same call or the two
  #     halves of the same action disagree about what a failed audit fix means.
  #
  # The probe captures npm's output FIRST and tests jq against the string.
  # Piping npm straight into jq made the pipeline inherit npm's exit status
  # under `pipefail`, and `npm audit` exits 1 whenever any vulnerability
  # remains - the normal state of most repos, and precisely the audit_rc==1
  # case that reaches here. So the probe could never pass: every trial was
  # held back as audit-fix-failed and the bisect convicted nothing. Only jq's
  # status may decide whether npm produced a report.
  local audit_out audit_rc audit_probe audit_kind
  audit_out=$(npm audit fix --ignore-scripts 2>&1)
  audit_rc=$?
  audit_probe=""
  if [ "$audit_rc" -eq 1 ]; then
    audit_probe=$(npm audit --json 2>/dev/null) || true
  fi
  audit_kind=""
  [ "$audit_rc" -eq 0 ] || audit_kind=$(classify_install_failure "$audit_out")
  # The gate is unchanged from before: anything that is not a plain
  # install-error is held back, which keeps BOTH a curation 403 and a fatal
  # ERESOLVE held back. What was wrong lived in classify_install_failure,
  # which read npm's routine ERESOLVE *warning* as a failure - see there.
  if [ "$audit_rc" -ne 0 ] \
     && { [ "$audit_rc" -ne 1 ] \
          || [ "$audit_kind" != "install-error" ] \
          || ! jq -e '.metadata' >/dev/null 2>&1 <<<"$audit_probe"; }; then
    restore_from "$ACCEPTED_LOCK"
    for n in "${subset[@]}"; do
      name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "audit-fix-failed" "$(log_excerpt "$audit_out")")"
    done
    state_add trials "$(jq -n --arg req "$subset_csv" --arg res audit-fix-failed --argjson n "$trial_no" '{n:$n, requested:$req, result:$res}')"
    return 0
  fi

  if ! assert_manifest_and_range_clean; then
    # Rule 3's own discipline, replayed here since a trial's audit fix can
    # hit the identical failure mode: restore (a full git checkout, so the
    # violation itself is undone too) and hold, never let a regression into
    # the accepted lockfile silently.
    restore_from "$ACCEPTED_LOCK"
    for n in "${subset[@]}"; do
      name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "audit-fix-conflict" "$MANIFEST_VIOLATION")"
    done
    state_add trials "$(jq -n --arg req "$subset_csv" --arg res manifest-violation --argjson n "$trial_no" '{n:$n, requested:$req, result:$res}')"
    return 0
  fi

  local delta_file="$WORK/trial-$trial_no-delta.json"
  lock_delta "$ACCEPTED_LOCK" package-lock.json > "$delta_file"

  # A name in this delta that is already convicted/held must not ride along in
  # this trial (defect #6). Audit fix scans the whole tree regardless of the
  # requested subset, so it can re-bump an already-terminal package on disk
  # every trial. If that entry isn't also reverted in package-lock.json itself,
  # this trial validates against a lockfile that still carries the
  # already-terminal package's change, and a failure gets wrongly blamed on
  # whatever's left in the subset instead.
  #
  # Reverting the lockfile entry is the whole fix, and there is deliberately no
  # re-queue: the name is already terminal, so `prune_subset` at the top of
  # trial() would drop it again and the trial would no-op. (There used to be a
  # queue_push here doing exactly that.)
  local conflict conflict_path reverted_any=0
  while IFS=$'\t' read -r conflict conflict_path; do
    [ -n "$conflict" ] || continue
    if name_is_terminal "$conflict"; then
      reverted_any=1
      # Restore the accepted set's entry for that path - or delete the key
      # outright when the accepted set had none. A plain assignment there would
      # write a literal `null` entry into packages{} instead of removing it,
      # which is not a lockfile npm can read; now that the delta also reports
      # added and removed entries, both directions actually occur.
      jq --slurpfile acc "$ACCEPTED_LOCK" --arg k "$conflict_path" \
        'if ($acc[0].packages | has($k)) then .packages[$k] = $acc[0].packages[$k]
         else del(.packages[$k]) end' package-lock.json > "$WORK/relock.json" \
        && mv "$WORK/relock.json" package-lock.json
      jq --arg n "$conflict" 'map(select(.name != $n))' "$delta_file" > "$delta_file.tmp" && mv "$delta_file.tmp" "$delta_file"
    fi
  done < <(jq -r '.[] | "\(.name)\t\(.path)"' "$delta_file")

  # The revert above rewrites package-lock.json only, so node_modules still
  # holds the version the lockfile no longer records. Validating in that state
  # breaks I1/I2 in both directions: a failure gets blamed on whatever else is
  # in the subset (attributed to a version that is not even recorded), and a
  # pass promotes a lockfile that was never actually installed to ACCEPTED_LOCK.
  if [ "$reverted_any" -eq 1 ]; then
    local ci_out ci_rc
    ci_out=$(npm ci --ignore-scripts 2>&1)
    ci_rc=$?
    if [ "$ci_rc" -ne 0 ]; then
      log "::error::dep-bisect: npm ci failed re-syncing node_modules after reverting an already-terminal package"
      log "$ci_out"
      exit 2
    fi
  fi

  local result
  result=$(validate)

  case "$result" in
    pass)
      cp package-lock.json "$ACCEPTED_LOCK"
      jq -c '.[]' "$delta_file" | while IFS= read -r item; do
        echo "$item"
      done > "$WORK/trial-$trial_no-accept.jsonl"
      while IFS= read -r item; do
        [ -n "$item" ] || continue
        state_add accepted "$item"
      done < "$WORK/trial-$trial_no-accept.jsonl"
      # Requested names this trial's delta cannot account for. "npm update <name>"
      # cannot reproduce every change a lockfile can carry: a nested transitive
      # that only audit fix bumps, or an entry the PR *removed* (a dedupe, or a
      # bumped parent dropping a dependency). Those names are real - they came
      # out of the failing lockfile's own delta - but this trial did not move
      # them, so they are not in the accepted set and nothing else will ever make
      # them terminal. Left unmarked they drain the queue and trip I3, which
      # aborts the entire run and discards every correct attribution along with
      # them. The fail branch below needs the same loop for its own reasons -
      # see there; it is NOT free just because a failing trial convicts.
      for n in "${subset[@]}"; do
        name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "not-reproducible" \
          "the PR moved this but npm update <name> produces no lockfile change for it - a nested transitive, or a removal - so it is not in the accepted set")"
      done
      state_add trials "$(jq -n --arg req "$subset_csv" --slurpfile d "$delta_file" --arg res pass --argjson n "$trial_no" \
        '{n:$n, requested:$req, delta:$d[0], result:$res}')"
      ;;
    timeout)
      if [[ "${TIMED_OUT_ONCE_MAP:-}" != *"|$subset_csv|"* ]]; then
        TIMED_OUT_ONCE_MAP="${TIMED_OUT_ONCE_MAP:-}|$subset_csv|"
        queue_push "$subset_csv"
      else
        for n in "${subset[@]}"; do
          name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "validate-timeout" "validate timed out twice on this subset")"
        done
      fi
      state_add trials "$(jq -n --arg req "$subset_csv" --arg res timeout --argjson n "$trial_no" '{n:$n, requested:$req, result:$res}')"
      ;;
    fail)
      local delta_names
      delta_names=$(jq -r '[.[].name] | unique | .[]' "$delta_file")
      local -a dn=()
      while IFS= read -r x; do [ -n "$x" ] && dn+=("$x"); done <<< "$delta_names"
      if [ ${#dn[@]} -eq 0 ]; then
        # No net delta against the accepted set: this trial installed exactly
        # a state that already validated green, so the failure cannot be
        # attributed to the subset - most likely a flaky validate. Convicting
        # it would roll back and file issues for packages that did nothing.
        # If the accepted set really is broken, finalize's re-validation says so.
        for n in "${subset[@]}"; do
          name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "not-reproducible" \
            "this trial's lockfile matched the already-validated accepted set, so the failure cannot be attributed to it - most likely a flaky validate")"
        done
        state_add trials "$(jq -n --arg req "$subset_csv" --arg res fail-no-delta --argjson n "$trial_no" \
          '{n:$n, requested:$req, delta:[], result:$res}')"
        return 0
      fi
      # Requested names this failing delta cannot account for. The empty case
      # above is not the only one: when `dn` is a non-empty STRICT subset of
      # `subset` - trial {A,B}, only A reproducible, validation fails - A is
      # convicted and h1/h2 are split from `dn`, so the leftover names are
      # neither convicted nor requeued. They never become terminal, drain the
      # queue and trip I3, which aborts the whole run and discards the
      # attribution that did succeed. Same defect the pass branch's loop fixes,
      # and this branch did not have it despite a comment up there claiming so.
      local sn
      for sn in "${subset[@]}"; do
        case " ${dn[*]} " in
          *" $sn "*) continue ;;
        esac
        name_is_terminal "$sn" || state_add held_back "$(held_back_entry "$sn" "not-reproducible" \
          "the PR moved this but npm update <name> produces no lockfile change for it - a nested transitive, or a removal - so this failing trial could not attribute it either way")"
      done
      if [ ${#dn[@]} -eq 1 ]; then
        jq --arg n "${dn[0]}" 'map(select(.name==$n)) | .[0] // {name:$n,from:null,to:null}' "$delta_file" > "$WORK/culprit.json"
        state_add culprits "$(jq --arg reason validate-failed --argjson trial "$trial_no" --arg log "$(log_excerpt "$(last_validate_log)")" \
          '. + {reason:$reason, trial:$trial, log_excerpt:$log}' "$WORK/culprit.json")"
      else
        local h1 h2
        { read -r h1; read -r h2; } < <(split_into_two "${dn[@]}")
        queue_push "$h1"; queue_push "$h2"
      fi
      state_add trials "$(jq -n --arg req "$subset_csv" --slurpfile d "$delta_file" --arg res fail --argjson n "$trial_no" \
        '{n:$n, requested:$req, delta:$d[0], result:$res}')"
      ;;
  esac
}

finalize() {
  restore_from "$ACCEPTED_LOCK"
  local final_result
  final_result=$(validate)
  if [ "$final_result" != "pass" ]; then
    # I2/defect #4: the accepted set's own final state failed - hold the
    # whole thing back rather than silently shipping a broken lockfile or
    # dropping the report of why.
    jq -r '.accepted[].name' "$STATE" | while IFS= read -r n; do
      [ -n "$n" ] || continue
      echo "$n"
    done > "$WORK/final-names.txt"
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      state_add held_back "$(held_back_entry "$n" "validate-failed-at-finalize" "the accepted set failed on final re-validation")"
    done < "$WORK/final-names.txt"
    jq '.accepted = []' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
    restore_from "$HEAD_LOCK"
  fi
  FINAL_RESULT="$final_result"
}

write_report() {
  local outcome="$1"
  local final_validated="${FINAL_RESULT:-n/a}"
  local used=$(( $(now_s) - T0 ))
  local queue_json
  queue_json=$(printf '%s\n' "${QUEUE[@]:-}" | jq -R 'select(length>0) | split(",")' | jq -s '.')
  jq -n \
    --arg outcome "$outcome" \
    --slurpfile state "$STATE" \
    --arg final_validated "$final_validated" \
    --arg final_log "$(log_excerpt "$(last_validate_log)")" \
    --argjson budget_limit "$BUDGET_SECONDS" \
    --argjson budget_used "$used" \
    --argjson trials_run "$TRIAL_N" \
    --argjson queue_remaining "$queue_json" \
    --arg base_ref "$BASE_REF" \
    --arg base_sha "${BASE_SHA:-}" \
    '{
      schema: 1,
      outcome: $outcome,
      baseline: { ref: $base_ref, sha: $base_sha },
      accepted: $state[0].accepted,
      culprits: $state[0].culprits,
      held_back: $state[0].held_back,
      trials: $state[0].trials,
      final: { validated: $final_validated, log_excerpt: $final_log },
      budget: { limit_seconds: $budget_limit, used_seconds: $budget_used,
                exhausted: ($outcome == "budget-exhausted"),
                trials_run: $trials_run, queue_remaining: $queue_remaining },
      granularity_note: "culprits/held-backs are held at the name level; every copy of that name across workspaces stays at baseline"
    }' > "$REPORT_PATH"

  if ! jq -e 'type' "$REPORT_PATH" >/dev/null 2>&1; then
    log "::error::dep-bisect: failed to produce a valid JSON report"
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# main

# Must run before anything else, and specifically before the first
# restore_from call: restore_from does a `git checkout -- .` to guarantee
# every trial starts from a fully clean tree, which would otherwise silently
# discard a pre-existing dirty file here instead of surfacing it.
if ! assert_only_lockfile_dirty; then
  log "::error::dep-bisect: working tree is dirty outside package-lock.json at startup - aborting"
  write_report "aborted"
  exit 2
fi

cp package-lock.json "$FULL_LOCK"
# The baseline lockfile. Resolve the ref to a commit first so the error for a
# ref that was never fetched names the ref, not a bare "could not read".
BASE_SHA=$(git rev-parse --verify --quiet "${BASE_REF}^{commit}") || {
  log "::error::dep-bisect: --base '$BASE_REF' is not a commit in this repository (not fetched?)"
  exit 2
}
git show "${BASE_SHA}:${GIT_PREFIX}package-lock.json" > "$HEAD_LOCK" 2>/dev/null || {
  log "::error::dep-bisect: could not read package-lock.json from $BASE_REF ($BASE_SHA)"
  exit 2
}

CHANGED_FILE="$WORK/changed.json"
lock_delta "$HEAD_LOCK" "$FULL_LOCK" > "$CHANGED_FILE"

if [ "$(jq 'length' "$CHANGED_FILE")" -eq 0 ]; then
  log "::error::dep-bisect: validate failed but package-lock.json is unchanged from $BASE_REF - not a dependency issue"
  write_report "aborted"
  exit 2
fi

# Baseline precondition (defect #1): validate the UNCHANGED lockfile before
# attributing anything.
restore_from "$HEAD_LOCK"

# Record what is ALREADY out of range here, before anything is attributed.
# Those names stay excluded from every later range check (see
# range_violations): they are the repo's pre-existing state, not something a
# trial did, and treating them as an invariant breach used to abort the run and
# leave the consumer with no repair path at all.
BASELINE_BAD=$(range_violations) || true
if [ -n "$BASELINE_BAD" ]; then
  BASELINE_RANGE_VIOLATIONS=$(printf '%s' "$BASELINE_BAD" | tr '\n' ',' | sed 's/,$//')
  log "::warning::dep-bisect: baseline ($BASE_REF) already resolves these outside their declared range, so they are not attributable to this PR: ${BASELINE_RANGE_VIOLATIONS//,/, }"
fi

if ! assert_manifest_and_range_clean; then
  log "::error::dep-bisect: baseline ($BASE_REF) itself violates the manifest/range invariant - aborting"
  restore_from "$FULL_LOCK"
  write_report "aborted"
  exit 2
fi
BASELINE_RESULT=$(validate)
if [ "$BASELINE_RESULT" != "pass" ]; then
  restore_from "$FULL_LOCK"
  write_report "baseline-red"
  exit 0
fi

cp "$HEAD_LOCK" "$ACCEPTED_LOCK"

# Every package in the delta is a candidate - there is no exclusion step. The
# delta is known non-empty (an unchanged lockfile aborted above), so this array
# always has at least one element.
# Read in a loop rather than with `mapfile`, which is bash 4 only: the runners
# are bash 5, but this script is also run by hand on macOS (bash 3.2).
ALL_NAMES=()
while IFS= read -r delta_name; do
  ALL_NAMES+=("$delta_name")
done < <(names_from_delta "$CHANGED_FILE" | sort)

if [ ${#ALL_NAMES[@]} -eq 1 ]; then
  jq --arg n "${ALL_NAMES[0]}" 'map(select(.name==$n)) | .[0] // {name:$n,from:null,to:null}' "$CHANGED_FILE" > "$WORK/single-culprit.json"
  state_add culprits "$(jq --arg reason validate-failed '. + {reason:$reason, trial:0, log_excerpt:"baseline is green and this is the only package that changed"}' "$WORK/single-culprit.json")"
else
  { read -r H1; read -r H2; } < <(split_into_two "${ALL_NAMES[@]}")
  queue_push "$H1"
  queue_push "$H2"
fi

BUDGET_EXHAUSTED=0
LAST_TRIAL_COST=60
while [ ${#QUEUE[@]} -gt 0 ]; do
  ELAPSED=$(( $(now_s) - T0 ))
  ESTIMATE=$(( ELAPSED + LAST_TRIAL_COST + VALIDATE_TIMEOUT + 60 ))
  if [ "$ESTIMATE" -gt "$BUDGET_SECONDS" ]; then
    BUDGET_EXHAUSTED=1
    break
  fi
  queue_pop
  subset_csv="$QUEUE_POPPED"
  BEFORE=$(now_s)
  trial "$subset_csv"
  AFTER=$(now_s)
  LAST_TRIAL_COST=$(( AFTER - BEFORE ))
  [ "$LAST_TRIAL_COST" -ge 0 ] || LAST_TRIAL_COST=60
done

if [ "$BUDGET_EXHAUSTED" -eq 1 ]; then
  for subset_csv in "${QUEUE[@]:-}"; do
    [ -n "$subset_csv" ] || continue
    IFS=, read -ra rem <<< "$subset_csv"
    for n in "${rem[@]}"; do
      name_is_terminal "$n" || state_add held_back "$(held_back_entry "$n" "budget-exhausted" "ran out of budget before this could be tried")"
    done
  done
fi

finalize

# I3: every name in the original changed set must land in exactly one
# bucket. A violation here means the algorithm itself has a bug - fail
# loudly rather than hand back a report that lies about that.
MISSING=()
for n in "${ALL_NAMES[@]}"; do
  name_is_terminal "$n" || MISSING+=("$n")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  log "::error::dep-bisect: accounting invariant violated - these names never reached a terminal state: ${MISSING[*]}"
  write_report "aborted"
  exit 2
fi

if [ "$BUDGET_EXHAUSTED" -eq 1 ]; then
  write_report "budget-exhausted"
else
  write_report "culprits"
fi
exit 0
