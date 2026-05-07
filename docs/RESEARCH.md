# RESEARCH.md — Competitive Analysis & Market Data

> This is the distilled competitive research conducted May 2026. Update when new competitors are identified.

---

## Market Size

| Segment | Annual Size (USA) |
|---------|-----------------|
| Survival tools market | $1.33 billion |
| Household preparedness spending | $11 billion |
| Disaster preparedness systems | $62.82 billion |
| Total "prepper economy" estimate | ~$70 billion |

The prepper market is emotionally motivated and already conditioned to buy "just in case" products. Same psychology as freeze-dried food buckets — peace of mind in a package.

---

## Competitive Landscape (May 2026)

### 1. PortableMind — portablemind.io
**Market leader. The one to beat.**

- Price: $49 (CORE, Windows only) → higher tiers for v1.5 (Voice + Vision) and MAX-SPEED
- Units sold: **4,000+ (stated on homepage)**
- Target: Travelers, privacy users, field workers, "outage preparedness" — NOT prepper-native
- Tech: Custom firmware versioning (v1.5), Voice mode (SCOUT), Vision (photo analysis), phone access via local network, desktop launcher app
- Platform: Shopify
- Weakness: **Generic positioning. Not a prepper product. Survival is an afterthought.**
- URL: portablemind.io
- Notable: They have a "Survival Terminal" product (pre-built PC box) as a premium SKU

### 2. BunkerAI — bunkerai.io
**Closest to our target positioning. Pure prepper marketing.**

- Price: Not publicly listed (shop to see)
- Units sold: Claims "1,500+, Batch 3 almost gone" — classic scarcity tactic
- Target: 100% prepper/survivalist — grid-down framing is their entire brand
- Tech: Unknown — no spec page, no model names, no hardware disclosed
- Platform: Shopify
- Branding: Military/tactical, marquee scrolling survival use cases
- Weakness: **Complete black box. Zero technical transparency. Looks like a dropship operation.**
- Our advantage: Be the honest, transparent version of BunkerAI

### 3. OffGrid AI Toolkit — offgridaitoolkit.com
**Most sophisticated product. Overengineered.**

- Price: $129+ (starting price)
- Target: Preppers, homesteaders, overlanders, hikers, healthcare, privacy advocates, spiritual users
- Tech: Google Gemma 3 (4B, 12B, 27B), MedGemma, Vision AI, 64GB SanDisk, online Command Center
- Differentiators: 4-model "AI Council" synthesis, knowledge base save system, image generation, free online demo
- Platform: Shopify
- Weakness: **Too complex. Too many tiers. The offline/survival narrative is diluted by their "online Command Center" feature. A prepper doesn't want 4 AI models deliberating — they want one thing that works.**

### 4. Docket Mini — docketoffline.ai
**The Etsy/TikTok player.**

- Price: ~$79 (sale from ~$99)
- Specs: 64GB or 128GB, AES 256-bit, USB 3.1 Gen 1, 7-12 pre-installed models
- Platform: Etsy + TikTok Shop (went viral there)
- Weakness: Etsy branding signals low production value. No survival-specific angle. Generic "privacy AI."

### 5. Sur5 — sur5ve.com / Indiegogo
**The crowdfund experiment. Basically failed.**

- Price: $48-99 (Indiegogo tiers)
- Funding raised: ~$5,300, fewer than 20 backers
- Status: Fulfillment phase, campaign closed
- Lesson: Indiegogo is the wrong channel. Audience mismatch.

---

## Market Gaps We Exploit

1. **Prepper-native branding + technical transparency** — BunkerAI has branding but hides tech. PortableMind has tech credibility but generic branding. Nobody does both.

2. **Genuine survival content library** — Everyone says "survival AI" but nobody ships a real, organized knowledge base. The AI is only as useful as its domain knowledge.

3. **A "trust layer"** — The #1 complaint is "is this a scam?" Nobody addresses this head-on with a transparency video and spec page.

4. **Survival-specific prompt library** — Generic prompts vs. 100+ tested real-world survival scenarios.

---

## Technical Reality (From Research)

**The "Potato PC" Problem:** The USB stores everything, but the customer's host computer supplies the RAM, CPU, and GPU. If someone plugs our drive into a dusty 2014 laptop with 4GB RAM, the model will crawl.

**Mitigation:**
- Set clear minimum hardware requirements BEFORE purchase
- Use Phi-3 Mini as default (runs on 8GB RAM — covers most modern laptops)
- Include hardware self-check instructions on the drive

**The Gatekeeper/SmartScreen Problem:** macOS Gatekeeper and Windows SmartScreen block unsigned binaries from unknown developers. This is the #1 customer complaint across all competitors.

**Mitigation:**
- The Ollama binary may already be signed by Ollama Inc. (reduces Mac issue)
- Ship step-by-step bypass instructions on the drive
- Create a video walkthrough for both platforms
- Long-term: EV code signing certificate ($200-400/year) once revenue justifies it

---

## Pricing Psychology

The $79 price point is the validated sweet spot in this market:
- Docket Mini: $79
- BunkerAI: Unknown, but in this range based on similar products
- PortableMind: Starts at $49 (underpriced for what they offer)
- OffGrid AI Toolkit: $129+ (premium position)

$79 is impulse-buy territory for a prepper who has already bought a $400 freeze-dryer and a $200 Faraday cage. It's the same price as a quality multi-tool.

---

## Competitor Software Deep-Dive (Added May 2026)

### PortableMind — What the Software Actually Does
- **Custom desktop app** (not web UI). Launches as a native binary from the drive.
- **Voice Mode:** Fully offline speech-to-text using Whisper.cpp (or similar). Talk out loud, no mic permissions sent anywhere.
- **SCOUT Vision:** Drag and drop photos, documents, labels — multimodal AI reads and extracts text offline.
- **Local Network Hosting:** Serves the UI on the local network so user can connect their phone via Wi-Fi router, no internet. AI accessible from phone even if host is across the room.
- **AES Chat Export ("Chat Packs"):** Encrypts and exports conversation histories as portable files. Move between machines without cloud.
- **Firmware Versioning:** Built-in updater (v1.5 currently). Updates UI and model when user opts in.
- **RAM requirement:** 16GB minimum to run well. Limits their addressable market.
- **No survival content library:** Generic workspace tool. No PDFs, no Wikipedia, no knowledge base.

### Docket Mini — What the Software Actually Does
- **12 pre-loaded AI models** switchable via dropdown: survival, coding, research, medical, vision, writing.
- **"Chat with Files" (Local RAG):** Upload PDFs directly into chat — AI references them offline with citations. Uses local embedding model + vector database.
- **30+ pre-installed survival guides** accessible within the interface.
- **AES 256-bit encryption** for conversations and user files on the drive.
- **Reality check:** 12 models = 32GB+ just for model files. Paralyzing for non-technical users. Reviews note "writer AI needs work" suggesting smaller/outdated models. Hardware (sliding USB mechanism) gets complaints.

### OffGrid AI Toolkit — What the Software Actually Does
- **4-model "AI Council":** Runs Gemma 3 4B, 12B, 27B + MedGemma simultaneously. Multiple models deliberate to synthesize one answer.
- **Vision & Image Generation:** Upload images for analysis + local image generation.
- **Knowledge Save System:** Complex system for archiving user-created knowledge bases.
- **Online "Command Center" (FATAL FLAW):** Syncs with cloud models (GPT, Claude, Gemini). Completely defeats the offline/air-gapped narrative.
- **Pricing:** $129+ starting. Over-complex. Multiple confusing tiers.

### BunkerAI — What the Software Actually Does
- **Black box:** No disclosed model names, no tech stack, no hardware specs.
- **Marketing claims:** "Offline medical diagnostics," "grid-down engineering."
- **Likely reality:** Ollama + open-source model with a custom UI wrapper. Community speculation includes malware suspicion due to zero transparency.
- **Key takeaway:** Their weakness is our strength. Full transparency is a moat.

### Open-Source Threat: techjarves/Portable-AI-USB (GitHub)
- **Free automated script** that installs Ollama + AnythingLLM + multiple models onto a USB drive.
- **Models bundled:** NemoMix Unleashed, Mistral, Phi-3.5
- **Cross-platform:** .bat (Windows) + .command (Mac) launchers, auto-clears cached paths.
- **Weakness:** Requires user to format drives, run terminal scripts, debug their own errors. Zero curated content, no survival library, no persona, no UI polish. Purely the engine.
- **Our market:** Non-technical buyers who want it to "just work." Different user entirely.

---

## V2+ Master Feature Backlog (For Future AI Agents)
> These are features our competitors have that we should build in V2+.
> DO NOT build any of these for V1. V1 = simple HTML/JS UI.

### Core Architecture & Privacy
- [ ] **AES 256-bit Encryption** — Encrypt chat history and user files on the drive
- [ ] **Encrypted Chat Export ("Chat Packs")** — Securely move conversation histories between machines
- [ ] **Local Network Hosting** — Serve UI on local network so phone can access AI over Wi-Fi without internet (NOTE: Actually simple to implement — change Ollama bind to 0.0.0.0 and serve UI on LAN. Potential V1.5.)
- [ ] **Firmware Versioning & Updater** — Built-in mechanism to patch UI or swap models when user opts in online

### Intelligence & Modalities
- [ ] **Voice Mode (Whisper.cpp)** — Fully offline speech-to-text so user can talk to AI hands-free
- [ ] **Vision AI (SCOUT)** — Multimodal: drag and drop photos/docs, AI reads and extracts text offline
- [ ] **Local RAG ("Chat with Files")** — V2 PRIORITY #1. Local embedding model + vector DB. User uploads PDFs, AI references them with citations. Implementation: chromem-go, LanceDB, or sqlite-vec (NOT LangChain/Pinecone — those require internet)
- [ ] **Multi-Model Selection** — Dropdown of specialized models (Survival, Medical, Coding, Writing)
- [ ] **"AI Council" Synthesis** — Multiple models deliberate to synthesize one answer (V3, complex)

### Hardware & Upsells
- [ ] **Faraday Pouch Upsell** — Carbon fiber EMP shielding pouch. COGS ~$2-3, sell for $14.99 at checkout. PortableMind does this. ~30% add-on rate = meaningful AOV lift. Source from Alibaba.
- [ ] **High-Speed NVMe Tier** — USB SSD (1000 MB/s vs 150MB/s) for faster initial model load. DD-03 SKU at $149+
- [ ] **USB Duplicator Hub** — 7-11 port hub for flashing multiple drives simultaneously (~$40-60 on Amazon)

