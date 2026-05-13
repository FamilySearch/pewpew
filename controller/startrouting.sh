#!/bin/bash
set -e
set -x

export BASE_PATH='/pewpew/load-test'
npm run build && npm run start
