#!/bin/sh
set -e
set -x
echo PORT=8089 RUST_LOG=warn ./target/debug/test-server \& PORT=8089 RUST_LOG=warn ./target/debug/pewpew run tests/int_on_demand.yaml -f json -w -d ./ -o stats-test.json -t 1s
# https://stackoverflow.com/a/52033580/7752223
(trap 'kill 0' SIGINT; \
PORT=8089 RUST_LOG=warn ./target/debug/test-server & \
PORT=8089 RUST_LOG=warn ./target/debug/pewpew run tests/int_on_demand.yaml -f json -w -d ./ -o stats-test.json -t 1s \
)
killall test-server
ps -ef | grep test-server