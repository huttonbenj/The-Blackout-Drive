# Doomsday Drive — Master Implementation Plan

## Project Identity
**Product:** Doomsday Drive — a plug-and-play offline AI survival knowledge system on a USB drive  
**Market:** Prepper / self-reliance / survivalist niche  
**Price:** $79 (Tier 1), $119 (Tier 2 PRO)  
**GitHub:** https://github.com/huttonbenj/Doomsday-Drive.git  
**Local path:** `/Users/benjamin/github/doomsday-drive`  
**LLC:** Hutton Technologies  
**Lead Architect:** Antigravity (AI) — owns the entire project end to end  

---

## Engineering Rules (Non-Negotiable)
1. **No guesswork.** Every implementation decision must be proven before it's committed.
2. **No bandaids.** If something doesn't work cleanly, fix the root cause.
3. **No shortcuts.** Every feature is built completely or not at all.
4. **Prove it works.** Each phase ends with a verification step before moving on.
5. **Commit as you go.** Every logical unit of work gets its own git commit with a meaningful message.
6. **Documentation lives in the repo.** Any AI agent picking this up must be able to get full context from `/docs/` alone.

---

## User Review Required

> [!IMPORTANT]
> **Review these open questions before approving execution.** Answers will change specific implementation details.

### Open Questions

1. **Base model choice:** My recommendation is **Phi-3 Mini (Q4_K_M)** as Tier 1 default (MIT license, runs on 8GB RAM, ~2.3GB). Do you agree, or do you want Mistral 7B (needs 16GB)?

2. **Chat UI approach:** Two options:
   - **Option A:** Custom-built HTML/JS chat UI (more control, exact branding, ~1 day of work, no external dependencies)
   - **Option B:** Open WebUI pre-packaged (battle-tested, more features, heavier, harder to brand exactly)
   - **Recommendation:** Option A for v1 — full control, lighter weight, survives indefinitely without upstream changes

3. **Drive name / brand:** Is "Doomsday Drive" the final product name, or is this placeholder? The Modelfile persona name (what the AI calls itself) can be anything — e.g., `ORACLE`, `BUNKER`, `AEGIS`, `DOOMSDAY`. Pick one.

4. **Tier 2 model:** For the PRO tier at $119, do you want Mistral 7B (requires 16GB RAM) or Llama 3 8B (requires 16GB RAM, needs "Built with Llama" attribution)?

5. **Platform for Shopify:** Do you already have a Shopify account, or do you need me to include that setup in the plan?

6. **Domain:** Have you registered a domain yet (e.g., `doomsdaydrive.com`)? This affects the marketing copy and store setup.

---

## Proposed Repository Structure

```
doomsday-drive/
│
├── docs/                          ← All project documentation
│   ├── AGENT_CONTEXT.md           ← [CRITICAL] AI agent onboarding doc
│   ├── STATE.md                   ← Live project state tracker
│   ├── RESEARCH.md                ← Competitive research + market data
│   ├── LEGAL.md                   ← License compliance guide
│   ├── BUSINESS_MODEL.md          ← Full business model + unit economics
│   └── DECISIONS.md               ← Log of all architectural decisions + rationale
│
├── drive/                         ← Everything that ships ON the USB drive
│   ├── START_WINDOWS.bat          ← Primary Windows launcher (auto-detects drive letter)
│   ├── START_MAC.command          ← Universal Mac launcher (auto-detects Intel vs ARM)
│   ├── START_LINUX.sh             ← Linux launcher (bonus, low effort)
│   │
│   ├── runtime/                   ← Ollama binaries (downloaded by setup script, not in git)
│   │   ├── .gitkeep
│   │   └── README.txt             ← "Run setup/download_runtime.sh to populate"
│   │
│   ├── models/                    ← GGUF model files (downloaded by setup script, not in git)
│   │   ├── .gitkeep
│   │   └── README.txt
│   │
│   ├── ui/                        ← Custom offline chat interface
│   │   ├── index.html             ← Main entry point
│   │   ├── style.css              ← Dark survival aesthetic
│   │   └── app.js                 ← Chat logic, Ollama API calls (localhost:11434)
│   │
│   ├── knowledge/                 ← Survival content library
│   │   ├── pdfs/                  ← Public domain survival PDFs
│   │   │   ├── army_survival_fm21-76.pdf
│   │   │   ├── fema_emergency_guide.pdf
│   │   │   ├── cdc_first_aid.pdf
│   │   │   └── [+ others]
│   │   └── zim/                   ← Kiwix ZIM files (downloaded by script)
│   │       └── .gitkeep
│   │
│   ├── prompts/
│   │   └── survival_prompts.md    ← 100+ curated survival prompts
│   │
│   ├── Modelfile                  ← Ollama Modelfile (DOOMSDAY persona)
│   │
│   └── LEGAL/
│       ├── OPEN_SOURCE_NOTICES.txt
│       ├── OLLAMA_LICENSE.txt
│       ├── PHI3_LICENSE.txt
│       ├── WIKIPEDIA_ATTRIBUTION.txt
│       └── DISCLAIMER.txt         ← Medical/liability disclaimer
│
├── scripts/                       ← Dev/build tooling (not shipped on USB)
│   ├── setup.sh                   ← One-command full environment setup
│   ├── download_runtime.sh        ← Downloads Ollama binaries for all platforms
│   ├── download_models.sh         ← Downloads GGUF model files
│   ├── download_content.sh        ← Downloads Kiwix ZIM + public domain PDFs
│   ├── build_image.sh             ← Creates a byte-perfect USB image (macOS dd)
│   ├── flash_usb.sh               ← Flashes image to a target USB device
│   └── test_drive.sh              ← Smoke test: verify all components are present + functional
│
├── marketing/
│   ├── copy/
│   │   ├── shopify_product_page.md     ← Full product page copy
│   │   ├── shopify_faq.md             ← FAQ copy
│   │   ├── tiktok_scripts.md          ← 10 TikTok video scripts
│   │   ├── email_welcome.md           ← Post-purchase email
│   │   └── hardware_requirements.md   ← Pre-purchase hardware spec page
│   └── assets/                        ← Generated product images
│
├── .gitignore
└── README.md                      ← Public-facing repo README
```

---

## Phase Breakdown

---

### PHASE 0: Project Infrastructure
**Goal:** Working repo, all docs in place, GitHub connected. No product code yet.

#### Tasks
- [ ] Initialize git repo, connect to `https://github.com/huttonbenj/Doomsday-Drive.git`
- [ ] Create full directory structure with all placeholder files
- [ ] Write `AGENT_CONTEXT.md` — complete AI agent onboarding document
- [ ] Write `STATE.md` — initial state entry
- [ ] Write `RESEARCH.md` — import competitive research from session artifacts
- [ ] Write `LEGAL.md` — import legal analysis from session artifacts
- [ ] Write `BUSINESS_MODEL.md` — import business model from session artifacts
- [ ] Write `DECISIONS.md` — log all decisions made so far
- [ ] Write `README.md` — public-facing project overview
- [ ] Write `.gitignore` (ignore model files, ZIM files, runtime binaries — too large for git)
- [ ] First commit + push to GitHub
- [ ] **Verify:** Repo visible at github.com/huttonbenj/Doomsday-Drive with full structure

---

### PHASE 1: Core Drive Build
**Goal:** A functional, launchable drive that an actual human can plug in and use.

#### 1A: The Modelfile (DOOMSDAY Persona)
- [ ] Write `drive/Modelfile` with:
  - Base: `phi3:mini`
  - System prompt: survival-focused, uncensored on legitimate field medicine, direct and actionable, branded persona
  - Temperature: 0.7
  - Context: 4096 tokens
- [ ] Test: `ollama create doomsday -f Modelfile` and verify persona behaves correctly
- [ ] Commit: `feat(model): add DOOMSDAY Modelfile with survival persona`

#### 1B: Launcher Scripts
**The most technically critical component. Must work on all 4 variants without any user configuration.**

**Windows (`START_WINDOWS.bat`):**
- Auto-detect drive letter using `%~d0` (the drive the batch file is running from)
- Set `OLLAMA_MODELS` env var to `%DRIVE%\models`
- Set `OLLAMA_HOST` to `127.0.0.1:11434`
- Launch `runtime\ollama-windows\ollama.exe serve` in background
- Wait for Ollama to be ready (poll localhost:11434)
- Open `ui\index.html` in default browser
- Trap CTRL+C and kill ollama on exit

**Mac (`START_MAC.command`):**
- Auto-detect architecture (`uname -m`) — select `ollama-mac-arm` or `ollama-mac-intel`
- Set `OLLAMA_MODELS` env var
- Launch ollama binary in background
- Wait for ready
- Open `ui/index.html` in default browser
- Cleanup on exit

**Both scripts must:**
- Never require admin/sudo rights
- Never write anything to the host OS (no installs, no registry edits)
- Handle "already running" gracefully if user double-clicks twice
- Work from any drive letter / mount point

- [ ] Write `drive/START_WINDOWS.bat`
- [ ] Write `drive/START_MAC.command`
- [ ] Write `drive/START_LINUX.sh`
- [ ] Test on Windows 10
- [ ] Test on Windows 11
- [ ] Test on macOS Apple Silicon (M-series)
- [ ] Test on macOS Intel
- [ ] Commit: `feat(launcher): add cross-platform launcher scripts`

#### 1C: Custom Chat UI
**Offline HTML/JS — zero CDN dependencies. Every asset is local.**

Design spec:
- Dark military/tactical aesthetic — near-black background (#0a0a0a), amber/green accent (#c8a04a or #00ff41 matrix-style)
- Branded header: "DOOMSDAY // OFFLINE SURVIVAL INTELLIGENCE"
- Chat interface: message bubbles, input field, send button
- Status indicator: "🔴 OFFLINE MODE — AI RUNNING LOCALLY" 
- Model selector (Tier 2 will have multiple models)
- Connects to `http://localhost:11434/api/chat` via fetch
- Streams responses (uses Ollama's streaming API)
- Handles "Ollama not ready" gracefully with a retry/loading screen
- Font: system monospace or bundled monospace font (no Google Fonts CDN)
- Mobile-friendly (for when user accesses from phone on local network)

- [ ] Build `drive/ui/index.html`
- [ ] Build `drive/ui/style.css`
- [ ] Build `drive/ui/app.js`
- [ ] Test: UI launches, connects to local Ollama, streams responses correctly
- [ ] Test: UI handles Ollama-not-ready gracefully
- [ ] Commit: `feat(ui): add offline survival chat interface`

#### 1D: Legal & Compliance Files
- [ ] Write `drive/LEGAL/OLLAMA_LICENSE.txt` (copy MIT license from Ollama repo)
- [ ] Write `drive/LEGAL/PHI3_LICENSE.txt` (copy MIT license from Microsoft)
- [ ] Write `drive/LEGAL/OPEN_SOURCE_NOTICES.txt` (master attribution doc)
- [ ] Write `drive/LEGAL/WIKIPEDIA_ATTRIBUTION.txt`
- [ ] Write `drive/LEGAL/DISCLAIMER.txt` (medical/liability disclaimer)
- [ ] Commit: `legal: add all open source license files and product disclaimer`

**Phase 1 Verification:**
- [ ] Clone fresh repo onto a separate machine
- [ ] Run setup scripts to populate runtime + models
- [ ] Plug in USB and double-click launcher
- [ ] Confirm: Ollama starts, UI opens in browser, chat works, DOOMSDAY persona responds correctly
- [ ] Confirm: No files written to host OS during session

---

### PHASE 2: Content Library
**Goal:** The drive is populated with the survival knowledge payload that justifies the price.**

#### 2A: Automation Scripts
- [ ] `scripts/download_runtime.sh` — Downloads Ollama portable binaries for all 3 platforms from Ollama's GitHub releases
- [ ] `scripts/download_models.sh` — Downloads Phi-3 Mini GGUF (Q4_K_M) from HuggingFace
- [ ] `scripts/download_content.sh` — Downloads:
  - Kiwix Wikipedia survival ZIM slice
  - Kiwix medical ZIM slice
  - List of public domain PDFs from FEMA, Army FM, CDC, USDA

#### 2B: Survival PDF Library (Public Domain Only)
Curated list — all confirmed public domain (US government or pre-1928):

| Document | Source | Size |
|---------|--------|------|
| Army FM 21-76 Survival Manual | archive.org | ~5MB |
| FEMA Are You Ready? Guide | fema.gov | ~8MB |
| CDC Emergency Preparedness | cdc.gov | ~3MB |
| USDA Home Canning Guide | nifa.usda.gov | ~4MB |
| Army FM 3-05.70 Survival | archive.org | ~6MB |
| EPA Emergency Drinking Water | epa.gov | ~2MB |
| USDA Food Preservation | extension service | ~3MB |
| Where There Is No Doctor | hesperian.org (CC) | ~15MB |
| Where There Is No Dentist | hesperian.org (CC) | ~8MB |

*"Where There Is No Doctor/Dentist" are CC-licensed — verified free for redistribution.*

#### 2C: Survival Prompt Pack
100+ prompts organized by category:
- Emergency Medical (30 prompts)
- Water & Food (20 prompts)
- Shelter & Warmth (15 prompts)
- Navigation & Comms (15 prompts)
- Power & Tools (10 prompts)
- Security & Situational (10 prompts)

- [ ] Write all prompts to `drive/prompts/survival_prompts.md`
- [ ] Commit: `feat(content): add survival prompt library`

#### 2D: Build & Flash Tooling
- [ ] `scripts/build_image.sh` — Assembles all components into master drive folder, verifies file checksums, outputs a drive-ready folder
- [ ] `scripts/test_drive.sh` — Smoke test: checks all required files present, all binaries executable, Ollama starts and responds to a test query
- [ ] Document USB duplication procedure (duplicator hub instructions in `docs/`)
- [ ] Commit: `feat(scripts): add build, flash, and test automation`

**Phase 2 Verification:**
- [ ] Run `scripts/setup.sh` on a fresh Mac — confirm it fully populates the drive folder
- [ ] Run `scripts/test_drive.sh` — all checks pass
- [ ] Total drive size is within target (64GB drive, leave 10GB headroom)

---

### PHASE 3: Business Assets & Marketing
**Goal:** Everything needed to open the Shopify store and post first content.**

#### 3A: Marketing Copy
- [ ] `marketing/copy/shopify_product_page.md` — Full product listing: headline, description, feature bullets, FAQ, hardware requirements, disclaimer
- [ ] `marketing/copy/shopify_faq.md` — 15 FAQ answers
- [ ] `marketing/copy/hardware_requirements.md` — Clear pre-purchase hardware spec page
- [ ] `marketing/copy/tiktok_scripts.md` — 10 scripted video concepts with hooks, demo steps, and CTAs
- [ ] `marketing/copy/email_welcome.md` — Post-purchase onboarding email sequence (3 emails)

#### 3B: Product Photography
- [ ] Generate product imagery (USB drive on survival gear / tactical background)
- [ ] Generate lifestyle shots (laptop open in off-grid setting, showing the AI UI)
- [ ] Generate packaging mockup (matte black Mylar bag with USB)

#### 3C: Shopify Store Setup Guide
- [ ] Document exact Shopify store configuration in `docs/`
- [ ] Product variant setup (Tier 1 / Tier 2 / Family Pack)
- [ ] Shipping configuration (USPS Ground Advantage via Pirateship)
- [ ] Legal pages (Terms, Privacy, Refund Policy, Medical Disclaimer)

---

### PHASE 4: Launch Prep
**Goal:** First 25 drives ready to ship, store live, first video posted.**

- [ ] Order 25× SanDisk 64GB USB 3.2 drives
- [ ] Order packaging (Mylar bags, kraft inserts)
- [ ] Flash 10 drives from master image using duplicator
- [ ] Quality check each drive (run test script)
- [ ] Shopify store goes live
- [ ] Etsy listing goes live
- [ ] Post first TikTok (transparency video: "what's actually on this drive")
- [ ] Post second TikTok (demo: Wi-Fi off, survival question, AI answers)

---

## Verification Plan

### Per-Phase Gates (Nothing moves forward without these)
| Phase | Gate |
|-------|------|
| 0 | GitHub repo has full structure, all docs committed and pushed |
| 1 | Launcher works on all 4 OS variants from a physical USB with no errors |
| 2 | `test_drive.sh` passes all checks; total size under 54GB |
| 3 | Product page copy reviewed and approved by user |
| 4 | 5 test drives sent to users, zero critical issues reported |

### Automated Tests
- `scripts/test_drive.sh` — run before every batch flash
- Checks: all binary files present, all scripts executable, Ollama responds to ping, model loads, UI serves correctly, all LEGAL files present

---

## What This Plan Does NOT Include (Intentionally Deferred)

- RAG (Retrieval-Augmented Generation) — Phase 2 product, after launch validation
- LoRA fine-tuning — Phase 3 product, after revenue justifies GPU time
- Mobile app — out of scope
- Windows code signing certificate — deferred; handled via Gatekeeper/SmartScreen bypass instructions in launch
- Amazon listing — after 50+ Shopify/Etsy reviews

---

## Decisions Already Made (from Research Phase)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default model | Phi-3 Mini Q4_K_M | MIT license (cleanest), runs on 8GB RAM, ~2.3GB size |
| UI approach | Custom HTML/JS | Full control, zero CDN deps, survives upstream changes |
| Content license | Public domain only | Zero legal risk, FEMA/Army/CDC/USDA freely available |
| Legal compliance | License files on drive | All MIT/Apache/CC — just include license files |
| Sales channel order | Shopify → Etsy → TikTok Shop → Amazon | Margin preservation, then volume |
| AI persona | Survival-tuned via Modelfile | 30 min effort, huge UX differentiation |

