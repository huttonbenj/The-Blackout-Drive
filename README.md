# The Blackout Drive

> **Air-gapped intelligence. Plug in. Power up. No internet required.**

[![Version](https://img.shields.io/badge/version-1.0.0%20Gold%20Master-blue)]()
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue)](LICENSE)

---

## What Is This?

The Blackout Drive is a plug-and-play USB drive containing a secure offline intelligence ecosystem, built for zero-connectivity environments. Customers plug it in, double-click a launcher, and get a fully functional AI running locally on their laptop — no internet, no accounts, no cloud, no subscription.

**Built for privacy purists, tactical preparedness, off-grid adventurers, and insurance planners.**

---

## For Developers / AI Agents

**Start here:** [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md)

This repo uses a structured documentation system so any AI agent or developer can pick up the project cold.

| Doc | Purpose |
|-----|---------|
| [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) | Full project context — architecture, stack, data flow |
| [`docs/STATE.md`](docs/STATE.md) | Current project state + V1/V2 feature status |
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
| OS support | Windows 10/11, macOS ARM, macOS Intel |

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

### 64GB Standard Edition — $89
- **BEACON AI** — Adaptive offline AI assistant covering trauma & medicine, food & agriculture, engineering & mechanics, comms & navigation, applied sciences, tactical & security, governance & law, history & philosophy, theology & classics
- **The Holy Bible** — Multiple translations (KJV, WEB, ASV, YLT)
- **Essential Library** — Survival PDFs, medical references, code documentation, field manuals, legal documents, philosophy
- **Prompts Directory** — 100+ curated ready-made queries across multiple disciplines
- **MY FILES** — User documents partitioned into Standard Storage (Unlocked) and Encrypted Storage (Locked)
- **Blackout Protocol** — One-click master switch enforcing Network Lock + Encrypt Chat History
- **In-browser reader** — Chapter navigation, search, scripture reader with book/chapter/verse nav

### 128GB Professional Edition — $169
- **Everything in the Standard Edition**, plus:
- **Medical Diagrams** — High-resolution clinical and anatomical reference imagery
- **Geospatial Maps** — Topographical and terrain reference data
- **CAD Blueprints** — Engineering and structural reference schematics
- **Instructional Video Archives** — Offline training and procedural video content

Both editions run the **exact same adaptive BEACON software**. The AI auto-detects your hardware and selects the optimal model. The editions differ only in storage capacity and the size of the curated offline library.

---

## Legal

All components are licensed for commercial redistribution. See `drive/_system/LEGAL/` for the full compliance record and medical disclaimer.

**Medical disclaimer:** The AI responses generated by this product are for educational and informational purposes only. Not a substitute for professional medical advice. In emergencies, contact 911.

---

*Built by Hutton Technologies*
