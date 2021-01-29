#!/bin/sh
### To build, first install wasm-pack, then run this script
# cargo install wasm-pack --version 0.8.1
set -e
set -x

wasm-pack build --release -t nodejs