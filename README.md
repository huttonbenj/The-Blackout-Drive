# The Blackout Drive™

> **Air-gapped intelligence. Plug in. Power up. No internet required.**

[![Version](https://img.shields.io/badge/version-1.0.0%20Gold%20Master-blue)]()
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue)](LICENSE)

---

## What Is This?

The Blackout Drive™ is a plug-and-play USB drive containing a secure offline intelligence ecosystem, built for zero-connectivity environments. Customers plug it in, double-click a launcher, and get a fully functional AI running locally on their laptop — no internet, no accounts, no cloud, no subscription.

**Built for privacy purists, tactical preparedness, off-grid adventurers, and insurance planners.**

---

## For Developers / AI Agents

**Start here:** [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md)

This repo uses a structured documentation system so any AI agent or developer can pick up the project cold.

| Doc | Purpose |
|-----|---------|
| [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) | Full project context — architecture, stack, data flow |
| [`STATE.md`](STATE.md) | Current project state + V1/V2 feature status |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | All architectural decisions with rationale |
| [`docs/LEGAL.md`](docs/LEGAL.md) | License compliance + medical disclaimer |
| `drive/_system/config.json` | Master runtime configuration |
| `drive/_system/models.json` | AI model configuration |

---

## Repository Structure

```
The-Blackout-Drive/
├── docs/              ← All project documentation
├── drive/             ← Everything that ships ON the USB drive
│   ├── _system/       ← System internals
│   │   ├── ui/        ← Custom offline chat interface (vanilla HTML/CSS/JS)
│   │   ├── content/   ← Offline knowledge library (books, PDFs, catalogs)
│   │   ├── profiles/  ← BEACON system prompt layers
│   │   ├── runtime/   ← Ollama binaries (downloaded via script)
│   │   ├── models/    ← GGUF model files (downloaded via script)
│   │   ├── server.py  ← Local HTTP API server (standard lib Python 3)
│   │   └── LEGAL/     ← License files + medical disclaimer
│   └── USER_DATA/     ← User data (preserved across flashes)
│       ├── content/       ← User-uploaded documents
│       ├── conversations/  ← Saved chat sessions
│       ├── unlocked/       ← User files (standard access)
│       └── locked/         ← User files (AES-256-GCM encrypted)
├── scripts/           ← Build, download, test automation
└── cloudflare-worker/ ← R2 content catalog API
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| AI engine | Ollama (portable binary) |
| Default model | Qwen3 4B / 8B (Apache 2.0, auto-detected by RAM) |
| Persona | BEACON (custom Ollama Modelfile) |
| Chat UI | Custom HTML/CSS/JS (zero CDN) |
| API server | Python 3 standard library (no pip installs) |
| Knowledge base | Public domain texts + PDFs |
| OS support | Windows 10/11, macOS (ARM + Intel), Linux x86_64 |
| AI requirements | 8GB+ RAM, dedicated GPU on Windows/Linux (Apple Silicon runs natively; 14GB+ auto-selects 8B model) |
| COMMS dispatch | 8GB+ RAM + dedicated GPU on Windows/Linux (same gate as BEACON; 14GB+ auto-selects 8B model) |

---

## Getting Started (Dev Setup)

> **Note:** Large files (model weights, Ollama binaries) are not tracked in git.
> Use the setup scripts to download them.

```bash
# 1. Clone the repo
git clone https://github.com/huttonbenj/The-Blackout-Drive.git
cd The-Blackout-Drive

# 2. Download runtimes + models
bash scripts/download_runtime.sh
bash scripts/download_models.sh

# 3. Launch the drive (for dev/testing)
# Mac:
./drive/START_MAC.command
# Windows:
# Double-click drive/START_WINDOWS.bat
```

---

## What Ships on the Drive

All editions run the **exact same Blackout Drive software, AI models, and library content**. The AI auto-detects your hardware and selects the optimal model.

### Core Edition 64GB — $89
- **BEACON AI** — Adaptive offline AI assistant (Qwen3 4B/8B, auto-selected by RAM)
- **Reference Library** — A curated collection of offline books, manuals, and guides covering survival, medical, legal, engineering, philosophy, homestead, cybersecurity, development, communication, and theology
- **Interactive Tools** — Ham Radio toolkit, Tactical Navigator, Cipher Studio, Survival Calculators, Medical Timers, and Prep Checklists
- **COMMS Panel** — Tactical mesh communications interface (radio hardware required — included in Basecamp Bundle and Field Kit)
- **Prompt Library** — 100+ curated ready-made queries across 11 knowledge domains
- **Encrypted Storage** — AES-256-GCM encrypted chat history + Cipher Studio for text, file, and folder encryption
- **Blackout Protocol** — One-click master switch enforcing Network Lock + Encrypt Chat History
- **Radio Silence** — Independent toggle to suspend all mesh radio transmission
- **Voice I/O** — Voice input and text-to-speech for hands-free operation
- **In-browser reader** — EPUB/PDF/TXT reader with chapter navigation and full-text search
- **Monaco code editor** — Full-featured offline code editor
- **Cross-platform** — Mac + Windows + Linux (Linux experimental — not yet fully tested)
- ~43GB free space for your own files

### Core Edition 128GB — $119
- **Everything in the 64GB edition**
- **~104GB free space** for your own PDFs, photos, documents, and encrypted backups

### Basecamp Bundle 64GB — $149
- **Everything in the Core Edition 64GB**
- **Pre-flashed Heltec V3 LoRa radio** — Ready for off-grid encrypted mesh communication
- **Mesh antenna & USB-C data cable**

### Basecamp Bundle 128GB — $179
- **Everything in the Core Edition 128GB**
- **Pre-flashed Heltec V3 LoRa radio** — Ready for off-grid encrypted mesh communication
- **Mesh antenna & USB-C data cable**

### Field Kit 64GB — $199
- **Everything in the Core Edition 64GB**
- **2x Pre-flashed Heltec V3 LoRa radios** — Hand one to a partner, communicate encrypted miles away with no cell service
- **2x Mesh antennas & USB-C data cables**

### Field Kit 128GB — $229
- **Everything in the Core Edition 128GB**
- **2x Pre-flashed Heltec V3 LoRa radios** — Hand one to a partner, communicate encrypted miles away with no cell service
- **2x Mesh antennas & USB-C data cables**

### Field Node (Add-on) — $59
- **Standalone pre-flashed Heltec V3 LoRa radio** — Pre-configured to join your encrypted channel out of the box
- **Mesh antenna & USB-C data cable**
- Drive not included

---

## Legal

All components are licensed for commercial redistribution. See `drive/_system/LEGAL/` for the full compliance record and medical disclaimer.

**Medical disclaimer:** The AI responses generated by this product are for educational and informational purposes only. Not a substitute for professional medical advice. In emergencies, contact 911.

---

## Intellectual Property

**The Blackout Drive™** is a trademark of Hutton Technologies LLC.

© 2026 Hutton Technologies LLC. All rights reserved. Licensed under [BSL 1.1](LICENSE).
