#!/bin/bash
# ============================================================
# The Blackout Drive — Wipe User Data (Pre-Handoff Reset)
# ============================================================
# Resets a flashed USB drive to factory-fresh state by removing
# all user-generated data. After running this, the next boot
# will trigger the first-run experience (EULA, master password
# creation, etc.) as if the drive has never been used.
#
# Usage:
#   bash scripts/wipe_user_data.sh /Volumes/BLACKOUT
#
# What gets deleted:
#   - Master password (ecosystem_key.json)
#   - User config (config.json, config.json.bak)
#   - Password lockout state (.pw_lockout.json)
#   - All conversations
#   - All locked/unlocked user files
#   - COMMS logs (comms_log.bkv)
#   - COMMS provisioning (channel PSK, provisioning state)
#   - Debug logs
#   - Ollama runtime cache (regenerated on boot)
#   - Active tier detection (regenerated on boot)
#
# What is preserved:
#   - System files (_system/)
#   - Library content (books, manuals)
#   - AI model files
#   - Runtime binaries
#   - Factory defaults
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

TARGET="${1%/}"

if [ -z "$TARGET" ]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} No target volume specified."
    echo ""
    echo "Usage: bash scripts/wipe_user_data.sh /Volumes/<usb-name>"
    echo ""
    echo "Available volumes:"
    ls /Volumes/ | sed 's/^/  /'
    echo ""
    exit 1
fi

if [ ! -d "$TARGET" ]; then
    echo -e "${RED}[ERROR]${NC} Target volume not found: $TARGET"
    exit 1
fi

# Safety: don't run on system disk
SYSTEM_DISK=$(df / | tail -1 | awk '{print $1}')
TARGET_DISK=$(df "$TARGET" | tail -1 | awk '{print $1}')
if [ "$SYSTEM_DISK" = "$TARGET_DISK" ]; then
    echo -e "${RED}[ERROR]${NC} Target appears to be your system disk. Refusing."
    exit 1
fi

# Verify it's actually a Blackout Drive
if [ ! -d "$TARGET/_system" ] || [ ! -f "$TARGET/_system/server.py" ]; then
    echo -e "${RED}[ERROR]${NC} $TARGET does not appear to be a Blackout Drive."
    exit 1
fi

echo ""
echo -e "${YELLOW}  The Blackout Drive — Wipe User Data${NC}"
echo "  ============================================="
echo ""
echo -e "  ${YELLOW}⚠ WARNING:${NC} This will delete ALL user data on:"
echo "  $TARGET"
echo ""
echo "  This includes:"
echo "    • Master password"
echo "    • All conversations"
echo "    • All locked and unlocked files"
echo "    • COMMS logs"
echo "    • Radio provisioning (channel keys)"
echo "    • All user settings"
echo ""
echo "  The drive will behave as brand-new on next boot."
echo ""
read -p "  Are you sure? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    exit 0
fi

echo ""

# ── 1. User identity & auth ─────────────────────────────────
echo -e "  ${CYAN}[WIPE]${NC}  Master password (ecosystem_key.json)..."
rm -f "$TARGET/USER_DATA/ecosystem_key.json"

echo -e "  ${CYAN}[WIPE]${NC}  Password lockout (.pw_lockout.json)..."
rm -f "$TARGET/USER_DATA/.pw_lockout.json"

echo -e "  ${CYAN}[WIPE]${NC}  User config (config.json, backups)..."
rm -f "$TARGET/USER_DATA/config.json"
rm -f "$TARGET/USER_DATA/config.json.bak"
rm -f "$TARGET/USER_DATA/config.json.tmp"

echo -e "  ${CYAN}[WIPE]${NC}  Library bookmarks..."
rm -f "$TARGET/USER_DATA/library_bookmarks.json"

# ── 2. Conversations ─────────────────────────────────────────
CONV_DIR="$TARGET/USER_DATA/conversations"
if [ -d "$CONV_DIR" ]; then
    CONV_COUNT=$(find "$CONV_DIR" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${CYAN}[WIPE]${NC}  Conversations ($CONV_COUNT files)..."
    find "$CONV_DIR" -name "*.json" -delete 2>/dev/null || true
fi

# ── 3. Locked & unlocked files ───────────────────────────────
for DIR in locked unlocked content; do
    DPATH="$TARGET/USER_DATA/$DIR"
    if [ -d "$DPATH" ]; then
        FILE_COUNT=$(find "$DPATH" -type f ! -name "README.txt" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo -e "  ${CYAN}[WIPE]${NC}  USER_DATA/$DIR/ ($FILE_COUNT files)..."
            find "$DPATH" -type f ! -name "README.txt" -delete 2>/dev/null || true
            # Remove empty subdirectories
            find "$DPATH" -mindepth 1 -type d -empty -delete 2>/dev/null || true
        fi
    fi
done

# ── 4. COMMS logs ─────────────────────────────────────────────
echo -e "  ${CYAN}[WIPE]${NC}  COMMS logs..."
rm -f "$TARGET/USER_DATA/comms_log.bkv"
rm -f "$TARGET/_system/data/comms_log.enc"
rm -f "$TARGET/_system/data/comms_log.enc.tmp"

# ── 4b. COMMS provisioning artifacts ─────────────────────────
echo -e "  ${CYAN}[WIPE]${NC}  COMMS provisioning (PSK + state)..."
rm -f "$TARGET/USER_DATA/comms_channel_key.bkv"
rm -f "$TARGET/USER_DATA/comms_provisioned.json"
rm -f "$TARGET/_system/data/comms_channel_key.bkv"
rm -f "$TARGET/_system/data/comms_provisioned.json"

# ── 5. Debug logs ─────────────────────────────────────────────
echo -e "  ${CYAN}[WIPE]${NC}  Debug logs..."
rm -rf "$TARGET/_system/data/logs" 2>/dev/null || true
rm -f "$TARGET/USER_DATA/logs/server.log" 2>/dev/null || true
mkdir -p "$TARGET/_system/data/logs"
mkdir -p "$TARGET/USER_DATA/logs"

# ── 6. Runtime cache (regenerated on boot) ────────────────────
OLLAMA_CACHE="$TARGET/_system/data/ollama_models"
if [ -d "$OLLAMA_CACHE" ]; then
    CACHE_SIZE=$(du -sh "$OLLAMA_CACHE" 2>/dev/null | cut -f1)
    echo -e "  ${CYAN}[WIPE]${NC}  Ollama runtime cache ($CACHE_SIZE)..."
    rm -rf "$OLLAMA_CACHE"
fi

# ── 7. Active tier detection (regenerated on boot) ────────────
if [ -f "$TARGET/_system/data/active_tier.json" ]; then
    echo -e "  ${CYAN}[WIPE]${NC}  Active tier detection (active_tier.json)..."
    rm -f "$TARGET/_system/data/active_tier.json"
fi

# ── 8. Mac metadata cleanup ──────────────────────────────────
echo -e "  ${CYAN}[CLEAN]${NC} Mac metadata..."
find "$TARGET" -name '._*' -delete 2>/dev/null || true
find "$TARGET" -name '.DS_Store' -delete 2>/dev/null || true

echo ""

# ── Verify fresh state ───────────────────────────────────────
echo -e "  ${CYAN}[VERIFY]${NC} Checking fresh state..."
ERRORS=0

for STALE_FILE in \
    "USER_DATA/ecosystem_key.json" \
    "USER_DATA/.pw_lockout.json" \
    "USER_DATA/config.json" \
    "USER_DATA/config.json.bak" \
    "_system/data/active_tier.json"; do
    if [ -f "$TARGET/$STALE_FILE" ]; then
        echo -e "  ${RED}[STALE]${NC} $STALE_FILE still exists!"
        ERRORS=$((ERRORS + 1))
    fi
done

CONV_REMAINING=$(find "$TARGET/USER_DATA/conversations" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
if [ "$CONV_REMAINING" -gt 0 ]; then
    echo -e "  ${RED}[STALE]${NC} $CONV_REMAINING conversation files remain!"
    ERRORS=$((ERRORS + 1))
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "  ============================================="
    echo -e "  ${GREEN}✅ WIPE COMPLETE — Drive is factory-fresh${NC}"
    echo ""
    echo "  Next boot will trigger:"
    echo "    1. EULA / Disclaimer acceptance"
    echo "    2. Master password creation"
    echo "    3. Clean first-run experience"
    echo ""
    echo "  To eject safely:"
    echo "    diskutil eject \"$TARGET\""
    echo "  ============================================="
else
    echo "  ============================================="
    echo -e "  ${RED}❌ WIPE INCOMPLETE — $ERRORS stale file(s) remain${NC}"
    echo "  ============================================="
    exit 1
fi

echo ""
