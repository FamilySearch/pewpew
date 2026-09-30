#!/usr/bin/env bash
# Sourced by the dep-*.sh wrappers. Resolves <project-path> against the repo
# root and refuses anything that is not one of the npm projects the monthly
# update covers. The wrappers are the ONLY way the repair agent runs npm, so
# this is where "which directory" is bounded: an argument is a path the config
# lists, not an arbitrary string. Sets ROOT, PROJECT (normalised) and SLUG (the
# suffix .github/aw/dep-* runtime files use for this project).
dep_project_resolve() { # dep_project_resolve <project-path>
  local raw="${1:?project path required}"
  ROOT=$(git rev-parse --show-toplevel)
  PROJECT=$(printf '%s' "$raw" | sed -e 's#^\./##' -e 's#/*$##')
  [ -n "$PROJECT" ] || PROJECT=.
  case "$PROJECT" in
    /*|*..*) echo "dep-project: refusing '$raw' - project paths are relative and inside the repository" >&2; return 2 ;;
  esac
  if ! jq -e --arg p "$PROJECT" '.projects[] | select(.path == $p)' "$ROOT/.github/dependency-update.json" >/dev/null 2>&1; then
    echo "dep-project: '$raw' is not a project listed in .github/dependency-update.json" >&2
    return 2
  fi
  [ -f "$ROOT/$PROJECT/package-lock.json" ] || { echo "dep-project: $PROJECT has no package-lock.json" >&2; return 2; }
  SLUG=$(printf '%s' "$PROJECT" | sed -e 's#^\.$#root#' -e 's#/#__#g')
  export ROOT PROJECT SLUG
}
