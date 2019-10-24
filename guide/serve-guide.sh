#!/bin/sh
set -e
set -x

# this function is called when Ctrl-C is sent
function trap_ctrlc ()
{
    # cleanup
    rm -rf book
    rm -rf src/results-viewer
    rm -rf results-viewer/lib/hdr-histogram-wasm
    exit 2
}
 
# initialise trap to call trap_ctrlc function
# when signal 2 (SIGINT) is received
trap "trap_ctrlc" SIGINT

PROJECT_ROOT=$(realpath ../)
GUIDE_DIR=$(realpath $PROJECT_ROOT/guide)
RESULTS_VIEWER_DIR=$(realpath $GUIDE_DIR/results-viewer)
WASM_LIB_DIR=$(realpath $PROJECT_ROOT/lib/hdr-histogram-wasm)
WASM_OUTPUT_DIR=$(realpath $RESULTS_VIEWER_DIR/lib/hdr-histogram-wasm)

# build the hdr-histogram-wasm for the results viewer
cd $WASM_LIB_DIR
wasm-pack build --release -t web -d $WASM_OUTPUT_DIR
cd $WASM_OUTPUT_DIR
sed 's/module = import\.meta\.url.*/import(".\/hdr_histogram_wasm_bg.wasm");\nmodule = require.resolve(".\/hdr_histogram_wasm_bg.wasm")[0][0];/' hdr_histogram_wasm.js > hdr_histogram_wasm2.js
mv hdr_histogram_wasm2.js hdr_histogram_wasm.js

# build the results viewer (which includes putting the output into the book's src)
cd $RESULTS_VIEWER_DIR
npm install
npm run build

# build the book
cd $GUIDE_DIR
mdbook serve