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

TZ=UTC cargo test --all
cargo test --all --doc

# Test examples with try scripts
echo "Starting test-server for examples testing..."
RUST_LOG=warn PORT=8082 timeout 600 ./target/debug/test-server > /dev/null 2>&1 &
TEST_SERVER_PID=$!
sleep 2

cd examples
echo "Running try examples..."
START_TIME=$(date +%s)
RUST_LOG=warn PORT=8082 ./test_examples_try.sh ../target/debug/pewpew || {
  EXIT_CODE=$?
  echo "ERROR: test_examples_try.sh failed with exit code $EXIT_CODE"
  kill $TEST_SERVER_PID 2>/dev/null || true
  exit $EXIT_CODE
}
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "✅ Try examples completed in ${ELAPSED}s"

read -e -p "Run Examples Tests y/N: " choice
if [[ "$choice" == [Yy]* ]]; then
  echo "Running run examples..."
  START_TIME=$(date +%s)
  RUST_LOG=warn PORT=8082 ./test_examples.sh ../target/debug/pewpew || {
    EXIT_CODE=$?
    echo "ERROR: test_examples.sh failed with exit code $EXIT_CODE"
    kill $TEST_SERVER_PID 2>/dev/null || true
    exit $EXIT_CODE
  }
  END_TIME=$(date +%s)
  ELAPSED=$((END_TIME - START_TIME))
  echo "✅ Run examples completed in ${ELAPSED}s"
fi
cd ..

# Clean up test-server
kill $TEST_SERVER_PID 2>/dev/null || true
echo "✅ Examples testing complete - PASSED"

# cargo install cargo-deny
cargo deny check --hide-inclusion-graph license sources advisories

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

read -e -p "Run Integration Tests y/N: " choice
if [[ "$choice" == [Yy]* ]]; then
  npm run testcleanup
  export RUST_LOG=warn
  # npm run integration
  # read -e -p "Grab screenshot then hit enter to continue." choice
  npm run integration:common
  read -e -p "Grab common screenshot then hit enter to continue." choice
  npm run integration:agent
  read -e -p "Grab agent screenshot then hit enter to continue." choice
  set +e
  clean_result="1"
  while [[ "$clean_result" != "0" ]]; do
    (npm run testcleanup)
    clean_result=$?
    echo "clean_result: $clean_result"
  done
  set -e
  npm run integration:controller
  read -e -p "Grab controller screenshot then hit enter to continue." choice
fi

read -e -p "Run Acceptance Tests y/N: " choice
if [[ "$choice" == [Yy]* ]]; then
  set +e
  clean_result="1"
  while [[ "$clean_result" != "0" ]]; do
    (npm run testcleanup)
    clean_result=$?
    echo "clean_result: $clean_result"
  done
  set -e
  echo Hit Ctrl-C when acceptance tests finish
  export ACCEPTANCE_AWS_PERMISSIONS=true
  npm run acceptance:all
  read -e -p "Grab screenshot then hit enter to continue." choice
fi
