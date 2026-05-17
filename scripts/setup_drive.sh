#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Full Drive Setup (Master Assembly Script)
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
source "$DRIVE_DIR/_system/config.sh"

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
echo -e "${YELLOW}  ████████╗██╗  ██╗███████╗    ██████╗ ██╗      █████╗  ██████╗██╗  ██╗ ██████╗ ██╗   ██╗████████╗${NC}"
echo -e "${YELLOW}  ╚══██╔══╝██║  ██║██╔════╝    ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝██╔═══██╗██║   ██║╚══██╔══╝${NC}"
echo -e "${YELLOW}     ██║   ███████║█████╗      ██████╔╝██║     ███████║██║     █████╔╝ ██║   ██║██║   ██║   ██║   ${NC}"
echo -e "${YELLOW}     ██║   ██╔══██║██╔══╝      ██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║   ██║██║   ██║   ██║   ${NC}"
echo -e "${YELLOW}     ██║   ██║  ██║███████╗    ██████╔╝███████╗██║  ██║╚██████╗██║  ██╗╚██████╔╝╚██████╔╝   ██║   ${NC}"
echo -e "${YELLOW}     ╚═╝   ╚═╝  ╚═╝╚══════╝    ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ${NC}"
echo -e "${YELLOW}                           ██████╗ ██████╗ ██╗██╗   ██╗███████╗${NC}"
echo -e "${YELLOW}                           ██╔══██╗██╔══██╗██║██║   ██║██╔════╝${NC}"
echo -e "${YELLOW}                           ██║  ██║██████╔╝██║██║   ██║█████╗  ${NC}"
echo -e "${YELLOW}                           ██║  ██║██╔══██╗██║╚██╗ ██╔╝██╔══╝  ${NC}"
echo -e "${YELLOW}                           ██████╔╝██║  ██║██║ ╚████╔╝ ███████╗${NC}"
echo -e "${YELLOW}                           ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝${NC}"
echo ""
echo -e "  ${BOLD}THE BLACKOUT DRIVE — SETUP v$BLACKOUT_VERSION${NC}"
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
if [ ! -d "$DRIVE_DIR/_system/runtime/ollama-mac-arm" ] || \
   [ ! -d "$DRIVE_DIR/_system/runtime/ollama-windows" ] || \
   [ ! -d "$DRIVE_DIR/_system/runtime/ollama-linux-amd64" ]; then
    bash "$SCRIPT_DIR/download_runtime.sh"
else
    echo "  Runtime directories already present. Skipping download."
    echo "  (Delete drive/_system/runtime/ and re-run to force re-download)"
fi
echo ""

# ── Step 3: Download model ───────────────────────────────────
echo -e "  ${BOLD}[3/6] Downloading AI model...${NC}"
# Read model filename from the single source of truth (models.json via model_setup.py)
SETUP_MODEL_FILE=$(python3 "$DRIVE_DIR/_system/model_setup.py" "$DRIVE_DIR/_system" --print-config 2>/dev/null | grep '^MODEL_FILE=' | cut -d= -f2)
if [ -z "$SETUP_MODEL_FILE" ]; then
    echo -e "  ${RED}[ERROR]${NC} Could not read model config from model_setup.py"
    FAIL=$((FAIL + 1))
elif [ ! -f "$DRIVE_DIR/_system/models/$SETUP_MODEL_FILE" ]; then
    bash "$SCRIPT_DIR/download_models.sh"
else
    SIZE=$(du -sh "$DRIVE_DIR/_system/models/$SETUP_MODEL_FILE" | cut -f1)
    echo "  Model already present: $SETUP_MODEL_FILE ($SIZE)"
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
check "drive/_system/ui/index.html"          "$DRIVE_DIR/_system/ui/index.html"
check "drive/_system/ui/style.css"           "$DRIVE_DIR/_system/ui/style.css"
check "drive/_system/ui/app.js"              "$DRIVE_DIR/_system/ui/app.js"
check "drive/_system/ui/config.js"           "$DRIVE_DIR/_system/ui/config.js"

# Config
check "drive/_system/config.sh"              "$DRIVE_DIR/_system/config.sh"
check "drive/_system/config.bat"             "$DRIVE_DIR/_system/config.bat"
check "drive/_system/config.json"            "$DRIVE_DIR/_system/config.json"
check "drive/_system/models.json"            "$DRIVE_DIR/_system/models.json"
check "drive/_system/model_setup.py"         "$DRIVE_DIR/_system/model_setup.py"

# Launchers (root-level)
check "drive/The Blackout Drive.app"         "$DRIVE_DIR/The Blackout Drive.app"
check "drive/Start (Windows).bat"            "$DRIVE_DIR/Start (Windows).bat"
check "drive/README.txt"                     "$DRIVE_DIR/README.txt"

# Internal launchers
check "drive/_system/START_MAC.command"      "$DRIVE_DIR/_system/START_MAC.command"
check "drive/_system/START_WINDOWS.bat"      "$DRIVE_DIR/_system/START_WINDOWS.bat"
check "drive/_system/STOP_BEACON.command"    "$DRIVE_DIR/_system/STOP_BEACON.command"
check "drive/_system/STOP_BEACON.bat"        "$DRIVE_DIR/_system/STOP_BEACON.bat"

# Server
check "drive/_system/server.py"              "$DRIVE_DIR/_system/server.py"

# Legal
check "drive/_system/LEGAL/DISCLAIMER.txt"          "$DRIVE_DIR/_system/LEGAL/DISCLAIMER.txt"
check "drive/_system/LEGAL/OPEN_SOURCE_NOTICES.txt" "$DRIVE_DIR/_system/LEGAL/OPEN_SOURCE_NOTICES.txt"
check "drive/_system/LEGAL/OLLAMA_LICENSE.txt"      "$DRIVE_DIR/_system/LEGAL/OLLAMA_LICENSE.txt"

# Runtime binaries
check "runtime/ollama-mac-arm"      "$DRIVE_DIR/_system/runtime/ollama-mac-arm"      "50"
check "runtime/ollama-mac-intel"    "$DRIVE_DIR/_system/runtime/ollama-mac-intel"    "50"
check "runtime/ollama-windows"      "$DRIVE_DIR/_system/runtime/ollama-windows"      "50"
check "runtime/ollama-linux-amd64"  "$DRIVE_DIR/_system/runtime/ollama-linux-amd64"  "50"
check "runtime/ollama-linux-arm64"  "$DRIVE_DIR/_system/runtime/ollama-linux-arm64"  "50"

# AI model (read filename from model_setup.py, the single source of truth)
if [ -n "$SETUP_MODEL_FILE" ]; then
    check "models/$SETUP_MODEL_FILE" "$DRIVE_DIR/_system/models/$SETUP_MODEL_FILE" "2000"
else
    echo -e "  ${RED}[FAIL]${NC} Could not determine model filename"
    FAIL=$((FAIL + 1))
fi

# Content (at least some ZIMs or PDFs)
check "content/zim/"   "$DRIVE_DIR/_system/content/zim/"
check "content/books/" "$DRIVE_DIR/_system/content/books/"

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
