# THE BLACKOUT DRIVE — SOURCE OF TRUTH

> **Purpose:** This document is the single, canonical reference for what The Blackout Drive is, what it does, what it claims, what technology it uses, and the rules governing all branding, documentation, and code. Any AI agent, developer, or contributor working on this project must read this document before making changes.

> **Last Updated:** May 28, 2026
> **Maintained By:** Benjamin Hutton / Hutton Technologies LLC

---

## 1. WHAT THE PRODUCT IS

### 1.1 One-Sentence Description
The Blackout Drive is a plug-and-play USB drive with an offline AI assistant, encrypted file storage, an offline reference library, and mesh radio communications — designed for environments with no internet access.

### 1.2 What We Built vs. What We Integrated

| Component | Did We Build It? | What We Did | Attribution Required |
|-----------|-----------------|-------------|---------------------|
| BEACON (the AI chat interface, system prompts, UI) | ✅ Yes | Built the chat UI, prompt engineering, system integration | Our IP |
| Qwen3 (the AI model) | ❌ No | Packaged it to run offline from the drive | Alibaba Cloud, Apache 2.0 |
| Ollama (the AI runtime) | ❌ No | Bundled it, configured it to run portably | Ollama Inc, MIT License |
| Mesh radio communications | ❌ No (protocol) / ✅ Yes (integration) | Built the COMMS UI and dispatch engine; the radio protocol is Meshtastic | Meshtastic Project, GPL v3 |
| LoRa radio hardware | ❌ No | We sell Heltec V3 radios in our Mesh Bundle — we didn't design or manufacture them | Heltec Automation |
| Encryption (AES-256-GCM) | ✅ Yes (implementation) | Built the vault, key derivation, file encryption pipeline | Uses standard cryptographic primitives |
| Library content (books) | ❌ No | Curated and packaged public domain works | Public domain / open access |
| Monaco code editor | ❌ No | Embedded it for file editing | Microsoft, MIT License |
| Python server (server.py) | ✅ Yes | Built the entire HTTP server and API | Our IP |
| All launcher scripts | ✅ Yes | Built for Windows, Mac, Linux (Linux experimental/untested for V1) | Our IP |
| All UI (HTML/CSS/JS) | ✅ Yes | Built everything | Our IP |

### 1.3 What It Is NOT
- NOT a medical device
- NOT a military product (even though it's useful in field/tactical environments)
- NOT a phone or communications device on its own (requires separate radio hardware)
- NOT cloud-powered (zero cloud dependency)
- NOT a product that collects any user data

---

## 2. BRANDING RULES

### 2.1 Terminology — ALWAYS Use

| Term | Context | Example |
|------|---------|---------|
| The Blackout Drive | Full product name | "The Blackout Drive is a USB drive…" |
| BEACON | The AI assistant | "Ask BEACON a question" |
| Mesh / mesh radio / mesh communications | Radio feature | "mesh communications via LoRa radio" |
| Meshtastic | The protocol/firmware the radios run | "built on the open-source Meshtastic protocol" |
| LoRa | The radio technology | "LoRa mesh radio" |
| AES-256-GCM | Our encryption standard | "encrypted with AES-256-GCM" |
| Qwen3 | The AI model | "powered by Qwen3" |
| Ollama | The AI runtime | "running via Ollama" |
| Network Lock | The setting that blocks internet | "Network Lock blocks all internet connections" |
| Blackout Protocol | The master security toggle | "Blackout Protocol forces Network Lock + Encrypt History" |
| Radio Silence | The setting that stops radio TX | "Radio Silence suspends all radio transmission" |
| offline AI engine | What BEACON is | "BEACON, the offline AI engine" |
| Tactical Navigator | One of the six tools — proper noun | "the Tactical Navigator tool" |
| Cipher Studio | One of the six tools — proper noun | "Cipher Studio provides AES-256-GCM encryption" |

### 2.2 Terminology — NEVER Use (Unless Factually Accurate in Context)

| Banned Term | Why | Exception |
|-------------|-----|-----------|
| "sovereign intelligence engine" | Inflated, implies autonomous authority | None |
| "military-grade" | Marketing hyperbole — AES-256 is a standard, not a military grade | Can say "AES-256-GCM, which is the same standard used by governments and militaries" |
| "tactical mesh" / "tactical LoRa mesh" | Implies we built a tactical network — we didn't | "Tactical Navigator" is a tool name (proper noun), that's fine |
| "our mesh network" / "a mesh network" | We don't own or operate a mesh network — users create their own | "mesh radio integration" or "mesh communications via Meshtastic" |
| "zero-knowledge encryption" | Has a specific cryptographic meaning we don't satisfy | "we do not have your password and cannot decrypt your data" |
| "impenetrable" / "unbreakable" | No encryption is unbreakable | "AES-256-GCM encryption" (let the standard speak for itself) |
| "battlefield" | Militaristic — we don't make military products | None |

### 2.3 Where "tactical" IS Acceptable
The word "tactical" is fine when used as:
- **A tool name:** "Tactical Navigator" (proper noun)
- **A category name:** "Tactical & Security" (prompt category)
- **A UI design term in code comments:** "tactical theme" (internal developer shorthand, never user-facing)
- **Factual context about data:** "do not fabricate tactical data" (referring to military/field data that BEACON shouldn't hallucinate)

The word "tactical" is NOT acceptable when used to:
- Describe the mesh network → use "off-grid mesh" instead
- Describe the product's purpose → describe it factually
- Market the product → avoid militaristic framing

### 2.4 Core Honesty Principles
1. **Never imply we created something we didn't.** We didn't create Qwen3, Ollama, Meshtastic, the mesh network, or LoRa. We integrated them.
2. **Never exaggerate security claims.** Say what the encryption standard is. Don't call it "impenetrable" or "military-grade."
3. **Never claim features we don't have.** If it doesn't exist in code, don't say it does.
4. **Prefer plain language alongside technical terms.** Users range from zero-technical to expert.
5. **If a setting says it "blocks" something, it must actually block it in code.** This is a legal requirement.

---

## 3. PRIVACY & DATA CLAIMS — VERIFIED AGAINST CODE

### 3.1 Master Claim: "Zero Data Collection"
**STATUS: ✅ VERIFIED**

- `server.py` contains zero analytics, tracking, or external reporting code
- Frontend JS contains zero Google Analytics, Sentry, Mixpanel, or any tracking
- No cookies are set by our code
- No fingerprinting code exists

### 3.2 Network Lock
**STATUS: ✅ VERIFIED**

- **Implementation:** `api.js` → `isOnline()` requires BOTH `navigator.onLine` AND `isOnlineModeEnabled()` to return true
- **Default:** ON (blocks all connections by default)
- **Coverage:** All external fetch calls in the frontend check `DDAPI.isOnline()` before executing
- **Update check:** Directly checks the `settingNetworkLock` toggle
- **Server-side:** The server itself only makes ONE external request: the update check (`server.py` line 1538), which only fires when the frontend explicitly calls `/api/update/check`

### 3.3 Radio Silence
**STATUS: ✅ VERIFIED (with wording caveat)**

- **Implementation:** `comms/__init__.py` → blocks TX at both dispatch (line 488) and send_text (line 512-514)
- **What it actually does:** Blocks all OUTBOUND radio transmission. The serial reader thread continues running (listening for incoming packets), but incoming messages are not forwarded to the dispatch engine.
- **Accurate wording:** "No data is transmitted over the radio hardware, and incoming messages are not processed or stored."
- **INACCURATE wording:** "No data is transmitted or received" — the radio hardware still physically receives RF; the software just ignores it.

### 3.4 Server Binding
**STATUS: ✅ VERIFIED**

- `server.py` line 4439: `ThreadingHTTPServer(('127.0.0.1', PORT), ...)` — hardcoded to localhost
- Cannot be accessed from other machines on the network

### 3.5 Update Mechanism
**STATUS: ✅ VERIFIED**

- The ONLY external request made by the server: a GET to the update manifest URL
- The ONLY data sent: `User-Agent: BlackoutDrive/1.0.0` (the version string)
- No personal data, device identifiers, or user content is ever transmitted

### 3.6 Ollama Privacy
- Ollama runtime binds to `127.0.0.1` (our launcher scripts set `OLLAMA_HOST`)
- `OLLAMA_NO_CLOUD=1` is set in all launchers (prevents cloud model access)
- `OLLAMA_NOHISTORY=1` is set in all launchers (prevents history file on host)
- `OLLAMA_MODELS` points to the USB drive, not the host machine
- `OLLAMA_HOME` points to the USB drive

### 3.7 What IS Stored on the Host Machine
- **localStorage:** UI preferences (Night Vision, font size, Network Lock toggle, Developer Mode). Stored in the browser's profile for `http://127.0.0.1:PORT`. Contains zero sensitive data. Clears when browser cache is cleared.
- **Ollama home:** Directed to the USB drive via `OLLAMA_HOME` env var.
- **Browser cache:** Standard browser caching of static assets. Ephemeral.
- **IMPORTANT:** The privacy policy says "Settings — saved as JSON files on the drive only" — this refers to `config.json`, not localStorage. This is technically accurate because config.json is the persistent settings store; localStorage is ephemeral UI state.

---

## 4. ARCHITECTURE OVERVIEW

### 4.1 System Components
```
USB DRIVE
├── drive/
│   ├── README.txt                  # User-facing root readme
│   ├── USER_DATA/                  # User's personal files
│   └── _system/
│       ├── server.py               # Python HTTP server (the core)
│       ├── config.json             # Master configuration (single source of truth)
│       ├── config.sh / config.bat  # Launcher config (derived from config.json)
│       ├── START_MAC.command       # macOS launcher
│       ├── START_LINUX.sh          # Linux launcher
│       ├── START_WINDOWS.bat       # Windows launcher
│       ├── model_setup.py          # Auto-detects hardware, picks best model
│       ├── models/                 # AI model files (GGUF format)
│       ├── runtime/                # Ollama binaries (per-platform)
│       ├── profiles/               # AI system prompts
│       │   ├── base/               # 4B model prompts
│       │   ├── max/                # 8B model prompts
│       │   └── _shared/            # Shared context (device_facts.txt)
│       ├── comms/                  # Mesh radio subsystem (Python)
│       ├── ui/                     # Frontend (HTML/CSS/JS)
│       │   ├── index.html          # Main HTML
│       │   ├── style.css           # Design system
│       │   ├── app.js              # Core application logic
│       │   ├── api.js              # API client (includes Network Lock gate)
│       │   ├── library.js          # Library/reader/GET MORE
│       │   ├── workspace.js        # File manager + code editor
│       │   ├── comms.js            # COMMS panel UI
│       │   ├── cipher.js           # Cipher Studio tool
│       │   ├── hamradio.js         # Ham Radio toolkit
│       │   ├── navigator.js        # Tactical Navigator
│       │   └── ... (other tools)
│       ├── LEGAL/                  # All legal documents
│       ├── _factory/               # Factory restore copies
│       ├── content/                # Library content (books, etc.)
│       └── data/                   # Runtime data (logs, models, etc.)
```

### 4.2 Boot Sequence
1. User double-clicks launcher → script runs
2. Script reads `config.json` → determines model, ports, settings
3. `model_setup.py` auto-detects hardware tier (base/max) → generates Modelfile
4. Ollama starts → binds to `127.0.0.1:OLLAMA_PORT`
5. `server.py` starts → binds to `127.0.0.1:UI_PORT`
6. Browser opens → UI loads
7. Ollama imports model → warms into GPU memory
8. BEACON is ready

### 4.3 Configuration Architecture
There are **two config.json files** with different purposes:

| File | Purpose | Mutable? |
|------|---------|----------|
| `_system/config.json` | System defaults + template. Read by the frontend (`config.js`). Contains app metadata, model settings, network ports, content URLs. | Only changed by developers |
| `USER_DATA/config.json` | Runtime settings. Read/written by `server.py`. Contains EULA acceptance, COMMS dispatch role, and user-modified settings. | Modified at runtime |

The frontend loads `_system/config.json` via HTTP. The server's `_CONFIG_PATH` points to `USER_DATA/config.json` for runtime state. If `USER_DATA/config.json` doesn't exist, the server bootstraps from the system config.

### 4.4 Key Design Decisions
- **Portable:** Everything runs from the USB drive. Nothing is installed on the host.
- **Offline-first:** Network Lock defaults to ON. The system works with zero internet.
- **Password is optional:** The drive works fully without a master password. Password is only prompted when the user first enables an encryption feature.
- **Factory restore:** The `_factory/` directory contains pristine copies of all system files. `EMERGENCY_RESTORE` scripts copy them back. User data is NEVER touched by a factory reset.
- **Atomic writes:** All config/conversation writes use `_safe_atomic_replace()` with .tmp staging to prevent corruption on USB eject. Boot-time recovery promotes orphaned .tmp files.
- **EULA gate:** Server-side enforcement — functional API routes are blocked until the user clicks "I UNDERSTAND AND AGREE" on first run. Persisted to `USER_DATA/config.json`.

---

## 5. FEATURES — VERIFIED LIST

| Feature | Status | Description |
|---------|--------|-------------|
| BEACON (AI Chat) | ✅ Shipping | Offline AI assistant, powered by Qwen3 via Ollama |
| Library | ✅ Shipping | Offline book reader with EPUB support, "Ask BEACON" RAG |
| Workspace | ✅ Shipping | File manager with Unlocked + Locked (encrypted) tabs |
| COMMS | ✅ Shipping | Mesh radio panel with node tracking, messaging, AI dispatch |
| Tools (6) | ✅ Shipping | Ham Radio, Tactical Navigator, Cipher Studio, Survival Calc, Medical Timers, Prep Checklists |
| Prompts | ✅ Shipping | 100+ curated prompts across 11 categories |
| Chats | ✅ Shipping | Save, encrypt, export, import conversations |
| Blackout Protocol | ✅ Shipping | One-click: forces Network Lock + Encrypt History ON |
| Network Lock | ✅ Shipping | Blocks all internet connections (default: ON) |
| Radio Silence | ✅ Shipping | Suspends all radio transmission |
| Night Vision Mode | ✅ Shipping | Red color palette for low-light use |
| Developer Mode | ✅ Shipping | Shows THE ENGINE (system file editor) in Workspace |
| Software Updates | ✅ Shipping | Manual check + download from Settings |
| Factory Reset | ✅ Shipping | Full wipe + restore to factory state |
| Master Archive | ✅ Shipping | Export/import full drive backup |
| Voice (TTS + STT) | ✅ Shipping | Text-to-speech + microphone input |

---

## 6. LEGAL DOCUMENTS — STATUS

| Document | Location | Synced with Code? |
|----------|----------|-------------------|
| Privacy Policy | `LEGAL/PRIVACY_POLICY.txt` | ✅ Verified |
| Terms of Service | `LEGAL/TERMS_OF_SERVICE.txt` | ✅ Verified |
| Medical Disclaimer | `LEGAL/DISCLAIMER.txt` | ✅ Verified |
| Open Source Notices | `LEGAL/OPEN_SOURCE_NOTICES.txt` | ✅ Verified |
| BSL 1.1 License | `LICENSE` (root) | ✅ |
| Web Privacy Page | `The-Blackout-Drive-Web/src/app/privacy/page.tsx` | ⚠️ NEEDS SYNC (see Section 8) |

---

## 7. REPOSITORIES

| Repo | Purpose | Branch |
|------|---------|--------|
| `The-Blackout-Drive` | The product (USB drive contents) | `main` |
| `The-Blackout-Drive-Web` | Marketing website (theblackoutdrive.com) | `main` |

---

## 8. KNOWN ISSUES — REMAINING FIXES NEEDED

### 8.1 ✅ pyserial — RESOLVED
pyserial is now attributed in `OPEN_SOURCE_NOTICES.txt` (BSD-3-Clause, Chris Liechti).

### 8.2 🔴 Web Privacy Page Out of Sync
**File:** `The-Blackout-Drive-Web/src/app/privacy/page.tsx`
- Line 126-127: still says "transmitted or received" (drive version was fixed)
- Missing: Ollama runtime disclosure (Section 4)
- Section numbering differs from drive

### 8.3 🔴 Radio Silence Wording — 5 Locations
"transmitted or received" → "no data is transmitted, and incoming messages are not processed or stored"
- `profiles/_shared/device_facts.txt:13` (feeds BEACON's responses)
- `_factory/profiles/_shared/device_facts.txt:13`
- `ui/comms.js:489`
- `_factory/ui/comms.js:489`
- `Modelfile.generated:74` (auto-generated)

### 8.4 🟡 tuning.txt — "tactical off-grid mesh"
`profiles/base/tuning.txt:22`, `profiles/max/tuning.txt:22` + factory copies

### 8.5 🟡 Network Lock Description Incomplete
`ui/index.html:251` — says "only needs to be off if you want to download new library content" but omits software updates.

### 8.6 🟡 "TACTICAL TOOLKIT" heading in tools.js
Recommendation: change to "TOOLKIT".

### 8.7 🟡 Shopify TODO Placeholders in Web Repo
`The-Blackout-Drive-Web/src/app/page.tsx:40,50` — Mesh Bundle product IDs are `TODO_SHOPIFY_ID_*`.

### 8.8 🟡 No Safe Ejection Guidance
Help panel and FIRST_RUN_README don't warn users to shut down before unplugging.

### 8.9 🟡 No Support Contact in Product UI
Help panel has no support email or website link.

### 8.10 🟡 No CHANGELOG File
No version history document for users who update.

### 8.11 🟢 Privacy Policy Date
`PRIVACY_POLICY.txt:3` says "May 17, 2026" but substantive changes have been made since.

### 8.12 🟢 __pycache__ Cleanup for Production
68+ .pyc files ship on the drive (including test_suite and test_harness). Need build-step cleanup.

---

## 9. SETTINGS → CODE VERIFICATION MAP

Every user-facing setting must have a verified code path that does what it says.

| Setting | Claim | Code Location | Verified? |
|---------|-------|---------------|-----------|
| Network Lock | "Blocks all internet connections" | `api.js` → `isOnline()` gates all external fetch | ✅ |
| Blackout Protocol | "Forces Network Lock + Encrypt History ON" | `app.js` → `_onBlackoutProtocolChange()` | ✅ |
| Encrypt Chat History | "Encrypts saved conversations with master password" | `app.js` → AES-256-GCM via Web Crypto API | ✅ |
| Save Chat History | "Saves conversations to drive" | `app.js` → writes to `data/chats/` | ✅ |
| Radio Silence | "Suspends all radio transmission" | `comms/__init__.py` → blocks TX | ✅ |
| Night Vision Mode | "Red color palette for low-light" | `app.js` → CSS variable swap | ✅ |
| Developer Mode | "Shows THE ENGINE in Workspace" | `workspace.js` → localStorage gate | ✅ |
| Hardware Diagnostics HUD | "Live overlay with memory/GPU/token speed" | `app.js` → polls `/api/diagnostics` | ✅ |
| Font Size | "Adjusts text size" | `app.js` → CSS class toggle | ✅ |
| Auto-read responses | "TTS reads BEACON's answers" | `app.js` → Web Speech API | ✅ |

---

## 10. THIRD-PARTY ATTRIBUTION CHECKLIST

Every third-party dependency must be properly attributed in `OPEN_SOURCE_NOTICES.txt`.

| Component | Attributed? | License |
|-----------|-------------|---------|
| Ollama | ✅ | MIT |
| Qwen3 | ✅ | Apache 2.0 |
| Monaco Editor | ✅ | MIT |
| epub.js | ✅ | BSD-2 |
| JSZip | ✅ | MIT |
| marked.js | ✅ | MIT |
| Highlight.js | ✅ | BSD-3 |
| 7-Zip | ✅ | LGPL + BSD |
| CPython (Windows) | ✅ | PSF |
| Meshtastic | ✅ | GPL v3 |
| **pyserial** | **❌ MISSING** | **BSD-3** |
| Heltec V3 hardware | N/A | N/A (hardware, not software) |

---

## 11. DESIGN LANGUAGE

### 11.1 Color System
- **Primary accent:** Amber/Gold (`#c8a04a` / `var(--amber)`)
- **Secondary data:** Teal/Cyan (`var(--cyan)`)
- **Background:** Deep dark (`#0a0a0a` → `#121212`)
- **Text:** White with opacity levels for hierarchy
- **Danger:** Red tones for destructive actions
- **Night Vision:** Deep red monochrome palette

### 11.2 Typography
- **Body:** System sans-serif stack
- **Mono:** JetBrains Mono / Fira Code / Cascadia Code / Consolas
- **UI Labels:** UPPERCASE, letter-spacing, monospace

### 11.3 Aesthetic
- Clean, dark, utilitarian — NOT flashy or gamified
- Inspired by intelligence dashboards and field terminals
- No rounded bubbly UI — sharp edges, grid layouts
- Corner brackets as decorative elements
- Minimal color — mostly monochrome with amber accents

---

## 12. BUSINESS CONTEXT

### 12.1 Company
- **Name:** Hutton Technologies LLC
- **State:** Mississippi
- **Contact:** support@theblackoutdrive.com / support@theblackoutdrive.com

### 12.2 License
- **Software:** Business Source License 1.1 (BSL 1.1)
- **Change Date:** May 7, 2030 → converts to Apache 2.0
- **Restriction:** Cannot use to create a competing product

### 12.3 Product SKUs
- **Core Edition** (64GB) — USB drive only — $69
- **Core Edition** (128GB) — USB drive only — $99
- **Basecamp Bundle** (64GB) — Drive + 1x pre-flashed Heltec V3 radio + antenna + cable — $119
- **Basecamp Bundle** (128GB) — Drive + 1x pre-flashed Heltec V3 radio + antenna + cable — $149
- **Field Kit** (64GB) — Drive + 2x pre-flashed Heltec V3 radios + antennas + cables — $169
- **Field Kit** (128GB) — Drive + 2x pre-flashed Heltec V3 radios + antennas + cables — $199
- **Field Node** (add-on, no drive) — 1x pre-flashed Heltec V3 radio + antenna + cable — $45

### 12.4 Website
- `theblackoutdrive.com` — Next.js + Tailwind, hosted separately
- Uses Shopify for checkout (disclosed in web privacy page)

---

## 13. RULES FOR AI AGENTS

Any AI agent working on this project MUST:

1. **Read this document first** before making any changes
2. **Never add marketing buzzwords** — see Section 2.2
3. **Never claim we created something we integrated** — see Section 1.2
4. **Verify every privacy claim against code** before changing documentation
5. **Keep the `_factory/` directory synchronized** when modifying system files
6. **Regenerate `Modelfile.generated`** if modifying any files in `profiles/`
7. **Keep the web repo synchronized** when changing the drive's legal documents
8. **Test all settings toggles** to ensure they actually do what they claim
9. **Use plain language** alongside technical terms — our users range from non-technical to expert
10. **Never remove existing comments or documentation** unless explicitly instructed
11. **Clean `__pycache__/` directories** before building production USB drives
12. **Update the "Last Updated" date** in PRIVACY_POLICY.txt when making substantive changes

---

## 14. PRODUCTION BUILD NOTES

Before copying the `drive/` directory to a physical USB drive for shipping:

```bash
# Remove Python bytecode caches (platform-specific, bloat)
find drive/ -name "__pycache__" -type d -exec rm -rf {} +

# Remove macOS metadata files
find drive/ -name ".DS_Store" -delete
find drive/ -name "._*" -delete

# Verify no test files ship
find drive/ -name "test_*" -type f  # Should return nothing

# Verify SOURCE_OF_TRUTH.md is excluded from customer drives
# (this is an internal document, not for end users)
```

---

## 15. SUPPORT & CONTACT INFO

| Channel | Address |
|---------|--------|
| General support | support@theblackoutdrive.com |
| Legal inquiries | support@theblackoutdrive.com |
| Website | theblackoutdrive.com |

---

*This document is the canonical reference. When in doubt, check the code. When the code and this document disagree, the code is the ground truth — update this document to match.*
