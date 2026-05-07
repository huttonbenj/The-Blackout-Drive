# Doomsday Drive — Master Backlog

> Status key: `[ ]` = todo · `[/]` = in progress · `[x]` = done · `[~]` = deferred

---

## PHASE 0: Project Infrastructure
> Goal: Working repo, all docs in place, GitHub connected. Zero product code.

- [ ] `P0-01` Initialize git repo + connect remote to GitHub (huttonbenj/Doomsday-Drive)
- [ ] `P0-02` Create full directory skeleton with .gitkeep files
- [ ] `P0-03` Write `.gitignore` (models, ZIM files, runtime binaries, .DS_Store)
- [ ] `P0-04` Write `docs/AGENT_CONTEXT.md` — full AI agent onboarding document
- [ ] `P0-05` Write `docs/STATE.md` — initial state entry
- [ ] `P0-06` Write `docs/RESEARCH.md` — import competitive research + market data
- [ ] `P0-07` Write `docs/LEGAL.md` — full legal compliance guide
- [ ] `P0-08` Write `docs/BUSINESS_MODEL.md` — unit economics + sales channels
- [ ] `P0-09` Write `docs/DECISIONS.md` — all architectural decisions + rationale
- [ ] `P0-10` Write `README.md` — public-facing repo overview
- [ ] `P0-11` First commit + push to GitHub
- [ ] `P0-GATE` Verify: repo visible at github.com/huttonbenj/Doomsday-Drive with full structure

---

## PHASE 1: Core Drive Build
> Goal: A functional drive that a human can plug in and actually use.

### 1A — Modelfile
- [ ] `P1-01` Write `drive/Modelfile` — DOOMSDAY persona, survival system prompt, tuned params
- [ ] `P1-02` Test: `ollama create doomsday -f Modelfile` locally, verify persona behavior
- [ ] `P1-03` Commit: `feat(model): add DOOMSDAY Modelfile with survival persona`

### 1B — Launcher Scripts
- [ ] `P1-04` Write `drive/START_WINDOWS.bat` — auto-detect drive letter, launch Ollama, open UI
- [ ] `P1-05` Write `drive/START_MAC.command` — auto-detect ARM vs Intel, launch Ollama, open UI
- [ ] `P1-06` Write `drive/START_LINUX.sh` — launch Ollama, open UI
- [ ] `P1-07` Test: Windows 10 — launcher works, no admin required
- [ ] `P1-08` Test: Windows 11 — launcher works, no admin required
- [ ] `P1-09` Test: macOS Apple Silicon — launcher works, Gatekeeper handled
- [ ] `P1-10` Test: macOS Intel — launcher works
- [ ] `P1-11` Commit: `feat(launcher): add cross-platform launcher scripts`

### 1C — Chat UI
- [ ] `P1-12` Write `drive/ui/index.html` — dark survival aesthetic, branded DOOMSDAY header
- [ ] `P1-13` Write `drive/ui/style.css` — full dark tactical design system
- [ ] `P1-14` Write `drive/ui/app.js` — streaming Ollama API, graceful not-ready handling
- [ ] `P1-15` Test: UI connects to local Ollama, streams responses
- [ ] `P1-16` Test: UI handles Ollama-not-ready gracefully (retry screen)
- [ ] `P1-17` Test: UI is usable on mobile (phone on local network)
- [ ] `P1-18` Commit: `feat(ui): add offline survival chat interface`
- [x] `P1-32` **UI POLISH — Font/Scale (user feedback):** Base font size too small on large displays (1728px viewport tested). Increase base font-size, prompt card text, message body, header elements. Make layout fill the screen more naturally. ← FIX NOW
- [x] `P1-33` **UI POLISH — Status wording confusion (user feedback):** "SYSTEM ONLINE" in header + "OFFLINE MODE" bar reads as contradictory — user thinks internet is on. Rename: header status → "AI READY" / "AI OFFLINE" / "CONNECTING". Offline bar → "RUNNING LOCALLY — No internet needed". ← FIX NOW

### 1D — Legal Files
- [ ] `P1-19` Write all 5 LEGAL files (Ollama MIT, Phi-3 MIT, notices, Wikipedia, disclaimer)
- [ ] `P1-20` Commit: `legal: add all license files and medical disclaimer`

### 1E — Ghost Process Protection (Added from review)
**Problem:** If a user yanks the USB mid-session, the Ollama process keeps running on the host, draining battery. Our current launchers only handle clean CTRL+C exit — not force-unplug.
- [ ] `P1-21` Write `drive/STOP_DOOMSDAY.bat` — Windows kill script (taskkill ollama, confirm dead)
- [ ] `P1-22` Write `drive/STOP_DOOMSDAY.command` — Mac kill script (pkill ollama, confirm dead)
- [ ] `P1-23` Add ghost-process warning banner to UI: "Before unplugging: click Shut Down or run STOP_DOOMSDAY"
- [ ] `P1-24` Commit: `feat(launcher): add ghost process kill scripts and UI shutdown warning`

### 1F — Gatekeeper / SmartScreen Friction Reduction (Added from review)
**Problem:** Non-technical prepper buyers will hit macOS Gatekeeper or Windows SmartScreen on first launch and think it's broken. Bypass instructions alone aren't enough.
- [ ] `P1-25` Write `drive/FIRST_RUN_MAC.command` — runs `xattr -rd com.apple.quarantine` on all drive binaries automatically, then launches. One double-click fix.
- [ ] `P1-26` Write `drive/FIRST_RUN_WINDOWS.bat` — adds Windows Defender exclusion for the drive folder via PowerShell (elevated prompt), then launches.
- [ ] `P1-27` Add `FIRST_RUN_README.txt` to drive root — plain-English "If blocked, run FIRST_RUN script" instructions
- [ ] `P1-28` Commit: `feat(launcher): add first-run Gatekeeper and SmartScreen helpers`

### 1G — Local Dev Test (No USB Required)
- [ ] `P1-29` Write `scripts/dev_test.sh` — simulates drive environment locally: creates doomsday model from Modelfile, starts ollama serve, opens UI in browser. Tests everything except portable binary + launcher drive-detection.
- [ ] `P1-30` Run dev test locally and verify: UI loads, connects to Ollama, DOOMSDAY persona responds correctly, streaming works, prompt cards work, cancel works
- [ ] `P1-31` Commit: `test(dev): add local dev test script, verify UI and persona end-to-end`

### Phase 1 Gate
- [ ] `P1-GATE-LOCAL` Dev test passes (UI + persona) — no USB required, can do now
- [ ] `P1-GATE-HW` Hardware test on 2+ physical OS variants — requires USB drive

---

### 1H — Rebrand: DOOMSDAY → DOOMSDAY.AI (user request)
**Scope:** Brand display name = `DOOMSDAY.AI`. Ollama model ID = `doomsday-ai` (dots invalid in Ollama).
- [x] `P1-34` Update `drive/config.sh`: `DOOMSDAY_APP_NAME="DOOMSDAY.AI"`, `DOOMSDAY_MODEL_NAME="doomsday-ai"`
- [x] `P1-35` Update `drive/config.bat`: same
- [x] `P1-36` Update `drive/ui/config.js`: `appName: 'DOOMSDAY.AI'`, `model: 'doomsday-ai'`
- [x] `P1-37` Update `drive/ui/index.html`: `<title>`, `<h1>`, subtitle
- [x] `P1-38` Update `drive/ui/app.js`: overlay title, persona label in chat
- [x] `P1-39` Update launcher terminal output in `START_MAC.command` + `START_WINDOWS.bat`
- [x] `P1-40` Update `drive/Modelfile` comment header (model name set at create-time, FROM unchanged)
- [x] `P1-41` Update `docs/`, `README.md`, `LEGAL/`, `FIRST_RUN_README.txt` display references
- [x] `P1-42` Commit: `rebrand: DOOMSDAY → DOOMSDAY.AI across all files`

### 1I — Persona Behavior Fix (Added 2026-05-07)
**Problem:** Model constantly re-introduces itself and adds preachy disclaimers to simple questions.
- [x] `P1-43` Rewrite `drive/Modelfile` SYSTEM prompt
- [x] `P1-44` Rebuild `doomsday-ai` model from updated Modelfile
- [x] `P1-45` Tested: model no longer self-introduces
- [x] `P1-46` Committed: `fix(model): rewrite system prompt`

### 1J — Library Browser UI (Added 2026-05-07)
**Goal:** Full-panel library overlay so users can browse and read all preloaded content.
- [x] `P1-47` Create `drive/content/library.json` — dynamic catalog driving the library UI
- [/] `P1-48` Add 📚 LIBRARY button to header in `index.html`
- [/] `P1-49` Build full-panel library overlay HTML/CSS
- [/] `P1-50` Build JS logic: open/close, category nav, file browsing, TXT reader, PDF hand-off
- [ ] `P1-51` Add search-within-reader functionality
- [ ] `P1-52` Handle missing-file gracefully (show "not yet downloaded" message)
- [ ] `P1-53` Test library with all content types (txt, pdf, zim)
- [ ] `P1-54` Commit: `feat(ui): offline library browser with text reader`

---

## PHASE 2: Content Library
> Goal: Drive has the survival knowledge payload that justifies the price.

### 2A — Automation Scripts
- [ ] `P2-01` Write `scripts/setup.sh` — one-command full dev environment setup
- [ ] `P2-02` Write `scripts/download_runtime.sh` — Ollama binaries for Win/Mac-ARM/Mac-Intel
- [ ] `P2-03` Write `scripts/download_models.sh` — Phi-3 Mini Q4_K_M from HuggingFace
- [ ] `P2-04` Write `scripts/download_content.sh` — Kiwix ZIMs + public domain PDFs
- [ ] `P2-05` Test all download scripts end-to-end on clean machine

### 2B — PDF Library
- [ ] `P2-06` Source + verify license for each PDF (public domain / CC confirmed)
- [ ] `P2-07` Download: Army FM 21-76 Survival Manual
- [ ] `P2-08` Download: FEMA Are You Ready? Guide
- [ ] `P2-09` Download: CDC Emergency Preparedness
- [ ] `P2-10` Download: USDA Home Canning Guide
- [ ] `P2-11` Download: Army FM 3-05.70 Survival
- [ ] `P2-12` Download: EPA Emergency Drinking Water
- [ ] `P2-13` Download: Where There Is No Doctor (Hesperian, CC licensed)
- [ ] `P2-14` Download: Where There Is No Dentist (Hesperian, CC licensed)
- [ ] `P2-15` Add all PDFs to `scripts/download_content.sh` for reproducible builds

### 2C — Kiwix Content
- [ ] `P2-16` Download: Wikipedia survival/medicine ZIM slice
- [ ] `P2-17` Verify ZIM loads correctly in Kiwix browser
- [ ] `P2-18` Add Kiwix reader binary to drive (all platforms)

### 2D — Survival Prompt Pack
- [ ] `P2-19` Write 100+ survival prompts across 6 categories to `drive/prompts/survival_prompts.md`
- [ ] `P2-20` Commit: `feat(content): add survival prompt library`

### 2E — Build & Test Scripts
- [ ] `P2-21` Write `scripts/build_image.sh` — assemble all components, verify checksums
- [ ] `P2-22` Write `scripts/test_drive.sh` — smoke test all required components
- [ ] `P2-23` Test: `test_drive.sh` passes cleanly on fully populated drive
- [ ] `P2-24` Commit: `feat(scripts): add build, flash, and smoke test automation`

### 2F — Bible & Religious Texts (Added 2026-05-07)
**Legal status:** KJV (1611), WEB, ASV, YLT all public domain. NIV/NLT/ESV cannot be included.
- [x] `P2-25` Verified legal status of all translations
- [x] `P2-26` Added KJV, WEB, ASV to `download_content.sh`
- [x] `P2-27` Updated Modelfile to reference Bible in knowledge base
- [/] `P2-28` Add YLT, Darby, other religious texts (Quran, Gita, BoM, Stoic texts)
- [/] `P2-29` Add US founding documents, Black’s Law Dictionary (PD)
- [ ] `P2-30` Update `FIRST_RUN_README.txt` to mention library content

### Phase 2 Gate
- [ ] `P2-GATE` Run `setup.sh` on clean machine → `test_drive.sh` all pass → total size < 54GB

---

## PHASE 3: Business Assets & Marketing
> Goal: Everything needed to open the store and post first content.
> **STATUS: ON PAUSE** — User request 2026-05-07. Resume only when explicitly told to.

### 3A — Marketing Copy
- [ ] `P3-01` Write `marketing/copy/shopify_product_page.md` — full listing copy
- [ ] `P3-02` Write `marketing/copy/shopify_faq.md` — 15 FAQ answers
- [ ] `P3-03` Write `marketing/copy/hardware_requirements.md` — pre-purchase spec page
- [ ] `P3-04` Write `marketing/copy/tiktok_scripts.md` — 10 video scripts with hooks + CTAs
- [ ] `P3-05` Write `marketing/copy/email_welcome.md` — 3-email post-purchase sequence

### 3B — Product Photography
- [ ] `P3-06` Generate: USB drive on tactical/survival gear background
- [ ] `P3-07` Generate: Laptop open in off-grid setting, DOOMSDAY UI visible
- [ ] `P3-08` Generate: Packaging mockup (matte black Mylar bag)
- [ ] `P3-09` Generate: Hero banner image for Shopify store

### 3C — Shopify + Legal Setup Guide
- [ ] `P3-10` Write `docs/SHOPIFY_SETUP.md` — step-by-step store configuration
- [ ] `P3-11` Write Terms of Service, Privacy Policy, Refund Policy, Medical Disclaimer templates

### Phase 3 Gate
- [ ] `P3-GATE` User reviews and approves all copy + imagery before store goes live

---

## PHASE 4: Launch
> Goal: Store live, first drives shipping, first content posted.

- [ ] `P4-01` Order 25× SanDisk 64GB USB 3.2 drives
- [ ] `P4-02` Order packaging (Mylar bags, kraft card inserts)
- [ ] `P4-03` Flash 10 drives from master image
- [ ] `P4-04` QC each drive with test script
- [ ] `P4-05` Shopify store live
- [ ] `P4-06` Etsy listing live
- [ ] `P4-07` Post TikTok #1: Transparency video ("what's actually on this drive")
- [ ] `P4-08` Post TikTok #2: Demo video (Wi-Fi off, survival question, AI answers)
- [ ] `P4-09` First sale

### Phase 4 Gate
- [ ] `P4-GATE` 5 units sold, zero critical customer issues, one video with 10K+ views

---

## DEFERRED BACKLOG (Post-Launch)

- `[~]` RAG integration — model actively searches survival PDF library at query time
  - Architecture NOTE (from Gemini review): Do NOT use LangChain or Pinecone. Use a precompiled self-contained binary (Go or Rust) that handles local embeddings + vector search silently. Keeps host machine footprint near zero. Research: chromem-go, usearch, or a custom sqlite-vec wrapper.
- `[~]` Tier 2 PRO drive (Mistral 7B, 128GB, $119)
- `[~]` Family Pack SKU ($199, 3× drives)
- `[~]` Amazon listing (after 50+ reviews)
- `[~]` TikTok Shop integration
- `[~]` Affiliate program setup
- `[~]` LoRA fine-tuning on survival dataset (Year 2)
- `[~]` Windows code-signing certificate ($200/year EV cert) — eliminates SmartScreen friction permanently
- `[~]` macOS Developer ID certificate — eliminates Gatekeeper friction permanently
- `[~]` Kiwix server mode (serve ZIM to multiple devices on local network)
- `[~]` Raspberry Pi "Survival Server" product (higher-ticket offline AI box)
- `[~]` USB activity LED watchdog — hardware indicator when Ollama is running (advanced)
