#!/bin/bash
set -e
set -x

AUTH_MODE=okta-np BASE_PATH='/pewpew/load-test' npm run start
