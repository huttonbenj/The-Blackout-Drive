#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Download AI Model Script
# ============================================================
# Downloads the Phi-3 Mini GGUF model and places it in
# drive/models/ ready to be read by the Ollama launcher.
#
# Run this once during drive assembly after download_runtime.sh
# Output: drive/models/phi3-mini.Q4_K_M.gguf  (~2.3 GB)
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive"
MODELS_DIR="$DRIVE_DIR/models"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  THE BLACKOUT DRIVE — Download AI Model${NC}"
echo "  ============================================="
echo ""
echo -e "  ${CYAN}[INFO]${NC} Model: $BLACKOUT_BASE_MODEL"
echo -e "  ${CYAN}[INFO]${NC} Output file: $BLACKOUT_MODEL_FILE"
echo -e "  ${CYAN}[INFO]${NC} Destination: $MODELS_DIR"
echo ""

mkdir -p "$MODELS_DIR"

DEST_FILE="$MODELS_DIR/$BLACKOUT_MODEL_FILE"

# ── Check if already downloaded ──────────────────────────────
if [ -f "$DEST_FILE" ]; then
    SIZE=$(du -sh "$DEST_FILE" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC} Model already exists: $DEST_FILE ($SIZE)"
    echo "  Delete it and re-run this script to re-download."
    echo ""
    exit 0
fi

# ── Strategy: pull via Ollama, then export the GGUF ──────────
# Ollama is the most reliable source — it handles mirrors,
# authentication, and SHA256 verification automatically.
echo -e "  ${CYAN}[1/3]${NC} Pulling $BLACKOUT_BASE_MODEL via Ollama (downloads ~2.3GB)..."
echo "         This will take a few minutes on a typical connection."
echo ""

if ! command -v ollama &> /dev/null; then
    echo -e "  ${RED}[ERROR]${NC} Ollama not found. Install from https://ollama.com"
    exit 1
fi

ollama pull "$BLACKOUT_BASE_MODEL"
echo ""
echo -e "  ${GREEN}[OK]${NC} Pull complete."

# ── Locate the cached GGUF in Ollama's model store ───────────
echo -e "  ${CYAN}[2/3]${NC} Locating downloaded GGUF file..."

# Ollama stores models in ~/.ollama/models/blobs/
BLOB_DIR="$HOME/.ollama/models/blobs"
# Find the largest blob file (the main GGUF — should be ~2.3GB)
GGUF_BLOB=$(find "$BLOB_DIR" -type f -name "sha256-*" -size +1G | sort -k1 -rh | head -1 2>/dev/null)

if [ -z "$GGUF_BLOB" ]; then
    echo -e "  ${RED}[ERROR]${NC} Could not locate GGUF blob in $BLOB_DIR"
    echo ""
    echo "  Manual fallback: download directly from HuggingFace:"
    echo "  https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf"
    echo "  Rename file to: $BLACKOUT_MODEL_FILE"
    echo "  Place in: $MODELS_DIR/"
    echo ""
    exit 1
fi

echo -e "  ${GREEN}[OK]${NC} Found blob: $(basename $GGUF_BLOB)"

# ── Copy GGUF to drive models directory ──────────────────────
echo -e "  ${CYAN}[3/3]${NC} Copying to drive (large file — may take 30+ seconds)..."
cp "$GGUF_BLOB" "$DEST_FILE"

# Verify
if [ -f "$DEST_FILE" ]; then
    SIZE=$(du -sh "$DEST_FILE" | cut -f1)
    echo -e "  ${GREEN}[OK]${NC} Model ready: $DEST_FILE ($SIZE)"
else
    echo -e "  ${RED}[FAIL]${NC} Copy failed"
    exit 1
fi

# ── Also create the BEACON Modelfile persona model ────────────
echo ""
echo -e "  ${CYAN}[BONUS]${NC} Building BEACON persona model..."
if ollama list 2>/dev/null | grep -q "$BLACKOUT_MODEL_NAME"; then
    echo -e "  ${GREEN}[OK]${NC} $BLACKOUT_MODEL_NAME model already exists."
else
    ollama create "$BLACKOUT_MODEL_NAME" -f "$DRIVE_DIR/$BLACKOUT_MODELFILE"
    echo -e "  ${GREEN}[OK]${NC} $BLACKOUT_MODEL_NAME model created."
fi

echo ""
echo "  ============================================="
echo -e "  ${GREEN}MODEL READY${NC}"
echo ""
echo "  File: $DEST_FILE"
SIZE=$(du -sh "$DEST_FILE" | cut -f1)
echo "  Size: $SIZE"
echo "  ============================================="
echo ""
echo -e "  ${CYAN}[NEXT]${NC} Run: scripts/download_content.sh"
echo ""
