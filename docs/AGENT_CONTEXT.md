# The Blackout Drive — Agent Context

> **Read this first.** This file gives any developer or AI agent complete context to work on this project cold.

---

## Product Overview

**The Blackout Drive** is a plug-and-play USB drive preloaded with a fully offline AI system. Target market: privacy purists, tactical preparedness, off-grid adventurers, and insurance planners.

**How it works:** Customer plugs in USB → double-clicks launcher → local AI chat assistant ("BEACON") + offline reference library running on their laptop. Zero internet, zero accounts, zero cloud.

---

## Architecture

### Stack
| Component | Technology |
|-----------|-----------|
| AI engine | [Ollama](https://ollama.com) (portable binary, bundled) |
| Model | Qwen3 4B / Qwen3 8B — Apache 2.0, adaptive auto-detection by host RAM |
| Persona | BEACON — custom Ollama Modelfile with tuned system prompt |
| Chat UI | Vanilla HTML/CSS/JS (zero CDN, zero npm, zero framework) |
| API server | Python 3 stdlib only (`http.server`) — no pip installs |
| Content CDN | Cloudflare R2 bucket + Workers (catalog API) |
| Library | Public domain texts (Gutenberg, US Gov, Creative Commons) |
| Platforms | macOS ARM, macOS Intel, Windows 10/11, Linux x86_64 |

### Directory Layout
```
The-Blackout-Drive/
├── drive/                          ← Everything shipped on USB
│   ├── The Blackout Drive.app/     ← macOS native launcher
│   ├── Start (Windows).bat         ← Windows entry point
│   ├── README.txt                  ← End-user instructions
│   ├── USER_DATA/                  ← User data (preserved across flashes)
│   │   ├── content/                ← User-uploaded documents (EPUBs, PDFs, etc.)
│   │   ├── conversations/          ← Saved chat sessions (JSON)
│   │   ├── unlocked/               ← User files (standard access)
│   │   └── locked/                 ← User files (AES-256-GCM encrypted, native .bkv format)
│   └── _system/                    ← System internals
│       ├── config.sh / config.bat  ← Shell config for launchers
│       ├── models.json            ← Model definitions (multi-model support)
│       ├── model_setup.py         ← Generates Modelfile.generated from models.json
│       ├── Modelfile.generated    ← BEACON AI persona (auto-generated, not tracked)
│       ├── server.py               ← Local HTTP server (Python stdlib)
│       ├── START_MAC.command        ← Mac launcher (full boot sequence)
│       ├── START_WINDOWS.bat        ← Windows launcher
│       ├── START_LINUX.sh           ← Linux launcher
│       ├── STOP_BEACON.*            ← Graceful shutdown scripts
│       ├── runtime/                 ← Ollama binaries (3 platforms)
│       ├── models/                  ← GGUF model file
│       ├── profiles/               ← BEACON system prompt layers
│       ├── content/                 ← Pre-loaded library content
│       │   ├── books/{category}/    ← EPUBs, PDFs, TXTs by category
│       │   ├── manifest.json        ← Auto-generated file inventory
│       │   └── text_index.json      ← Pre-built search index (~76MB)
│       └── ui/                      ← Frontend (17 JS files + CSS + HTML)
│           ├── tools.js             ← Tools panel controller (registry pattern)
│           ├── hamradio.js          ← Ham Radio toolkit (self-registering module)
│           ├── navigator.js         ← Tactical Navigator (coordinate converter)
│           ├── cipher.js            ← Cipher Studio (text, file, folder encrypt/decrypt)
│           ├── calculators.js       ← Survival Calculators (water, power, solar)
│           ├── medtimers.js         ← Medical Timers (tourniquet + CPR metronome)
│           ├── checklists.js        ← Prep Checklists (emergency readiness + custom lists)
│           └── comms.js             ← COMMS panel controller (Hardware Required / Radio Silence / Active states)
├── cloudflare-worker/
│   └── catalog-worker.js           ← R2 → dynamic JSON catalog API
├── scripts/                         ← Build/deploy automation
│   ├── flash_drive.sh               ← Rsync to physical USB
│   ├── download_runtime.sh          ← Fetch Ollama binaries
│   ├── download_models.sh           ← Fetch GGUF model
│   ├── sync_content.sh              ← Sync content ↔ R2 bucket
│   └── build_text_index.py          ← Extract epub text for RAG
└── LICENSE                          ← BSL 1.1 (converts Apache 2.0 in 2030)
```

### Data Flow
1. **Launcher** (`START_MAC.command` or `START_WINDOWS.bat`) starts Ollama + Python server
2. **Python server** (`server.py`) serves UI on `localhost:8080`, proxies nothing
3. **Chat UI** (`app.js`) connects directly to Ollama on `localhost:11434`
4. **RAG** — library text index searched on each substantive query, injected as system context
5. **Downloads** — UI fetches catalog from R2 Worker, downloads files through Python server

### Key Config Files
- `config.json` — master config (ports, model name, URLs)
- `config.sh` / `config.bat` — shell equivalents sourced by launchers
- `config.js` — JS config loaded by UI (reads from config.json at runtime)

---

## Development Setup

```bash
# Clone and set up
git clone https://github.com/huttonbenj/The-Blackout-Drive.git
cd The-Blackout-Drive

# Download runtimes (Ollama binaries for all platforms)
bash scripts/download_runtime.sh

# Download AI model
bash scripts/download_models.sh

# Download content library from public sources
bash scripts/download_content.sh

# Sync content to R2 (requires Cloudflare credentials)
bash scripts/sync_content.sh

# Dev test (starts Ollama + server locally)
bash scripts/dev_test.sh

# Build and flash to USB
bash scripts/flash_drive.sh /Volumes/YOUR_DRIVE
```

---

## API Reference (server.py)

All endpoints bound to `127.0.0.1:8080` (localhost only).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Redirect to `/ui/` |
| GET | `/ui/*` | Serve static UI files |
| GET | `/api/status` | Drive status + disk usage + version |
| GET | `/api/manifest` | Content file inventory (manifest.json) |
| GET | `/api/diagnostics` | Full system health report |
| GET | `/api/search?q=` | TF-IDF search of library text index |
| GET | `/api/library-context` | RAG context summary for LLM injection |
| GET | `/api/user-files` | List user-managed files from Locked storage |
| GET | `/api/open-file?path=` | Shell-open file in native OS app |
| GET | `/api/conversations` | List saved conversations (metadata only) |
| GET | `/api/conversations/<id>` | Get full conversation with messages |
| POST | `/api/conversations/save` | Save/update a conversation |
| DELETE | `/api/conversations/<id>` | Delete a conversation |
| POST | `/api/download` | Start background file download from URL |
| GET | `/api/download/<id>` | Poll download progress |
| DELETE | `/api/download/<id>` | Cancel download |
| DELETE | `/api/files?path=` | Delete file + regenerate manifest |
| OPTIONS | `*` | CORS preflight |

---

## Content Catalog System

### How it works:
1. Content lives in **Cloudflare R2** bucket (`blackout-drive-content`)
2. A **Cloudflare Worker** (`catalog-worker.js`) reads R2 bucket structure → returns JSON catalog
3. The catalog is cached locally as `content/catalog.json` on the drive
4. Library UI reads local cache first, falls back to Worker when online

### R2 Bucket Structure:
```
blackout-drive-content/
├── bible/          ← KJV, ASV, WEB, YLT (.txt)
├── classics/       ← Art of War, Republic, etc. (.epub)
├── homestead/      ← Gardening, beekeeping, herbal (.epub)
├── law/            ← Constitution, Federalist Papers (.epub)
├── medical/        ← Surgery manuals, field medicine guides (.epub/.pdf)
├── philosophy/     ← Meditations, Walden, Seneca (.epub)
├── preparedness/   ← FEMA guide (.pdf)
└── survival/       ← Army FMs, bushcraft (.epub/.pdf)
```

Each folder can have an optional `_meta.json` for name/description/icon overrides.

---

## Key Design Decisions

See [`docs/DECISIONS.md`](DECISIONS.md) for full architectural decision records (ADRs) with rationale covering our zero-dependency constraints, Python stdlib server, content distribution, and anti-flicker UI.

---

## Tools Panel Architecture

The TOOLS panel is a modular, self-discovering system for interactive offline utilities. It follows the same full-screen overlay pattern as Library and Workspace.

**Registry pattern:** Each tool is a standalone `.js` file that calls `registerTool()` at load time:
```javascript
registerTool({
  id: 'ham-radio',
  name: 'HAM RADIO',
  icon: ICONS.radioWave,  // Use SVG from icons.js — never use emojis
  description: 'Morse code trainer, frequency charts, phonetic alphabet, and quiz',
  render: function(container) { /* renders tool UI */ },
  cleanup: function() { /* optional cleanup */ }
});
```

**Adding a new tool:** Create a `.js` file, call `registerTool()`, add the `<script>` tag to `index.html`, add CSS to `style.css`, mirror to `_factory/`. The tool auto-appears in the grid.

---

## Version History

### V1.0.0 (Current — "Basecamp Edition")
- BEACON AI chat with streaming responses
- Curated offline reference library (survival, medical, legal, engineering, philosophy, homestead, cybersecurity, development, communication, theology)
- EPUB/TXT/PDF reader with chapter navigation
- Bible reader with book/chapter/verse navigation
- Modular TOOLS panel with tool registry pattern
- Ham radio toolkit (Morse trainer, frequency charts, phonetic alphabet, quiz)
- Tactical Navigator (GPS coordinate converter: Decimal, DMS, MGRS, UTM + distance & bearing)
- Cipher Studio (AES-256-GCM encrypt/decrypt for text, files, and folders)
- Survival Calculators (water purification ratios, battery runtime, solar charge time)
- Medical Timers (tourniquet application tracker, CPR compression metronome at 110 BPM)
- Prep Checklists (bug-out bag, vehicle, home, first aid, comms plan + custom list builder + readiness scoring)
- COMMS panel (tactical mesh communications — Hardware Required / Radio Silence / Active states)
- Radio Silence toggle (independent of Blackout Protocol — suspends all outbound mesh radio transmissions; incoming RF is physically received by the hardware but not processed or stored)
- Voice input (STT) and text-to-speech (TTS)
- Conversation persistence with auto-save
- AES-256-GCM chat encryption (Single Ecosystem Key)
- MY FILES (Unlocked + Locked encrypted storage)
- Blackout Protocol master security switch
- RAG-powered library search
- Network Lock with optional content catalog access
- Diagnostics panel
- 100+ prompt library
- macOS + Windows + Linux launchers
- 7-SKU pricing: Core Edition 64GB ($69), Core Edition 128GB ($99), Basecamp Bundle 64GB ($119), Basecamp Bundle 128GB ($149), Field Kit 64GB ($169), Field Kit 128GB ($199), Field Node add-on ($45)
