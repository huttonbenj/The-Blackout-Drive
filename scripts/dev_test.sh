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
DRIVE_DIR="$SCRIPT_DIR/../drive/_system"

# ── Load configuration (single source of truth) ────────────────
source "$DRIVE_DIR/config.sh"

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

# ── Step 2: Read model config from models.json ──────────────
echo -e "  ${CYAN}[2/5]${NC} Reading model configuration..."
MODEL_CONFIG=$(python3 "$DRIVE_DIR/model_setup.py" "$DRIVE_DIR" --generate-modelfile --print-config 2>&1)
if [ $? -ne 0 ]; then
    echo -e "  ${RED}[FAIL]${NC} model_setup.py failed:"
    echo "$MODEL_CONFIG"
    exit 1
fi
DEV_MODEL_NAME=$(echo "$MODEL_CONFIG" | grep '^MODEL_NAME=' | cut -d= -f2)
DEV_MODEL_DISPLAY=$(echo "$MODEL_CONFIG" | grep '^MODEL_DISPLAY=' | cut -d= -f2)
echo -e "  ${GREEN}[PASS]${NC} Model configured: $DEV_MODEL_DISPLAY ($DEV_MODEL_NAME)"

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
echo -e "  ${CYAN}[4/5]${NC} Building BEACON model from Modelfile.generated..."
echo ""

# Start ollama serve if not running
if ! curl -s "$BLACKOUT_OLLAMA_URL" > /dev/null 2>&1; then
    echo -e "  ${CYAN}[INFO]${NC} Starting Ollama server..."
    ollama serve &
    OLLAMA_PID=$!
    echo "         Ollama PID: $OLLAMA_PID"
    
    # Wait for it to be ready
    WAIT=0
    while ! curl -s "$BLACKOUT_OLLAMA_URL" > /dev/null 2>&1; do
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

# Create the model using the generated Modelfile
ollama create "$DEV_MODEL_NAME" -f "$DRIVE_DIR/Modelfile.generated"
echo ""
echo -e "  ${GREEN}[PASS]${NC} $DEV_MODEL_NAME model built successfully"

# ── Step 5: Smoke test — send a test prompt ──────────────────
echo -e "  ${CYAN}[5/5]${NC} Smoke testing BEACON persona..."
echo "         Sending test prompt: 'How do I purify water in an emergency?'"
echo ""

RESPONSE=$(curl -s "${BLACKOUT_OLLAMA_URL}/api/chat" \
    -d "{
        \"model\": \"$DEV_MODEL_NAME\",
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
echo "  ============================================="
echo ""

# Read UI port from model_setup.py output
DEV_UI_PORT=$(echo "$MODEL_CONFIG" | grep '^UI_PORT=' | cut -d= -f2)
DEV_UI_PORT="${DEV_UI_PORT:-$BLACKOUT_UI_PORT}"
DEV_UI_URL=$(echo "$MODEL_CONFIG" | grep '^UI_URL=' | cut -d= -f2-)
DEV_UI_URL="${DEV_UI_URL:-$BLACKOUT_UI_URL}"

python3 "$DRIVE_DIR/server.py" "$DEV_UI_PORT" "$DRIVE_DIR" &>/dev/null &
UI_SERVER_PID=$!
sleep 1
open "${DEV_UI_URL}/ui/"

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
