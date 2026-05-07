# Walkthrough — Phase 1 MVP Ship Execution

> **18 files modified** | **589 lines removed** | **119 lines added** | **0 stale references remaining**

---

## What Was Done

### 1. V2/V3 Code Isolated

Created `v2-experimental` branch preserving all experimental features, then stripped from `main`:

| File | Action |
|---|---|
| [ham-radio.js](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/ham-radio.js) | **Deleted** (408 lines, preserved on v2-experimental) |
| [index.html](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/index.html) | Removed `<script src="ham-radio.js">` |
| [library.json](file:///Users/benjamin/github/The-Blackout-Drive/drive/content/library.json) | Removed `ham-radio` category |
| [catalog_extended.json](file:///Users/benjamin/github/The-Blackout-Drive/drive/content/catalog_extended.json) | Removed `ham-radio-premium` paid pack (dead CDN) |
| [library.js](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/library.js) | Stubbed handler → "Coming in V2" message |

### 2. P0 Blockers Squashed (5 bugs fixed)

| Bug | Fix |
|---|---|
| **REPO_ROOT undefined** | Copied `server.py` into `drive/` for USB self-containment; launchers now use `$SCRIPT_DIR/server.py` |
| **Windows BEACON_ prefix** | Complete rewrite of `START_WINDOWS.bat` — every `BEACON_*` → `BLACKOUT_*` |
| **SERVER_PORT ReferenceError** | [api.js:221](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/api.js#L219-L226) now uses `cfg().uiPort` |
| **showManageSpace undefined** | [library.js:58](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/library.js#L57-L58) → `showManagePanel()` |
| **cancelPackDownload(this)** | [library.js:1323](file:///Users/benjamin/github/The-Blackout-Drive/drive/ui/library.js#L1318-L1325) now reloads GET MORE panel instead of passing button as pack |

### 3. Dead References Eliminated

| Reference | Location | Fix |
|---|---|---|
| `cdn.blackoutdrive.com` | config.json, config.js | → `null` |
| `cdn.theblackoutdrive.com` | catalog_extended.json | Entire pack removed |
| Hesperian store URLs | library.json | → `null` + V2 note |
| USDA HTML index URL | library.json | → `null` + V2 note |
| `BEACON_*` vars | dev_test.sh | → `BLACKOUT_*` |

### 4. Infrastructure Hardened

| File | Change |
|---|---|
| [config.sh](file:///Users/benjamin/github/The-Blackout-Drive/drive/config.sh) | Added `BLACKOUT_DRIVE_ROOT` auto-detection |
| [config.bat](file:///Users/benjamin/github/The-Blackout-Drive/drive/config.bat) | Added `BLACKOUT_DRIVE_ROOT` via `%~dp0` |
| [STOP_BEACON.command](file:///Users/benjamin/github/The-Blackout-Drive/drive/STOP_BEACON.command) | Now also kills Python server |
| [STOP_BEACON.bat](file:///Users/benjamin/github/The-Blackout-Drive/drive/STOP_BEACON.bat) | Uses window title filter, not `taskkill /im python.exe` |
| [setup_drive.sh](file:///Users/benjamin/github/The-Blackout-Drive/scripts/setup_drive.sh) | Added server.py copy step + integrity check |
| [dev_test.sh](file:///Users/benjamin/github/The-Blackout-Drive/scripts/dev_test.sh) | Uses `server.py` instead of `http.server` |

### 5. Documentation Updated

| File | Change |
|---|---|
| [README.md](file:///Users/benjamin/github/The-Blackout-Drive/README.md) | Phase badge, script names, repo structure, persona name, dev setup |
| [FIRST_RUN_README.txt](file:///Users/benjamin/github/The-Blackout-Drive/drive/FIRST_RUN_README.txt) | Removed phantom content, accurate preloaded vs. downloadable split |

---

## Verification Results

| Check | Result |
|---|---|
| Shell syntax (`bash -n`) | ✅ 6/6 scripts pass |
| JSON validation | ✅ 3/3 files valid |
| Stale reference scan | ✅ 0 results (`BEACON_`, `REPO_ROOT`, `cdn.*`, `SERVER_PORT`, `showManageSpace`, `doomsday`, `ham-radio.js`) |
| Server startup | ✅ API status OK, version 1.0.0 |
| Library context | ✅ 10 files detected |
| UI serving | ✅ HTTP 200 for `index.html` and `config.js` |

---

## What's Left Before Physical Flash

1. **Run `scripts/download_runtime.sh`** — downloads ~2GB Ollama binaries (Mac ARM, Mac Intel, Windows)
2. **Run `scripts/download_models.sh`** — downloads ~2.3GB Phi-3 Mini GGUF
3. **Run `scripts/setup_drive.sh`** — orchestrates full assembly + integrity check
4. **Cold-start test on physical USB** — plug into a clean Mac/Windows machine with no Ollama installed
5. **Git commit** — `git add -A && git commit -m "fix: Phase 1 MVP ship-ready"`
