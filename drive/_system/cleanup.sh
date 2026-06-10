#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# The Blackout Drive — Build Cleanup Script
# Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
# ═══════════════════════════════════════════════════════════════
#
# Purges development artifacts before manufacturing or release.
# Run from the repository root: bash drive/_system/cleanup.sh
#
# What gets deleted:
#   - __pycache__/ directories (recursive)
#   - *.pyc compiled bytecode files
#   - test_*.py test files in drive/
#   - .DS_Store macOS metadata files
#   - data/logs/ diagnostic logs
#
# Safe to run multiple times (idempotent).
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRIVE_ROOT="$(dirname "$SCRIPT_DIR")"

echo "═══ Blackout Drive Build Cleanup ═══"
echo "Drive root: $DRIVE_ROOT"
echo ""

# 1. Remove __pycache__ directories
count=$(find "$DRIVE_ROOT" -type d -name "__pycache__" 2>/dev/null | wc -l | tr -d ' ')
find "$DRIVE_ROOT" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
echo "✓ Removed $count __pycache__/ directories"

# 2. Remove .pyc files
count=$(find "$DRIVE_ROOT" -name "*.pyc" -type f 2>/dev/null | wc -l | tr -d ' ')
find "$DRIVE_ROOT" -name "*.pyc" -type f -delete 2>/dev/null || true
echo "✓ Removed $count .pyc files"

# 3. Remove test files from drive root
count=0
for testfile in "$DRIVE_ROOT"/test_*.py; do
    if [ -f "$testfile" ]; then
        rm -f "$testfile"
        count=$((count + 1))
        echo "  - Deleted $(basename "$testfile")"
    fi
done
echo "✓ Removed $count test file(s)"

# 4. Remove .DS_Store files
count=$(find "$DRIVE_ROOT" -name ".DS_Store" -type f 2>/dev/null | wc -l | tr -d ' ')
find "$DRIVE_ROOT" -name ".DS_Store" -type f -delete 2>/dev/null || true
echo "✓ Removed $count .DS_Store files"

# 5. Remove diagnostic logs
LOG_DIR="$DRIVE_ROOT/_system/data/logs"
if [ -d "$LOG_DIR" ]; then
    rm -rf "$LOG_DIR"
    echo "✓ Removed data/logs/ directory"
else
    echo "✓ No data/logs/ directory to remove"
fi

echo ""
echo "═══ Cleanup complete ═══"
