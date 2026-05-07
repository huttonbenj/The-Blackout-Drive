#!/bin/bash
# ============================================================
# DOOMSDAY DRIVE — Full Drive Setup (Master Assembly Script)
# ============================================================
# Orchestrates the complete drive assembly workflow:
#   1. Validates environment
#   2. Downloads runtimes (if not already present)
#   3. Downloads AI model (if not already present)
#   4. Downloads content library (if not already present)
#   5. Verifies drive integrity (sizes, file counts)
#   6. Prints final pre-flash checklist
#
# Run from the repo root on your assembly Mac.
# The drive/  directory becomes the flash target.
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

PASS=0
FAIL=0

check() {
    local LABEL="$1"
    local PATH_TO_CHECK="$2"
    local MIN_SIZE_MB="$3"

    if [ ! -e "$PATH_TO_CHECK" ]; then
        echo -e "  ${RED}[FAIL]${NC} Missing: $LABEL"
        FAIL=$((FAIL + 1))
        return
    fi

    if [ -n "$MIN_SIZE_MB" ]; then
        local SIZE_MB=$(du -sm "$PATH_TO_CHECK" | cut -f1)
        if [ "$SIZE_MB" -lt "$MIN_SIZE_MB" ]; then
            echo -e "  ${RED}[FAIL]${NC} Too small: $LABEL (${SIZE_MB}MB < ${MIN_SIZE_MB}MB expected)"
            FAIL=$((FAIL + 1))
            return
        fi
    fi

    echo -e "  ${GREEN}[PASS]${NC} $LABEL"
    PASS=$((PASS + 1))
}

echo ""
echo -e "${YELLOW}  ██████╗  ██████╗  ██████╗ ███╗   ███╗███████╗██████╗  █████╗ ██╗   ██╗${NC}"
echo -e "${YELLOW}  ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║██╔════╝██╔══██╗██╔══██╗╚██╗ ██╔╝${NC}"
echo -e "${YELLOW}  ██║  ██║██║   ██║██║   ██║██╔████╔██║███████╗██║  ██║███████║ ╚████╔╝ ${NC}"
echo -e "${YELLOW}  ██║  ██║██║   ██║██║   ██║██║╚██╔╝██║╚════██║██║  ██║██╔══██║  ╚██╔╝  ${NC}"
echo -e "${YELLOW}  ██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║███████║██████╔╝██║  ██║   ██║   ${NC}"
echo -e "${YELLOW}  ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   ${NC}"
echo ""
echo -e "  ${BOLD}DRIVE ASSEMBLY SETUP — v$DOOMSDAY_VERSION${NC}"
echo "  ============================================="
echo ""

# ── Step 1: Check host dependencies ─────────────────────────
echo -e "  ${BOLD}[1/6] Checking host dependencies...${NC}"
for DEP in curl python3 ollama; do
    if command -v "$DEP" &> /dev/null; then
        echo -e "  ${GREEN}[OK]${NC} $DEP found"
    else
        echo -e "  ${RED}[MISSING]${NC} $DEP — install before continuing"
        FAIL=$((FAIL + 1))
    fi
done
echo ""

# ── Step 2: Download runtimes ────────────────────────────────
echo -e "  ${BOLD}[2/6] Downloading runtimes...${NC}"
if [ ! -d "$DRIVE_DIR/runtime/ollama-mac-arm" ] || [ ! -d "$DRIVE_DIR/runtime/ollama-windows" ]; then
    bash "$SCRIPT_DIR/download_runtime.sh"
else
    echo "  Runtime directories already present. Skipping download."
    echo "  (Delete drive/runtime/ and re-run to force re-download)"
fi
echo ""

# ── Step 3: Download model ───────────────────────────────────
echo -e "  ${BOLD}[3/6] Downloading AI model...${NC}"
if [ ! -f "$DRIVE_DIR/models/$DOOMSDAY_MODEL_FILE" ]; then
    bash "$SCRIPT_DIR/download_models.sh"
else
    SIZE=$(du -sh "$DRIVE_DIR/models/$DOOMSDAY_MODEL_FILE" | cut -f1)
    echo "  Model already present: $DOOMSDAY_MODEL_FILE ($SIZE)"
fi
echo ""

# ── Step 4: Download content library ────────────────────────
echo -e "  ${BOLD}[4/6] Downloading content library...${NC}"
bash "$SCRIPT_DIR/download_content.sh"
echo ""

# ── Step 5: Verify drive integrity ──────────────────────────
echo -e "  ${BOLD}[5/6] Verifying drive integrity...${NC}"
echo ""

# UI files
check "drive/ui/index.html"          "$DRIVE_DIR/ui/index.html"
check "drive/ui/style.css"           "$DRIVE_DIR/ui/style.css"
check "drive/ui/app.js"              "$DRIVE_DIR/ui/app.js"
check "drive/ui/config.js"           "$DRIVE_DIR/ui/config.js"

# Config
check "drive/config.sh"              "$DRIVE_DIR/config.sh"
check "drive/config.bat"             "$DRIVE_DIR/config.bat"
check "drive/Modelfile"              "$DRIVE_DIR/Modelfile"

# Launchers
check "drive/START_MAC.command"      "$DRIVE_DIR/START_MAC.command"
check "drive/START_WINDOWS.bat"      "$DRIVE_DIR/START_WINDOWS.bat"
check "drive/STOP_DOOMSDAY.command"  "$DRIVE_DIR/STOP_DOOMSDAY.command"
check "drive/STOP_DOOMSDAY.bat"      "$DRIVE_DIR/STOP_DOOMSDAY.bat"
check "drive/FIRST_RUN_MAC.command"  "$DRIVE_DIR/FIRST_RUN_MAC.command"
check "drive/FIRST_RUN_WINDOWS.bat"  "$DRIVE_DIR/FIRST_RUN_WINDOWS.bat"
check "drive/FIRST_RUN_README.txt"   "$DRIVE_DIR/FIRST_RUN_README.txt"

# Legal
check "drive/LEGAL/DISCLAIMER.txt"          "$DRIVE_DIR/LEGAL/DISCLAIMER.txt"
check "drive/LEGAL/OPEN_SOURCE_NOTICES.txt" "$DRIVE_DIR/LEGAL/OPEN_SOURCE_NOTICES.txt"
check "drive/LEGAL/OLLAMA_LICENSE.txt"      "$DRIVE_DIR/LEGAL/OLLAMA_LICENSE.txt"
check "drive/LEGAL/PHI3_LICENSE.txt"        "$DRIVE_DIR/LEGAL/PHI3_LICENSE.txt"

# Runtime binaries
check "runtime/ollama-mac-arm"    "$DRIVE_DIR/runtime/ollama-mac-arm"    "50"
check "runtime/ollama-mac-intel"  "$DRIVE_DIR/runtime/ollama-mac-intel"  "50"
check "runtime/ollama-windows"    "$DRIVE_DIR/runtime/ollama-windows"    "50"

# AI model
check "models/$DOOMSDAY_MODEL_FILE" "$DRIVE_DIR/models/$DOOMSDAY_MODEL_FILE" "2000"

# Content (at least some ZIMs or PDFs)
check "content/zim/"   "$DRIVE_DIR/content/zim/"
check "content/books/" "$DRIVE_DIR/content/books/"

echo ""

# ── Step 6: Final summary ────────────────────────────────────
echo -e "  ${BOLD}[6/6] Drive Summary${NC}"
echo ""
echo "  Total drive size:"
du -sh "$DRIVE_DIR" 2>/dev/null | awk '{print "    " $1}'
echo ""
echo "  By directory:"
du -sh "$DRIVE_DIR"/*/  2>/dev/null | sort -rh | head -10 | awk '{print "    " $0}'
echo ""

if [ $FAIL -eq 0 ]; then
    echo "  ============================================="
    echo -e "  ${GREEN}✅ DRIVE READY FOR FLASH${NC}"
    echo ""
    echo "  Results: $PASS checks passed, $FAIL failed"
    echo ""
    echo "  Next steps:"
    echo "    1. Insert USB drive (32GB+ recommended)"
    echo "    2. Run: scripts/flash_drive.sh /Volumes/<your-usb>"
    echo "    3. Test on a clean machine (no Ollama installed)"
    echo "  ============================================="
else
    echo "  ============================================="
    echo -e "  ${RED}❌ DRIVE NOT READY — $FAIL check(s) failed${NC}"
    echo ""
    echo "  Results: $PASS passed, $FAIL failed"
    echo "  Fix the issues above before flashing."
    echo "  ============================================="
    exit 1
fi

echo ""
