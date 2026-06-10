#!/bin/bash
# ============================================================
# The Blackout Drive -- Linux Launcher
# ============================================================
# Double-click this (or run from terminal) to start
# The Blackout Drive. Works on first run and every run after.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/_system" && pwd)"

if [ ! -f "$SCRIPT_DIR/config.json" ]; then
    echo ""
    echo "  [ERROR] System files not found."
    echo "  Make sure the _system folder is present on this drive."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# Hand off to the real launcher
exec bash "$SCRIPT_DIR/START_LINUX.sh"
