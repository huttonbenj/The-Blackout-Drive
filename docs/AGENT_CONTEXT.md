# AGENT_CONTEXT.md — Doomsday Drive Project

> **This document is the single source of truth for any AI agent, developer, or collaborator joining this project.**
> Read this file first. Read all docs in `docs/` second. Then look at the code.
> Do not make assumptions. If something is unclear, check `docs/DECISIONS.md` first.

---

## What Is This Project?

**Doomsday Drive** is a physical product business. We manufacture and sell USB drives preloaded with a fully offline AI survival system, targeted at the prepper / self-reliance / survivalist market.

The drive contains:
- A portable AI engine (Ollama) that runs without installation on the host computer
- A custom AI persona called **DOOMSDAY** — tuned specifically for survival, field medicine, and grid-down scenarios
- A curated offline survival knowledge library (Wikipedia survival slice, public domain PDFs)
- A 100+ prompt survival library
- A custom offline chat UI with tactical aesthetic

**The customer plugs in the USB, double-clicks a launcher, and has a fully functional offline AI running on their laptop — no internet, no accounts, no cloud.**

---

## Business Overview

| Field | Value |
|-------|-------|
| Product name | Doomsday Drive |
| LLC | Hutton Technologies |
| Lead developer/architect | AI agent (Antigravity) — owns the entire project |
| GitHub | https://github.com/huttonbenj/Doomsday-Drive |
| Local path | `/Users/benjamin/github/doomsday-drive` |
| Target market | Prepper / survivalist / self-reliance niche |
| Price | $79 (Tier 1), $119 (Tier 2 PRO) |
| Margin | ~78% gross margin |
| Hardware | 64GB SanDisk Ultra Dual USB-C/USB-A 3.2 |
| Sales channels | Shopify → Etsy → TikTok Shop → Amazon |

Full business model, unit economics, and competitive analysis: see `docs/BUSINESS_MODEL.md` and `docs/RESEARCH.md`.

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| AI engine | Ollama (portable, no-install binary) | MIT license, cross-platform, zero dependency |
| Default model | Phi-3 Mini (Q4_K_M quantization, ~2.3GB) | MIT license, runs on 8GB RAM, no install |
| Persona | Ollama Modelfile — "DOOMSDAY" | 30 min effort, full behavioral tuning |
| Chat UI | Custom HTML/CSS/JS (zero CDN deps) | Full control, survives upstream changes |
| Knowledge base | Kiwix ZIM (Wikipedia survival) + public domain PDFs | CC BY-SA 4.0 + public domain = no legal risk |
| OS support | Windows 10/11 (x86_64), macOS ARM (M1+), macOS Intel | Covers >99% of prepper laptop hardware |
| Platform | Shopify | Standard e-commerce |

---

## Engineering Rules (Non-Negotiable)

These rules were set by the project owner and must be followed at all times:

1. **No guesswork.** Every implementation decision must be proven before it's committed.
2. **No bandaids.** If something doesn't work cleanly, fix the root cause.
3. **No shortcuts.** Every feature is built completely or not at all.
4. **Prove it works.** Each phase ends with a verification step before moving on.
5. **Commit as you go.** Every logical unit of work gets its own git commit with a meaningful message.
6. **Documentation lives in the repo.** Any AI agent picking this up must be able to get full context from `/docs/` alone.
7. **Nothing ships that hasn't been tested on real hardware.** The launcher must be verified on all 4 OS variants before any drives are flashed.

---

## Repository Structure

```
doomsday-drive/
├── docs/
│   ├── AGENT_CONTEXT.md        ← YOU ARE HERE — read this first
│   ├── STATE.md                ← Current project state + what's in progress
│   ├── DECISIONS.md            ← All architectural decisions + rationale
│   ├── RESEARCH.md             ← Competitive analysis + market data
│   ├── LEGAL.md                ← License compliance guide for every component
│   ├── BUSINESS_MODEL.md       ← Unit economics, pricing, sales channels
│   └── SHOPIFY_SETUP.md        ← Store configuration guide (Phase 3)
│
├── drive/                      ← Everything that ships ON the physical USB drive
│   ├── START_WINDOWS.bat       ← Windows launcher (auto-detects drive letter)
│   ├── START_MAC.command       ← Mac launcher (auto-detects ARM vs Intel)
│   ├── START_LINUX.sh          ← Linux launcher
│   ├── Modelfile               ← Ollama Modelfile — DOOMSDAY persona definition
│   ├── runtime/                ← Ollama binaries (git-ignored, use download script)
│   ├── models/                 ← GGUF model files (git-ignored, use download script)
│   ├── ui/
│   │   ├── index.html          ← Offline chat interface entry point
│   │   ├── style.css           ← Dark tactical design system
│   │   └── app.js              ← Chat logic + Ollama API integration
│   ├── knowledge/
│   │   ├── pdfs/               ← Public domain survival PDFs
│   │   └── zim/                ← Kiwix ZIM files (Wikipedia survival slice)
│   ├── prompts/
│   │   └── survival_prompts.md ← 100+ curated survival scenario prompts
│   └── LEGAL/
│       ├── DISCLAIMER.txt      ← Medical/liability disclaimer
│       ├── OLLAMA_LICENSE.txt  ← Ollama MIT license
│       ├── PHI3_LICENSE.txt    ← Phi-3 MIT license
│       ├── WIKIPEDIA_ATTRIBUTION.txt
│       └── OPEN_SOURCE_NOTICES.txt
│
├── scripts/
│   ├── setup.sh                ← One-command full dev environment setup
│   ├── download_runtime.sh     ← Downloads Ollama binaries (all platforms)
│   ├── download_models.sh      ← Downloads Phi-3 Mini GGUF
│   ├── download_content.sh     ← Downloads Kiwix ZIMs + public domain PDFs
│   ├── build_image.sh          ← Assembles master drive folder + verifies
│   ├── flash_usb.sh            ← Flashes drive image to target USB
│   └── test_drive.sh           ← Smoke test — verifies all components present
│
├── marketing/
│   ├── copy/                   ← All product copy (Shopify, TikTok, email)
│   └── assets/                 ← Generated product images
│
├── .gitignore
└── README.md
```

---

## Current State

**See `docs/STATE.md` for the live state tracker.**

Quick summary of phases:
- **Phase 0** — Project infrastructure (repo, docs, GitHub) → `[IN PROGRESS]`
- **Phase 1** — Core drive build (Modelfile, launchers, UI, legal files) → `[TODO]`
- **Phase 2** — Content library (scripts, PDFs, ZIM, prompts) → `[TODO]`
- **Phase 3** — Business assets (copy, imagery, Shopify) → `[TODO]`
- **Phase 4** — Launch → `[TODO]`

---

## Key Decisions Already Made

See `docs/DECISIONS.md` for full rationale. Summary:

| Decision | Choice |
|----------|--------|
| AI persona name | DOOMSDAY |
| Base model | Phi-3 Mini Q4_K_M (MIT license) |
| Chat UI approach | Custom HTML/CSS/JS (zero CDN dependencies) |
| Content licensing | Public domain + CC BY-SA only (zero legal risk) |
| Launcher mechanism | Portable Ollama binary from drive, no host install |
| Sales channel order | Shopify → Etsy → TikTok Shop → Amazon |

---

## Legal Summary

- **Ollama:** MIT License — include LICENSE file on drive ✅
- **Phi-3 Mini:** MIT License — include LICENSE file on drive ✅
- **Wikipedia/Kiwix content:** CC BY-SA 4.0 — attribution baked into ZIM ✅
- **Public domain PDFs:** No requirements ✅
- **Critical:** Medical/liability disclaimer required on drive and website ✅

Full legal analysis: `docs/LEGAL.md`

---

## How to Continue Work as an AI Agent

1. Read this file completely
2. Read `docs/STATE.md` — find out exactly what phase/task is in progress
3. Read `docs/DECISIONS.md` — understand the rationale behind all choices
4. Check `task.md` (in the Antigravity brain) for the master backlog
5. Look at the most recently committed code to understand what's already built
6. **Never skip verification gates** — each phase has a gate that must pass before moving to the next
7. **Always commit after completing a logical unit** — don't batch up many changes into one commit
8. **Always test before committing** — especially launcher scripts (they must work on real OS, not just look correct)

---

## Contact & Ownership

- **Project Owner:** Benjamin Hutton (huttonbenj on GitHub)
- **Lead Architect:** AI agent — fully autonomous implementation
- **LLC:** Hutton Technologies
- **Repo:** https://github.com/huttonbenj/Doomsday-Drive (private)
