#!/usr/bin/env bash
# `npm update` for NAMED packages only, in one project.
#   bash .github/scripts/dep-npm-update.sh <project-path> <package> [<package>...]
# Package names and nothing else: a version, alias, path or option would let
# the agent choose a registry, re-enable install scripts, or install something
# package.json never declared. To take a new major the agent edits the range in
# package.json first, then this re-resolves that name to the newest version
# the NEW range allows - `npm update` never crosses the declared range itself.
# Names may carry an @scope/ prefix and (grandfathered) capitals; each segment
# must start alphanumeric so a leading dot or dash cannot be a path or a flag.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/dep-project.sh"
dep_project_resolve "${1:?usage: dep-npm-update.sh <project-path> <package>...}" || exit 2
shift
[ "$#" -gt 0 ] || { echo "dep-npm-update: no package names given" >&2; exit 2; }
for a in "$@"; do
  if [[ ! "$a" =~ ^(@[A-Za-z0-9][A-Za-z0-9._-]*/)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "dep-npm-update: refusing '$a' - package names only. Versions, aliases, paths, options and the registry are not the agent's to choose." >&2
    exit 2
  fi
done
cd "$ROOT/$PROJECT"
echo "dep-npm-update [$PROJECT]: npm update --ignore-scripts $*" >&2
exec npm update --ignore-scripts "$@"
