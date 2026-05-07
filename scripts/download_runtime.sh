#!/bin/bash
# ============================================================
# DOOMSDAY DRIVE — Download Runtime Script
# ============================================================
# Downloads portable Ollama binaries for all 3 platforms
# and places them in the correct drive/runtime/ directories.
#
# Run this once on a Mac during drive assembly.
# Output: drive/runtime/ollama-mac-arm/ollama
#         drive/runtime/ollama-mac-intel/ollama
#         drive/runtime/ollama-windows/ollama.exe
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  DOOMSDAY DRIVE — Download Runtimes${NC}"
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
        # Extract ollama binary from zip
        unzip -o "$TMP_FILE" -d "$DEST_DIR" "ollama.exe" 2>/dev/null || \
        unzip -o "$TMP_FILE" -d "/tmp/ollama-extract-$PLATFORM" && \
            find "/tmp/ollama-extract-$PLATFORM" -name "ollama.exe" -exec cp {} "$DEST_DIR/" \;
    else
        TMP_FILE="${TMP_FILE}.tgz"
        curl -fL --progress-bar "$ASSET_URL" -o "$TMP_FILE"
        tar -xzf "$TMP_FILE" -C "$DEST_DIR" --strip-components=0 2>/dev/null || \
            tar -xzf "$TMP_FILE" -C "$DEST_DIR"
        # Ollama macOS tarballs may just be the binary
        find "$DEST_DIR" -name "ollama" -exec chmod +x {} \;
    fi

    rm -f "$TMP_FILE"

    # Verify
    if ls "$DEST_DIR"/ollama* 1> /dev/null 2>&1; then
        local SIZE=$(du -sh "$DEST_DIR" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} $PLATFORM → $DEST_DIR ($SIZE)"
    else
        echo -e "  ${RED}[FAIL]${NC} Binary not found after extraction: $DEST_DIR"
        exit 1
    fi
    echo ""
}

# ── macOS ARM (Apple Silicon M1/M2/M3/M4) ────────────────────
echo -e "  ${CYAN}[2/4]${NC} Downloading macOS ARM (Apple Silicon)..."
MAC_ARM_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-darwin-arm64.tgz"
download_ollama "ollama-mac-arm" "$MAC_ARM_URL" "false"

# ── macOS Intel (x86_64) ──────────────────────────────────────
echo -e "  ${CYAN}[3/4]${NC} Downloading macOS Intel..."
MAC_INTEL_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-darwin-amd64.tgz"
download_ollama "ollama-mac-intel" "$MAC_INTEL_URL" "false"

# ── Windows (x86_64) ─────────────────────────────────────────
echo -e "  ${CYAN}[4/4]${NC} Downloading Windows..."
WIN_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-windows-amd64.zip"
download_ollama "ollama-windows" "$WIN_URL" "true"

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
