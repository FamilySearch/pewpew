#!/bin/bash
set -e
set +x
source ./variables.sh

if [ -z ${PORT+x} ]; then
  echo "PORT is unset. Please start the test-server and specify the PORT variable when running this";
  exit 1
else
  echo "Testing examples (try mode) on PORT '$PORT'";
fi
PEWPEW_PATH=("pewpew")
if [[ ! -z "$1" ]] ; then
  PEWPEW_PATH=("$1")
fi
PEWPEW_VERSION=$($PEWPEW_PATH --version)
echo "Testing examples against version $PEWPEW_VERSION"


for file in *.yaml; do
  [ -f "$file" ] || break
  # Skip files that have declare which fail try mode
  case "$file" in
    declare.yaml|delete_search.yaml|provider_collect.yaml|random_search.yaml)
      echo "Skipping: $file"
      continue
      ;;
  esac
  echo "Running: $PEWPEW_PATH try -f json $file"
  # Use timeout to prevent hanging (30 seconds should be plenty for try scripts)
  if timeout 30 "$PEWPEW_PATH" try -f json "$file" > "$file.try.out"; then
    echo "Result: PASS"
  else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "Result: TIMEOUT (exceeded 30 seconds)"
    else
      echo "Result: FAILED with exit code $EXIT_CODE"
    fi
    exit $EXIT_CODE
  fi
done
echo "All try examples passed!"
