#!/bin/sh
### Build both guide versions and the shared results viewer for local testing
# This script mirrors what the GitHub workflow does
set -e
set -x

# this function is called when Ctrl-C is sent
trap_ctrlc ()
{
    # cleanup
    rm -rf guide/0.5.x/book
    rm -rf guide/0.6.x/book
    rm -rf guide/results-viewer-react/dist
    rm -rf guide/results-viewer-react/lib/hdr-histogram-wasm
    rm -rf guide/results-viewer-react/lib/config-gen
    rm -rf guide/gh-pages-local
    exit 2
}

# initialise trap to call trap_ctrlc function
# when signal 2 (SIGINT) is received
trap "trap_ctrlc" INT

# Get the project root (parent of guide directory)
GUIDE_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_ROOT=$(dirname "$GUIDE_DIR")

GUIDE_0_6_DIR=$(realpath $GUIDE_DIR/0.6.x)
GUIDE_0_5_DIR=$(realpath $GUIDE_DIR/0.5.x)
# Use the merged results-viewer-react with version selection
RESULTS_VIEWER_REACT_DIR=$(realpath $GUIDE_DIR/results-viewer-react)
WASM_LIB_DIR=$(realpath $PROJECT_ROOT/lib/hdr-histogram-wasm)
mkdir -p "$RESULTS_VIEWER_REACT_DIR/lib/hdr-histogram-wasm"
WASM_OUTPUT_REACT_DIR=$RESULTS_VIEWER_REACT_DIR/lib/hdr-histogram-wasm

CFG_GEN_DIR=$(realpath $PROJECT_ROOT/lib/config-gen)
mkdir -p "$RESULTS_VIEWER_REACT_DIR/lib/config-gen"
CFG_GEN_OUTPUT_REACT_DIR=$RESULTS_VIEWER_REACT_DIR/lib/config-gen

# build the hdr-histogram-wasm for the results viewer
cd $WASM_LIB_DIR
wasm-pack build --release -t bundler -d $WASM_OUTPUT_REACT_DIR --scope fs

# build the config-gen library for the HAR to YAML converter
cd $CFG_GEN_DIR
wasm-pack build --release -t bundler -d $CFG_GEN_OUTPUT_REACT_DIR --scope fs

# build the results viewer (which includes putting the output into the book's src)
cd $RESULTS_VIEWER_REACT_DIR
npm ci
npm run build

# build the 0.6.x guide (scripting version)
cd $GUIDE_0_6_DIR
mdbook build

# build the 0.5.x guide (stable version)
cd $GUIDE_0_5_DIR
mdbook build

# Assemble the final structure for local viewing
cd $GUIDE_DIR
rm -rf gh-pages-local
mkdir -p gh-pages-local

# copy 0.5.x guide to root (default guide)
cp -r 0.5.x/book/. gh-pages-local/

# copy 0.6.x guide to /preview/ subdirectory
mkdir -p gh-pages-local/preview
cp -r 0.6.x/book/. gh-pages-local/preview/

# copy the shared results viewer (from merged viewer with version selector)
mkdir -p gh-pages-local/viewer
cp -r results-viewer-react/dist/. gh-pages-local/viewer/

echo ""
echo "✓ Build complete! The assembled site is in: guide/gh-pages-local/"
echo ""
echo "To view locally, run:"
echo "  ./guide/serve-guide.sh"
echo ""
echo "Then visit: http://localhost:8000"
echo ""
