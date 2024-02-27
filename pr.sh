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
cargo build --bin test-server
cargo build -p pewpew-config-updater

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

cd "$CWD/lib/config-gen"
# cargo install wasm-pack
wasm-pack test --node
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
npm run build:common
npm run build:react
NODE_ENV=test npm test

# npm run testcleanup
# npm run coverage
# echo grab screenshot

# npm run testcleanup
# echo Hit Ctrl-C when acceptance tests finish
# npm acceptance:all
# echo grab screenshot

cargo deny check --hide-inclusion-graph license sources advisories
