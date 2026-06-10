#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# sync_content.sh — Pull all library content from R2 bucket
#
# This is the ONLY way content gets onto the drive.
# R2 bucket is the single source of truth.
#
# Usage:  ./scripts/sync_content.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTENT_DIR="$PROJECT_ROOT/drive/_system/content"
BOOKS_DIR="$CONTENT_DIR/books"
CATALOG_FILE="$CONTENT_DIR/catalog.json"
WORKER_URL="https://blackout-catalog.hutton-benj.workers.dev"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  THE BLACKOUT DRIVE — Content Sync                     ║${NC}"
echo -e "${CYAN}║  Source: R2 bucket (single source of truth)            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Fetch catalog from Worker ───────────────────────
echo -e "${YELLOW}[1/3] Fetching catalog from Worker...${NC}"
CATALOG_JSON=$(curl -sf "$WORKER_URL" 2>/dev/null) || {
    echo -e "${RED}ERROR: Could not reach Worker at $WORKER_URL${NC}"
    echo "  Make sure the Worker is deployed and you have internet access."
    exit 1
}

# Save catalog to disk (offline fallback)
echo "$CATALOG_JSON" > "$CATALOG_FILE"
echo -e "  ${GREEN}✓ Catalog saved to catalog.json${NC}"

# Count files
TOTAL_FILES=$(echo "$CATALOG_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
total = sum(len(p.get('files',[])) for p in data.get('packs',[]))
print(total)
")
echo -e "  ${GREEN}✓ Found $TOTAL_FILES files across $(echo "$CATALOG_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('packs',[])))")  categories${NC}"

# ── Step 2: Download all files ──────────────────────────────
echo ""
echo -e "${YELLOW}[2/3] Syncing files from R2...${NC}"

# Parse catalog into download manifest using bucket keys
MANIFEST=$(echo "$CATALOG_JSON" | python3 -c "
import sys, json, os

data = json.load(sys.stdin)
books_dir = '$BOOKS_DIR'
lines = []

for pack in data.get('packs', []):
    folder = pack['id']
    folder_path = os.path.join(books_dir, folder)
    os.makedirs(folder_path, exist_ok=True)

    for f in pack.get('files', []):
        filename = f['filename']
        expected_size = f.get('size', 0)
        local_path = os.path.join(folder_path, filename)
        bucket_key = f'{folder}/{filename}'

        # Skip if file exists and size matches
        if os.path.exists(local_path):
            local_size = os.path.getsize(local_path)
            if expected_size and abs(local_size - expected_size) < 1024:
                continue

        # Emit: bucket_key|local_path|display_name
        lines.append(f'{bucket_key}|{local_path}|{folder}/{filename}')

print('\n'.join(lines))
")

DOWNLOADED=0
FAILED=0
TOTAL=$(echo "$MANIFEST" | grep -c '|' 2>/dev/null || echo 0)

WRANGLER_CFG="$PROJECT_ROOT/cloudflare-worker"

if [ "$TOTAL" -eq 0 ]; then
    echo -e "  ${GREEN}✓ All files already on disk — nothing to download${NC}"
else
    echo -e "  Downloading $TOTAL files via wrangler..."
    echo ""
    while IFS='|' read -r BUCKET_KEY LOCAL_PATH DISPLAY; do
        [ -z "$BUCKET_KEY" ] && continue
        echo -ne "  ⬇ $DISPLAY... "
        if npx wrangler r2 object get "blackout-drive-content/$BUCKET_KEY" --file "$LOCAL_PATH" --remote --config "$WRANGLER_CFG/wrangler.toml" 2>/dev/null | grep -q "complete"; then
            SIZE=$(wc -c < "$LOCAL_PATH" | tr -d ' ')
            echo "✓ ($(printf "%'d" "$SIZE") bytes)"
            DOWNLOADED=$((DOWNLOADED + 1))
        else
            echo -e "${RED}FAILED${NC}"
            FAILED=$((FAILED + 1))
        fi
    done <<< "$MANIFEST"
    echo ""
    echo -e "  ${GREEN}Downloaded: $DOWNLOADED${NC}"
    [ "$FAILED" -gt 0 ] && echo -e "  ${RED}Failed: $FAILED${NC}"
fi

# ── Step 3: Clean up old flat files ─────────────────────────
echo ""
echo -e "${YELLOW}[3/3] Cleanup...${NC}"

# Remove old flat files that are now in subfolders
FLAT_COUNT=0
for f in "$BOOKS_DIR"/*.epub "$BOOKS_DIR"/*.pdf "$BOOKS_DIR"/*.txt; do
    [ -f "$f" ] || continue
    BASENAME=$(basename "$f")
    # Check if this file now exists in a subfolder
    if find "$BOOKS_DIR" -mindepth 2 -name "$BASENAME" -print -quit | grep -q .; then
        rm "$f"
        FLAT_COUNT=$((FLAT_COUNT + 1))
    fi
done

if [ "$FLAT_COUNT" -gt 0 ]; then
    echo -e "  ${GREEN}✓ Removed $FLAT_COUNT flat files (now in category folders)${NC}"
fi

# Remove old catalog files if they exist
[ -f "$CONTENT_DIR/library.json" ] && {
    echo -e "  ${GREEN}✓ Removed legacy library.json${NC}"
    rm "$CONTENT_DIR/library.json"
}
[ -f "$CONTENT_DIR/catalog_extended.json" ] && {
    echo -e "  ${GREEN}✓ Removed legacy catalog_extended.json${NC}"
    rm "$CONTENT_DIR/catalog_extended.json"
}

# Regenerate manifest.json so file paths match new folder structure
echo -e "  ${GREEN}✓ Regenerating manifest.json...${NC}"
DRIVE_DIR="$PROJECT_ROOT/drive/_system" python3 << 'PYEOF'
import os, json, hashlib, datetime

drive_dir = os.environ.get('DRIVE_DIR', '')
content_dir = os.path.join(drive_dir, 'content')
files = {}
total_bytes = 0

for root, dirs, filenames in os.walk(content_dir):
    dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
    for fname in sorted(filenames):
        if fname.startswith('.') or fname in ('manifest.json', 'library.json', 'catalog.json', 'catalog_extended.json'):
            continue
        full = os.path.join(root, fname)
        rel = os.path.relpath(full, drive_dir).replace('\\', '/')
        size = os.path.getsize(full)
        total_bytes += size
        md5 = hashlib.md5()
        try:
            with open(full, 'rb') as f:
                md5.update(f.read(65536))
                if size > 65536:
                    f.seek(size - 65536)
                    md5.update(f.read(65536))
        except:
            pass
        files[rel] = {'size': size, 'checksum': md5.hexdigest()}

manifest = {
    'schema': '1.0',
    'assembled': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'file_count': len(files),
    'total_bytes': total_bytes,
    'files': files,
}

with open(os.path.join(content_dir, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print(f"    {len(files)} files indexed")
PYEOF

echo ""
echo -e "${GREEN}═══ Sync complete ═══${NC}"
echo -e "  Catalog: $CATALOG_FILE"
echo -e "  Books:   $BOOKS_DIR/<category>/<file>"
echo ""
