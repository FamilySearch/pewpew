#!/bin/bash
set -e
set +x
source ./variables.sh

if [ -z ${PORT+x} ]; then
  echo "PORT is unset. Please start the test-server and specify the PORT variable when running this";
  exit 1
else
  echo "Testing examples on PORT '$PORT'";
fi
PEWPEW_PATH=("pewpew")
if [[ ! -z "$1" ]] ; then
  PEWPEW_PATH=("$1")
fi
PEWPEW_VERSION=$($PEWPEW_PATH --version)
echo "Testing examples against version $PEWPEW_VERSION"


for file in *.yaml; do
  [ -f "$file" ] || break
  echo "Running: $PEWPEW_PATH run -f json $file"
  # Use timeout to prevent hanging (30 seconds should be plenty for short run scripts)
  if timeout 30 "$PEWPEW_PATH" run -f json "$file" > "$file.out"; then
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
echo "All examples passed!"
