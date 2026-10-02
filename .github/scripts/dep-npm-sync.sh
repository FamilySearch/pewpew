#!/usr/bin/env bash
# The two lockfile/node_modules sync operations the repair agent may run:
#   bash .github/scripts/dep-npm-sync.sh <project-path> ci        # install exactly what package-lock.json says
#   bash .github/scripts/dep-npm-sync.sh <project-path> install   # re-resolve package-lock.json from package.json
# `ci` is how a checkpoint is restored. `install` is what makes an edit to
# package.json (a range bump, an `overrides` change) real in the lockfile - it
# resolves against the manifest and nothing else, so it can only reach what
# package.json declares. Both always --ignore-scripts (these are unvetted
# versions; install time is where supply-chain compromises land) and accept no
# other options, so the registry, scripts and audit behaviour cannot be changed
# from the command line.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/dep-project.sh"
dep_project_resolve "${1:?usage: dep-npm-sync.sh <project-path> ci|install}" || exit 2
MODE="${2:?usage: dep-npm-sync.sh <project-path> ci|install}"
[ "$#" -eq 2 ] || { echo "dep-npm-sync: takes exactly <project-path> and ci|install" >&2; exit 2; }
cd "$ROOT/$PROJECT"
case "$MODE" in
  ci)      echo "dep-npm-sync [$PROJECT]: npm ci --ignore-scripts" >&2;      exec npm ci --ignore-scripts ;;
  install) echo "dep-npm-sync [$PROJECT]: npm install --ignore-scripts --no-audit --no-fund" >&2
           exec npm install --ignore-scripts --no-audit --no-fund ;;
  *) echo "dep-npm-sync: mode must be ci or install, got '$MODE'" >&2; exit 2 ;;
esac
