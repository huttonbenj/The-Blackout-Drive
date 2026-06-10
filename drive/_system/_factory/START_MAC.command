#!/bin/bash

# ============================================================
# The Blackout Drive — macOS Launcher
# ============================================================
# This script launches The Blackout Drive offline AI system.
# It runs entirely from the USB drive — nothing is installed
# on your computer. All data stays on the drive.
#
# Requirements: macOS 11+, 8GB+ RAM, USB 3.0+ port
# ============================================================
# 
# FIRST RUN NOTE: macOS may show a security warning.
# If blocked: System Settings → Privacy & Security → "Allow Anyway"
# ============================================================

# ── Resolve script location (works regardless of mount point) ──
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# ── UPDATE BOOTSTRAPPER ──────────────────────────────────────
# Check for a staged update BEFORE anything else runs.
# The app downloads updates to _update_staging/ via /api/update/download.
# This block applies them on the next boot, when no files are locked.
# ──────────────────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/_update_staging/update_manifest.json" ]; then
    echo ""
    echo "  ═══════════════════════════════════════════════════════"
    echo "  APPLYING SOFTWARE UPDATE..."
    echo "  ═══════════════════════════════════════════════════════"
    echo ""

    UPDATE_VERSION=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/_update_staging/update_manifest.json'))['version'])" 2>/dev/null || echo "unknown")
    echo "  Updating to v${UPDATE_VERSION}..."

    # Back up current critical files (for rollback)
    mkdir -p "$SCRIPT_DIR/_update_backup"
    [ -f "$SCRIPT_DIR/server.py" ] && cp "$SCRIPT_DIR/server.py" "$SCRIPT_DIR/_update_backup/server.py"
    [ -f "$SCRIPT_DIR/../USER_DATA/config.json" ] && cp "$SCRIPT_DIR/../USER_DATA/config.json" "$SCRIPT_DIR/_update_backup/config.json"

    # Apply staged files over live files
    # NOTE: config.json is NOT in the update package (protects user settings).
    # The version number is merged below via JSON patch.
    cp -R "$SCRIPT_DIR/_update_staging/_system/"* "$SCRIPT_DIR/" 2>/dev/null

    # Merge version number into existing config.json (preserves all user settings)
    if [ "$UPDATE_VERSION" != "unknown" ] && [ -f "$SCRIPT_DIR/../USER_DATA/config.json" ]; then
        python3 -c "
import json
p = '$SCRIPT_DIR/../USER_DATA/config.json'
c = json.load(open(p))
c.setdefault('app', {})['version'] = '$UPDATE_VERSION'
json.dump(c, open(p, 'w'), indent=2)
" 2>/dev/null && echo "  Version updated to $UPDATE_VERSION in config.json"
    fi

    # Copy launcher files if they were included in the update
    [ -f "$SCRIPT_DIR/_update_staging/launchers/START_MAC.command" ] && \
        cp "$SCRIPT_DIR/_update_staging/launchers/START_MAC.command" "$SCRIPT_DIR/START_MAC.command"
    [ -f "$SCRIPT_DIR/_update_staging/launchers/START_LINUX.sh" ] && \
        cp "$SCRIPT_DIR/_update_staging/launchers/START_LINUX.sh" "$SCRIPT_DIR/START_LINUX.sh"
    [ -f "$SCRIPT_DIR/_update_staging/launchers/START_WINDOWS.bat" ] && \
        cp "$SCRIPT_DIR/_update_staging/launchers/START_WINDOWS.bat" "$SCRIPT_DIR/START_WINDOWS.bat"

    # Clean up staging directory
    rm -rf "$SCRIPT_DIR/_update_staging"

    echo "  ✓ Update applied successfully."
    echo ""
fi

# ── Load configuration (single source of truth) ────────────────
source "$SCRIPT_DIR/config.sh"

# ── Terminal colors ──────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ── Spinner helper (braille dots) ────────────────────────────
SPIN_CHARS='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
spin_idx=0
spin() {
  printf "\r  ${CYAN}${SPIN_CHARS:$spin_idx:1}${NC} %s ${DIM}(%ds)${NC}" "$1" "$2"
  spin_idx=$(( (spin_idx + 1) % ${#SPIN_CHARS} ))
}

# ── Phase header helper ──────────────────────────────────────
phase() {
  echo ""
  echo -e "  ${YELLOW}── $1 ──────────────────────────────────────${NC}"
}

clear
echo -n -e "\033]0;The Blackout Drive\007"

echo ""
echo -e "${YELLOW}  ████████╗██╗  ██╗███████╗${NC}"
echo -e "${YELLOW}  ╚══██╔══╝██║  ██║██╔════╝${NC}"
echo -e "${YELLOW}     ██║   ███████║█████╗  ${NC}"
echo -e "${YELLOW}     ██║   ██╔══██║██╔══╝  ${NC}"
echo -e "${YELLOW}     ██║   ██║  ██║███████╗${NC}"
echo -e "${YELLOW}     ╚═╝   ╚═╝  ╚═╝╚══════╝${NC}"
echo -e "${YELLOW}  ██████╗ ██╗      █████╗  ██████╗██╗  ██╗ ██████╗ ██╗   ██╗████████╗${NC}"
echo -e "${YELLOW}  ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝██╔═══██╗██║   ██║╚══██╔══╝${NC}"
echo -e "${YELLOW}  ██████╔╝██║     ███████║██║     █████╔╝ ██║   ██║██║   ██║   ██║   ${NC}"
echo -e "${YELLOW}  ██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║   ██║██║   ██║   ██║   ${NC}"
echo -e "${YELLOW}  ██████╔╝███████╗██║  ██║╚██████╗██║  ██╗╚██████╔╝╚██████╔╝   ██║   ${NC}"
echo -e "${YELLOW}  ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ${NC}"
echo -e "${YELLOW}  ██████╗ ██████╗ ██╗██╗   ██╗███████╗${NC}"
echo -e "${YELLOW}  ██╔══██╗██╔══██╗██║██║   ██║██╔════╝${NC}"
echo -e "${YELLOW}  ██║  ██║██████╔╝██║██║   ██║█████╗  ${NC}"
echo -e "${YELLOW}  ██║  ██║██╔══██╗██║╚██╗ ██╔╝██╔══╝  ${NC}"
echo -e "${YELLOW}  ██████╔╝██║  ██║██║ ╚████╔╝ ███████╗${NC}"
echo -e "${YELLOW}  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝${NC}"
echo ""
echo -e "${WHITE}  The Blackout Drive — OFFLINE AI // ENCRYPTED VAULT // MESH COMMS${NC}"
echo "  -------------------------------------------------------"
echo "  No internet required. No data leaves this drive."
echo "  -------------------------------------------------------"

# ═══════════════════════════════════════════════════════════════
# Phase 1: Detect Hardware
# ═══════════════════════════════════════════════════════════════
phase "Phase 1/5: Detect Hardware"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    OLLAMA_BINARY="$SCRIPT_DIR/runtime/ollama-mac-arm/ollama"
    ARCH_LABEL="Apple Silicon (M1/M2/M3/M4/M5)"
else
    OLLAMA_BINARY="$SCRIPT_DIR/runtime/ollama-mac-intel/ollama"
    ARCH_LABEL="Intel Mac"
fi

if [ ! -f "$OLLAMA_BINARY" ]; then
    echo ""
    echo -e "  ${RED}✗ Runtime not found: $OLLAMA_BINARY${NC}"
    echo ""
    echo "  This drive may not be fully set up."
    echo "  If you are the developer, run: scripts/download_runtime.sh"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── Setup model from models.json ─────────────────────────────
mkdir -p "$SCRIPT_DIR/data/logs"
MODEL_CONFIG=$(python3 "$SCRIPT_DIR/model_setup.py" "$SCRIPT_DIR" --generate-modelfile --print-config --auto-detect 2>>"$SCRIPT_DIR/data/logs/server.log")
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ Model setup failed:${NC}"
    echo "$MODEL_CONFIG"
    read -p "  Press Enter to exit..."
    exit 1
fi

BLACKOUT_MODEL_FILE=$(echo "$MODEL_CONFIG" | grep '^MODEL_FILE=' | cut -d= -f2)
BLACKOUT_MODEL_NAME=$(echo "$MODEL_CONFIG" | grep '^MODEL_NAME=' | cut -d= -f2)
MODEL_DISPLAY=$(echo "$MODEL_CONFIG" | grep '^MODEL_DISPLAY=' | cut -d= -f2)
MODEL_TIER=$(echo "$MODEL_CONFIG" | grep '^MODEL_TIER=' | cut -d= -f2)
BLACKOUT_DEBUG=$(echo "$MODEL_CONFIG" | grep '^DEBUG=' | cut -d= -f2)
BLACKOUT_LOG_DIR=$(echo "$MODEL_CONFIG" | grep '^LOG_DIR=' | cut -d= -f2)
BLACKOUT_OLLAMA_PORT=$(echo "$MODEL_CONFIG" | grep '^OLLAMA_PORT=' | cut -d= -f2)
BLACKOUT_UI_PORT=$(echo "$MODEL_CONFIG" | grep '^UI_PORT=' | cut -d= -f2)
BLACKOUT_OLLAMA_HOST_ADDR=$(echo "$MODEL_CONFIG" | grep '^OLLAMA_HOST_ADDR=' | cut -d= -f2)
BLACKOUT_OLLAMA_URL=$(echo "$MODEL_CONFIG" | grep '^OLLAMA_URL=' | cut -d= -f2-)
BLACKOUT_UI_URL=$(echo "$MODEL_CONFIG" | grep '^UI_URL=' | cut -d= -f2-)
BLACKOUT_OLLAMA_ORIGINS=$(echo "$MODEL_CONFIG" | grep '^OLLAMA_ORIGINS=' | cut -d= -f2-)
BLACKOUT_AI_DISABLED=$(echo "$MODEL_CONFIG" | grep '^AI_DISABLED=' | cut -d= -f2)
BLACKOUT_AI_DISABLED_REASON=$(echo "$MODEL_CONFIG" | grep '^AI_DISABLED_REASON=' | cut -d= -f2)

# Get RAM for display
RAM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1073741824}')
TIER_UPPER=$(echo "$MODEL_TIER" | tr '[:lower:]' '[:upper:]')

echo -e "  ${GREEN}✓${NC} $ARCH_LABEL · ${RAM_GB}GB RAM · ${TIER_UPPER} tier"
echo -e "  ${GREEN}✓${NC} Model: $MODEL_DISPLAY"

# ── Setup debug logging if enabled ───────────────────────────
if [ "$BLACKOUT_DEBUG" = "1" ]; then
    mkdir -p "$BLACKOUT_LOG_DIR"
    LOG_FILE="$BLACKOUT_LOG_DIR/boot.log"
    echo "================================================================" >> "$LOG_FILE"
    echo "  Boot started: $(date)" >> "$LOG_FILE"
    echo "  Model: $MODEL_DISPLAY ($BLACKOUT_MODEL_FILE)" >> "$LOG_FILE"
    echo "  Script dir: $SCRIPT_DIR" >> "$LOG_FILE"
    echo "  Debug: ON" >> "$LOG_FILE"
    echo "================================================================" >> "$LOG_FILE"
    echo -e "  ${DIM}Debug log: $LOG_FILE${NC}"
fi

MODEL_FILE="$SCRIPT_DIR/models/$BLACKOUT_MODEL_FILE"
if [ ! -f "$MODEL_FILE" ]; then
    echo ""
    echo -e "  ${RED}✗ AI model not found: $MODEL_FILE${NC}"
    echo ""
    echo "  This drive may not be fully set up."
    echo "  If you are the developer, run: scripts/download_models.sh"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

chmod +x "$OLLAMA_BINARY"

# ═══════════════════════════════════════════════════════════════
# Phase 2: Start AI Engine
# ═══════════════════════════════════════════════════════════════
phase "Phase 2/5: Start AI Engine"

# Clean stale sentinel files from previous sessions
rm -f "$SCRIPT_DIR/data/.shutdown_sentinel" 2>/dev/null

# Check if already running
if curl -s "http://127.0.0.1:${BLACKOUT_UI_PORT:-8080}/api/heartbeat" > /dev/null 2>&1 && \
   curl -s "http://127.0.0.1:${BLACKOUT_OLLAMA_PORT:-11434}/" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Already running — opening browser"
    open "http://127.0.0.1:${BLACKOUT_UI_PORT:-8080}/ui/"
    exit 0
fi

# Clean up any existing instances
pkill -f "server.py" 2>/dev/null
pkill -f "ollama" 2>/dev/null
sleep 1
if pgrep -f "ollama" > /dev/null 2>&1; then
    pkill -9 -f "ollama" 2>/dev/null
fi

# Wait for port to be free
KILL_WAIT=0
while lsof -i :${BLACKOUT_OLLAMA_PORT:-11434} > /dev/null 2>&1; do
    KILL_WAIT=$((KILL_WAIT + 1))
    if [ $KILL_WAIT -ge 10 ]; then
        break
    fi
    spin "Releasing port ${BLACKOUT_OLLAMA_PORT:-11434}..." "$KILL_WAIT"
    sleep 1
done
if [ $KILL_WAIT -gt 0 ]; then echo ""; fi

# Set environment — point Ollama to drive
mkdir -p "$SCRIPT_DIR/data/ollama_models"
mkdir -p "$SCRIPT_DIR/data/ollama_home"
export OLLAMA_HOME="$SCRIPT_DIR/data/ollama_home"
export OLLAMA_MODELS="$SCRIPT_DIR/data/ollama_models"
export OLLAMA_HOST="$BLACKOUT_OLLAMA_HOST_ADDR"
export OLLAMA_ORIGINS="$BLACKOUT_OLLAMA_ORIGINS"
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_NOPRUNE=1
export OLLAMA_NO_CLOUD=1
export OLLAMA_NOHISTORY=1
export OLLAMA_LOAD_TIMEOUT=120s
if [ "$BLACKOUT_DEBUG" = "1" ]; then
    export OLLAMA_DEBUG=1
fi

# Launch Ollama
echo -e "  Starting Ollama server..."
if [ "$BLACKOUT_DEBUG" = "1" ]; then
    echo "  [BOOT] Starting Ollama: $OLLAMA_BINARY" >> "$LOG_FILE"
    "$OLLAMA_BINARY" serve >> "$BLACKOUT_LOG_DIR/ollama.log" 2>&1 &
else
    "$OLLAMA_BINARY" serve &>/dev/null &
fi
OLLAMA_PID=$!

# Wait for Ollama with spinner
WAIT_COUNT=0
MAX_WAIT=45
while ! curl -s "${BLACKOUT_OLLAMA_URL}" > /dev/null 2>&1; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    spin "Waiting for AI engine to respond..." "$WAIT_COUNT"
    if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
        echo ""
        echo ""
        echo -e "  ${RED}✗ AI engine failed to start after ${MAX_WAIT}s${NC}"
        echo "  Check that your Mac has at least 8GB of RAM."
        kill $OLLAMA_PID 2>/dev/null
        read -p "  Press Enter to exit..."
        exit 1
    fi
done
echo ""
echo -e "  ${GREEN}✓${NC} AI engine online"

# ═══════════════════════════════════════════════════════════════
# Phase 3: Start Interface (BEFORE model load — UI handles warming state)
# ═══════════════════════════════════════════════════════════════
phase "Phase 3/5: Start Interface"

if [ "$BLACKOUT_DEBUG" = "1" ]; then
    echo "  [BOOT] Starting server.py with debug logging" >> "$LOG_FILE"
    python3 "$SCRIPT_DIR/server.py" "$BLACKOUT_UI_PORT" "$SCRIPT_DIR" --debug "$BLACKOUT_LOG_DIR" &
else
    python3 "$SCRIPT_DIR/server.py" "$BLACKOUT_UI_PORT" "$SCRIPT_DIR" &>/dev/null &
fi
UI_SERVER_PID=$!

# Verify UI server started (poll /api/status)
UI_WAIT=0
UI_MAX_WAIT=15
while ! curl -s -o /dev/null -w "" --connect-timeout 2 --max-time 3 "http://127.0.0.1:${BLACKOUT_UI_PORT}/api/status" > /dev/null 2>&1; do
    sleep 1
    UI_WAIT=$((UI_WAIT + 1))
    spin "Waiting for web server..." "$UI_WAIT"
    if [ $UI_WAIT -ge $UI_MAX_WAIT ]; then
        echo ""
        echo ""
        echo -e "  ${RED}✗ UI server failed to start after ${UI_MAX_WAIT}s${NC}"
        echo "  Try running manually:"
        echo "    python3 \"$SCRIPT_DIR/server.py\" $BLACKOUT_UI_PORT \"$SCRIPT_DIR\""
        echo ""
        kill $OLLAMA_PID 2>/dev/null
        read -p "  Press Enter to exit..."
        exit 1
    fi
done
echo ""
echo -e "  ${GREEN}✓${NC} Web server on ${BLACKOUT_UI_URL}"

# ═══════════════════════════════════════════════════════════════
# Phase 4: Open Browser (user sees "WARMING UP" screen immediately)
# ═══════════════════════════════════════════════════════════════
phase "Phase 4/5: Open Browser"
open "${BLACKOUT_UI_URL}/ui/"
echo -e "  ${GREEN}✓${NC} Launched browser"

# ═══════════════════════════════════════════════════════════════
# Phase 5: Load BEACON Model (runs AFTER browser is open)
# ═══════════════════════════════════════════════════════════════
phase "Phase 5/5: Load BEACON Model"

# Check if ollama create can be skipped (model already registered & Modelfile unchanged)
MODELFILE_PATH="$SCRIPT_DIR/Modelfile.generated"
MODELFILE_HASH_FILE="$SCRIPT_DIR/data/.modelfile_hash"
CURRENT_HASH=$(shasum -a 256 "$MODELFILE_PATH" 2>/dev/null | awk '{print $1}')
PREVIOUS_HASH=""
if [ -f "$MODELFILE_HASH_FILE" ]; then
    PREVIOUS_HASH=$(cat "$MODELFILE_HASH_FILE" 2>/dev/null)
fi

# Check if the model is already registered in Ollama
MODEL_EXISTS=$(curl -s "${BLACKOUT_OLLAMA_URL}/api/tags" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    names = [m.get('name','').split(':')[0] for m in data.get('models',[])]
    print('yes' if '$BLACKOUT_MODEL_NAME'.split(':')[0] in names else 'no')
except:
    print('no')
" 2>/dev/null)

if [ "$MODEL_EXISTS" = "yes" ] && [ "$CURRENT_HASH" = "$PREVIOUS_HASH" ] && [ -n "$CURRENT_HASH" ]; then
    echo -e "  ${GREEN}✓${NC} BEACON model already registered (skipped import)"
else
    echo -e "  Importing $MODEL_DISPLAY into engine..."
    if [ "$BLACKOUT_DEBUG" = "1" ]; then
        "$OLLAMA_BINARY" create "$BLACKOUT_MODEL_NAME" -f "$MODELFILE_PATH" >> "$BLACKOUT_LOG_DIR/ollama.log" 2>&1
    else
        "$OLLAMA_BINARY" create "$BLACKOUT_MODEL_NAME" -f "$MODELFILE_PATH" >/dev/null 2>&1
    fi
    # Save hash so we can skip next time
    mkdir -p "$(dirname "$MODELFILE_HASH_FILE")"
    echo "$CURRENT_HASH" > "$MODELFILE_HASH_FILE"
    echo -e "  ${GREEN}✓${NC} BEACON model registered"
fi

# Ensure embedding model is available (required for Ask BEACON / RAG search)
# nomic-embed-text is a tiny 45MB model — pull only takes seconds if not cached.
EMBED_EXISTS=$(curl -s "${BLACKOUT_OLLAMA_URL}/api/tags" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    names = [m.get('name','').split(':')[0] for m in data.get('models',[])]
    print('yes' if 'nomic-embed-text' in names else 'no')
except:
    print('no')
" 2>/dev/null)

if [ "$EMBED_EXISTS" != "yes" ]; then
    echo -e "  Pulling embedding model (nomic-embed-text, ~45MB)..."
    "$OLLAMA_BINARY" pull nomic-embed-text >/dev/null 2>&1
    echo -e "  ${GREEN}✓${NC} Embedding model ready"
fi

# Pre-warm model into GPU/Metal memory (Backgrounded)
echo -e "  Loading model into GPU memory (background)..."
curl -s --max-time 120 -X POST "${BLACKOUT_OLLAMA_URL}/api/generate" \
  -d "{\"model\":\"$BLACKOUT_MODEL_NAME\",\"prompt\":\"\",\"keep_alive\":\"30m\"}" >/dev/null 2>&1 &

echo -e "  ${GREEN}✓${NC} BEACON warming up"

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}The Blackout Drive is READY${NC}"
echo "  ═══════════════════════════════════════════════════════"
echo ""
echo "  If the browser didn't open, go to:"
echo "    ${BLACKOUT_UI_URL}/ui/"
echo ""
echo -e "  ${YELLOW}KEEP THIS WINDOW OPEN${NC} — it powers the AI."
echo ""
echo "  When done: close the browser tab, then"
echo "  press Ctrl+C here or just close this window."
echo "  Then safely eject the drive."
echo ""
echo "  ═══════════════════════════════════════════════════════"
echo ""

# ── Trap exit signals — cleanup on close ────────────
cleanup() {
    echo ""
    echo -e "  ${CYAN}[SHUTDOWN]${NC} Shutting down BEACON system..."
    kill $UI_SERVER_PID 2>/dev/null
    kill $OLLAMA_PID 2>/dev/null
    wait $OLLAMA_PID 2>/dev/null
    echo -e "  ${CYAN}[SHUTDOWN]${NC} System offline. All data remains on your drive."
    echo ""
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "  Press Ctrl+C to shut down BEACON."
echo ""
wait $OLLAMA_PID
