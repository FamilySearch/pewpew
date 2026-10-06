#!/usr/bin/env bash
# The repair agent's checkpoint: the last whole-tree state known to validate.
#   .github/scripts/dep-checkpoint.sh save      # record the current tree as the checkpoint
#   .github/scripts/dep-checkpoint.sh restore   # throw away everything since, re-install every project
# The checkpoint is a binary diff of the whole tree against the pull request's
# head - files the agent added included, staged through a throwaway index so
# the real one is untouched - kept in .github/aw/ (excluded from anything the
# agent pushes). `save` after every
# change that validated green; `restore` after one that did not - it undoes the
# attempt in full while keeping every earlier success. A wrapper rather than
# three shell commands because an EMPTY checkpoint (nothing changed yet, which
# is the normal state when the agent is dispatched for majors alone) makes a
# bare `git apply` fail, and the allowlist does not admit the `if` around it.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
mkdir -p .github/aw
PATCH=.github/aw/dep-checkpoint.patch
case "${1:?usage: .github/scripts/dep-checkpoint.sh save|restore}" in
  save)
    # A plain `git diff` would leave out untracked files, and restore's
    # `git clean` would then delete a file a green fix added (a new config).
    # `add -A` respects .gitignore, so node_modules and build outputs stay out.
    TMP_INDEX=$(mktemp)
    trap 'rm -f "$TMP_INDEX"' EXIT
    cp "$(git rev-parse --git-path index)" "$TMP_INDEX"
    GIT_INDEX_FILE="$TMP_INDEX" git add -A -- . ':(exclude).github/aw'
    GIT_INDEX_FILE="$TMP_INDEX" git diff --cached --binary HEAD > "$PATCH"
    echo "dep-checkpoint: saved ($(grep -c '^diff --git' "$PATCH" || true) file(s) differ from the PR head)" >&2
    ;;
  restore)
    # reset, not `checkout -- .`: checkout restores from the index, so anything
    # the attempt staged (`git add`) would survive and the apply below would fail.
    git reset -q --hard HEAD
    # Files an attempt added. .github/aw/dep-* is listed in .git/info/exclude so
    # it survives this, as do the gitignored wasm outputs and node_modules.
    git clean -fd -e .github/aw >/dev/null
    if [ -s "$PATCH" ]; then git apply "$PATCH"; fi
    # node_modules still holds what the failed attempt installed.
    # fd 3, not stdin: commands in the body (npm, the validate command) can read
    # stdin, and one that does swallows the remaining project paths - the repair
    # agent's context once listed only the root project for that reason.
    while IFS= read -r p <&3; do
      (cd "$ROOT/$p" && npm ci --ignore-scripts >/dev/null 2>&1) || { echo "dep-checkpoint: npm ci failed in $p while restoring - the checkpoint itself may not install" >&2; exit 1; }
    done 3< <(jq -r '.projects[].path' .github/dependency-update.json)
    echo "dep-checkpoint: restored" >&2
    ;;
  *) echo "dep-checkpoint: expected save or restore, got '$1'" >&2; exit 2 ;;
esac
