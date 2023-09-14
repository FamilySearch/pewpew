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
npm rebuild
chmod a+x node_modules/.bin/*
npm install -g rimraf

echo "npm rebuild done"
