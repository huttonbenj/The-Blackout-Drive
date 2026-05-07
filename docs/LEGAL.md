# LEGAL.md — License Compliance Guide

> Every component on the Doomsday Drive has been reviewed for commercial redistribution rights.
> This document is the authoritative compliance record. Do not add any component to the drive without first verifying its license here.

---

## ⚠️ Important Disclaimer
This document reflects our analysis of publicly available license terms. It does not constitute legal advice. For concerns beyond what's documented here, consult a qualified IP attorney.

---

## Component License Matrix

| Component | License | Commercial Use | Redistribution | Requirements |
|-----------|---------|---------------|----------------|-------------|
| Ollama | MIT | ✅ | ✅ | Include LICENSE file |
| Phi-3 Mini (Microsoft) | MIT | ✅ | ✅ | Include LICENSE file |
| Mistral 7B (Tier 2) | Apache 2.0 | ✅ | ✅ | Include LICENSE + NOTICE file |
| Wikipedia content | CC BY-SA 4.0 | ✅ | ✅ | Attribution (baked into ZIM) |
| Kiwix reader | GPL v3 | ✅ | ✅ | Include license + link to source |
| FEMA publications | Public Domain | ✅ | ✅ | None |
| US Army Field Manuals | Public Domain | ✅ | ✅ | None |
| CDC publications | Public Domain | ✅ | ✅ | None |
| USDA publications | Public Domain | ✅ | ✅ | None |
| Hesperian Guides | CC (free redistribution) | ✅ | ✅ | Attribution |
| Our custom Modelfile | Ours (MIT-based) | ✅ | ✅ | N/A |
| Our custom UI | Ours | ✅ | ✅ | N/A |

---

## Detailed Component Notes

### Ollama
- License: MIT License
- Source: https://github.com/ollama/ollama/blob/main/LICENSE
- Action required: Ship `drive/LEGAL/OLLAMA_LICENSE.txt` (copy of MIT license with Ollama's copyright notice)
- We do NOT use the Ollama trademark in our product name

### Phi-3 Mini (Microsoft)
- License: MIT License
- Source: https://huggingface.co/microsoft/Phi-3-mini-4k-instruct/blob/main/LICENSE
- Action required: Ship `drive/LEGAL/PHI3_LICENSE.txt`
- Note: MIT license permits sublicensing and selling

### Mistral 7B (PRO tier, deferred)
- License: Apache License 2.0
- Source: https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/blob/main/LICENSE
- Action required: Ship Apache 2.0 license + NOTICE file when Tier 2 is built
- Note: Apache 2.0 requires attribution and license inclusion but permits commercial sale

### Meta Llama 3 (NOT used — documented for future reference)
- License: Meta Llama 3 Community License (NOT standard open source)
- Key requirement: Must display "Built with Llama" on product/website
- Restriction: Cannot use outputs to train competing LLMs
- Decision: NOT using Llama 3 for Tier 1 due to attribution branding requirement. Revisit for Tier 2.

### Wikipedia / Kiwix ZIM Files
- Wikipedia content: CC BY-SA 4.0 — commercial redistribution explicitly permitted
- Kiwix software: GPL v3 — can distribute binary, must provide link to source
- Action required: `drive/LEGAL/WIKIPEDIA_ATTRIBUTION.txt` + note that Kiwix is GPL v3 at kiwix.org/source
- The ZIM format includes article attribution baked in — customers can see article sources

### Public Domain PDFs (US Government)
- All US federal government publications are automatically public domain under 17 U.S.C. § 105
- No copyright, no license requirements, no attribution required
- Confirmed public domain: FEMA publications, Army Field Manuals, CDC publications, USDA publications, EPA publications

### Hesperian Health Guides
- "Where There Is No Doctor" and "Where There Is No Dentist"
- Hesperian Foundation explicitly states these are free to reproduce for non-commercial and educational use
- They also permit redistribution with attribution for humanitarian purposes
- Action required: Include attribution note in PDF folder and in LEGAL notices

---

## Files Required on Drive (drive/LEGAL/)

- [ ] `DISCLAIMER.txt` — Medical/liability disclaimer (our content, required)
- [ ] `OLLAMA_LICENSE.txt` — MIT license text with Ollama's copyright
- [ ] `PHI3_LICENSE.txt` — MIT license text with Microsoft's copyright
- [ ] `WIKIPEDIA_ATTRIBUTION.txt` — CC BY-SA 4.0 attribution for Wikipedia content
- [ ] `OPEN_SOURCE_NOTICES.txt` — Master list of all components and their licenses

---

## Product Liability — Medical Claims

**The single biggest legal risk is not software licensing — it's product liability from medical-adjacent use.**

Required disclaimer (must appear on: the drive, the website, packaging insert):

> *"This device and the AI responses it generates are for educational and informational purposes only. The information provided is not a substitute for professional medical advice, diagnosis, or treatment. In any medical emergency, contact emergency services (911) immediately. Hutton Technologies makes no warranty regarding the accuracy of AI-generated responses."*

This disclaimer must be:
1. In `drive/LEGAL/DISCLAIMER.txt`
2. On the Shopify product page (below the fold)
3. In the Terms of Service
4. Shown in the UI (footer of the chat interface)
5. On the packaging insert card

---

## What We Can NEVER Include

- ❌ Copyrighted books (SAS Survival Guide, Bushcraft 101, etc.) — even if purchased
- ❌ Copyrighted PDFs scraped from the internet
- ❌ Any content from piracy sites
- ❌ Models with non-commercial licenses (some HuggingFace models have NC restrictions)
- ❌ Any content that requires a subscription or account to download legally
