#!/bin/bash
# Helper script to merge guide changes from master branch
#
# Usage: ./guide/merge-from-master.sh
#
# This script helps merge changes from master's guide/src into the new
# dual-version structure (0.5.x and 0.6.x)

set -e

echo "Checking for guide changes in master..."

# Fetch latest master
git fetch origin master:master 2>/dev/null || true

# Find the merge base
MERGE_BASE=$(git merge-base HEAD master)

# Check if there are guide changes
if git diff --quiet $MERGE_BASE master -- guide/src; then
    echo "✓ No guide changes in master since last merge"
    exit 0
fi

echo ""
echo "Guide changes detected in master:"
echo "=================================="
git diff --stat $MERGE_BASE master -- guide/src

echo ""
echo "Files changed:"
git diff --name-only $MERGE_BASE master -- guide/src

echo ""
echo "To merge these changes:"
echo "1. Review the changes: git diff $MERGE_BASE master -- guide/src"
echo "2. For each changed file in guide/src/:"
echo "   - Apply to guide/0.5.x/src/ (stable version)"
echo "   - Decide if it should also go to guide/0.6.x/src/ (preview version)"
echo ""
echo "Example workflow:"
echo "  git show master:guide/src/introduction.md > guide/0.5.x/src/introduction.md"
echo "  git add guide/0.5.x/src/introduction.md"
echo ""
