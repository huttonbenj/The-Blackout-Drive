#!/bin/bash
# ============================================================
# The Blackout Drive — Flash Drive Script
# ============================================================
# Copies the assembled drive/ contents to a physical USB drive.
# Run this AFTER setup_drive.sh passes all integrity checks.
#
# Usage:
#   bash scripts/flash_drive.sh /Volumes/BLACKOUT
#
# Requirements:
#   - A USB drive formatted as ExFAT or FAT32 (works on both
#     Windows and Mac without extra drivers)
#   - At least 32GB capacity (64GB recommended)
#   - setup_drive.sh must have passed first
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Argument validation ───────────────────────────────────────
if [ -z "$1" ]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} No target volume specified."
    echo ""
    echo "Usage: bash scripts/flash_drive.sh /Volumes/<your-usb-name>"
    echo ""
    echo "Available volumes:"
    ls /Volumes/ | sed 's/^/  /'
    echo ""
    exit 1
fi

TARGET="$1"

# Strip trailing slash
TARGET="${TARGET%/}"

echo ""
echo -e "${YELLOW}  The Blackout Drive — Flash Drive${NC}"
echo "  ============================================="
echo ""

# ── Safety checks ────────────────────────────────────────────
echo -e "  ${CYAN}[CHECK]${NC} Validating target: $TARGET"

if [ ! -d "$TARGET" ]; then
    echo -e "  ${RED}[ERROR]${NC} Target volume not found: $TARGET"
    echo "  Insert your USB drive and check /Volumes/ for its name."
    exit 1
fi

# Make sure it's not the system disk
SYSTEM_DISK=$(df / | tail -1 | awk '{print $1}')
TARGET_DISK=$(df "$TARGET" | tail -1 | awk '{print $1}')
if [ "$SYSTEM_DISK" = "$TARGET_DISK" ]; then
    echo -e "  ${RED}[ERROR]${NC} Target appears to be your system disk. Refusing."
    exit 1
fi

# Check available space (need ~25GB minimum)
AVAIL_KB=$(df -k "$TARGET" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
SOURCE_KB=$(du -sk "$DRIVE_DIR" | cut -f1)
SOURCE_GB=$((SOURCE_KB / 1024 / 1024))

echo -e "  ${CYAN}[INFO]${NC}  Source size:     ~${SOURCE_GB}GB"
echo -e "  ${CYAN}[INFO]${NC}  Target free:     ~${AVAIL_GB}GB"

if [ "$AVAIL_KB" -lt "$SOURCE_KB" ]; then
    echo -e "  ${RED}[ERROR]${NC} Not enough space on $TARGET"
    echo "  Need: ~${SOURCE_GB}GB,  Available: ~${AVAIL_GB}GB"
    exit 1
fi

echo -e "  ${GREEN}[OK]${NC}   Space check passed."
echo ""

# ── Confirmation prompt ───────────────────────────────────────
echo -e "  ${YELLOW}⚠ WARNING:${NC} This will copy all The Blackout Drive files to:"
echo "  $TARGET"
echo ""
echo "  Existing files on the drive will NOT be deleted (rsync merge)."
echo "  To start fresh, manually erase the drive first."
echo ""
read -p "  Proceed? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    exit 0
fi

echo ""

# ── Flash ─────────────────────────────────────────────────────
echo -e "  ${CYAN}[FLASH]${NC} Copying files to $TARGET..."
echo "         This may take 10-30 minutes depending on USB speed."
echo ""

# rsync flags:
#   -a  archive (preserves permissions, timestamps, symlinks)
#   -v  verbose
#   -h  human-readable sizes
#   --progress  per-file progress
#   --exclude   skip dev/git artifacts not needed on the product drive
rsync -avh --progress \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    "$DRIVE_DIR/" "$TARGET/"

echo ""

# ── Set executable permissions on scripts (Mac can't always preserve them) ──
echo -e "  ${CYAN}[POST]${NC}  Setting executable permissions..."
chmod +x "$TARGET/START_MAC.command"         2>/dev/null || true
chmod +x "$TARGET/STOP_BEACON.command"     2>/dev/null || true
chmod +x "$TARGET/FIRST_RUN_MAC.command"     2>/dev/null || true

# ── Verify key files exist on the target ─────────────────────
echo -e "  ${CYAN}[VERIFY]${NC} Verifying flash..."
ERRORS=0

for F in \
    "START_MAC.command" \
    "START_WINDOWS.bat" \
    "STOP_BEACON.command" \
    "STOP_BEACON.bat" \
    "FIRST_RUN_MAC.command" \
    "FIRST_RUN_WINDOWS.bat" \
    "FIRST_RUN_README.txt" \
    "Modelfile" \
    "config.sh" \
    "config.bat" \
    "ui/index.html" \
    "ui/app.js" \
    "ui/style.css" \
    "ui/config.js" \
    "LEGAL/DISCLAIMER.txt"; do
    if [ -f "$TARGET/$F" ]; then
        echo -e "  ${GREEN}[OK]${NC}  $F"
    else
        echo -e "  ${RED}[MISSING]${NC} $F"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check model file
MODEL_ON_DRIVE="$TARGET/models/$BLACKOUT_MODEL_FILE"
if [ -f "$MODEL_ON_DRIVE" ]; then
    MODEL_SIZE=$(du -sh "$MODEL_ON_DRIVE" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC}  models/$BLACKOUT_MODEL_FILE ($MODEL_SIZE)"
else
    echo -e "  ${RED}[MISSING]${NC} models/$BLACKOUT_MODEL_FILE — model not flashed!"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# ── Eject ────────────────────────────────────────────────────
if [ $ERRORS -eq 0 ]; then
    echo "  ============================================="
    echo -e "  ${GREEN}✅ FLASH COMPLETE${NC}"
    echo ""
    TOTAL=$(du -sh "$TARGET" 2>/dev/null | cut -f1)
    echo "  Drive: $TARGET"
    echo "  Total: $TOTAL"
    echo ""
    echo "  To eject safely:"
    echo "    diskutil eject \"$TARGET\""
    echo ""
    echo "  QA: Test on a machine with NO Ollama installed."
    echo "  ============================================="
else
    echo "  ============================================="
    echo -e "  ${RED}❌ FLASH INCOMPLETE — $ERRORS file(s) missing${NC}"
    echo "  Check the errors above and re-run setup_drive.sh."
    echo "  ============================================="
    exit 1
fi

echo ""
