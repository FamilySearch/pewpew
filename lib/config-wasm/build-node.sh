#!/bin/sh
### To build, first install wasm-pack, then run this script
# cargo install wasm-pack --version 0.10.0
set -e
set -x

wasm-pack build --release -t nodejs --scope fs