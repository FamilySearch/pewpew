#!/bin/bash
set +e # Continue on errors
set -x # Echo commands
rm fs_home.yaml
rm integration.json
rm test-epoch*.json
rm tests/test-epoch*.json
rm tests/stats-integration*.json
rm examples/*.out
rm examples/search-*.json
rm examples/stats-*.json
rm examples/log-results*
