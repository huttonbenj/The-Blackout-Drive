#!/bin/bash
echo ""
echo "==========================================================="
echo "  THE BLACKOUT DRIVE — EMERGENCY RESTORE"
echo "==========================================================="
echo ""
echo "  This will restore all system files to factory defaults."
echo "  Your USER_DATA (uploads, conversations) will NOT be touched."
echo ""
read -p "  Type RESTORE to confirm: " confirm
if [ "$confirm" != "RESTORE" ]; then
    echo ""
    echo "  Cancelled. No changes made."
    exit 0
fi
echo ""
echo "  Restoring factory defaults..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -R "${SCRIPT_DIR}/_system/_factory/"* "${SCRIPT_DIR}/_system/"
echo ""
echo "  ✓ Factory defaults restored."
echo "  Please restart the drive to apply changes."
echo ""
