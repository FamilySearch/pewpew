#!/bin/sh
### Serve the locally built guides for testing
set -e

# Get the directory where this script is located
GUIDE_DIR=$(cd "$(dirname "$0")" && pwd)

if [ ! -d "$GUIDE_DIR/gh-pages-local" ]; then
    echo "Error: gh-pages-local directory not found"
    echo "Please run ./guide/build-guide.sh first"
    exit 1
fi

echo "Starting local server..."
echo "Visit: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd "$GUIDE_DIR/gh-pages-local"
python3 -m http.server 8000
