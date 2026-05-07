#!/bin/bash

# ============================================================
# DOOMSDAY DRIVE — macOS Launcher
# ============================================================
# This script launches the DOOMSDAY offline AI system.
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

# ── Terminal colors ──────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

clear

echo ""
echo -e "${YELLOW}  ██████╗  ██████╗  ██████╗ ███╗   ███╗███████╗██████╗  █████╗ ██╗   ██╗${NC}"
echo -e "${YELLOW}  ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║██╔════╝██╔══██╗██╔══██╗╚██╗ ██╔╝${NC}"
echo -e "${YELLOW}  ██║  ██║██║   ██║██║   ██║██╔████╔██║███████╗██║  ██║███████║ ╚████╔╝ ${NC}"
echo -e "${YELLOW}  ██║  ██║██║   ██║██║   ██║██║╚██╔╝██║╚════██║██║  ██║██╔══██║  ╚██╔╝  ${NC}"
echo -e "${YELLOW}  ██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║███████║██████╔╝██║  ██║   ██║   ${NC}"
echo -e "${YELLOW}  ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   ${NC}"
echo ""
echo -e "${WHITE}  OFFLINE SURVIVAL INTELLIGENCE SYSTEM${NC}"
echo "  -------------------------------------------------------"
echo "  No internet required. No data leaves this drive."
echo "  -------------------------------------------------------"
echo ""

# ── Step 1: Detect architecture ─────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    OLLAMA_BINARY="$SCRIPT_DIR/runtime/ollama-mac-arm/ollama"
    echo -e "  ${CYAN}[BOOT]${NC} Detected: Apple Silicon (M1/M2/M3)"
else
    OLLAMA_BINARY="$SCRIPT_DIR/runtime/ollama-mac-intel/ollama"
    echo -e "  ${CYAN}[BOOT]${NC} Detected: Intel Mac"
fi

# ── Step 2: Verify runtime exists ───────────────────────────
if [ ! -f "$OLLAMA_BINARY" ]; then
    echo ""
    echo -e "  ${RED}[ERROR]${NC} Runtime not found: $OLLAMA_BINARY"
    echo ""
    echo "  This drive may not be fully set up."
    echo "  If you are the developer, run: scripts/download_runtime.sh"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── Step 3: Verify model exists ──────────────────────────────
MODEL_FILE="$SCRIPT_DIR/models/phi3-mini.Q4_K_M.gguf"
if [ ! -f "$MODEL_FILE" ]; then
    echo ""
    echo -e "  ${RED}[ERROR]${NC} AI model not found: $MODEL_FILE"
    echo ""
    echo "  This drive may not be fully set up."
    echo "  If you are the developer, run: scripts/download_models.sh"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── Step 4: Make binary executable ──────────────────────────
chmod +x "$OLLAMA_BINARY"

# ── Step 5: Check if Ollama is already running ───────────────
if curl -s http://localhost:11434 > /dev/null 2>&1; then
    echo -e "  ${GREEN}[INFO]${NC} DOOMSDAY system already running. Opening interface..."
    open "$SCRIPT_DIR/ui/index.html"
    exit 0
fi

# ── Step 6: Set environment — point Ollama to drive ─────────
export OLLAMA_MODELS="$SCRIPT_DIR/models"
export OLLAMA_HOST="127.0.0.1:11434"

# ── Step 7: Launch Ollama in background ─────────────────────
echo -e "  ${CYAN}[BOOT]${NC} Starting AI engine..."
"$OLLAMA_BINARY" serve &
OLLAMA_PID=$!

# ── Step 8: Wait for Ollama to be ready (up to 45 seconds) ──
WAIT_COUNT=0
MAX_WAIT=45
while ! curl -s http://localhost:11434 > /dev/null 2>&1; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    echo -e "  ${CYAN}[BOOT]${NC} Waiting for engine... ($WAIT_COUNT/$MAX_WAIT)"
    if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
        echo ""
        echo -e "  ${RED}[ERROR]${NC} DOOMSDAY system failed to start after ${MAX_WAIT}s."
        echo "  Check that your Mac has at least 8GB of RAM."
        kill $OLLAMA_PID 2>/dev/null
        read -p "  Press Enter to exit..."
        exit 1
    fi
done

echo -e "  ${GREEN}[BOOT]${NC} AI engine online."

# ── Step 9: Load the DOOMSDAY model (first run: create it) ──
echo -e "  ${CYAN}[BOOT]${NC} Checking DOOMSDAY model..."
if ! "$OLLAMA_BINARY" list 2>/dev/null | grep -q "doomsday"; then
    echo -e "  ${CYAN}[BOOT]${NC} First run — building DOOMSDAY model (takes ~30 seconds)..."
    "$OLLAMA_BINARY" create doomsday -f "$SCRIPT_DIR/Modelfile"
    echo -e "  ${GREEN}[BOOT]${NC} DOOMSDAY model ready."
else
    echo -e "  ${GREEN}[BOOT]${NC} DOOMSDAY model loaded."
fi

# ── Step 10: Open the chat interface ─────────────────────────
echo -e "  ${CYAN}[BOOT]${NC} Opening interface..."
open "$SCRIPT_DIR/ui/index.html"

echo ""
echo "  -------------------------------------------------------"
echo -e "  ${GREEN}DOOMSDAY is online.${NC} Your browser will open the interface."
echo ""
echo "  If your browser doesn't open, open this file manually:"
echo "  $SCRIPT_DIR/ui/index.html"
echo ""
echo "  IMPORTANT: Keep this terminal window open."
echo "  Closing it will shut down the AI system."
echo "  -------------------------------------------------------"
echo ""

# ── Step 11: Trap exit signals — cleanup on close ────────────
cleanup() {
    echo ""
    echo -e "  ${CYAN}[SHUTDOWN]${NC} Shutting down DOOMSDAY system..."
    kill $OLLAMA_PID 2>/dev/null
    wait $OLLAMA_PID 2>/dev/null
    echo -e "  ${CYAN}[SHUTDOWN]${NC} System offline. All data remains on your drive."
    echo ""
    exit 0
}

trap cleanup SIGINT SIGTERM

# ── Step 12: Keep alive until user closes ───────────────────
echo "  Press Ctrl+C to shut down DOOMSDAY."
echo ""
wait $OLLAMA_PID
