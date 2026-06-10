#!/bin/bash
# ============================================================
# The Blackout Drive — Flash Drive Script
# ============================================================
# Copies the assembled drive/ contents to a physical USB drive.
# Run this AFTER setup_drive.sh passes all integrity checks.
#
# Usage:
#   bash scripts/flash_drive.sh /Volumes/BLACKOUT
#   bash scripts/flash_drive.sh /Volumes/BLACKOUT --quick   # Code-only (skips models/runtimes)
#
# Requirements:
#   - A USB drive formatted as ExFAT (REQUIRED — FAT32 has a 4GB
#     file limit which breaks model files). The script will auto-
#     detect FAT32 and offer to reformat for you.
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
QUICK_MODE=false
AUTO_YES=false

for arg in "$@"; do
    case "$arg" in
        --quick)   QUICK_MODE=true; AUTO_YES=true ;;
        --yes|-y)  AUTO_YES=true ;;
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

# ── Filesystem check: FAT32 cannot hold files >4GB ───────────
# The Ollama model GGUF file is >4GB. FAT32 will silently fail
# during rsync with "File too large". ExFAT is required.
TARGET_FS=$(diskutil info "$TARGET" 2>/dev/null | grep 'File System Personality' | sed 's/.*: *//')
TARGET_DISK_ID=$(diskutil info "$TARGET" 2>/dev/null | grep 'Part of Whole' | sed 's/.*: *//')
TARGET_VOLUME_NAME=$(basename "$TARGET")

if echo "$TARGET_FS" | grep -qi 'fat32\|MS-DOS'; then
    echo -e "  ${RED}[ERROR]${NC} Drive is formatted as FAT32."
    echo -e "         FAT32 has a 4GB file size limit which will break model files."
    echo -e "         The drive must be reformatted as ${BOLD}ExFAT${NC} (works on Windows, Mac, and Linux)."
    echo ""
    if [ -n "$TARGET_DISK_ID" ]; then
        echo -e "  ${YELLOW}⚠ WARNING:${NC} Reformatting will ${BOLD}ERASE ALL DATA${NC} on the drive."
        read -p "  Reformat /dev/$TARGET_DISK_ID as ExFAT named BLACKOUT? (y/N): " REFORMAT_CONFIRM
        if [[ "$REFORMAT_CONFIRM" =~ ^[Yy]$ ]]; then
            echo -e "  ${CYAN}[FORMAT]${NC} Reformatting as ExFAT..."
            diskutil eraseDisk ExFAT BLACKOUT MBRFormat "/dev/$TARGET_DISK_ID"
            # Update TARGET to the new mount point
            TARGET="/Volumes/BLACKOUT"
            echo -e "  ${GREEN}[OK]${NC}   Drive reformatted as ExFAT: $TARGET"
            echo ""
        else
            echo "  Cancelled. Reformat manually:"
            echo "    diskutil eraseDisk ExFAT BLACKOUT MBRFormat /dev/$TARGET_DISK_ID"
            exit 1
        fi
    else
        echo "  Reformat manually:"
        echo "    diskutil eraseDisk ExFAT BLACKOUT MBRFormat /dev/diskN"
        echo "  (Replace diskN with your USB drive identifier from 'diskutil list')"
        exit 1
    fi
# Check if volume is named BLACKOUT — not strictly required, but standard
elif [ "$TARGET_VOLUME_NAME" != "BLACKOUT" ]; then
    echo -e "  ${YELLOW}[NOTE]${NC}  Volume is named '$TARGET_VOLUME_NAME' (convention is 'BLACKOUT')."
    echo -e "         This is cosmetic — the flash will work either way."
    read -p "  Rename volume to BLACKOUT? (y/N): " RENAME_CONFIRM
    if [[ "$RENAME_CONFIRM" =~ ^[Yy]$ ]]; then
        diskutil rename "$TARGET" BLACKOUT 2>/dev/null && {
            TARGET="/Volumes/BLACKOUT"
            echo -e "  ${GREEN}[OK]${NC}   Renamed to BLACKOUT: $TARGET"
        } || echo -e "  ${YELLOW}[WARN]${NC} Rename failed — continuing with current name."
    fi
else
    echo -e "  ${GREEN}[OK]${NC}   Filesystem: ExFAT ✓"
fi

# Clean Ollama runtime cache — these are blobs created by `ollama create`
# at boot time and are NOT the source GGUF model files. They get regenerated
# automatically on next launch. Cleaning them reclaims ~2-5GB.
# Skip in quick mode — quick doesn't re-copy the cache, so deleting it
# would force a slow cold model rebuild on next boot.
OLLAMA_CACHE="$TARGET/_system/data/ollama_models"
if [ "$QUICK_MODE" != true ] && [ -d "$OLLAMA_CACHE" ]; then
    CACHE_SIZE=$(du -sh "$OLLAMA_CACHE" 2>/dev/null | cut -f1)
    echo -e "  ${CYAN}[CLEAN]${NC} Removing Ollama runtime cache ($CACHE_SIZE)..."
    rm -rf "$OLLAMA_CACHE"
elif [ "$QUICK_MODE" = true ] && [ -d "$OLLAMA_CACHE" ]; then
    echo -e "  ${YELLOW}[QUICK]${NC}  Preserving Ollama model cache."
fi

# V-07: Purge encrypted COMMS logs on flash.
# These contain AES-256-GCM encrypted tactical message history. A factory
# flash should guarantee a clean slate — no stale mission data should persist
# if the drive changes hands or the operator performs a system reset.
# Current path: USER_DATA/comms_log.bkv  (legacy: _system/data/comms_log.enc)
if [ "$QUICK_MODE" != true ]; then
    for COMMS_F in "$TARGET/USER_DATA/comms_log.bkv" \
                   "$TARGET/_system/data/comms_log.enc" \
                   "$TARGET/_system/data/comms_log.enc.tmp"; do
        if [ -f "$COMMS_F" ]; then
            echo -e "  ${CYAN}[CLEAN]${NC} Purging encrypted COMMS log: $(basename "$COMMS_F")"
            rm -f "$COMMS_F"
        fi
    done
fi

# V-08: Purge developer-machine tier detection.
# active_tier.json records which model tier was auto-detected from RAM.
# This MUST be regenerated on each boot by model_setup.py on the TARGET
# machine. If a stale copy from the developer's Mac (48GB RAM → "max")
# persists, the wrong model may load on a low-RAM target.
ACTIVE_TIER="$TARGET/_system/data/active_tier.json"
if [ -f "$ACTIVE_TIER" ]; then
    echo -e "  ${CYAN}[CLEAN]${NC} Removing stale active_tier.json (regenerated at boot)..."
    rm -f "$ACTIVE_TIER"
fi

# Also purge debug logs from previous sessions
LOGS_DIR="$TARGET/_system/data/logs"
if [ -d "$LOGS_DIR" ] && [ "$QUICK_MODE" != true ]; then
    echo -e "  ${CYAN}[CLEAN]${NC} Purging previous debug logs..."
    rm -rf "$LOGS_DIR"
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
if [ "$AUTO_YES" != true ]; then
    read -p "  Proceed? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "  Cancelled."
        exit 0
    fi
else
    echo -e "  ${GREEN}[AUTO]${NC} --yes flag set, proceeding."
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


# Quick mode: skip large binary assets (models, runtimes, vendor, books, GGUF)
# This copies only code, config, and UI files — takes seconds, not minutes.
QUICK_EXCLUDES=""
if [ "$QUICK_MODE" = true ]; then
    echo -e "  ${YELLOW}[QUICK]${NC}  Skipping models, runtimes, vendor, books, and GGUF files."
    echo -e "  ${YELLOW}[QUICK]${NC}  Only code/config/UI changes will be synced."
    echo ""
    QUICK_EXCLUDES="--exclude=_system/models/ --exclude=_system/runtime/ --exclude=_system/vendor/ --exclude=_system/content/books/ --exclude=_system/content/text_index.json --exclude=_system/data/ollama_models/ --exclude=_system/data/ollama_home/ --exclude=_system/_factory/ --exclude=_system/_backups/ --exclude=*.gguf"
fi

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
    --exclude='_system/data/active_tier.json' \
    --exclude='_system/data/logs/' \
    $QUICK_EXCLUDES \
    "$DRIVE_DIR/" "$TARGET/"

# ── Ensure USER_DATA structure exists on target ──────────────
echo -e "  ${CYAN}[POST]${NC}  Ensuring USER_DATA/ structure..."
mkdir -p "$TARGET/USER_DATA/conversations" \
         "$TARGET/USER_DATA/unlocked" \
         "$TARGET/USER_DATA/locked" \
         "$TARGET/USER_DATA/content" \
         "$TARGET/_system/data/logs"


# ── Clean stale books from previous flashes ──────────────────
# The main rsync above does NOT use --delete (to preserve user data like
# conversations and logs). But content/books/ should exactly mirror the source.
# Without this, old books removed from the source persist on the USB and
# show up as "Other Content" in the Manage Space panel.
echo -e "  ${CYAN}[POST]${NC}  Cleaning stale content files..."
if [ "$QUICK_MODE" != true ]; then
    rsync -avh --delete --progress \
        "$DRIVE_DIR/_system/content/books/" "$TARGET/_system/content/books/"
else
    echo -e "  ${YELLOW}[QUICK]${NC}  Skipping book sync."
fi

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
    "_system/config.json" \
    "_system/config.sh" \
    "_system/config.bat" \
    "_system/server.py" \
    "_system/ui/index.html" \
    "_system/ui/app.js" \
    "_system/ui/comms.js" \
    "_system/ui/style.css" \
    "_system/ui/config.js" \
    "_system/LEGAL/DISCLAIMER.txt" \
    "Install Radio Driver (Windows).bat" \
    "_system/drivers/cp210x/silabser.inf"; do
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
