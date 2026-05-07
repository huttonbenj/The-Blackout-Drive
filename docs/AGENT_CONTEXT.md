# AGENT_CONTEXT.md — DOOMSDAY.AI Project

> **This document is the single source of truth for any AI agent, developer, or collaborator joining this project.**
> Read this file first. Read all docs in `docs/` second. Then look at the code.
> Do not make assumptions. If something is unclear, check `docs/DECISIONS.md` first.

---

## ⚠️ IMMUTABLE RULE — BACKLOG IS APPEND-ONLY

**This rule applies to ALL AI agents, contributors, and developers without exception:**

> **NEVER delete, replace, or overwrite existing entries in `task.md` or any backlog/planning document.**
> **You may ONLY add new entries.** Mark items `[x]` when done. Add notes or sub-items below existing ones.
> The backlog is the permanent historical record of all decisions, work, and context.
> Overwriting it destroys project memory and creates confusion between sessions.

The full backlog lives in `~/.gemini/antigravity/brain/{conversation-id}/task.md` (Antigravity brain).
Key docs that are also append-only: `docs/DECISIONS.md`, `docs/STATE.md`.

---

## What Is This Project?

**DOOMSDAY.AI** is a physical product business. We manufacture and sell USB drives preloaded with a fully offline AI survival system, targeted at the prepper / self-reliance / survivalist market.

The drive contains:
- A portable AI engine (Ollama) that runs without installation on the host computer
- A custom AI persona called **DOOMSDAY.AI** — tuned specifically for survival, field medicine, and grid-down scenarios
- A curated offline survival knowledge library (Wikipedia survival slice, public domain PDFs)
- A 100+ prompt survival library
- A custom offline chat UI with tactical aesthetic

**The customer plugs in the USB, double-clicks a launcher, and has a fully functional offline AI running on their laptop — no internet, no accounts, no cloud.**

---

## Business Overview

| Field | Value |
|-------|-------|
| Product name | DOOMSDAY.AI |
| LLC | Hutton Technologies |
| Lead developer/architect | AI agent (Antigravity) — owns the entire project |
| Drive GitHub | https://github.com/huttonbenj/Doomsday-Drive (PUBLIC — MIT license) |
| Web GitHub | https://github.com/huttonbenj/Doomsday-Web (PRIVATE) |
| Drive local path | `/Users/benjamin/github/doomsday-drive` |
| Web local path | `/Users/benjamin/github/Doomsday-Web` |
| Target market | Prepper / survivalist / self-reliance niche |
| Price | $79 (Tier 1), $119 (Tier 2 PRO) |
| Content packs | Free and paid packs — purchased via doomsday.ai website |
| Margin | ~78% gross margin |
| Hardware | 64GB SanDisk Ultra Dual USB-C/USB-A 3.2 |
| Sales channels | doomsday.ai (primary) → Etsy → TikTok Shop → Amazon → Shopify (marketplace only) |

Full business model, unit economics, and competitive analysis: see `docs/BUSINESS_MODEL.md` and `docs/RESEARCH.md`.

---

## Tech Stack

### Drive (doomsday-drive — PUBLIC)

| Component | Technology | Why |
|-----------|-----------|-----|
| AI engine | Ollama (portable, no-install binary) | MIT license, cross-platform, zero dependency |
| Default model | Phi-3 Mini (Q4_K_M quantization, ~2.3GB) | MIT license, runs on 8GB RAM, no install |
| Persona | Ollama Modelfile — DOOMSDAY.AI | Full behavioral tuning, short numbered rules |
| Chat UI | Custom HTML/CSS/JS (zero CDN deps) | Full control, survives upstream changes |
| Local server | Python 3 (stdlib only) — `scripts/server.py` | File mgmt, downloads, manifest generation |
| Library system | `library.js` + `api.js` — vanilla JS | Manifest-driven, offline-first, plug-and-play |
| Content catalog | `content/library.json` + `catalog_extended.json` | Base + downloadable pack definitions |
| OS support | Windows 10/11, macOS ARM (M1+), macOS Intel | Covers >99% of prepper laptop hardware |
| License | MIT (open source) | Trust signal + community + marketing story |

### Website (Doomsday-Web — PRIVATE)

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | Next.js 15 (App Router) | Best for marketing site + SEO + e-commerce |
| Database | Supabase (Postgres + auth) | Free tier generous, auth built in |
| Payments | Stripe | Industry standard, best DX |
| Hosting | Vercel | Native Next.js, free tier, edge CDN |
| License API | FastAPI on Render.com | Stripe webhook → key generation → email |
| Email | Resend (transactional) | Simple API, generous free tier |
| File CDN | Cloudflare R2 | Cheap object storage for content pack files |
| Auth | Supabase Auth | Integrated with DB, no extra service needed |

---

## Engineering Rules (Non-Negotiable)

These rules were set by the project owner and must be followed at all times:

1. **BACKLOG IS APPEND-ONLY.** Never delete or replace entries in task.md or any planning doc. Only add. Mark done with `[x]`.
2. **No guesswork.** Every implementation decision must be proven before it's committed.
3. **No bandaids.** If something doesn't work cleanly, fix the root cause.
4. **No shortcuts.** Every feature is built completely or not at all.
5. **Prove it works.** Each phase ends with a verification step before moving on.
6. **Commit as you go.** Every logical unit of work gets its own git commit with a meaningful message.
7. **Documentation lives in the repo.** Any AI agent picking this up must be able to get full context from `/docs/` alone.
8. **Nothing ships that hasn't been tested on real hardware.** The launcher must be verified on all 4 OS variants before any drives are flashed.
9. **Two repos, two concerns.** Drive code = `doomsday-drive` (public). Business code = `Doomsday-Web` (private). Never mix them.
10. **Content catalog paths are fixed.** `dest` fields in catalog JSONs are immutable — the library maps files by exact path.

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
| AI persona name | DOOMSDAY.AI |
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

1. **Read this file completely** — all rules and decisions are here
2. **Read `docs/STATE.md`** — find out exactly what phase/task is in progress
3. **Read `docs/DECISIONS.md`** — understand the rationale behind all choices
4. **Check the Antigravity brain backlog** (`task.md`) — the master task list
5. **Look at recent git commits** — `git log --oneline -20` to see what's already done
6. **NEVER remove from the backlog** — append-only, always. Rule #1 above.
7. **Never skip verification gates** — each phase has a gate that must pass before next
8. **Always commit after completing a logical unit** — don't batch many changes into one
9. **Always test before committing** — especially launcher scripts
10. **Check both repos** when relevant — drive logic in `doomsday-drive`, site logic in `Doomsday-Web`

---

## Contact & Ownership

- **Project Owner:** Benjamin Hutton (huttonbenj on GitHub)
- **Lead Architect:** AI agent — fully autonomous implementation
- **LLC:** Hutton Technologies
- **Repo:** https://github.com/huttonbenj/Doomsday-Drive (private)
