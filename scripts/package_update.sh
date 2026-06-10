#!/bin/bash

# ============================================================
# The Blackout Drive — Update Package Builder
# ============================================================
# Creates a distributable update ZIP and manifest for the OTA
# update system. Run this from the repo root when you want to
# release a new version.
#
# Usage:
#   ./scripts/package_update.sh <version> [changelog]
#
# Example:
#   ./scripts/package_update.sh 1.1.0 "Fixed COMMS race condition, updated legal docs"
#
# Output:
#   dist/
#     manifest.json         ← Upload to updates.theblackoutdrive.com/manifest.json
#     core.zip              ← Upload to updates.theblackoutdrive.com/v<VERSION>/core.zip
# ============================================================

set -e

VERSION="${1:?Usage: $0 <version> [changelog]}"
CHANGELOG="${2:-Bug fixes and improvements.}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
STAGING_DIR="$DIST_DIR/staging"
SYSTEM_DIR="$REPO_ROOT/drive/_system"

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo "  Building Update Package v${VERSION}"
echo "  ═══════════════════════════════════════════════════════"
echo ""

# Clean previous build
rm -rf "$DIST_DIR"
mkdir -p "$STAGING_DIR/_system"
mkdir -p "$STAGING_DIR/launchers"

# ── Copy core files (UI, server, legal, profiles) ────────────
# NOTE: config.json is INTENTIONALLY EXCLUDED from updates.
# It contains user-specific settings (eula_accepted, comms config,
# radio_silence, dispatch_role, basecamp_position) that must not
# be overwritten. The version number is updated by the bootstrapper
# via JSON merge from the staging manifest.
echo "  Copying core files..."
cp "$SYSTEM_DIR/server.py" "$STAGING_DIR/_system/"
cp "$SYSTEM_DIR/model_setup.py" "$STAGING_DIR/_system/"

# UI files
cp -R "$SYSTEM_DIR/ui" "$STAGING_DIR/_system/"

# Profiles (system prompts)
cp -R "$SYSTEM_DIR/profiles" "$STAGING_DIR/_system/"

# Legal docs
cp -R "$SYSTEM_DIR/LEGAL" "$STAGING_DIR/_system/"

# Config scripts
cp "$SYSTEM_DIR/config.sh" "$STAGING_DIR/_system/" 2>/dev/null || true
cp "$SYSTEM_DIR/config.bat" "$STAGING_DIR/_system/" 2>/dev/null || true

# ── Copy launchers ───────────────────────────────────────────
echo "  Copying launcher scripts..."
cp "$SYSTEM_DIR/START_WINDOWS.bat" "$STAGING_DIR/launchers/" 2>/dev/null || true
cp "$SYSTEM_DIR/START_MAC.command" "$STAGING_DIR/launchers/" 2>/dev/null || true
cp "$SYSTEM_DIR/START_LINUX.sh" "$STAGING_DIR/launchers/" 2>/dev/null || true

# ── EXCLUDE large binary files ───────────────────────────────
# The following are NOT included in core updates:
#   - runtime/ (Ollama binaries — hundreds of MB)
#   - models/  (GGUF model files — gigabytes)
#   - data/    (runtime state — NEVER include)
#   - content/ (library content — separate system)
#   - _factory/ (factory defaults — dev only)

# ── Remove dev-only files from the staging copy ──────────────
# NOTE: Monaco editor IS included — it's part of the shipped product.
# _factory/ directory is excluded since it's dev-only.

# ── Create the ZIP ───────────────────────────────────────────
echo "  Creating core.zip..."
cd "$STAGING_DIR"
zip -r "$DIST_DIR/core.zip" . -x "*.DS_Store" "*__pycache__*" > /dev/null
cd "$REPO_ROOT"

# ── Calculate SHA-256 ────────────────────────────────────────
SHA256=$(shasum -a 256 "$DIST_DIR/core.zip" | awk '{print $1}')
SIZE=$(stat -f%z "$DIST_DIR/core.zip" 2>/dev/null || stat -c%s "$DIST_DIR/core.zip" 2>/dev/null)

echo "  SHA-256: $SHA256"
echo "  Size:    $SIZE bytes ($(echo "$SIZE" | awk '{printf "%.1f MB", $1/1048576}'))"

# ── Generate manifest.json ───────────────────────────────────
echo "  Generating manifest.json..."
cat > "$DIST_DIR/manifest.json" <<EOF
{
  "latest_version": "${VERSION}",
  "released": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "min_drive_version": "1.0.0",
  "changelog": "${CHANGELOG}",
  "packages": {
    "core": {
      "url": "https://updates.theblackoutdrive.com/v${VERSION}/core.zip",
      "sha256": "${SHA256}",
      "size_bytes": ${SIZE}
    }
  }
}
EOF

# ── Clean up staging ─────────────────────────────────────────
rm -rf "$STAGING_DIR"

echo ""
echo "  ✓ Update package built successfully!"
echo ""
echo "  Output files:"
echo "    $DIST_DIR/manifest.json"
echo "    $DIST_DIR/core.zip"
echo ""
echo "  To release:"
echo "    1. Upload core.zip to: https://updates.theblackoutdrive.com/v${VERSION}/core.zip"
echo "    2. Upload manifest.json to: https://updates.theblackoutdrive.com/manifest.json"
echo ""
echo "  ═══════════════════════════════════════════════════════"
echo ""
