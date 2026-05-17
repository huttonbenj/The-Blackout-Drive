#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Mac First Run / Gatekeeper Fix
# ============================================================
# macOS Gatekeeper blocks downloaded executables by default.
# This script removes the quarantine flag from all Blackout Drive
# binaries in ONE click — then launches normally.
#
# HOW TO USE: Double-click this file ONCE instead of
# START_MAC.command on your first run. After that, use
# START_MAC.command for all future sessions.
# ============================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo ""
echo "  THE BLACKOUT DRIVE — First Run Setup"
echo "  Removing macOS security quarantine from drive binaries..."
echo ""

# Remove quarantine flag from all executables on the drive
xattr -rd com.apple.quarantine "$SCRIPT_DIR/runtime/" 2>/dev/null && \
    echo "  [OK] Runtime binaries cleared" || \
    echo "  [INFO] Runtime folder not yet populated (run setup scripts first)"

xattr -rd com.apple.quarantine "$SCRIPT_DIR/START_MAC.command" 2>/dev/null && \
    echo "  [OK] Launcher cleared"

xattr -rd com.apple.quarantine "$SCRIPT_DIR/STOP_BEACON.command" 2>/dev/null
xattr -rd com.apple.quarantine "$SCRIPT_DIR/FIRST_RUN_MAC.command" 2>/dev/null

# Make all .command scripts executable
chmod +x "$SCRIPT_DIR"/*.command 2>/dev/null
echo "  [OK] Script permissions set"

echo ""
echo "  Setup complete. Launching BEACON..."
echo ""
sleep 1

# Hand off to the main launcher
exec "$SCRIPT_DIR/START_MAC.command"
