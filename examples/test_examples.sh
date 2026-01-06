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


# Arrays to track background jobs
declare -a PIDS=()
declare -a FILES=()

# Start all tests in parallel
for file in *.yaml; do
  [ -f "$file" ] || break
  echo "Starting: $PEWPEW_PATH run -f json $file"
  # Run in background with timeout
  (
    if timeout 45 "$PEWPEW_PATH" run -f json "$file" > "$file.out"; then
      exit 0
    else
      exit $?
    fi
  ) &
  PIDS+=($!)
  FILES+=("$file")
done

echo "Running ${#PIDS[@]} tests in parallel..."

# Wait for all jobs and collect results
FAILED=0
for i in "${!PIDS[@]}"; do
  pid=${PIDS[$i]}
  file=${FILES[$i]}

  if wait $pid; then
    echo "✓ PASS: $file"
  else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "✗ TIMEOUT: $file (exceeded 30 seconds)"
    else
      echo "✗ FAILED: $file (exit code $EXIT_CODE)"
    fi
    FAILED=$((FAILED + 1))
  fi
done

if [ $FAILED -gt 0 ]; then
  echo "❌ $FAILED test(s) failed"
  exit 1
fi

echo "✅ All examples passed!"
