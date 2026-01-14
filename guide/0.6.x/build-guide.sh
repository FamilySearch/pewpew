#!/bin/sh
### To build, first install wasm-pack, then run this script
# cargo install wasm-pack
# cargo install mdbook
set -e
set -x

# this function is called when Ctrl-C is sent
trap_ctrlc ()
{
    # cleanup
    rm -rf book
    rm -rf src/results-viewer
    rm -rf results-viewer/lib/hdr-histogram-wasm
    rm -rf results-viewer-react.lib/config-gen
    exit 2
}

# initialise trap to call trap_ctrlc function
# when signal 2 (SIGINT) is received
# https://unix.stackexchange.com/questions/314554/why-do-i-get-an-error-message-when-trying-to-trap-a-sigint-signal
trap "trap_ctrlc" INT

PROJECT_ROOT=$(realpath ../)
GUIDE_DIR=$(realpath $PROJECT_ROOT/guide)
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

# build the book
cd $GUIDE_DIR
mdbook build
