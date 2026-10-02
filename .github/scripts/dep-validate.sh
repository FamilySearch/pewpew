#!/usr/bin/env bash
# Runs one project's validate command - the repair agent's ONLY validation path.
#   bash .github/scripts/dep-validate.sh <project-path>
# The command is read from .github/aw/dep-validate-cmd-<slug>, which the agent
# workflow's pre-agent step writes from .github/dependency-update.json on the
# BASE branch - never from the pull request's own tree, so a PR cannot choose
# the command that runs with the job's tokens in scope. A missing or empty file
# is a bug in the staging order, so this refuses rather than falling back to
# `npm test` and validating against a gate this repository does not use.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/dep-project.sh"
dep_project_resolve "${1:?usage: dep-validate.sh <project-path>}" || exit 2
CMD_FILE="$ROOT/.github/aw/dep-validate-cmd-$SLUG"
if [ ! -s "$CMD_FILE" ]; then
  echo "::error::dep-validate: $CMD_FILE is missing or empty. The pre-agent step writes one per configured project before anything runs, so this is a bug - refusing to guess a validate command." >&2
  exit 1
fi
CMD=$(cat "$CMD_FILE")
echo "dep-validate [$PROJECT]: $CMD" >&2
cd "$ROOT/$PROJECT" && exec bash -euo pipefail -c "$CMD"
