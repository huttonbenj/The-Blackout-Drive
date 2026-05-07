# DECISIONS.md — Architectural Decision Log

> Every non-trivial decision made during this project is logged here with rationale.
> If you're wondering why something was done a certain way, check here first.

---

## Decision Log

---

### D-001: AI Persona Name → DOOMSDAY.AI
**Date:** 2026-05-07  
**Status:** Decided  
**Decision:** The AI model persona is named `DOOMSDAY.AI`. The internal Ollama model identifier is `doomsday-ai` (dots are invalid in Ollama model names).  
**Rationale:** Aligns with the product brand ("DOOMSDAY.AI"), is memorable, and communicates the survivalist use case immediately. Creates brand consistency between product name and AI identity.  
**Implications:** The Ollama Modelfile creates a model named `doomsday-ai`. The UI displays "DOOMSDAY.AI" as the AI name. Marketing copy references "Ask DOOMSDAY.AI."

---

### D-002: Default Model → Phi-3 Mini Q4_K_M
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Tier 1 uses Microsoft's Phi-3 Mini at Q4_K_M quantization.  
**Rationale:**
- MIT License — the cleanest possible license, zero commercial restrictions
- ~2.3GB on disk — fits comfortably on 64GB drive with room for content library
- Runs on 8GB RAM — the lowest common denominator that covers ~90% of laptops sold in the last 5 years
- No attribution requirements beyond including the MIT LICENSE file
- Genuinely capable model — Microsoft optimized it specifically for reasoning tasks  
**Alternatives considered:**
- Mistral 7B (Apache 2.0) — better quality but needs 16GB RAM, cuts out too many potential customers
- Llama 3 8B — needs 16GB RAM AND has Meta attribution requirements ("Built with Llama" badge)
- Qwen 2.5 (Apache 2.0) — good quality but Chinese origin may trigger customer distrust in prepper market  
**Tier 2 model (PRO, $119):** Mistral 7B Instruct Q4_K_M — deferred to Phase 2

---

### D-003: Chat UI → Custom HTML/CSS/JS
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Build a custom offline chat interface from scratch.  
**Rationale:**
- Zero CDN dependencies — every asset is local on the drive, works 100% offline
- Full brand control — tactical/survival aesthetic impossible to achieve cleanly with pre-built UIs
- Lightweight — Open WebUI is ~500MB+ when fully packaged; our UI will be <500KB
- No upstream breakage — our UI doesn't depend on external projects that could change or die
- Ollama's API is simple (`/api/chat`, streaming JSON) — easy to integrate in vanilla JS  
**Alternatives considered:**
- Open WebUI — battle-tested, more features, but heavy, hard to brand, requires Node/Python runtime
- Ollama's built-in UI — minimal, not portable, not brandable  
**Implementation:** `drive/ui/index.html` + `style.css` + `app.js` — all vanilla, no build step required

---

### D-004: Launcher Mechanism → Portable Ollama Binary
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Ship the Ollama binary on the drive itself, launched from the drive.  
**Rationale:**
- True portability — customer plugs in drive on ANY machine without pre-installing anything
- No host OS modifications — nothing gets installed, no registry changes, no files written to host
- Ollama provides pre-compiled binaries for Windows x86_64, macOS ARM, macOS Intel
- `OLLAMA_MODELS` env var controls where models are loaded from → point to drive  
**Key technical detail:** The launcher must set `OLLAMA_MODELS` and `OLLAMA_HOST` before starting Ollama, and must clean up (kill Ollama process) on exit to not leave phantom processes running on the host.

---

### D-005: Content Licensing → Public Domain + CC BY-SA Only
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Only include content that is public domain or CC BY-SA 4.0 licensed.  
**Rationale:** Zero legal risk. Public domain content (US government publications, pre-1928 works) has no requirements. CC BY-SA 4.0 content (Wikipedia) permits commercial redistribution with attribution. We will never include copyrighted PDFs from commercial publishers.  
**Approved sources:**
- FEMA publications → public domain (US government)
- Army Field Manuals → public domain (US military)
- CDC publications → public domain (US government)
- USDA Extension publications → public domain (US government)
- Hesperian Health Guides ("Where There Is No Doctor") → CC licensed, free for redistribution
- Wikipedia via Kiwix ZIM → CC BY-SA 4.0

---

### D-006: Sales Channel Order → Shopify First
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Launch on Shopify, then Etsy, then TikTok Shop, then Amazon.  
**Rationale:**
- Shopify: highest margins (only Shopify fee ~2.9%), full customer data, email list ownership
- Etsy: gift/novelty buyers, low competition in this category, easy listing
- TikTok Shop: highest volume potential once a video performs, but algorithm dependency
- Amazon: highest volume overall, but brutal for new sellers — enter after 50+ reviews from other channels  
**Deferred:** Amazon until after launch validation

---

### D-007: Ollama Modelfile Over Fine-Tuning for v1
**Date:** 2026-05-07  
**Status:** Final  
**Decision:** Use an Ollama Modelfile (system prompt + parameters) rather than LoRA fine-tuning for v1.  
**Rationale:**
- 30 minutes of work vs. days of GPU compute
- Produces ~90% of the practical differentiation vs. the base model
- Fine-tuning requires a high-quality survival Q&A dataset we haven't curated yet
- Launch first, validate market, then invest in fine-tuning if revenue justifies it  
**Future state:** LoRA fine-tuning on a curated survival dataset is in the deferred backlog (Year 2)

---

### D-008: No Code Signing for v1
**Date:** 2026-05-07  
**Status:** Final — revisit at $5K MRR  
**Decision:** Do not purchase a code signing certificate for launch.  
**Rationale:**
- EV code signing costs $200-400/year and requires business verification time
- macOS Gatekeeper and Windows SmartScreen bypass instructions are well-documented and manageable
- All competitors (PortableMind, BunkerAI, OffGrid AI Toolkit) ship unsigned binaries
- The Ollama binary itself may already be signed by Ollama Inc.  
**Mitigation:** Clear step-by-step Gatekeeper/SmartScreen bypass guide shipped on the drive and on the website. Video walkthrough posted on TikTok.
