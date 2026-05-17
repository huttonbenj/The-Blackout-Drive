#!/bin/bash
# ============================================================
# The Blackout Drive — Build Manifest
# ============================================================
# Generates drive/content/manifest.json after content is
# downloaded by setup_drive.sh or download_content.sh.
#
# The manifest tells library.js exactly which files are
# physically present on this drive. The library ONLY shows
# files listed in the manifest — nothing else.
#
# Run: bash scripts/build_manifest.sh
# (Called automatically at end of setup_drive.sh)
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVE_DIR="$(dirname "$SCRIPT_DIR")/drive"
CONTENT_DIR="$DRIVE_DIR/_system/content"
MANIFEST="$CONTENT_DIR/manifest.json"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}Building drive manifest...${NC}"
echo ""

# Collect all content files into manifest JSON
python3 - << PYEOF
import json, os, hashlib, datetime

content_dir = '$CONTENT_DIR'
manifest_path = '$MANIFEST'

files = {}
total_bytes = 0

for root, dirs, filenames in os.walk(content_dir):
    # Skip the manifest itself and any hidden dirs
    dirs[:] = [d for d in dirs if not d.startswith('.')]
    for fname in filenames:
        if fname.startswith('.') or fname == 'manifest.json' or fname == 'library.json':
            continue
        full_path = os.path.join(root, fname)
        rel_path = os.path.relpath(full_path, os.path.dirname(content_dir))
        size = os.path.getsize(full_path)
        total_bytes += size
        # Fast checksum (first+last 64KB only, sufficient for integrity check)
        md5 = hashlib.md5()
        with open(full_path, 'rb') as f:
            md5.update(f.read(65536))
            f.seek(max(0, size - 65536))
            md5.update(f.read(65536))
        files[rel_path] = {
            'size': size,
            'checksum': md5.hexdigest()
        }

manifest = {
    'schema': '1.0',
    'assembled': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'file_count': len(files),
    'total_bytes': total_bytes,
    'files': files
}

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

total_mb = total_bytes / (1024 * 1024)
print(f'  Manifest written: {len(files)} files, {total_mb:.1f} MB total')
print(f'  Path: {manifest_path}')
PYEOF

echo ""
echo -e "  ${GREEN}✓ Manifest built.${NC} The library will now show only files present on this drive."
echo ""
