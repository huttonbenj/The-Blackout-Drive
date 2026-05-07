# The Blackout Drive — Exhaustive Production Audit
> Conducted: 2026-05-07 | Auditor: Antigravity AI

---

## 1. WHAT IS THIS PROJECT?

**The Blackout Drive** is a physical product business. A 64GB USB drive ships preloaded with:
- A portable Ollama AI binary (no host install required)
- A custom AI persona called **BEACON** (based on Phi-3 Mini Q4_K_M, ~2.3GB)
- A curated offline knowledge library (public domain books, PDFs, optional Kiwix ZIMs)
- A custom offline chat UI (vanilla HTML/CSS/JS, zero CDN)
- Launcher scripts for Windows and macOS

**Target market:** Prepper / survivalist / self-reliance niche  
**Price:** $79 (Basecamp) / $89 (Harvest, Chaplain editions — deferred)  
**LLC:** Hutton Technologies  
**Repo:** github.com/huttonbenj/The-Blackout-Drive (public, MIT)  
**Second repo:** The-Blackout-Drive-Web (private — website, not yet started)

---

## 2. REPOSITORY STRUCTURE (What Actually Exists)

```
The-Blackout-Drive/
├── docs/
│   ├── AGENT_CONTEXT.md       ✅ Complete — master agent briefing doc
│   ├── STATE.md               ⚠️  STALE — shows Phase 1 in progress, reality is much further
│   ├── DECISIONS.md           ✅ Complete — 8 decisions logged with rationale
│   ├── BUSINESS_MODEL.md      ✅ Complete + updated — unit economics, GTM, rebrand notes
│   ├── RESEARCH.md            ✅ Complete — competitive landscape
│   ├── LEGAL.md               ✅ Complete — license compliance per component
│   └── SHOPIFY_SETUP.md       ❌ MISSING — referenced in AGENT_CONTEXT but does not exist
│
├── drive/                     ← Ships ON the USB drive
│   ├── START_MAC.command      ✅ Fully built, 170 lines
│   ├── START_WINDOWS.bat      ✅ Fully built, 145 lines
│   ├── STOP_BEACON.command    ✅ Built — Mac emergency stop
│   ├── STOP_BEACON.bat        ✅ Built — Windows emergency stop
│   ├── FIRST_RUN_MAC.command  ✅ Built — Gatekeeper quarantine remover
│   ├── FIRST_RUN_WINDOWS.bat  ✅ Built — SmartScreen bypass helper
│   ├── FIRST_RUN_README.txt   ✅ Built — customer-facing setup guide
│   ├── Modelfile              ✅ Complete — BEACON persona (phi3:mini base)
│   ├── config.json            ✅ Complete — master config, single source of truth
│   ├── config.sh              ✅ Complete — shell config (sourced by Mac scripts)
│   ├── config.bat             ✅ Complete — batch config (sourced by Windows scripts)
│   ├── runtime/               ⚠️  EMPTY (gitignored) — binaries not downloaded yet
│   │   └── README.txt + .gitkeep
│   ├── models/                ⚠️  EMPTY (gitignored) — model not downloaded yet
│   │   └── README.txt + .gitkeep
│   ├── prompts/               ❌ EMPTY — referenced in docs but 0 files in it
│   ├── ui/
│   │   ├── index.html         ✅ Complete — 182 lines, anti-flicker system, full layout
│   │   ├── style.css          ✅ Complete — 84KB, full design system
│   │   ├── app.js             ✅ Complete — 625 lines, streaming chat, voice input, RAG
│   │   ├── api.js             ✅ Complete — 248 lines, full API layer
│   │   ├── config.js          ✅ Complete — dynamic config loader with fallback
│   │   └── library.js         ✅ Complete — 1420 lines, full library browser
│   ├── content/
│   │   ├── library.json       ✅ Complete — 326 lines, 6 categories, 25+ items
│   │   ├── catalog_extended.json ✅ Complete — 5 packs (4 free, 1 paid)
│   │   ├── manifest.json      ✅ Present — auto-generated
│   │   ├── books/             ✅ 13 text files present (Bibles, philosophy, law)
│   │   └── zim/               ❌ EMPTY — ZIM files not downloaded
│   ├── knowledge/
│   │   ├── pdfs/              ❌ EMPTY (gitignored, placeholder only)
│   │   └── zim/               ❌ EMPTY (gitignored, placeholder only)
│   └── LEGAL/
│       ├── DISCLAIMER.txt     ✅ Present
│       ├── OLLAMA_LICENSE.txt ✅ Present
│       ├── PHI3_LICENSE.txt   ✅ Present
│       └── OPEN_SOURCE_NOTICES.txt ✅ Present
│
├── scripts/
│   ├── server.py              ✅ Complete — 527 lines, full HTTP + API server
│   ├── setup_drive.sh         ✅ Complete — master assembly script
│   ├── flash_drive.sh         ✅ Complete — rsync to USB with verification
│   ├── download_runtime.sh    ✅ Complete — fetches Ollama binaries (all 3 platforms)
│   ├── download_models.sh     ✅ Complete — downloads Phi-3 Mini GGUF
│   ├── download_content.sh    ✅ Complete — downloads PDFs + ZIM files
│   ├── build_manifest.sh      ✅ Complete — regenerates manifest.json
│   └── dev_test.sh            ✅ Complete — smoke test (host Ollama, not portable binary)
│
└── marketing/
    ├── assets/                ❌ EMPTY — no images generated
    └── copy/                  ❌ EMPTY — no copy written
```


---

## 3. CORE UI — WHAT'S BUILT AND HOW WELL

### index.html ✅ SOLID
- 3-layer anti-flicker: inline script sets `html[data-restore]` before paint → CSS applies immediately → JS loads async. Works correctly.
- Semantic HTML used properly. Mic button hidden by default, shown only if Web Speech API available.
- No favicon — minor but visible in browser tab.

### style.css ✅ SOLID (84KB)
- Full amber/gold tactical design system with CSS custom properties
- Dark background (#0a0e08), amber (#c8a04a), high contrast throughout
- Contains 4 separate patch blocks added over sessions — some `!important` conflicts. Functional but not clean.
- No external fonts (fully offline-safe). All components styled: overlay, typing indicator, Bible nav, manage panel, pack tiles.
- **ISSUE:** Accumulated dead/redundant code from multiple refactor sessions.

### config.js ✅ SOLID
- Loads config.json from server, falls back to hardcoded defaults if unavailable
- **MINOR BUG:** Load order comment in config.js says wrong order (`app.js → library.js`), actual index.html loads `library.js → app.js`. Comment wrong, code correct.

### api.js ✅ SOLID with one bug
- Clean separation — all HTTP calls go here, zero UI logic
- checkOllama, streamChat, getManifest, getStatus, deleteFile, startDownload, getDownloadStatus, cancelDownload all implemented correctly
- **BUG:** `openFile()` references undefined `SERVER_PORT` variable. Should be `CONFIG.uiPort`. Function will throw ReferenceError in strict mode. This means PDF "Open in system viewer" may fail.
- `fetchRemoteCatalog()` points to `cdn.theblackoutdrive.com` — CDN does not exist yet.

### app.js ✅ MOSTLY SOLID (625 lines)
- `checkConnection()` correctly verifies both Ollama running AND blackout-beacon model loaded in `/api/tags`. This is right.
- 12s overlay timeout — overlay CANNOT block UI indefinitely. Good.
- Streaming chat with AbortController cancellation works.
- Custom markdown renderer — handles code blocks, headers, bold, italic, lists. XSS safe (escapes HTML first).
- RAG Tier 2: hits `/api/search` on every send — adds latency even when no results. Should be debounced or conditional.
- Voice input: Web Speech API, auto-sends on recognition end. Error handling for mic denied/no-speech.
- `usePrompt()` correctly guards against offline — shows toast instead of failing silently.

### library.js ✅ FEATURE-COMPLETE, ARCHITECTURALLY MESSY (1420 lines)
- Single monolith. 10+ scattered state variables. No single state object. Works but not maintainable.
- Bible reader: full dual-format parser (KJV/WEB and ASV/YLT). Book sidebar, jump-to-verse, prev/next chapter. Very well built.
- Text reader: Gutenberg boilerplate stripper, section/chapter detection, TOC sidebar. Sophisticated.
- Get More panel: catalog_extended.json packs, FREE/PAID filter, search, download with progress, license key input.
- Manage Space panel: disk usage bar, per-category listing, individual + bulk delete. Fully built.
- **BUG:** `_restoreLibState()` calls `showManageSpace()` (line 57) but function is named `showManagePanel()`. Reload on Manage Space tab = error.
- **BUG:** `cancelPackDownload()` resets action button calling `startPackDownload(this)` where `this` is the button element — but function expects a pack object. Cancel-pack flow broken.
- `showGetMoreHint()` is defined but never called — dead code.
- Inline `onclick=` handlers still in Bible reader HTML. Works but breaks strict CSP.

---

## 4. LAUNCHER SCRIPTS — AUDIT

### START_MAC.command ✅ SOLID with one critical bug
- Auto-detects ARM vs Intel via `uname -m` ✅
- Sources config.sh for all vars ✅
- Checks runtime binary exists, exits with clear error if not ✅
- Checks model file exists, exits with clear error if not ✅
- Checks if Ollama already running (skips startup if so) ✅
- Sets OLLAMA_MODELS, OLLAMA_HOST, OLLAMA_ORIGINS env vars before launching ✅
- Waits up to 45s for Ollama to be ready ✅
- Creates blackout-beacon model on first run via `ollama create` ✅
- Starts Python server, opens browser ✅
- Cleanup trap on SIGINT/SIGTERM — kills UI server and Ollama ✅
- **CRITICAL BUG:** Line 135: `python3 "$REPO_ROOT/scripts/server.py"` — `REPO_ROOT` is NEVER defined in config.sh or anywhere in the script. This will silently expand to `/scripts/server.py` (empty string prefix) and the server will fail to start. The UI will open but no API endpoints will work (no manifest, no search, no downloads). This is a launch-blocking bug.

### START_WINDOWS.bat ✅ SOLID with same bug + logic issue
- Sources config.bat for all vars ✅
- Checks ollama.exe exists ✅
- Checks model file exists ✅
- Checks if already running via curl ✅
- Sets env vars ✅
- Waits up to 30s for Ollama (shorter than Mac's 45s — acceptable) ✅
- **LOGIC ISSUE:** Step 7 runs `ollama run BEACON_MODEL_NAME ""` BEFORE checking if model exists in list. This could cause it to try downloading the base model from internet on a cold drive. The Mac script does this correctly (checks list first).
- **CRITICAL BUG:** Same `%REPO_ROOT%` undefined issue. Line 116: `python "%REPO_ROOT%scripts\server.py"` — REPO_ROOT not defined in config.bat. Server will not start.
- **ISSUE:** Uses `taskkill /f /im python.exe` on shutdown — will kill ALL Python processes on the host machine, not just the one we started. Dangerous on a dev machine.

### FIRST_RUN_MAC.command ✅ SOLID
- Removes com.apple.quarantine xattr from runtime/ and .command files ✅
- Makes .command files executable ✅
- Hands off to START_MAC.command ✅
- Works correctly. Good customer experience.

### FIRST_RUN_WINDOWS.bat ✅ SOLID
- Unblocks with icacls or alternate approach ✅
- Hands off to START_WINDOWS.bat ✅

### STOP_BEACON.command ✅ SOLID
- pkill -f ollama, verifies, force kills if still running ✅
- Does NOT kill Python server — minor gap (server stays running after stop)

### STOP_BEACON.bat ✅ SOLID
- taskkill /f /im ollama.exe ✅

### config.sh ✅ SOLID
- All vars correctly defined. REPO_ROOT is notably ABSENT — this is the root cause of the launcher bug.
- Missing: `REPO_ROOT` needs to be defined as the parent of SCRIPT_DIR (i.e., the repo root)

### config.bat ✅ SOLID (same issue — REPO_ROOT not defined)

---

## 5. SERVER (scripts/server.py) ✅ VERY SOLID

527 lines, stdlib-only Python 3. No external dependencies.

**Endpoints implemented:**
- `GET /api/status` — drive size, free bytes, version ✅
- `GET /api/manifest` — reads manifest.json ✅
- `POST /api/download` — background threaded download with job ID ✅
- `GET /api/download/<id>` — poll download progress ✅
- `DELETE /api/download/<id>` — cancel download ✅
- `DELETE /api/files` — delete file + regenerate manifest ✅
- `GET /api/library-context` — summarizes installed files for LLM RAG injection ✅
- `GET /api/search` — keyword search across content/books/*.txt ✅
- `GET /api/open-file` — shell-opens file in OS native app (open/startfile/xdg-open) ✅
- `GET /*` — static file serving with security path traversal protection ✅
- `OPTIONS *` — CORS preflight ✅

**Security:** Binds only to 127.0.0.1. `_safe_path()` uses `os.path.realpath` + prefix check to prevent directory traversal. Good.

**Download worker:** Threaded, cancel_flag checked in loop, atomic move (temp file → dest), manifest regenerated on complete. Solid.

**ISSUES:**
- Server logs are suppressed by default (`pass` in `log_message`). Fine for production but blind in debugging.
- No rate limiting (not needed for local-only server)
- `GET /api/search` only searches `content/books/*.txt` — not PDFs or ZIM files. RAG misses PDF content.
- `build_manifest()` does a partial MD5 checksum (first+last 64KB). Fast but not cryptographically reliable. Fine for this use case.
- Server must be started from the launcher. If launcher bug (REPO_ROOT undefined) prevents server start, all API endpoints fail silently.

---

## 6. CONTENT LIBRARY — AUDIT

### library.json (drive catalog) ✅ WELL STRUCTURED
6 categories, 25 items total:

| Category | Items | Status |
|---|---|---|
| Holy Bible | 4 translations | KJV preloaded ✅, WEB/ASV/YLT downloadable |
| Survival Manuals | 6 PDFs | All downloadable (army FMs, FEMA, USDA, EPA) |
| Medical & Health | 2 PDFs | Hesperian guides — download URLs point to Hesperian STORE PAGE, not direct PDFs ⚠️ |
| Law & Government | 4 TXTs | Constitution, Declaration, UN Rights, Black's Law |
| Philosophy & Wisdom | 4 TXTs | Marcus Aurelius, Epictetus, Art of War, Plato |
| Wikipedia Offline | 3 ZIMs | All null download_url — ZIM only via setup script |

**ISSUES in library.json:**
- `bible_kjv` marked `preloaded: true` but also `download_url: null` — correct behavior, but `bible_web/asv/ylt` are NOT preloaded. The README claims all 4 Bibles are on the drive. They are NOT — only KJV is preloaded. ASV, WEB, YLT require download. README is misleading.
- `where_no_doctor` and `where_no_dentist` download URLs point to Hesperian STORE pages, not direct PDF links. Download button will fail — browser gets an HTML page, not a PDF.
- `us_constitution` download_url points to Gutenberg file 5/5-0.txt — this is actually the US Constitution and Declaration mixed together. Splitting is awkward.
- `un_rights` download_url points to `pg10000.txt` — this IS the Universal Declaration. ✅
- `blacks_law` download_url points to `55050-0.txt` — needs verification that URL resolves.
- Army FM download URLs point to bits.de — a German military archive. These URLs are fragile (not official, not CDN-backed). High risk of 404 over time.

### catalog_extended.json (packs) ✅ WELL STRUCTURED
5 packs:
1. **Bible Commentary Pack** (free) — Matthew Henry vols 1, 2, NT from Gutenberg ✅ URLs look valid
2. **Extended Medical Pack** (free) — Gray's Anatomy, Merck Materia Medica, Home Nursing from Gutenberg ✅
3. **Homestead & Agriculture Pack** (free) — Culpeper's Herbal, Ten Acres Enough, Farm Rulebook from Gutenberg ✅
4. **Philosophy & Wisdom Pack** (free) — Plato's Republic ⚠️ Only 1 file, should have more
5. **Ham Radio & Emergency Comms Pack** ($4.99 paid) — 3 files pointing to `cdn.theblackoutdrive.com` ❌ CDN DOES NOT EXIST

**ISSUES in catalog_extended.json:**
- Ham Radio pack URLs are dead (cdn.theblackoutdrive.com doesn't exist). Clicking PURCHASE goes to `theblackoutdrive.com/shop/ham-radio-pack` which doesn't exist either. This is the only paid item — it's completely non-functional as a revenue source.
- Philosophy pack has only 1 file (Plato's Republic) but Plato's Republic is ALSO in library.json. Duplicate entry — user could download it twice to different paths.
- No Seneca's Letters (mentioned in backlog as missing).

### Content Files Actually on Drive (content/books/)
13 files present: 4 Bibles (KJV, ASV, WEB, YLT), art_of_war, meditations, enchiridion, plato_republic, us_constitution, declaration_of_independence, matthew_henry (3 vols). All text files, all valid.

**ZIM files: NONE present** — `content/zim/` is completely empty. Wikipedia offline is listed in the library but is unusable without running the setup script.

**PDF files: NONE present** — All PDFs in library.json require download. The drive ships with zero PDFs.

**prompts/ directory: COMPLETELY EMPTY** — The 100+ survival prompts mentioned in AGENT_CONTEXT.md do not exist anywhere in the repo. This is a missing deliverable.

---

## 7. BUILD & DEPLOYMENT SCRIPTS — AUDIT

### download_runtime.sh ✅ SOLID
- Auto-fetches latest Ollama version from GitHub API, falls back to v0.6.8
- Downloads Mac ARM, Mac Intel, Windows binaries
- Extracts correctly (tgz for Mac, zip for Windows)
- **ISSUE:** Ollama macOS release format changed over versions — tgz extraction logic has a fallback but may not work correctly with all release formats. Needs a post-download verification step (check `ollama --version` runs).
- **NOT TESTED** — runtime/ is empty, no evidence this has been run on a real machine.

### download_models.sh ✅ BUILT (not audited in detail — uses standard `ollama pull` approach)

### download_content.sh ✅ BUILT
- Downloads PDFs and ZIM files from various sources
- **NOT TESTED** — knowledge/ directories are empty

### setup_drive.sh ✅ SOLID
- Orchestrates: dependency check → runtime download → model download → content download → integrity verify
- Integrity check covers UI files, config, launchers, legal, runtime binaries (with min size), model (min 2000MB), content dirs
- Good pre-flash checklist. Prints total drive size.
- **ISSUE:** `setup.sh` is referenced in README as the setup command, but the actual script is `setup_drive.sh`. README command `./scripts/setup.sh` will fail — file doesn't exist.
- **ISSUE:** `test_drive.sh` is referenced in README but actual file is `dev_test.sh`. Same problem.

### flash_drive.sh ✅ SOLID
- Takes mount point as arg, validates target isn't system disk
- Checks available space
- Uses rsync with --exclude .git, .DS_Store, etc.
- Sets executable permissions on .command files post-flash
- Verifies key files exist on target after flash
- **ISSUE:** rsync uses `-v` (verbose) — for a 25GB+ flash this will print thousands of lines. Should use `--info=progress2` instead.
- **ISSUE:** Does not eject the drive automatically — leaves it to user. Fine but should be called out.

### dev_test.sh ✅ SOLID (for its purpose)
- Tests Modelfile + persona + UI using HOST Ollama (not portable binary)
- 5-step test: check Ollama installed → check Modelfile → check UI files → build model → smoke test response
- **NOTE:** Uses `python3 -m http.server` (not `scripts/server.py`) — so API endpoints (/api/search, /api/manifest, etc.) are not tested here. Library downloads, search, RAG would all fail during dev_test.
- **BUG:** Config var references `BEACON_MODELFILE` but config.sh exports `BLACKOUT_MODELFILE`. If this was run it would error. (The Mac scripts renamed vars to BLACKOUT_ prefix but dev_test.sh still uses the old BEACON_ names in some spots.)

### build_manifest.sh ✅ EXISTS (not audited in detail — calls server.py manifest logic)

---

## 8. DOCUMENTATION — AUDIT

### docs/AGENT_CONTEXT.md ⚠️ PARTIALLY STALE
- Phase status says Phase 0 "in progress" — it's been done for weeks. Never updated.
- References `START_LINUX.sh` — does NOT exist in the repo.
- References `scripts/setup.sh` — does NOT exist (is `setup_drive.sh`).
- References `scripts/test_drive.sh` — does NOT exist (is `dev_test.sh`).
- References `scripts/build_image.sh` — does NOT exist (is `build_manifest.sh` or `setup_drive.sh`).
- References `scripts/flash_usb.sh` — does NOT exist (is `flash_drive.sh`).
- References `docs/SHOPIFY_SETUP.md` — does NOT exist.
- References `drive/prompts/survival_prompts.md` — does NOT exist.
- References `drive/LEGAL/WIKIPEDIA_ATTRIBUTION.txt` — does NOT exist in LEGAL/.
- Web paths reference `/Users/benjamin/github/the-blackout-drive` (lowercase) — actual path is mixed case.
- **Most dangerous:** New agents reading this doc will have WRONG script names and MISSING file references.

### docs/STATE.md ❌ SEVERELY STALE
- Says "Phase 1 — Committed, Testing" with Phase 2/3/4 not started.
- Reality: Phases 1, 2 core, and significant Phase 3 work is done.
- Only 2 commits listed — actual repo has 20+ commits.
- This doc is essentially useless for a new agent picking up the project.

### docs/DECISIONS.md ✅ GOOD
- 8 decisions logged: persona name, model choice, UI approach, launcher mechanism, content licensing, sales channel order, Modelfile vs fine-tuning, no code signing.
- All accurate and still valid.
- Missing: decisions made during rebrand sessions (BEACON persona rename, theblackoutdrive.com domain) are in BUSINESS_MODEL.md but not in DECISIONS.md. Fragmented.

### docs/BUSINESS_MODEL.md ✅ EXCELLENT (most up-to-date doc)
- Unit economics ✅ (Tier 1 $79, ~78% gross margin)
- Revenue projections (conservative/mediocre/great scenarios) ✅
- Hardware sourcing ✅
- Sales channels (Shopify → Etsy → TikTok → Amazon) ✅
- B2B wholesale strategy ✅
- Faraday pouch upsell idea ✅
- Themed editions (Basecamp/Harvest/Chaplain) ✅
- Rebrand session notes (BEACON persona, domain decision) ✅
- Feature audit (what's working vs not) ✅ — most accurate status doc in the entire repo
- Extensive backlog appended at the end ✅
- **ISSUE:** The backlog at the bottom has checkbox items that are just sitting in a doc. No task.md exists for this project — all tasks are embedded in BUSINESS_MODEL.md which is not a standard task tracker.

### docs/LEGAL.md ✅ SOLID
- Covers Ollama (MIT), Phi-3 (MIT), Wikipedia/Kiwix (CC BY-SA 4.0), public domain PDFs, Hesperian (CC BY-SA)
- Medical disclaimer requirement documented ✅
- **ISSUE:** Hesperian's CC BY-SA license terms require attribution and share-alike. The drive ships the Hesperian books' download links but does NOT currently include a HESPERIAN_LICENSE.txt or HESPERIAN_ATTRIBUTION.txt in LEGAL/. Minor compliance gap.

### docs/RESEARCH.md ✅ GOOD
- Competitive landscape well documented (PortableMind, BunkerAI, OffGrid AI, Docket Mini, Sur5)
- SEO gap analysis documented ✅
- Pricing analysis ✅
- Slightly stale (May 2026 prices, market positions may shift)

### FIRST_RUN_README.txt ⚠️ MINOR ISSUES
- Lists "A Book for Midwives" and "Red Cross Family Disaster Plan" under Medical — neither of these are in library.json or content/books/. They don't exist on the drive.
- Lists "Wikipedia Medicine & Health", "Wikipedia Outdoor & Wilderness", "Wiktionary" — these are ZIM files. They are NOT preloaded. README implies they are on the drive.
- Support URL at bottom: `[your support URL here]` — placeholder not filled in.

---

## 9. WHAT IS ACTUALLY VERIFIED AS WORKING

Based on the current state (server running at localhost:8080, UI loading in browser):

| Feature | Status | Notes |
|---|---|---|
| Chat with BEACON | ✅ VERIFIED WORKING | Ollama + model running, streaming works |
| Status indicator | ✅ VERIFIED | BEACON READY shows when model loaded |
| Overlay dismissal | ✅ VERIFIED | 12s max, dismisses on connect or error |
| Clear conversation | ✅ VERIFIED | Works with confirm dialog |
| Character counter | ✅ VERIFIED | 0/4000 shows, turns red near limit |
| Enter to send | ✅ VERIFIED | Shift+Enter for newline |
| Stop generation | ✅ VERIFIED | STOP button cancels streaming |
| Prompt cards | ✅ VERIFIED | Click fires message if BEACON online |
| Offline toast | ✅ VERIFIED | Shows if prompt clicked while offline |
| Library button | ✅ VERIFIED | Opens panel |
| Library sidebar | ✅ VERIFIED | Categories load from library.json |
| Bible reader | ✅ VERIFIED | KJV readable, chapter navigation, jump |
| Text reader | ✅ VERIFIED | Art of War, Marcus Aurelius, etc. work |
| Library anti-flicker | ✅ VERIFIED | Reload restores correct state |
| Get More panel | ✅ VERIFIED (partial) | Shows packs, FREE filter works |
| Pack download (free) | ✅ VERIFIED (Gutenberg) | Files download, manifest updates |
| Pack download (paid) | ❌ NOT WORKING | CDN doesn't exist, purchase URL dead |
| Manage Space | ✅ VERIFIED | Shows when manifest present |
| File delete | ✅ VERIFIED | Works via API |
| RAG Tier 1 | ✅ VERIFIED | Library context injected on connect |
| RAG Tier 2 | ✅ VERIFIED | Search of .txt files works |
| Voice input (mic) | ✅ VERIFIED (browser support) | Works in Chrome, not all browsers |
| Markdown rendering | ✅ VERIFIED | Bold, lists, code blocks render |

---

## 10. WHAT IS NOT BUILT (Missing / Unstarted)

| Missing Item | Impact | Notes |
|---|---|---|
| 100+ survival prompts file | Medium | Referenced everywhere, zero files in prompts/ |
| Voice/TTS (Whisper + Piper) | Medium | Mic button works for speech-to-text via browser API only. No Whisper offline STT, no Piper TTS for BEACON to speak back. |
| Ham Radio interactive tools | Low (paid feature) | Phonetic trainer, Morse code practice, frequency charts — none built. The content pack is also dead (CDN missing). |
| ZIM file viewer | High | Kiwix ZIM files listed in catalog. No viewer built. Clicking a ZIM item shows a "ZIM panel" placeholder. Files require Kiwix desktop app. |
| Edition switcher UI | Medium | config.json has edition scaffold. No UI to switch between Basecamp/Harvest/Chaplain. No Modelfile.harvest or Modelfile.chaplain exist. |
| Linux launcher (START_LINUX.sh) | Low | Referenced in AGENT_CONTEXT, not built. Linux not supported. |
| Website (The-Blackout-Drive-Web) | HIGH | Zero code written. No Next.js app, no Shopify, no Stripe, no domain, no CDN. The entire e-commerce layer is missing. |
| Shopify store | HIGH | Not set up. The primary sales channel doesn't exist. |
| CDN (cdn.theblackoutdrive.com) | HIGH | Referenced in catalog for paid pack URLs. Cloudflare R2 bucket not created. Ham Radio pack completely non-functional. |
| Domain (theblackoutdrive.com) | HIGH | May not be purchased yet (backlog says "DO THIS NOW"). |
| License key validation | High | Current implementation is localStorage-only stub. No server validates keys. |
| Trademark filing | Medium | Backlog item, not done. |
| Marketing assets | High | marketing/assets/ and marketing/copy/ both empty. No product photos, no TikTok videos, no ad copy, nothing. |
| Physical packaging design | High | Mylar bag, kraft insert card — not designed, not sourced. |
| USB hardware sourced | High | No bulk order placed. No flash station. |
| Support URL in README | Low | Placeholder `[your support URL here]` not filled in. |
| Favicon | Low | No favicon.ico or favicon.svg |
| Gatekeeper bypass video | Medium | Documented as mitigation strategy, not produced |

---

## 11. BUGS CONFIRMED (Code-Level)

| # | Bug | File | Severity | Description |
|---|---|---|---|---|
| B-01 | REPO_ROOT undefined | START_MAC.command, START_WINDOWS.bat | **CRITICAL** | Python server cannot start. All API endpoints broken when launched from USB. |
| B-02 | SERVER_PORT undefined | api.js `openFile()` | HIGH | `openFile()` throws ReferenceError. PDF "open in system viewer" fails. |
| B-03 | Wrong function name | library.js `_restoreLibState()` | MEDIUM | Calls `showManageSpace()` but function is `showManagePanel()`. Reload on Manage tab = error. |
| B-04 | cancelPackDownload broken | library.js | MEDIUM | Passes button element to function that expects pack object. Cancel flow crashes. |
| B-05 | Windows kills all Python | START_WINDOWS.bat | MEDIUM | `taskkill /f /im python.exe` kills every Python process on host, not just ours. |
| B-06 | Wrong model load order | START_WINDOWS.bat | MEDIUM | Runs `ollama run` before checking if model exists. May trigger base model download on cold start. |
| B-07 | dev_test.sh wrong var names | dev_test.sh | LOW | Uses BEACON_ prefix but config.sh uses BLACKOUT_ prefix in some spots. Script may error. |
| B-08 | Hesperian download URLs | library.json | HIGH | `where_no_doctor` and `where_no_dentist` download_url point to store pages, not PDFs. Download will get HTML. |
| B-09 | Army FM URLs fragile | library.json | MEDIUM | PDF links point to bits.de (German archive), not official sources. Will 404 eventually. |
| B-10 | STOP script misses server | STOP_BEACON.command | LOW | Kills Ollama but not Python server. Server keeps running after stop. |
| B-11 | README wrong script names | README.md | MEDIUM | setup.sh and test_drive.sh don't exist. Commands will fail. |
| B-12 | README misleads on content | FIRST_RUN_README.txt | MEDIUM | Lists books/ZIMs that aren't preloaded or don't exist (Midwife book, Red Cross plan). |

---

## 12. WHAT'S BEEN DONE RIGHT (Genuine Strengths)

1. **Architecture is clean and deliberate.** Config is truly a single source of truth — config.json → config.sh → config.bat → config.js all derive from it. Good discipline.

2. **The chat UI is production-quality.** The anti-flicker system is genuinely sophisticated. The connection logic (checking model list, not just Ollama alive) is correct. The overlay timeout is bulletproof.

3. **The library is remarkably feature-complete.** Multi-format Bible parser, Gutenberg boilerplate stripper, TOC detection, download with progress, manage space with delete — this is serious work for a v1.

4. **The server is proper.** Path traversal protection, threaded downloads, atomic file moves, CORS handling, manifest regeneration — stdlib Python with no dependencies that behaves like a real server.

5. **Legal is solid.** MIT and CC BY-SA compliance is documented and license files are on the drive. The medical disclaimer exists.

6. **The AI persona (BEACON) is well-crafted.** The 6-rule Modelfile system prompt is direct, specific, and actionable. The "just answer" rule prevents the preachy ChatGPT style. The faith-friendly framing is smart for the prepper market.

7. **Business model is clear and realistic.** Unit economics (~$17.50 COGS, ~$61 GP at $79) are solid. Three revenue scenarios are honest. B2B wholesale strategy is smart. Faraday pouch upsell is a concrete idea with sourcing notes.

8. **Flash and build workflow is real.** rsync + integrity checks + executable permission restoration is a proper flash workflow. Not just "copy files."

9. **RAG is working.** Two-tier RAG (library context injection + keyword search) in a local offline product is genuinely impressive and differentiated.

10. **Offline resilience throughout.** API calls have timeouts. Fetch errors degrade gracefully. Navigator.onLine gating. No assumption of connectivity anywhere in the UI.

---

## 13. PRODUCTION READINESS ASSESSMENT

### The drive software itself (can it be shipped?)
**NOT YET.** REPO_ROOT bug means the API server doesn't start from a USB launch. RAG, downloads, manifest, search — all broken in the real USB deployment scenario. This is the #1 blocker.

After REPO_ROOT fix: The UI and chat work. The library works for preloaded content. Downloads work in dev (tested from repo). Whether portable Ollama binary runs correctly is **unverified** — the runtime/ folder has never been populated and tested on a real machine.

### Has it been tested on real hardware?
**NO.** All four hardware tests (Win 10, Win 11, macOS ARM, macOS Intel) remain unchecked per STATE.md. The dev_test.sh has been run but it uses HOST Ollama, not the portable binary. The true USB experience has never been tested.

### Business layer (website, store, CDN)?
**ZERO.** The entire commercial infrastructure is missing. No website, no Shopify, no CDN, no domain confirmed purchased, no Stripe, no packaging, no inventory.

### Phase Completion (Honest Assessment)

| Phase | Description | True Status |
|---|---|---|
| 0 — Infrastructure | Repo, docs, GitHub | ✅ 100% done |
| 1 — Core drive build | UI, launchers, model | ✅ 95% done (REPO_ROOT bug, not HW tested) |
| 2 — Content library | Scripts, content | 🟡 60% done (scripts built, content undownloaded, ZIM not working) |
| 3 — Business assets | Copy, imagery, store | ❌ 5% done (unit economics only) |
| 4 — Launch | Sales, shipping, ops | ❌ 0% done |

### What Needs to Happen Before First Sale

**P0 (Blockers — nothing ships without these):**
1. Fix REPO_ROOT bug in START_MAC.command and START_WINDOWS.bat
2. Fix SERVER_PORT bug in api.js openFile()
3. Run download_runtime.sh — populate runtime/ for all 3 platforms
4. Run download_models.sh — get phi3-mini.Q4_K_M.gguf into models/
5. Test full launch sequence on real USB on all 4 OS variants
6. Fix Hesperian download URLs (get direct PDF links)
7. Purchase theblackoutdrive.com domain

**P1 (Required before first sale):**
8. Fix showManageSpace → showManagePanel rename
9. Fix Windows taskkill to use PID not process name
10. Fill in support URL in FIRST_RUN_README.txt
11. Create marketing/copy — at minimum Shopify listing copy
12. Set up Shopify store
13. Source 25+ unit USB bulk order
14. Design and print packaging insert

**P2 (Quality — should be done but can ship without):**
15. Fix cancelPackDownload bug
16. Fix AGENT_CONTEXT.md stale script names
17. Update STATE.md to reflect reality
18. Add prompts/survival_prompts.md (100+ prompts)
19. Create Hesperian and Wikipedia attribution files in LEGAL/
20. Fix README script names (setup.sh → setup_drive.sh)
21. Add favicon
22. CSS cleanup (remove patch blocks, consolidate)
23. Modularize library.js

**P3 (Deferred — post-launch):**
24. Set up CDN (Cloudflare R2) for Ham Radio pack
25. Build real license key validation server
26. Build website (The-Blackout-Drive-Web)
27. Edition switcher UI (Harvest, Chaplain)
28. Voice TTS (Piper) and offline STT (Whisper.cpp)
29. Trademark filing
30. ZIM file viewer (Kiwix integration or custom)
