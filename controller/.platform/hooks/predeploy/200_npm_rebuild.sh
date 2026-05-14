#!/usr/bin/env bash
set -ex

echo "npm rebuild start"

APP_STAGING_DIR=$( /opt/elasticbeanstalk/bin/get-config  platformconfig -k AppStagingDir )

# Add NPM-installed executables to the PATH
NPM_LIB=$( npm list -g | head -1 )
NPM_HOME=$( dirname "${NPM_LIB}" )
export PATH="${NPM_HOME}/bin:${PATH}"

# rebuild to fix the node_modules/.bin/ folder
cd "${APP_STAGING_DIR}"
# https://github.com/vitejs/vite/issues/1361
# https://github.com/evanw/esbuild/issues/1711
npm install -D esbuild
# PERF-3613: When the artifact is built on x86 CodeBuild but deployed to a
# Graviton (arm64) instance, the platform-specific optionalDependencies
# (@next/swc-*, sharp) arrive with the wrong arch. Reinstalling next forces
# npm to pick the correct optional binaries for the running instance.
# Idempotent across x86 and arm64 instances.
# Pin to the exact version from the lock file to avoid picking up a newer
# release than what CI validated.
NEXT_VERSION=$(node -p "require('./package-lock.json').packages['node_modules/next'].version")
npm install --no-save "next@${NEXT_VERSION}"
npm rebuild
chmod a+x node_modules/.bin/*
npm install -g rimraf

echo "npm rebuild done"
