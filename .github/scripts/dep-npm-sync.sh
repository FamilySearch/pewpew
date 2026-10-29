#!/usr/bin/env bash
# The two lockfile/node_modules sync operations the repair agent may run:
#   .github/scripts/dep-npm-sync.sh <project-path> ci        # install exactly what package-lock.json says
#   .github/scripts/dep-npm-sync.sh <project-path> install   # re-resolve package-lock.json from package.json
# `ci` is how a checkpoint is restored. `install` is what makes an edit to
# package.json (a range bump, an `overrides` change) real in the lockfile - it
# resolves against the manifest and nothing else, so it can only reach what
# package.json declares. Both always --ignore-scripts (these are unvetted
# versions; install time is where supply-chain compromises land) and accept no
# other options, so the registry, scripts and audit behaviour cannot be changed
# from the command line.
#
# `install` also dedupes the split a range bump can leave in a workspace: npm
# nests the new version under the workspace that declares it (e.g.
# controller/node_modules/chart.js 4.6.1) and keeps the old one hoisted only as
# another package's peer (node_modules/chart.js 4.5.1, "peer": true). Both
# resolve, so validate stays green, but the peer consumer (chartjs-adapter-
# date-fns) then registers on a different instance than the workspace imports.
# Dropping every copy of the package from the lockfile and installing again
# re-resolves just that package to one hoisted copy. Not `npm dedupe`: that
# re-resolves every duplicated package against today's registry.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/dep-project.sh"
dep_project_resolve "${1:?usage: .github/scripts/dep-npm-sync.sh <project-path> ci|install}" || exit 2
MODE="${2:?usage: .github/scripts/dep-npm-sync.sh <project-path> ci|install}"
[ "$#" -eq 2 ] || { echo "dep-npm-sync: takes exactly <project-path> and ci|install" >&2; exit 2; }
cd "$ROOT/$PROJECT"

# Packages a workspace has nested at a different version than the hoisted copy
# that is only there as someone's peer. One name per line.
peer_splits() {
  node -e '
    const lock = JSON.parse(require("fs").readFileSync("package-lock.json", "utf8")).packages;
    const split = new Set();
    for (const key of Object.keys(lock)) {
      const match = /^(.+?)\/node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
      if (!match || match[1].includes("node_modules")) { continue; } // only <workspace>/node_modules/<pkg>
      const hoisted = lock[`node_modules/${match[2]}`];
      if (hoisted?.peer && hoisted.version !== lock[key].version) { split.add(match[2]); }
    }
    for (const name of split) { console.log(name); }
  '
}

# Removes every lockfile entry for the named packages, nested or hoisted.
drop_from_lock() {
  node -e '
    const fs = require("fs");
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    const names = process.argv.slice(1);
    for (const key of Object.keys(lock.packages)) {
      if (names.some((name) => key.endsWith(`node_modules/${name}`))) { delete lock.packages[key]; }
    }
    fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  ' "$@"
}

case "$MODE" in
  ci)      echo "dep-npm-sync [$PROJECT]: npm ci --ignore-scripts" >&2;      exec npm ci --ignore-scripts ;;
  install) echo "dep-npm-sync [$PROJECT]: npm install --ignore-scripts --no-audit --no-fund" >&2
           npm install --ignore-scripts --no-audit --no-fund
           mapfile -t SPLIT < <(peer_splits)
           [ "${#SPLIT[@]}" -gt 0 ] || exit 0
           echo "dep-npm-sync [$PROJECT]: deduping ${SPLIT[*]} (nested in a workspace, hoisted only as a peer)" >&2
           drop_from_lock "${SPLIT[@]}"
           npm install --ignore-scripts --no-audit --no-fund
           mapfile -t SPLIT < <(peer_splits)
           if [ "${#SPLIT[@]}" -gt 0 ]; then
             echo "dep-npm-sync [$PROJECT]: still split after dedupe: ${SPLIT[*]} - a peer range excludes the workspace's version (npm ls <pkg> --all)" >&2
             exit 1
           fi ;;
  *) echo "dep-npm-sync: mode must be ci or install, got '$MODE'" >&2; exit 2 ;;
esac
