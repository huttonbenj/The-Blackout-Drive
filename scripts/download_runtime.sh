#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Download Runtime Script
# ============================================================
# Downloads portable Ollama binaries for all 3 platforms
# and the embedded Python runtime for Windows.
# Places them in the correct drive/runtime/ directories.
#
# Run this once on a Mac during drive assembly.
# Output: drive/runtime/ollama-mac-arm/ollama
#         drive/runtime/ollama-mac-intel/ollama
#         drive/runtime/ollama-windows/ollama.exe
#         drive/runtime/python-windows/python.exe
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive/_system"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  THE BLACKOUT DRIVE — Download Runtimes${NC}"
echo "  ============================================="
echo ""

# ── Detect current OS/arch ───────────────────────────────────
CURRENT_OS=$(uname -s)
CURRENT_ARCH=$(uname -m)

echo -e "  ${CYAN}[INFO]${NC} Host: $CURRENT_OS / $CURRENT_ARCH"
echo ""

# ── Fetch latest Ollama release version ──────────────────────
echo -e "  ${CYAN}[1/4]${NC} Fetching latest Ollama release version..."
OLLAMA_VERSION=$(curl -s https://api.github.com/repos/ollama/ollama/releases/latest \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null)

if [ -z "$OLLAMA_VERSION" ]; then
    echo -e "  ${YELLOW}[WARN]${NC} Could not auto-detect version. Using fallback: v0.6.8"
    OLLAMA_VERSION="v0.6.8"
fi

echo -e "  ${GREEN}[OK]${NC} Ollama version: $OLLAMA_VERSION"
echo ""

# ── Helper: download + extract ───────────────────────────────
download_ollama() {
    local PLATFORM="$1"      # mac-arm | mac-intel | windows
    local ASSET_URL="$2"     # full download URL
    local DEST_DIR="$DRIVE_DIR/runtime/$PLATFORM"
    local IS_ZIP="$3"        # true = .zip, false = tar.gz

    echo -e "  ${CYAN}[DOWNLOAD]${NC} $PLATFORM..."
    mkdir -p "$DEST_DIR"

    local TMP_FILE="/tmp/ollama-$PLATFORM-${OLLAMA_VERSION}"

    if [ "$IS_ZIP" = "true" ]; then
        TMP_FILE="${TMP_FILE}.zip"
        curl -fL --progress-bar "$ASSET_URL" -o "$TMP_FILE"
        # Extract FULL zip — ollama.exe + lib/ollama/ (GPU runners).
        # The lib/ directory contains CUDA and ROCm runners that are
        # REQUIRED for GPU acceleration. Without them, Ollama falls
        # back to a slow, unoptimized CPU-only runner.
        unzip -o "$TMP_FILE" -d "$DEST_DIR"
    else
        TMP_FILE="${TMP_FILE}.tgz"
        curl -fL --progress-bar "$ASSET_URL" -o "$TMP_FILE"
        tar -xzf "$TMP_FILE" -C "$DEST_DIR" --strip-components=0 2>/dev/null || \
            tar -xzf "$TMP_FILE" -C "$DEST_DIR"
        # Ollama macOS tarballs may just be the binary
        find "$DEST_DIR" -name "ollama" -exec chmod +x {} \;
    fi

    rm -f "$TMP_FILE"

    # Verify binary exists
    if ls "$DEST_DIR"/ollama* 1> /dev/null 2>&1; then
        local SIZE=$(du -sh "$DEST_DIR" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} $PLATFORM → $DEST_DIR ($SIZE)"
    else
        echo -e "  ${RED}[FAIL]${NC} Binary not found after extraction: $DEST_DIR"
        exit 1
    fi

    # For Windows: verify GPU runner libraries were extracted
    if [ "$PLATFORM" = "ollama-windows" ] && [ -d "$DEST_DIR/lib" ]; then
        local LIB_SIZE=$(du -sh "$DEST_DIR/lib" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} GPU runners: $DEST_DIR/lib/ ($LIB_SIZE)"
    elif [ "$PLATFORM" = "ollama-windows" ]; then
        echo -e "  ${YELLOW}[WARN]${NC} No lib/ directory — GPU acceleration will be unavailable!"
    fi
    echo ""
}

# ── macOS (Universal binary — works on both ARM and Intel) ────
echo -e "  ${CYAN}[2/6]${NC} Downloading macOS (universal binary)..."
MAC_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-darwin.tgz"
download_ollama "ollama-mac-arm" "$MAC_URL" "false"

# Copy the same universal binary to the intel dir (launcher checks arch)
echo -e "  ${CYAN}[3/6]${NC} Setting up macOS Intel (same universal binary)..."
mkdir -p "$DRIVE_DIR/runtime/ollama-mac-intel"
cp -R "$DRIVE_DIR/runtime/ollama-mac-arm/"* "$DRIVE_DIR/runtime/ollama-mac-intel/"
echo -e "  ${GREEN}[OK]${NC} ollama-mac-intel (copy of universal binary)"
echo ""

# ── Windows (x86_64) ─────────────────────────────────────────
echo -e "  ${CYAN}[4/6]${NC} Downloading Windows Ollama..."
WIN_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-windows-amd64.zip"
download_ollama "ollama-windows" "$WIN_URL" "true"

# ── Linux x86_64 ─────────────────────────────────────────────
echo -e "  ${CYAN}[5/6]${NC} Downloading Linux x86_64 Ollama..."
LINUX_AMD64_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-amd64.tgz"
download_ollama "ollama-linux-amd64" "$LINUX_AMD64_URL" "false"

# ── Linux ARM64 ──────────────────────────────────────────────
echo -e "  ${CYAN}[6/6]${NC} Downloading Linux ARM64 Ollama..."
LINUX_ARM64_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-arm64.tgz"
download_ollama "ollama-linux-arm64" "$LINUX_ARM64_URL" "false"

# ── Python Embedded for Windows (zero-install plug-and-play) ──
echo -e "  ${CYAN}[7/7]${NC} Downloading Python embedded for Windows..."
PYTHON_VERSION="3.13.13"
PYTHON_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip"
PYTHON_DIR="$DRIVE_DIR/runtime/python-windows"
PYTHON_TMP="/tmp/python-embed-${PYTHON_VERSION}.zip"

if [ -f "$PYTHON_DIR/python.exe" ]; then
    echo -e "  ${GREEN}[OK]${NC} Python already present — skipping."
else
    mkdir -p "$PYTHON_DIR"
    curl -fL --progress-bar "$PYTHON_URL" -o "$PYTHON_TMP"
    unzip -o "$PYTHON_TMP" -d "$PYTHON_DIR"
    rm -f "$PYTHON_TMP"
    if [ -f "$PYTHON_DIR/python.exe" ]; then
        PYTHON_SIZE=$(du -sh "$PYTHON_DIR" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} Python ${PYTHON_VERSION} embedded → $PYTHON_DIR ($PYTHON_SIZE)"
    else
        echo -e "  ${RED}[FAIL]${NC} python.exe not found after extraction"
        exit 1
    fi
fi
echo ""

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "  ============================================="
echo -e "  ${GREEN}ALL RUNTIMES DOWNLOADED${NC}"
echo ""
echo "  Runtime sizes:"
du -sh "$DRIVE_DIR/runtime"/*/  2>/dev/null | sed 's/^/    /'
echo ""
echo "  Total runtime footprint:"
du -sh "$DRIVE_DIR/runtime/" 2>/dev/null | sed 's/^/    /'
echo "  ============================================="
echo ""
echo -e "  ${CYAN}[NEXT]${NC} Run: scripts/download_models.sh"
echo ""
