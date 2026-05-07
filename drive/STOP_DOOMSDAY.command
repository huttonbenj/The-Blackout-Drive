#!/bin/bash
# ============================================================
# DOOMSDAY DRIVE — Mac Emergency Stop
# ============================================================
# Run this if:
#  - You want to stop DOOMSDAY before unplugging the drive
#  - The main launcher was closed without proper shutdown
#  - You suspect Ollama is still running after removal
# ============================================================

echo ""
echo "  [SHUTDOWN] Stopping DOOMSDAY system..."
echo ""

# Kill all ollama processes
pkill -f "ollama" 2>/dev/null

# Give it a moment
sleep 1

# Verify
if pgrep -f "ollama" > /dev/null 2>&1; then
    echo "  [WARNING] Ollama still running. Forcing termination..."
    pkill -9 -f "ollama" 2>/dev/null
    sleep 1
fi

if pgrep -f "ollama" > /dev/null 2>&1; then
    echo "  [ERROR] Could not terminate Ollama. Try: sudo pkill -9 ollama"
else
    echo "  [OK] DOOMSDAY system stopped."
    echo "  [OK] Safe to unplug the drive."
fi

echo ""
sleep 2
