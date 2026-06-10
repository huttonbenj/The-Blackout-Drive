#!/bin/bash
# rebuild_model.sh - Full nuclear rebuild of the blackout-beacon model
# Run this after changing profiles/*.txt, device_facts.txt, or model parameters.
#
# This script performs the COMPLETE rebuild cycle:
#   1. Starts Ollama if not running
#   2. Unloads the model from GPU memory (keep_alive: 0)
#   3. Deletes the old model manifest
#   4. Regenerates Modelfile.generated from current profile files
#   5. Creates the model fresh
#   6. Verifies the system prompt is clean
#
# Usage:
#   bash scripts/rebuild_model.sh

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive/_system"

# ── Resolve model name ────────────────────────────────────────
MODEL_NAME=$(python3 "$DRIVE_DIR/model_setup.py" "$DRIVE_DIR" --auto-detect --print-config 2>/dev/null | grep '^MODEL_NAME=' | cut -d= -f2)
MODEL_NAME="${MODEL_NAME:-blackout-beacon}"

echo ""
echo -e "  ${CYAN}[REBUILD]${NC} Full model rebuild: ${YELLOW}$MODEL_NAME${NC}"
echo ""

# ── Check for Ollama ──────────────────────────────────────────
OLLAMA=$(command -v ollama 2>/dev/null || echo "")
if [ -z "$OLLAMA" ]; then
    echo -e "  ${RED}[ERROR]${NC} Ollama not found. Install from https://ollama.com"
    exit 1
fi

# ── Step 1: Ensure Ollama is running ──────────────────────────
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "  ${CYAN}[1/6]${NC} Starting Ollama..."
    "$OLLAMA" serve &>/dev/null &
    sleep 3
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo -e "  ${RED}[ERROR]${NC} Failed to start Ollama"
        exit 1
    fi
else
    echo -e "  ${CYAN}[1/6]${NC} Ollama is running"
fi

# ── Step 2: Unload model from GPU memory ──────────────────────
echo -e "  ${CYAN}[2/6]${NC} Unloading $MODEL_NAME from GPU memory..."
curl -s http://localhost:11434/api/generate -d "{\"model\":\"$MODEL_NAME\",\"keep_alive\":0}" > /dev/null 2>&1 || true
sleep 2

# ── Step 3: Delete old model ──────────────────────────────────
echo -e "  ${CYAN}[3/6]${NC} Deleting old model manifest..."
"$OLLAMA" rm "$MODEL_NAME" 2>/dev/null || echo "         (no existing model to delete)"

# ── Step 4: Regenerate Modelfile ──────────────────────────────
echo -e "  ${CYAN}[4/6]${NC} Regenerating Modelfile.generated..."
python3 "$DRIVE_DIR/model_setup.py" "$DRIVE_DIR" --generate-modelfile --auto-detect > /dev/null

# ── Step 5: Create fresh model ────────────────────────────────
echo -e "  ${CYAN}[5/6]${NC} Building $MODEL_NAME from Modelfile.generated..."
"$OLLAMA" create "$MODEL_NAME" -f "$DRIVE_DIR/Modelfile.generated"

# ── Step 6: Verify ────────────────────────────────────────────
echo -e "  ${CYAN}[6/6]${NC} Verifying system prompt..."
STALE_COUNT=$("$OLLAMA" show "$MODEL_NAME" --system 2>&1 | grep -ci "initialized and standing by" || true)
if [ "$STALE_COUNT" -gt 0 ]; then
    echo -e "  ${RED}[FAIL]${NC} Stale phrases detected in system prompt!"
    exit 1
else
    echo -e "  ${GREEN}[PASS]${NC} System prompt is clean"
fi

echo ""
echo -e "  ${GREEN}✅ REBUILD COMPLETE${NC} — $MODEL_NAME is ready"
echo -e "  ${YELLOW}NOTE:${NC} Restart server.py and hard-refresh the browser to test."
echo ""
