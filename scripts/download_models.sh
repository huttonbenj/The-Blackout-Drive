#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Download AI Models Script
# ============================================================
# Downloads BOTH tier models (BASE + MAX) and places them in
# drive/_system/models/ ready to be read by the Ollama launcher.
#
# Model configuration is read from models.json (single source
# of truth for all model settings).
#
# Run this once during drive assembly after download_runtime.sh.
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive/_system"
MODELS_DIR="$DRIVE_DIR/models"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  THE BLACKOUT DRIVE — Download AI Models${NC}"
echo "  ============================================="
echo ""

mkdir -p "$MODELS_DIR"

# ── Read all models from models.json ──────────────────────────
# Parse the JSON to get every model key, file, display name, base
ALL_MODELS=$(python3 -c "
import json, os
mj = os.path.join('$DRIVE_DIR', 'models.json')
with open(mj) as f: m = json.load(f)
for key, model in m.get('models', {}).items():
    print(f\"{key}|{model['file']}|{model.get('name', key)}|{model.get('base', '')}|{model.get('tier', 'base')}\")
" 2>/dev/null)

if [ -z "$ALL_MODELS" ]; then
    echo -e "  ${RED}[ERROR]${NC} Could not read model config from models.json"
    exit 1
fi

# Count models
TOTAL=$(echo "$ALL_MODELS" | wc -l | tr -d ' ')
echo -e "  ${CYAN}[INFO]${NC} Found $TOTAL models to download"
echo ""

DOWNLOADED=0
SKIPPED=0

while IFS='|' read -r KEY FILE DISPLAY BASE TIER; do
    DEST_FILE="$MODELS_DIR/$FILE"
    echo -e "  ─── ${TIER^^} tier: $DISPLAY ($BASE) ───"
    echo -e "  ${CYAN}[INFO]${NC} File: $FILE"

    # Check if already downloaded
    if [ -f "$DEST_FILE" ]; then
        SIZE=$(du -sh "$DEST_FILE" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} Already exists: $SIZE"
        echo ""
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # Pull via Ollama
    echo -e "  ${CYAN}[PULL]${NC} Downloading $BASE via Ollama..."
    echo ""

    if ! command -v ollama &> /dev/null; then
        echo -e "  ${RED}[ERROR]${NC} Ollama not found. Install from https://ollama.com"
        exit 1
    fi

    ollama pull "$BASE"
    echo ""
    echo -e "  ${GREEN}[OK]${NC} Pull complete."

    # Locate the cached GGUF in Ollama's model store
    echo -e "  ${CYAN}[COPY]${NC} Locating GGUF blob..."
    BLOB_DIR="$HOME/.ollama/models/blobs"
    # Find the largest blob file recently modified (the main GGUF)
    GGUF_BLOB=$(find "$BLOB_DIR" -type f -name "sha256-*" -size +1G -newer "$MODELS_DIR" 2>/dev/null | \
                xargs ls -t 2>/dev/null | head -1)

    # Fallback: just find the largest blob
    if [ -z "$GGUF_BLOB" ]; then
        GGUF_BLOB=$(find "$BLOB_DIR" -type f -name "sha256-*" -size +1G 2>/dev/null | \
                    xargs ls -S 2>/dev/null | head -1)
    fi

    if [ -z "$GGUF_BLOB" ]; then
        echo -e "  ${RED}[ERROR]${NC} Could not locate GGUF blob in $BLOB_DIR"
        echo "  Manual fallback: download from HuggingFace."
        echo "  Rename to: $FILE"
        echo "  Place in: $MODELS_DIR/"
        echo ""
        continue
    fi

    echo -e "  ${CYAN}[COPY]${NC} Copying to drive (large file — may take 30+ seconds)..."
    cp "$GGUF_BLOB" "$DEST_FILE"

    if [ -f "$DEST_FILE" ]; then
        SIZE=$(du -sh "$DEST_FILE" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} Saved: $DEST_FILE ($SIZE)"
        DOWNLOADED=$((DOWNLOADED + 1))
    else
        echo -e "  ${RED}[FAIL]${NC} Copy failed for $FILE"
    fi
    echo ""

done <<< "$ALL_MODELS"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "  ============================================="
echo -e "  ${GREEN}MODELS READY${NC}"
echo ""
echo "  Downloaded: $DOWNLOADED"
echo "  Already present: $SKIPPED"
echo ""

# List all models in directory
echo "  Files in models/:"
for f in "$MODELS_DIR"/*.gguf; do
    if [ -f "$f" ]; then
        SIZE=$(du -sh "$f" | cut -f1)
        echo "    $(basename $f) ($SIZE)"
    fi
done

echo ""
echo "  ============================================="
echo ""
echo -e "  ${CYAN}[NEXT]${NC} Run: scripts/download_content.sh"
echo ""
