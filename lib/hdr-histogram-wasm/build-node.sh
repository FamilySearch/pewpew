#!/bin/sh
### To build, first install wasm-pack, then run this script
# cargo install wasm-pack
set -e
set -x

wasm-pack build --release -t bundler --scope fs
# ~/.cache/.wasm-pack/wasm-opt-4d7a65327e9363b7/wasm-opt pkg/hdr_histogram_wasm_bg.wasm -o pkg/hdr_histogram_wasm_bg.wasm -Oz
