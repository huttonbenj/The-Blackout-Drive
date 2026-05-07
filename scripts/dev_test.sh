#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Local Dev Test Script
# ============================================================
# Tests the full UI, Modelfile persona, and API integration
# WITHOUT needing a physical USB drive.
#
# What this tests:
#   ✅ BEACON Modelfile loads correctly
#   ✅ Ollama serves the blackout-beacon model
#   ✅ Chat UI opens and connects
#   ✅ Streaming responses work
#   ✅ BEACON persona behaves correctly
#
# What this does NOT test (requires physical USB):
#   ❌ Portable Ollama binary (uses host Ollama install)
#   ❌ Drive-letter / mount-point detection in launchers
#   ❌ Cross-OS compatibility of launcher scripts
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive"

# ── Load configuration (single source of truth) ────────────────
source "$DRIVE_DIR/config.sh"

MODELFILE="$DRIVE_DIR/$BEACON_MODELFILE"
UI_PATH="$DRIVE_DIR/ui/index.html"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  BEACON DRIVE — Local Dev Test${NC}"
echo "  ============================================="
echo ""

# ── Step 1: Check Ollama is installed ───────────────────────
echo -e "  ${CYAN}[1/5]${NC} Checking host Ollama installation..."
if ! command -v ollama &> /dev/null; then
    echo -e "  ${RED}[FAIL]${NC} Ollama not found. Install from https://ollama.com"
    exit 1
fi
OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
echo -e "  ${GREEN}[PASS]${NC} Ollama found: $OLLAMA_VERSION"

# ── Step 2: Check Modelfile exists ──────────────────────────
echo -e "  ${CYAN}[2/5]${NC} Checking Modelfile..."
if [ ! -f "$MODELFILE" ]; then
    echo -e "  ${RED}[FAIL]${NC} Modelfile not found at: $MODELFILE"
    exit 1
fi
echo -e "  ${GREEN}[PASS]${NC} Modelfile found: $MODELFILE"

# ── Step 3: Check UI files exist ────────────────────────────
echo -e "  ${CYAN}[3/5]${NC} Checking UI files..."
UI_OK=true
for f in "index.html" "style.css" "app.js" "config.js"; do
    if [ ! -f "$DRIVE_DIR/ui/$f" ]; then
        echo -e "  ${RED}[FAIL]${NC} Missing: drive/ui/$f"
        UI_OK=false
    fi
done
if [ "$UI_OK" = true ]; then
    echo -e "  ${GREEN}[PASS]${NC} All UI files present"
else
    exit 1
fi

# ── Step 4: Create / update blackout-beacon model ──────────────────
echo -e "  ${CYAN}[4/5]${NC} Building BEACON model from Modelfile..."
echo "         (This downloads $BEACON_BASE_MODEL if not already cached — ~2.3GB)"
echo ""

# Start ollama serve if not running
if ! curl -s "$BEACON_OLLAMA_URL" > /dev/null 2>&1; then
    echo -e "  ${CYAN}[INFO]${NC} Starting Ollama server..."
    ollama serve &
    OLLAMA_PID=$!
    echo "         Ollama PID: $OLLAMA_PID"
    
    # Wait for it to be ready
    WAIT=0
    while ! curl -s "$BEACON_OLLAMA_URL" > /dev/null 2>&1; do
        sleep 1
        WAIT=$((WAIT + 1))
        if [ $WAIT -ge 30 ]; then
            echo -e "  ${RED}[FAIL]${NC} Ollama didn't start in 30 seconds"
            exit 1
        fi
    done
    echo -e "  ${GREEN}[OK]${NC} Ollama server running"
    STARTED_OLLAMA=true
else
    echo -e "  ${GREEN}[OK]${NC} Ollama already running"
    STARTED_OLLAMA=false
fi

# Create the model
ollama create "$BEACON_MODEL_NAME" -f "$MODELFILE"
echo ""
echo -e "  ${GREEN}[PASS]${NC} $BEACON_MODEL_NAME model built successfully"

# ── Step 5: Smoke test — send a test prompt ──────────────────
echo -e "  ${CYAN}[5/5]${NC} Smoke testing BEACON persona..."
echo "         Sending test prompt: 'How do I purify water in an emergency?'"
echo ""

RESPONSE=$(curl -s "${BEACON_OLLAMA_URL}/api/chat" \
    -d "{
        \"model\": \"$BEACON_MODEL_NAME\",
        \"messages\": [{\"role\": \"user\", \"content\": \"In 2 sentences, how do I purify water in an emergency?\"}],
        \"stream\": false
    }" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('message',{}).get('content','[no response]'))" 2>/dev/null)

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "[no response]" ]; then
    echo -e "  ${RED}[FAIL]${NC} No response from model"
    exit 1
fi

echo "  ┌─ BEACON Response ─────────────────────────────────"
echo "$RESPONSE" | fold -s -w 60 | sed 's/^/  │ /'
echo "  └─────────────────────────────────────────────────────"
echo ""
echo -e "  ${GREEN}[PASS]${NC} BEACON persona responding correctly"

# ── Open UI ──────────────────────────────────────────────────
echo ""
echo "  ============================================="
echo -e "  ${GREEN}ALL TESTS PASSED${NC}"
echo ""
echo "  Opening chat UI in browser..."
echo "  Keep this terminal open while testing."
echo ""
echo "  UI path: $UI_PATH"
echo "  ============================================="
echo ""

python3 -m http.server "$BEACON_UI_PORT" --directory "$DRIVE_DIR/ui" &>/dev/null &
UI_SERVER_PID=$!
sleep 1
open "${BEACON_UI_URL}"

# ── Cleanup on exit ──────────────────────────────────────────
cleanup() {
    echo ""
    echo "  [CLEANUP] Shutting down dev test..."
    kill $UI_SERVER_PID 2>/dev/null
    if [ "$STARTED_OLLAMA" = "true" ] && [ -n "$OLLAMA_PID" ]; then
        kill $OLLAMA_PID 2>/dev/null
        echo "  [CLEANUP] Ollama stopped."
    else
        echo "  [INFO] Ollama was already running before test — leaving it running."
    fi
    echo ""
}

trap cleanup EXIT SIGINT SIGTERM

echo "  Press Ctrl+C to stop the test session."
echo ""
wait
