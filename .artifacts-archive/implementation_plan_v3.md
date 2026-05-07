# DOOMSDAY.AI — Full Stack Architecture & V2 Implementation Plan

## Architecture Audit — What We Have vs. What We Need

### Current Stack (V1)
| Layer | Component | Status | Problem |
|-------|-----------|--------|---------|
| Runtime | Ollama binary | ✅ Good | — |
| Server | `python3 -m http.server` | ⚠ Must upgrade | Read-only, can't write/delete files |
| Frontend | Vanilla HTML/CSS/JS | ✅ Keep | Right choice, zero deps |
| Config | 3 files out of sync | ⚠ Fix | config.sh, config.bat, config.js must be manually synced |
| API layer | None — fetch calls scattered | ⚠ Fix | app.js and library.js both make HTTP calls directly |
| Library | `library.js` (monolithic) | ✅ Acceptable | Manageable at current size |
| Config-JS | Static `window.DOOMSDAY_CONFIG` | ✅ Keep | Already clean |

### Target Stack (V2)
```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1: RUNTIME (unchanged)                                │
│  Ollama binary · Python 3 (system)                          │
│                                                              │
│  LAYER 2: CORE AI ENGINE (unchanged)                        │
│  drive/Modelfile · drive/models/ · drive/runtime/           │
│                                                              │
│  LAYER 3: LOCAL SERVER  ← UPGRADED                          │
│  scripts/server.py  (replaces python3 -m http.server)       │
│  GET  /ui/*           → serve static files                  │
│  GET  /content/*      → serve content files                 │
│  GET  /api/status     → health + disk usage                 │
│  GET  /api/manifest   → manifest.json                       │
│  POST /api/download   → download URL to disk + update mf    │
│  DELETE /api/files    → delete file + update manifest       │
│  GET  /api/download/status → download progress              │
│                                                              │
│  LAYER 4: FRONTEND  ← REFACTORED                           │
│  index.html          (structure — no logic)                 │
│  config.js           (all config values, loaded first)      │
│  api.js              (NEW: all HTTP calls, pure data)       │
│  app.js              (chat UI only, uses API)               │
│  library.js          (library UI only, uses API)            │
│  style.css           (design system)                        │
│                                                              │
│  LAYER 5: CONTENT (unchanged structure)                      │
│  drive/content/library.json    (local catalog)              │
│  drive/content/manifest.json   (what's on this drive)       │
│  drive/content/books/          (text/PDF files)             │
│  drive/content/zim/            (Wikipedia)                  │
│  drive/content/packs/          (NEW: installed pack metadata)│
│                                                              │
│  LAYER 6: CONFIGURATION  ← UNIFIED                         │
│  drive/config.json  (MASTER — single source of truth)       │
│  drive/config.sh    (generated from config.json)            │
│  drive/config.bat   (generated from config.json)            │
│  drive/ui/config.js (fetches config.json at startup)        │
└──────────────────────────────────────────────────────────────┘

REMOTE (internet-only, optional):
  https://cdn.doomsday.ai/catalog.json  — available packs
  https://cdn.doomsday.ai/files/*       — downloadable content
```

---

## Configuration Architecture

### `drive/config.json` — Master Source of Truth
```json
{
  "app": {
    "name": "DOOMSDAY.AI",
    "version": "1.0.0",
    "tagline": "Offline Survival Intelligence"
  },
  "model": {
    "name": "doomsday-ai",
    "base": "phi3:mini",
    "file": "phi3-mini.Q4_K_M.gguf"
  },
  "network": {
    "ollamaPort": 11434,
    "uiPort": 8080,
    "ollamaBind": "127.0.0.1"
  },
  "content": {
    "remoteCatalogUrl": "https://cdn.doomsday.ai/catalog.json",
    "remoteFilesUrl": "https://cdn.doomsday.ai/files"
  },
  "chat": {
    "streamTimeoutMs": 120000,
    "retryIntervalMs": 2000,
    "maxRetries": 30,
    "maxInputChars": 4000
  }
}
```

- Shell scripts read this via: `python3 -c "import json; c=json.load(open('drive/config.json')); print(c['model']['name'])"`
- `config.js` loads this at startup via `fetch('/config.json')` and merges into `window.DOOMSDAY_CONFIG`
- Shell `config.sh` and `config.bat` keep their current variable names but values come from `config.json`

---

## Frontend JS Architecture

### Module Load Order (index.html script tags):
```
1. config.js     — loads config.json, sets window.DOOMSDAY_CONFIG
2. api.js        — all HTTP calls, reads from window.DOOMSDAY_CONFIG
3. app.js        — chat UI, calls DDAPI.*
4. library.js    — library UI, calls DDAPI.*
```

### `api.js` Responsibilities:
```javascript
window.DDAPI = {
  // Ollama (chat)
  async checkOllama()           → bool
  async streamChat(messages, onChunk, onDone, onError)
  
  // Local server
  async getManifest()           → {files: {...}}
  async getStatus()             → {content_size_bytes, version}
  async deleteFile(relPath)     → {ok, removed}
  async startDownload(url, dest)→ {ok, jobId}
  async getDownloadStatus(jobId)→ {progress, total, done, error}
  
  // Remote catalog (online only)
  async fetchRemoteCatalog()    → {packs: [...]}
}
```

---

## Library UI Architecture — All Panels

### Sidebar States
```
OFFLINE MODE (no internet):
  ON THIS DRIVE
    📖 Holy Bible       (4)  ← shown ONLY if ≥1 file in manifest
    ☠  Survival         (6)  ← shown ONLY if ≥1 file in manifest
    🏥 Medical          (0)  ← HIDDEN (not grayed, not locked — not there)
  ──────────────────────────
  🗑  MANAGE SPACE           ← always visible

ONLINE MODE (navigator.onLine === true):
  ON THIS DRIVE
    📖 Holy Bible       (4)
    ☠  Survival         (6)
  ──────────────────────────
  ⬇  GET MORE               ← appears only when online
  🗑  MANAGE SPACE
```

### Panel: ON THIS DRIVE (category view)
- Shows file list for selected category
- File items: type badge, name, description, size, license
- Clicking TXT → Bible reader or generic reader
- Clicking PDF → HEAD check, then native viewer or "not found"

### Panel: GET MORE (online only)
```
⬇ GET MORE CONTENT
────────────────────────────────────────────────────────
Connected to internet. Download additional content packs.
                                          [Browse files ▾]
AVAILABLE PACKS

📖 Bible Commentary Pack                          ~15 MB
   Matthew Henry Commentary, Strongs Concordance
   [⬇ DOWNLOAD PACK]  [▾ See 2 files]

🏥 Extended Medical Pack                          ~45 MB
   Merck Manual, CDC Guidelines, Field Surgery
   [⬇ DOWNLOAD PACK]  [▾ See 5 files]

📡 Ham Radio & Comms Pack                          ~8 MB
   [⬇ DOWNLOAD PACK]  [▾ See 3 files]

🌿 Homestead & Agriculture Pack                   ~30 MB
   [⬇ DOWNLOAD PACK]  [▾ See 7 files]
```

Download in progress:
```
📡 Ham Radio & Comms Pack
  [████████████░░░░] 67%   5.3 MB / 8.0 MB   [✕ Cancel]
```

On completion: category auto-appears in sidebar, no page reload.
If cancelled/errored: partial file deleted, manifest NOT updated.

[▾ Browse files] expands individual files within each pack — power user mode.

### Panel: MANAGE SPACE (always available)
```
🗑 MANAGE SPACE
─────────────────────────────────────────────────────────
Content usage: ████░░░░░░░░░░░░  16.2 MB of 58.7 GB

ON THIS DRIVE:

📖 Holy Bible                              16.2 MB  [−]
   ✓ KJV Bible (King James, 1611)           4.2 MB  [🗑]
   ✓ WEB Bible (World English)              4.1 MB  [🗑]
   ✓ ASV Bible (American Standard)          3.9 MB  [🗑]
   ✓ YLT Bible (Young's Literal)            3.8 MB  [🗑]
                                        [Remove All ☠]

☠ Survival Manuals                         42.0 MB  [−]
   ✓ Army FM 21-76 Survival Manual         12.0 MB  [🗑]
   ...
```

Clicking 🗑 on a file → confirmation → DELETE /api/files → manifest updated → file disappears.
If category reaches 0 files → disappears from sidebar automatically.

---

## Pack System Design

### Pack Catalog Format (`catalog.json` on CDN):
```json
{
  "schema": "1.0",
  "packs": [
    {
      "id": "medical-extended",
      "name": "Extended Medical Pack",
      "description": "Advanced field medicine references",
      "version": "1.0.0",
      "size_mb": 45,
      "category": "medical",
      "files": [
        {
          "id": "merck_manual",
          "name": "Merck Manual",
          "url": "https://cdn.doomsday.ai/files/merck_manual.pdf",
          "dest": "content/books/merck_manual.pdf",
          "size_mb": 12,
          "license": "Public Domain"
        }
      ]
    }
  ]
}
```

### Pack Installation Flow:
1. User clicks "⬇ DOWNLOAD PACK"
2. Frontend calls `DDAPI.startDownload(file.url, file.dest)` for each file in pack
3. Server downloads file to disk in background thread
4. Frontend polls `DDAPI.getDownloadStatus(jobId)` every 500ms → updates progress bar
5. When all files done → `DDAPI.getManifest()` → refresh library state → category appears in sidebar
6. Pack metadata saved to `drive/content/packs/{id}.json` for tracking

---

## server.py — Local Server Design

```
Endpoints:
  GET  /*                  → serve static files (security: no dir traversal)
  GET  /api/status         → {content_size_bytes, free_bytes, version}
  GET  /api/manifest       → manifest.json contents
  POST /api/download       → {url, dest} → returns {jobId}
  GET  /api/download/{id}  → {progress, total, done, error}
  DELETE /api/files        → ?path=... → delete + update manifest

Security:
  - All file paths normalized and checked to stay within DRIVE_ROOT
  - Directory traversal attempts → 403
  - Only localhost connections accepted (127.0.0.1 bind)
  - OPTIONS handler for CORS (Ollama on different port)
```

---

## What Is NOT Changing (Don't Touch)

- Vanilla JS/HTML/CSS approach — still correct, zero deps
- Ollama integration — works perfectly
- Shell launcher structure — works
- CSS design system — good
- Bible reader implementation — keep as-is
- Generic TXT reader — keep as-is
- library.json format — keep as-is

---

## Sprint Plan & Timeline

> Assumes ~4-6 hrs/day with AI agents. All work is in order.

### Sprint 1 — Foundation (Day 1-2, ~6 hrs)
- [x] Create `drive/config.json` — master config file
- [x] Update `config.js` to fetch `/config.json` at startup
- [x] Update `config.sh` to read from `config.json` via python3
- [ ] Create `drive/ui/api.js` — all HTTP calls centralized
- [ ] Update `app.js` to use `DDAPI.*` instead of direct fetch
- [ ] Update `library.js` to use `DDAPI.*` instead of direct fetch
- [ ] Write `scripts/server.py` — custom Python HTTP server
- [ ] Update `START_MAC.command` to use `server.py`
- [ ] Update `START_WINDOWS.bat` to use `server.py`

### Sprint 2 — Library Sidebar & GET MORE (Day 3-4, ~5 hrs)
- [ ] Fix library sidebar: only show categories with manifest files
- [ ] Add GET MORE sidebar entry (online detection)
- [ ] Add MANAGE SPACE sidebar entry (always shown)
- [ ] Build GET MORE panel (fetches remote catalog, shows packs)
- [ ] Build pack expand/collapse (show individual files)
- [ ] Wire ⬇ DOWNLOAD PACK → DDAPI.startDownload per file in pack
- [ ] Build download progress bar (polling DDAPI.getDownloadStatus)
- [ ] On pack complete: auto-refresh sidebar

### Sprint 3 — Manage Space (Day 5-6, ~4 hrs)
- [ ] Build MANAGE SPACE panel (disk usage visualization)
- [ ] Per-file 🗑 button → confirmation → DDAPI.deleteFile → manifest refresh
- [ ] Per-category "Remove All" → batch delete → manifest refresh
- [ ] Sidebar auto-hides emptied categories
- [ ] Drive usage bar (GET /api/status for free_bytes)

### Sprint 4 — Polish & Edge Cases (Day 7-8, ~4 hrs)
- [ ] Disk-full detection before download starts (check free_bytes vs pack size)
- [ ] Windows path handling in server.py (backslash normalization)
- [ ] Offline fallback: GET MORE panel shows "No internet" message gracefully
- [ ] Pack re-download: if already have some files, skip those (resume)
- [ ] Content pack version checking

### Sprint 5 — Hardware Test & Production Build (Day 9-10, ~4 hrs)
- [ ] Hardware USB test on Mac
- [ ] Hardware USB test on Windows
- [ ] Run full setup_drive.sh → build_manifest.sh → verify library shows only present files
- [ ] Performance test: large file downloads, concurrent downloads
- [ ] Final image build + smoke test

### Phase 3 — Marketing & Launch (Day 11-14)
- [ ] Shopify store
- [ ] Marketing copy
- [ ] TikTok scripts
- [ ] First batch of 25 drives flashed

**Total to launch: ~12-14 days of focused work**

---

## Open Questions (Do Not Block Execution)

1. **CDN for packs** — Use AWS S3, Cloudflare R2, or Bunny.net for CDN hosting? Decision needed before Sprint 4.
2. **Pack pricing** — Free downloads or paid? If paid, need license key validation endpoint (Sprint 4 scope change).
3. **Windows Python 3** — Python 3 may not be pre-installed on some Windows machines. Need fallback: bundle a minimal Python runtime in `drive/runtime/` for Windows only.
