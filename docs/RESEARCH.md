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
