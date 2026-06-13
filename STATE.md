# STATE.md — The Blackout Drive System State

> Last updated: 2026-05-21 (Phase 29 — V1 Polish)

## Architecture

| Component | Technology | Status |
|-----------|-----------|--------|
| Server | Python 3 stdlib `http.server` | Production |
| AI Engine | Ollama + Qwen3 (4B/8B auto-tier) | Production |
| Crypto | AES-256-GCM (v1) + AES-256-CTR/HMAC (v2) via libcrypto ctypes | Production |
| COMMS | Meshtastic serial + vendored protobuf | Production |
| Frontend | Vanilla JS + CSS (zero frameworks) | Production |
| Editor | Monaco (vendored, air-gapped) | Production |
| TTS | Native SpeechSynthesis (browser API, zero deps) | Production |

## Security Model

- **Password**: PBKDF2-SHA256, 600K iterations, server-side verification
- **File Encryption**: 1:1 model — each file individually encrypted as `.bkv`
  - v1 (AES-256-GCM): files < 50MB
  - v2 (AES-256-CTR + HMAC-SHA256): files >= 50MB (streaming decrypt, O(1) memory)
- **Chat Encryption**: AES-256-GCM via Web Crypto API (browser-side)
- **COMMS Encryption**: AES-256-GCM encrypted message store
- **Brute-Force Protection**: Disk-persisted lockout (`.pw_lockout.json`)
- **System File Gate**: X-Password required for core file modifications
- **Binding**: Localhost-only (127.0.0.1)
- **Zero Telemetry**: No outbound network requests ever

## File Layout

```
drive/
├── The Blackout Drive.app/    # macOS launcher
├── Start (Windows).bat        # Windows launcher
├── README.txt                 # User-facing quickstart
├── USER_DATA/                 # User data (never overwritten by factory reset)
│   ├── unlocked/              # Unencrypted file storage
│   ├── locked/                # Encrypted .bkv files (UUID names)
│   ├── conversations/         # Encrypted chat history
│   └── content/               # Downloaded library content
└── _system/                   # System code (restorable from _factory/)
    ├── server.py              # HTTP server (main entry point)
    ├── config.json            # Runtime configuration
    ├── models.json            # AI model definitions
    ├── model_setup.py         # Ollama model builder
    ├── Modelfile.generated    # Generated Ollama Modelfile
    ├── comms/                 # COMMS subsystem
    │   ├── __init__.py        # CommsManager (thread, serial, dispatch)
    │   ├── crypto_core.py     # AES-256 primitives (libcrypto ctypes)
    │   ├── filecrypt.py       # .bkv file encryption/decryption
    │   ├── protocol.py        # Meshtastic protobuf codec
    │   ├── serial_io.py       # Serial port detection + I/O
    │   ├── store.py           # Encrypted message persistence
    │   └── dispatch.py        # AI dispatch + classification
    ├── profiles/              # AI persona layers
    │   ├── _shared/device_facts.txt
    │   ├── base/ (identity.txt, tuning.txt)
    │   └── max/ (identity.txt, tuning.txt)
    ├── ui/                    # Frontend (single-page app)
    │   ├── index.html         # Entry point
    │   ├── app.js             # Core app logic
    │   ├── style.css          # Global styles
    │   ├── comms.js           # COMMS panel
    │   ├── workspace.js       # Workspace panel
    │   ├── library.js         # Library panel
    │   ├── config.js          # Runtime config loader
    │   ├── crypto.js          # Client-side AES-256-GCM (Web Crypto)
    │   ├── myfiles.js         # Upload modal
    │   └── lib/               # Vendored libraries (Monaco, epub.js, TTS)
    ├── _factory/              # Factory snapshot (for EMERGENCY_RESTORE)
    ├── _backups/              # Auto-backups of edited system files
    ├── data/                  # Runtime data (comms_log.enc, etc.)
    └── vendor/                # Vendored Python packages (pyserial)
```

## Deployment

| Platform | Launcher | Python Source |
|----------|----------|---------------|
| macOS | `The Blackout Drive.app` or `START_MAC.command` | System Python 3 |
| Windows | `Start (Windows).bat` | Bundled `runtime/python-windows/` |
| Linux | `START_LINUX.sh` | System Python 3 |

## Known Limitations

- Files >2GB cannot be uploaded (frontend + server limit)
- TTS uses browser-native SpeechSynthesis (voice availability varies by OS/browser)
- No GPS hardware on Heltec V3 boards (requires external module or fixed position)
- COMMS requires physical Meshtastic radio connected via USB

## QA Infrastructure

- `drive/_system/test_suite.py` — 129 automated backend tests (zero dependencies)
  - Run: `python3 drive/_system/test_suite.py --pw <password>`
  - Coverage: health, passwords, vault ops, uploads, conversations, COMMS, diagnostics,
    settings, file tree, manifest, static assets, CORS, adversarial attacks

## Product Editions

All editions run the **exact same software, AI models, and library content**. Core Edition SKUs are drive-only. Basecamp Bundle and Field Kit include pre-flashed Heltec V3 LoRa radio hardware for off-grid encrypted mesh communication.

| SKU | Edition | Hardware | Price | Included |
|---|---|---|---|---|
| 1 | **Core Edition** | SanDisk Ultra Dual Drive Go (64GB) | $69 | BEACON AI, reference library, 6 interactive tools, encrypted storage, voice I/O, Monaco editor |
| 2 | **Core Edition** | SanDisk Ultra Dual Drive Go (128GB) | $99 | Everything in SKU 1 + double storage capacity |
| 3 | **Basecamp Bundle** | SanDisk Ultra Dual Drive Go (64GB) | $119 | Everything in SKU 1 + 1x pre-flashed Heltec V3 radio, mesh antenna, USB-C data cable |
| 4 | **Basecamp Bundle** | SanDisk Ultra Dual Drive Go (128GB) | $149 | Everything in SKU 2 + 1x pre-flashed Heltec V3 radio, mesh antenna, USB-C data cable |
| 5 | **Field Kit** | SanDisk Ultra Dual Drive Go (64GB) | $169 | Everything in SKU 1 + 2x pre-flashed Heltec V3 radios, 2x mesh antennas, 2x USB-C data cables |
| 6 | **Field Kit** | SanDisk Ultra Dual Drive Go (128GB) | $199 | Everything in SKU 2 + 2x pre-flashed Heltec V3 radios, 2x mesh antennas, 2x USB-C data cables |
| 7 | **Field Node** (add-on) | Heltec V3 LoRa radio only (no drive) | $45 | Pre-flashed radio + mesh antenna + USB-C data cable; joins existing encrypted channel out of the box |

## V2 Features (Planned — Not Implemented)

- **Persona Switcher**: Toggle between BEACON (default), SCHOLAR (academic), CODER (developer)
- **Bundled Native Client**: Electron/Tauri wrapper enabling local PDF parsing + custom document RAG
- **Diagnostic Vision**: Multimodal image input (plant ID, wound assessment, component analysis)
- **Local Mesh Broadcasting**: Serve BEACON over local Wi-Fi to phones/tablets without internet
- **Map Visualization**: GPS data plotted on tactical map interface
- **Knowledge Base**: Custom document RAG from user-uploaded PDFs
- **Wikipedia Offline**: ZIM file integration
- **Multi-Model Support**: Switch between different LLMs

## Content Library (48 files, ~150MB)

| Category | Count | Formats |
|----------|-------|---------|
| Bible | 4 | .txt |
| Heritage (Literature & Philosophy) | 11 | .epub |
| Homestead & Self-Reliance | 7 | .epub |
| Law & Rights | 7 | .epub |
| Engineering & Mechanics | 5 | .epub |
| Survival & Field Craft | 5 | .epub |
| Communication & Navigation | 1 | .epub |
| Medical & First Aid | 2 | .epub |
| Cybersecurity | 3 | .pdf |
| Software Development | 3 | .epub, .pdf |

