# Project State — The Blackout Drive

> Last updated: 2026-05-13

## Current Version: 1.0.0 ("Basecamp Edition")

### Status: ✅ Gold Master — Production Ready

The V1 codebase is feature-complete, audited, and verified for USB deployment.

---

## V1 Feature Status

### Core
- [x] Ollama engine (Mac ARM, Mac Intel, Windows)
- [x] BEACON AI persona (custom Modelfile)
- [x] Qwen3 4B (~2.3GB) + Qwen3 8B (~5.1GB) — adaptive auto-detection by host RAM
- [x] Streaming chat responses
- [x] Context window sliding (6 messages) with token budget estimator

### Launchers
- [x] macOS launcher (START_MAC.command)
- [x] macOS native app wrapper (The Blackout Drive.app)
- [x] Windows launcher (START_WINDOWS.bat)
- [x] Linux launcher (START_LINUX.sh)
- [x] Stop scripts (Mac/Win)
- [x] First-run setup scripts

### Chat UI
- [x] Dark theme with amber/gold design system
- [x] Markdown rendering (headers, bold, italic, code, lists)
- [x] Typing indicators
- [x] Welcome screen with 6 starter prompts
- [x] Connection overlay with auto-dismiss
- [x] Status indicator (green=ready, amber=not running)
- [x] Character counter (4000 limit)
- [x] Auto-resize textarea
- [x] Send/Stop toggle
- [x] Retry button on failures
- [x] Keyboard shortcuts (Cmd+K/L/P, Escape)
- [x] Toast notifications
- [x] Anti-flicker 3-layer system
- [x] First-run onboarding overlay

### Voice
- [x] Voice input (Web Speech API)
- [x] Text-to-speech per message
- [x] Auto-read mode
- [x] TTS speed control (0.75×/1×/1.25×)

### Conversations
- [x] Auto-save (debounced after each exchange)
- [x] Session persistence (survives refresh)
- [x] Conversation list panel
- [x] Load/resume conversations
- [x] Delete conversations
- [x] New conversation
- [x] Encrypted chat history (AES-256-GCM, Single Ecosystem Key)
- [ ] Encrypted export/import (AES-256 conversation archives)

### Library
- [x] Category browser with sidebar
- [x] EPUB reader with chapter navigation
- [x] TXT reader
- [x] PDF viewer (opens in OS app)
- [x] Bible reader (OT/NT, book/chapter nav)
- [x] Text search in reader
- [x] File download from R2 with progress
- [x] Manage Space (delete + restore)
- [x] GET MORE panel
- [x] MY FILES panel (Standard Storage + Encrypted Storage)
- [x] Pack download (bulk)
- [x] Manifest auto-regeneration

### RAG / Search
- [x] Text index builder (EPUB extraction)
- [x] TF-IDF keyword search
- [x] RAG injection into chat context
- [x] Library context injection

### Settings & Diagnostics
- [x] Auto-save toggle
- [x] Auto-read toggle
- [x] Speech speed select
- [x] Font size select
- [x] Network Lock toggle with confirmation modal
- [x] Blackout Protocol master switch (forces Network Lock + Encrypt History ON)
- [x] Diagnostics panel (Ollama status, disk, platform)

### Infrastructure
- [x] Cloudflare Worker (catalog API)
- [x] R2 bucket (content CDN)
- [x] Flash drive script
- [x] GitHub repository

---

## V2 Features (Planned — Not Implemented)

These are planned features with zero implementation:

### 1. The Persona Switcher
**Concept:** Introduce a UI toggle allowing users to switch the active AI system prompt.
**Personas:**
- **BEACON:** The default, curated expert in off-grid operations, medicine, and localized engineering.
- **SCHOLAR:** An academic persona strictly tuned for searching the offline Kiwix Wikipedia and historical/philosophical texts.
- **CODER:** A strictly technical persona optimized for privacy-focused developers.

### 2. Bundled Local Client & Native Document Parsing
**Concept:** Transition from the V1 zero-dependency pure Python server to a fully bundled, cross-platform local client (e.g., Electron or Tauri) for V2.
**Capability:** This will allow us to safely vendor PDF parsing libraries (like pdfminer or PyMuPDF) directly into the binary. Users will be able to drop their own personal PDFs and manuals into the drive and have the AI read them locally, without ever risking a pip install failure in an offline, zero-connectivity scenario.

### 3. Diagnostic Vision (Multimodal AI)
**Concept:** Add image/camera input for visual analysis queries (e.g., "What plant is this?", "Assess this wound", "Identify this component").
**Requires:** Multimodal GGUF model (e.g., LLaVA or equivalent), camera/image upload UI, model selection logic.

### 4. Secure Local Mesh (Network Broadcasting)
**Concept:** Serve BEACON over local Wi-Fi to phones and tablets without internet. The host machine acts as a local server, allowing multiple devices to access the AI through a browser.
**Requires:** Bind server to `0.0.0.0`, responsive mobile UI, QR code for easy connection, optional shared passphrase, multi-client Ollama concurrency.

### Additional Features

- [ ] Knowledge base (custom document RAG)
- [ ] Multi-model support (switch between models)
- [ ] Wikipedia offline (ZIM files)
- [ ] Benchmarking suite
- [ ] Auto-update from GitHub releases
- [ ] Ham Radio tools (Morse trainer, frequency reference)

---

## Product Editions

| Edition | Capacity | Price | Contents |
|---------|----------|-------|----------|
| **Standard** | 64GB | $89 | BEACON engine, prompts directory, essential text/code-based offline library (survival PDFs, medical text, code documentation) |
| **Professional** | 128GB | $169 | Everything in Standard + high-res medical diagrams, geospatial/topographical maps, CAD blueprints, instructional video archives |

Both editions run the **exact same adaptive BEACON software**. The AI auto-detects host hardware (RAM) and selects the optimal model (Qwen3 4B or 8B). The product tiers are differentiated purely by storage capacity and library payload.

---

## Content Library (41 files, ~102MB) — Standard Edition Baseline

| Category | Count | Formats |
|----------|-------|---------|
| Bible | 4 | .txt |
| Classic Literature | 6 | .epub |
| Homestead & Self-Reliance | 6 | .epub |
| Law & Rights | 6 | .epub |
| Medical & First Aid | 6 | .epub, .pdf |
| Philosophy & Wisdom | 6 | .epub |
| Emergency Preparedness | 1 | .pdf |
| Survival & Field Craft | 6 | .epub, .pdf |

---

## Known Issues

None critical. All P0/P1 bugs have been resolved.

## Deployment Checklist
- [x] All content verified and correct
- [x] All launchers tested
- [x] All UI features working
- [x] README.txt user instructions complete
- [x] Legal files included (LEGAL/ directory)
- [x] Model file present and verified
- [x] Flash drive script working
- [x] Git repo synced
