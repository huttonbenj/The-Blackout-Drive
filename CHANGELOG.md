# Changelog

All notable changes to The Blackout Drive will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.4.0] — 2026-05-21

### Phase 29: V1 Polish & Release Hardening

**Critical Fixes**
- Fixed DM routing: channel broadcasts no longer leak into DM views
  - Root cause: `_commsFilterMessages()` matched `from`/`to` without checking `is_dm`
  - BEACON channel responses no longer appear in node DM conversations
- Emission controls (Radio Silence, GPS TX, Telemetry TX) now persist across reboots
  - Read from `config.json` on boot; written atomically on toggle

**TTS**
- Piper TTS WASM decommissioned (air-gap violation: CDN asset loading, 30s latency)
- Restored native `SpeechSynthesis` as sole TTS engine (instant playback, zero deps)

**COMMS Telemetry**
- Surfaced per-node GPS coordinates (lat/lng/alt) with LIVE/STALE indicators
- Surfaced per-node battery gauge (color-coded) and voltage on roster cards
- Backend `last_heard` timestamps synced to frontend elapsed timers
- Telemetry Tab redesigned: card-based layout, emission control pills, per-node section
- Dispatch Tab redesigned: categorized stats (Operational vs Protection), color-coded roles
- Eliminated 2 redundant API fetches (telemetry/dispatch tabs use cached poll data)

**Docs & Cleanup**
- Updated STATE.md, DECISIONS.md, CHANGELOG.md — removed stale Piper/7-Zip references
- Added ADR-011 (Piper decommission) and ADR-012 (single-radio gateway design)
- Cleaned .gitignore Piper TTS section
- Factory snapshot synchronized to production (10 stale files updated)
- Removed empty `--debug` directory artifact

---

## [1.3.0] — 2026-05-21

### Phase 28: Automated QA & Streaming Crypto

**Security**
- AES-256-CTR + HMAC-SHA256 streaming encryption for large files (>50MB)
  - Eliminates OOM risk — O(1) memory for any file size (2GB+ tested)
  - v2 `.bkv` format with backwards-compatible v1 detection
  - HMAC integrity verification before decryption (authenticate-then-decrypt)
  - Streaming HMAC verification — never loads ciphertext into RAM
  - `decrypt_to_stream()` API — server pipes 64KB chunks directly to HTTP
- Separated encryption and HMAC keys via domain separation (`key + b'ENC'`, `key + b'MAC'`)

**Bug Fixes**
- Fixed locked folder upload crash (`time.time()` → `_time.time()` import alias)
- Fixed DM unread notification badges (were excluded from tracking)
- Fixed DM badge disappearing on poll cycle (`_commsRenderNavNodes` re-applies badge state)
- Fixed COMMS audio not playing for off-filter messages
- Fixed password reset leaving orphaned `comms_log.enc`
- Eliminated temp-file plaintext leak in locked uploads (direct memory read)

**Features**
- Piper TTS WASM integration — offline neural text-to-speech via ONNX Runtime Web
  - Vendored `en_US-lessac-medium` voice model (~63MB) + ONNX Runtime WASM (~11MB)
  - Falls back to browser SpeechSynthesis if WASM initialization fails
  - `scripts/download_piper.py` — one-shot asset fetcher for air-gapped deployment
- DM unread counts persist across page refresh via localStorage
- Registered `.wasm`, `.onnx`, `.data` MIME types for proper TTS asset serving

**DevOps**
- Automated test suite (`test_suite.py`) — zero-dependency backend QA
  - 71 tests: server health, passwords, vault ops, file uploads, conversations,
    COMMS, diagnostics, settings, static assets, CORS, adversarial attacks
  - All tests passing — backend verified CLEAN
- Factory snapshot synchronized to production

---

## [1.2.0] — 2026-05-20

### Phase 26–27: Forensic Architectural Overhaul

**Security**
- Native AES-256-GCM file encryption via libcrypto ctypes (replaces 7-Zip subprocess)
- 1:1 encrypted vault model — each file encrypted individually with UUID filenames
- In-memory decryption for locked file serving (zero temp files on disk)
- Encrypted vault manifest (`.vault_manifest.bkv`)
- Brute-force lockout with disk-persisted state (`.pw_lockout.json`)
- X-Password auth gate on system file modifications (server.py, model_setup.py)
- COMMS store re-keying on password change

**Features**
- Full Workspace parity: Locked tab behaves identically to Unlocked
- IDE explorer mode for locked vault files (read-only)
- Binary file viewers in IDE (images, PDFs, EPUBs)
- Engine editor disclaimer modal with factory restore guidance

---

## [1.1.0] — 2026-05-18

### Phases 19–25: COMMS Integration & Security Hardening

**Features**
- COMMS panel: Tactical mesh radio integration via Meshtastic/protobuf
  - Four-channel support with per-channel filtering
  - Direct messaging with per-node routing
  - Node roster with activity tracking and sparkline telemetry
  - Classification heat ribbon (ALERT, PRIORITY, ROUTINE)
  - Web Audio API procedural sound effects (RX chirp, TX confirm, alert)
  - Quick-reply tactical presets + SOS
  - Encrypted vault for message persistence
- Tactical Navigator with offline map capabilities
- Cipher Studio (Caesar, Vigenère, Atbash, ROT13)
- Survival Calculators (water purification, solar positioning)
- Medical Timers and Emergency Checklists
- Ham Radio tools (Morse trainer, frequency charts, phonetic alphabet)

**Security**
- Server-side EULA enforcement gate
- DM routing isolation across entire stack
- Session-based password caching with multi-tab resilience
- Persistent safety disclaimers in chat + COMMS
- Intercom/Earpiece AI response routing

**Quality**
- Combinatorial cross-navigation matrix testing
- Red Team Chaos Suite (V-01 through V-10)
- Performance: Ollama model caching and GPU memory management
- GPS staleness indicator with relative timestamps

---

## [1.0.0] — 2026-05-17

### Initial Release — "Basecamp Edition"

**Core**
- BEACON offline AI engine powered by Qwen3 (4B/8B, auto-selected by RAM)
- Custom Ollama Modelfile with layered system prompt (identity, tuning, device facts)
- Python 3 stdlib HTTP server — zero pip dependencies
- Cross-platform: Windows 10/11, macOS (ARM + Intel), Linux

**Security**
- Master password with PBKDF2-SHA256 hashing (600K iterations)
- AES-256-GCM encrypted chat history (browser-side, Web Crypto API)
- AES-256-GCM encrypted file vault (Locked files)
- Blackout Protocol — one-click toggle enforcing Network Lock + Encrypt Chat History
- Localhost-only server binding (127.0.0.1)
- Path traversal protection on all file operations
- Prompt injection defense in BEACON persona

**Features**
- Offline Reference Library with built-in EPUB and text reader
- Scripture reader with book/chapter/verse navigation (KJV, WEB, ASV, YLT)
- Workspace with Unlocked and Locked (encrypted) file storage
- Monaco code editor (air-gapped, no CDN)
- 113 curated prompts across 11 knowledge domains
- Conversation history with save, export, and purge
- Font size settings (Small / Default / Large)
- Text-to-speech for AI responses
- Voice input via browser microphone
- Diagnostics panel with system health reporting
- Performance metrics logging (TTFT, tok/s)

**Content**
- 48 offline reference files (books, manuals, field guides)
- Content catalog with R2-backed download system
- Full-text search index for library content

**DevOps**
- Automated flash script with post-flash verification
- Model rebuild script with tier auto-detection
- Factory reset via EMERGENCY_RESTORE.sh
- GitHub Actions CI (Python lint, JS lint, content URL health check)

