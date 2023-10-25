#!/bin/bash
set -e
set -x

PROJECT_ROOT=$(realpath ./)
CONTROLLER_DIR=$(realpath $PROJECT_ROOT/controller)
WASM_LIB_DIR=$(realpath $PROJECT_ROOT/lib/hdr-histogram-wasm)
WASM_OUTPUT_CONTROLLER_DIR=$CONTROLLER_DIR/lib/hdr-histogram-wasm
mkdir -p "$WASM_OUTPUT_CONTROLLER_DIR"

cargo build
# cargo install cross
# cargo build --target x86_64-unknown-linux-musl
# cross build --target aarch64-unknown-linux-musl
# cross build --target armv7-unknown-linux-musleabihf

# cargo fmt --all
cargo fmt --all -- --check

cargo clippy --all -- -D warnings

cargo test --all
cargo test --all --doc

CWD=$(pwd)

cd "$CWD/lib/config-wasm"
# cargo install wasm-pack
wasm-pack build --release -t nodejs --scope fs
# ~/.cache/.wasm-pack/wasm-opt-4d7a65327e9363b7/wasm-opt pkg/config_wasm_bg.wasm -o pkg/config_wasm_bg.wasm -Oz

cd tests/
npm ci
npm test

cd "$CWD/lib/hdr-histogram-wasm"
wasm-pack build --release -t nodejs --scope fs
wasm-pack build --release -t bundler -d $WASM_OUTPUT_CONTROLLER_DIR --scope fs
# ~/.cache/.wasm-pack/wasm-opt-4d7a65327e9363b7/wasm-opt pkg/hdr_histogram_wasm_bg.wasm -o pkg/hdr_histogram_wasm_bg.wasm -Oz
cd tests/
npm ci
npm test

cd "$CWD"

npm ci
npm run linterror
npm run build:react
NODE_ENV=test npm test

# terminal 1
# npm run coverage
# grab screenshot
# cd controller/ && npm run testcleanup

# terminal 2
# cd controller/ && npm start
# terminal 3
# cd controller/ && npm run acceptance
# grab screenshot

cargo deny check --hide-inclusion-graph license sources advisories
