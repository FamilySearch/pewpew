#!/bin/sh
### To build, first install wasm-pack, then run this script
# cargo install wasm-pack --version 0.10.1
set -e
set -x

wasm-pack build --release -t nodejs --scope fs
~/.cache/.wasm-pack/wasm-opt-4d7a65327e9363b7/wasm-opt pkg/config_wasm_bg.wasm -o pkg/config_wasm_bg.wasm -Oz
