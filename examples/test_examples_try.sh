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
  echo "Running: $PEWPEW_PATH try -f json $file"
  "$PEWPEW_PATH" try -f json "$file" > "$file.try.out"
  echo "Result: $?"
done
echo "All try examples passed!"
