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
source "$DRIVE_DIR/_system/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Argument parsing ──────────────────────────────────────────
TARGET=""
MODEL_OVERRIDE=""

for arg in "$@"; do
    case "$arg" in
        --model=*) MODEL_OVERRIDE="${arg#--model=}" ;;
        --model)   shift; MODEL_OVERRIDE="$1" ;;
        -*) echo -e "${RED}[ERROR]${NC} Unknown flag: $arg"; exit 1 ;;
        *) TARGET="$arg" ;;
    esac
done

if [ -z "$TARGET" ]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} No target volume specified."
    echo ""
    echo "Usage: bash scripts/flash_drive.sh /Volumes/<usb-name> [--model <model-key>]"
    echo ""
    echo "  Available model keys (from models.json):"
    python3 -c "
import json, sys
with open('$DRIVE_DIR/_system/models.json') as f:
    data = json.load(f)
default = data.get('default','')
for key in data.get('models', {}):
    tag = ' ← default' if key == default else ''
    desc = data['models'][key].get('description', '')
    print(f'    {key}{tag}')
    print(f'      {desc}')
" 2>/dev/null || echo "    (could not read models.json)"
    echo ""
    echo "Available volumes:"
    ls /Volumes/ | sed 's/^/  /'
    echo ""
    exit 1
fi

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

# Clean Ollama runtime cache — these are blobs created by `ollama create`
# at boot time and are NOT the source GGUF model files. They get regenerated
# automatically on next launch. Cleaning them reclaims ~2-5GB.
OLLAMA_CACHE="$TARGET/_system/data/ollama_models"
if [ -d "$OLLAMA_CACHE" ]; then
    CACHE_SIZE=$(du -sh "$OLLAMA_CACHE" 2>/dev/null | cut -f1)
    echo -e "  ${CYAN}[CLEAN]${NC} Removing Ollama runtime cache ($CACHE_SIZE)..."
    rm -rf "$OLLAMA_CACHE"
fi

# Check available space
AVAIL_KB=$(df -k "$TARGET" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
SOURCE_KB=$(du -sk "$DRIVE_DIR" | cut -f1)
SOURCE_GB=$((SOURCE_KB / 1024 / 1024))

# For incremental updates (re-flash), most data is already on the drive.
# Only check for full source size on first flash (when drive is near-empty).
TARGET_USED_KB=$(du -sk "$TARGET" 2>/dev/null | cut -f1)

echo -e "  ${CYAN}[INFO]${NC}  Source size:     ~${SOURCE_GB}GB"
echo -e "  ${CYAN}[INFO]${NC}  Target free:     ~${AVAIL_GB}GB"

if [ "$AVAIL_KB" -lt "$SOURCE_KB" ]; then
    # The drive may already contain most of the source files (incremental update).
    # Only fail if free space + existing content can't fit the source.
    TOTAL_USABLE=$((AVAIL_KB + TARGET_USED_KB))
    if [ "$TOTAL_USABLE" -lt "$SOURCE_KB" ]; then
        echo -e "  ${RED}[ERROR]${NC} Not enough space on $TARGET"
        echo "  Need: ~${SOURCE_GB}GB,  Available: ~${AVAIL_GB}GB"
        exit 1
    else
        echo -e "  ${CYAN}[INFO]${NC}  Incremental update — existing files will be overwritten in-place."
    fi
fi

echo -e "  ${GREEN}[OK]${NC}   Space check passed."
echo ""

# ── Confirmation prompt ───────────────────────────────────────
echo -e "  ${YELLOW}⚠ WARNING:${NC} This will copy all The Blackout Drive files to:"
echo "  $TARGET"
echo ""
echo "  User data (conversations, logs) will be preserved."
echo "  Stale content files will be removed to match the source."
echo ""
read -p "  Proceed? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    exit 0
fi

echo ""

# ── Profile / Model switching ─────────────────────────────────
# The prompt architecture is 3-layer (identity.txt + tuning.txt + device_facts.txt)
# stored in profiles/{tier}/. model_setup.py picks the correct profile based on
# the model tier in models.json. No manual prompt file copying needed.
MODELS_JSON="$DRIVE_DIR/_system/models.json"
MODELS_JSON_BACKUP=""

if [ -n "$MODEL_OVERRIDE" ]; then
    # Validate model key exists in models.json
    MODEL_EXISTS=$(python3 -c "
import json
with open('$MODELS_JSON') as f:
    data = json.load(f)
print('yes' if '$MODEL_OVERRIDE' in data.get('models', {}) else 'no')
" 2>/dev/null)

    if [ "$MODEL_EXISTS" != "yes" ]; then
        echo -e "  ${RED}[ERROR]${NC} Model '$MODEL_OVERRIDE' not found in models.json"
        echo "  Available models:"
        python3 -c "
import json
with open('$MODELS_JSON') as f:
    data = json.load(f)
for k in data.get('models', {}):
    print(f'    {k}')
" 2>/dev/null
        exit 1
    fi

    echo -e "  ${CYAN}[PROFILE]${NC} Model override: ${BOLD}$MODEL_OVERRIDE${NC}"

    # Patch models.json default (save backup to restore after flash)
    MODELS_JSON_BACKUP=$(python3 -c "
import json, sys
with open('$MODELS_JSON') as f:
    content = f.read()
print(content)
")
    python3 -c "
import json
with open('$MODELS_JSON') as f:
    data = json.load(f)
data['default'] = '$MODEL_OVERRIDE'
with open('$MODELS_JSON', 'w') as f:
    json.dump(data, f, indent=2)
print('  [OK] models.json default → $MODEL_OVERRIDE')
"
    echo ""
fi

# ── Regenerate Modelfile from profile layers ─────────────────
echo -e "  ${CYAN}[BUILD]${NC}  Regenerating Modelfile from profile layers..."
python3 "$DRIVE_DIR/_system/model_setup.py" "$DRIVE_DIR/_system" --generate-modelfile
echo -e "  ${GREEN}[OK]${NC}   Modelfile.generated updated."
echo ""

# ── Flash ─────────────────────────────────────────────────────
echo -e "  ${CYAN}[FLASH]${NC} Copying files to $TARGET..."
echo "         This may take 10-30 minutes depending on USB speed."
echo ""

# ── Build library text index for RAG search ──────────────────
echo "📚 Building library text index..."
python3 "$(dirname "$0")/build_text_index.py" "$DRIVE_DIR/_system" 2>&1
echo ""


# rsync flags:
#   -a  archive (preserves permissions, timestamps, symlinks)
#   -v  verbose
#   -h  human-readable sizes
#   --progress  per-file progress
#   --exclude   skip dev/git artifacts and Mac metadata not needed on the product drive
#   NOTE: USER_DATA/ is excluded — user files are NEVER overwritten by flash
rsync -avh --progress \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='.Spotlight-V100' \
    --exclude='.fseventsd' \
    --exclude='.Trashes' \
    --exclude='._*' \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    --exclude='USER_DATA/conversations/*' \
    --exclude='USER_DATA/unlocked/*' \
    --exclude='USER_DATA/locked/*' \
    --exclude='USER_DATA/content/*' \
    --exclude='USER_DATA/.tmp' \
    "$DRIVE_DIR/" "$TARGET/"

# ── Ensure USER_DATA structure exists on target ──────────────
echo -e "  ${CYAN}[POST]${NC}  Ensuring USER_DATA/ structure..."
mkdir -p "$TARGET/USER_DATA/conversations" \
         "$TARGET/USER_DATA/unlocked" \
         "$TARGET/USER_DATA/locked" \
         "$TARGET/USER_DATA/content"

# ── Migrate conversations from legacy location if needed ─────
LEGACY_CONV="$TARGET/_system/data/conversations"
NEW_CONV="$TARGET/USER_DATA/conversations"
if [ -d "$LEGACY_CONV" ] && [ "$(ls -A "$LEGACY_CONV" 2>/dev/null)" ]; then
    echo -e "  ${YELLOW}[MIGRATE]${NC} Moving conversations to USER_DATA/..."
    for f in "$LEGACY_CONV"/*.json; do
        [ -f "$f" ] || continue
        base=$(basename "$f")
        if [ ! -f "$NEW_CONV/$base" ]; then
            mv "$f" "$NEW_CONV/$base"
        fi
    done
    # Clean up legacy dir if empty
    rmdir "$LEGACY_CONV" 2>/dev/null || true
    echo -e "  ${GREEN}[OK]${NC}   Conversations migrated."
fi

# ── Clean orphaned directories from previous versions ────────
if [ -d "$TARGET/drive" ]; then
    echo -e "  ${CYAN}[CLEAN]${NC} Removing orphaned drive/ directory..."
    rm -rf "$TARGET/drive"
fi
if [ -d "$TARGET/content/user" ]; then
    echo -e "  ${CYAN}[CLEAN]${NC} Removing orphaned content/user/ directory..."
    rm -rf "$TARGET/content/user"
fi
# Remove the entire root-level content/ directory (user content now lives in USER_DATA/content/)
if [ -d "$TARGET/content" ]; then
    echo -e "  ${CYAN}[CLEAN]${NC} Removing orphaned root content/ directory..."
    rm -rf "$TARGET/content"
fi

# ── Clean stale books from previous flashes ──────────────────
# The main rsync above does NOT use --delete (to preserve user data like
# conversations and logs). But content/books/ should exactly mirror the source.
# Without this, old books removed from the source persist on the USB and
# show up as "Other Content" in the Manage Space panel.
echo -e "  ${CYAN}[POST]${NC}  Cleaning stale content files..."
rsync -avh --delete --progress \
    "$DRIVE_DIR/_system/content/books/" "$TARGET/_system/content/books/"

echo ""

# ── Remove Mac metadata files that cause Windows "problem with drive" warnings ──
echo -e "  ${CYAN}[POST]${NC}  Cleaning Mac metadata (prevents Windows warnings)..."
find "$TARGET" -name '._*' -delete 2>/dev/null || true
find "$TARGET" -name '.DS_Store' -delete 2>/dev/null || true
rm -rf "$TARGET/.Spotlight-V100" "$TARGET/.fseventsd" "$TARGET/.Trashes" 2>/dev/null || true
echo -e "  ${GREEN}[OK]${NC}   Mac metadata removed."

# ── Set executable permissions on scripts (Mac can't always preserve them) ──
echo -e "  ${CYAN}[POST]${NC}  Setting executable permissions..."
chmod +x "$TARGET/_system/START_MAC.command"         2>/dev/null || true
chmod +x "$TARGET/_system/STOP_BEACON.command"       2>/dev/null || true
chmod +x "$TARGET/The Blackout Drive.app/Contents/MacOS/launch" 2>/dev/null || true

# ── Verify key files exist on the target ─────────────────────
echo -e "  ${CYAN}[VERIFY]${NC} Verifying flash..."
ERRORS=0

# Read model filename from model_setup.py
BLACKOUT_MODEL_FILE=$(python3 "$DRIVE_DIR/_system/model_setup.py" "$DRIVE_DIR/_system" --print-config 2>/dev/null | grep '^MODEL_FILE=' | cut -d= -f2)

for F in \
    "The Blackout Drive.app/Contents/MacOS/launch" \
    "Start (Windows).bat" \
    "README.txt" \
    "_system/START_MAC.command" \
    "_system/START_WINDOWS.bat" \
    "_system/START_LINUX.sh" \
    "_system/STOP_BEACON.command" \
    "_system/STOP_BEACON.bat" \
    "_system/model_setup.py" \
    "_system/models.json" \
    "_system/config.sh" \
    "_system/config.bat" \
    "_system/server.py" \
    "_system/ui/index.html" \
    "_system/ui/app.js" \
    "_system/ui/style.css" \
    "_system/ui/config.js" \
    "_system/LEGAL/DISCLAIMER.txt"; do
    if [ -f "$TARGET/$F" ]; then
        echo -e "  ${GREEN}[OK]${NC}  $F"
    else
        echo -e "  ${RED}[MISSING]${NC} $F"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check model file
MODEL_ON_DRIVE="$TARGET/_system/models/$BLACKOUT_MODEL_FILE"
if [ -f "$MODEL_ON_DRIVE" ]; then
    MODEL_SIZE=$(du -sh "$MODEL_ON_DRIVE" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC}  _system/models/$BLACKOUT_MODEL_FILE ($MODEL_SIZE)"
else
    echo -e "  ${RED}[MISSING]${NC} _system/models/$BLACKOUT_MODEL_FILE — model not flashed!"
    ERRORS=$((ERRORS + 1))
fi

# Check Python runtime for Windows
PYTHON_EXE="$TARGET/_system/runtime/python-windows/python.exe"
if [ -f "$PYTHON_EXE" ]; then
    echo -e "  ${GREEN}[OK]${NC}  _system/runtime/python-windows/python.exe"
else
    echo -e "  ${YELLOW}[WARN]${NC} _system/runtime/python-windows/python.exe — Windows won't be plug-and-play!"
fi

# Check GPU runners for Windows
OLLAMA_LIB="$TARGET/_system/runtime/ollama-windows/lib"
if [ -d "$OLLAMA_LIB" ]; then
    LIB_SIZE=$(du -sh "$OLLAMA_LIB" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC}  _system/runtime/ollama-windows/lib/ ($LIB_SIZE GPU runners)"
else
    echo -e "  ${YELLOW}[WARN]${NC} _system/runtime/ollama-windows/lib/ — GPU acceleration unavailable on Windows!"
    echo -e "         Run scripts/download_runtime.sh to include GPU runners."
fi

# Check Linux runtimes
LINUX_OLLAMA="$TARGET/_system/runtime/ollama-linux-amd64"
if [ -d "$LINUX_OLLAMA" ]; then
    LINUX_SIZE=$(du -sh "$LINUX_OLLAMA" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC}  _system/runtime/ollama-linux-amd64/ ($LINUX_SIZE)"
else
    echo -e "  ${YELLOW}[WARN]${NC} _system/runtime/ollama-linux-amd64/ — Linux x86_64 won't be plug-and-play!"
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
    if [ -n "$MODEL_OVERRIDE" ]; then
        echo "  Model: $MODEL_OVERRIDE"
    fi
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
    # Still restore models.json even on failure
    if [ -n "$MODELS_JSON_BACKUP" ]; then
        echo "$MODELS_JSON_BACKUP" > "$MODELS_JSON"
    fi
    exit 1
fi

# ── Restore models.json to repo default ──────────────────────
# The profile flash temporarily patched models.json. Restore it
# so git doesn't show a spurious diff and the repo stays clean.
if [ -n "$MODELS_JSON_BACKUP" ]; then
    echo "$MODELS_JSON_BACKUP" > "$MODELS_JSON"
    echo -e "  ${CYAN}[RESTORE]${NC} models.json restored to repo default."
fi

echo ""
