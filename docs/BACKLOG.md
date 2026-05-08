# The Blackout Drive — Master Product Backlog
> Last updated: 2026-05-07 | Maintainer: Hutton Technologies

---

## V1 — REMAINING POLISH (Ship-Ready)

### 🔴 Must Fix Before First USB Flash
- [ ] **Mobile responsive**: Library sidebar collapses or hides on <768px viewports
- [ ] **Chat bubble overflow**: Long unbroken strings (URLs, code) should word-break instead of overflow
- [ ] **Error recovery**: If Ollama crashes mid-stream, show a retry button instead of leaving a dead spinner

### 🟡 Should Fix (Quality Polish)
- [ ] **Prompt card disabled styling**: Cards should look visually "locked" when offline (add lock icon or opacity)
- [ ] **Toast stacking**: Multiple rapid toasts should stack vertically, not overlap
- [ ] **Footer disclaimer text**: Too small on mobile, wraps awkwardly below 400px
- [ ] **SPEAK button**: Non-functional if browser doesn't support SpeechSynthesis — should hide entirely
- [ ] **Markdown rendering**: BEACON responses lack formatting (no bullet points, headers). Consider adding basic markdown-to-HTML in renderMessage()

### 🟢 Nice to Have
- [ ] **CSS deduplication**: 546 `!important` overrides — full refactor to reduce specificity wars
- [ ] **Accessibility**: aria-live regions for chat, focus trap in modals, semantic headings
- [ ] **Keyboard shortcuts**: Cmd+K for clear, Cmd+L for library
- [ ] **Dark/light theme toggle** (probably not — dark theme IS the brand)

---

## V2 — FEATURE EXPANSION

### 💬 Conversation History (ChatGPT-style sidebar)
- [ ] Left sidebar showing saved conversations with timestamps
- [ ] Auto-generate conversation titles from first user message
- [ ] Create new conversation (+ button)
- [ ] Rename conversations inline
- [ ] Delete individual conversations (with custom confirm modal)
- [ ] Persist conversations to localStorage (or IndexedDB for larger storage)
- [ ] Conversation search/filter
- [ ] Active conversation highlight in sidebar

### 🧠 Model Quality Improvements
- [ ] Test larger model variants (Phi-3 Medium, Llama 3.1 8B) for hardware that supports it
- [ ] Model auto-detection: check available RAM and suggest appropriate model
- [ ] Streaming markdown rendering (render bold, lists, code as tokens arrive)
- [ ] Response formatting instructions in system prompt (use bullets, headers)
- [ ] Context-aware follow-ups: "tell me more about #3" should work

### 📻 Ham Radio Interactive Tools (code exists in v2-experimental branch)
- [ ] NATO phonetic alphabet interactive grid
- [ ] Morse code encoder/decoder with audio playback
- [ ] Frequency reference tables (emergency, GMRS, FRS, MURS)
- [ ] Ham radio license quiz (Technician class)
- [ ] Re-integrate CSS from v2-experimental branch when ready

### 🗣️ Voice Features
- [ ] Voice input (Web Speech API) — partially implemented, needs polish
- [ ] Text-to-speech improvements — better voice selection, speed control
- [ ] Wake word detection ("Hey BEACON") — experimental, browser-dependent

### 🌐 Mesh Networking Integration
- [ ] Research Meshtastic / LoRa mesh device integration
- [ ] BEACON could format messages for mesh transmission (short, structured)
- [ ] Offline mesh chat relay through the drive's server
- [ ] Emergency broadcast templates formatted for mesh protocols

### 📚 Library Expansion
- [ ] Kiwix ZIM file reader (embedded iframe or native viewer)
- [ ] PDF inline reader (pdf.js integration — zero CDN)
- [ ] EPUB support
- [ ] User-uploadable content (drag & drop files into library)
- [ ] Full-text search across all downloaded content
- [ ] Reading progress tracking per book

### 🔧 Technical Improvements
- [ ] IndexedDB for conversation storage (larger than localStorage/sessionStorage)
- [ ] Service Worker for true offline caching of UI assets
- [ ] Web Worker for heavy text processing (search, highlighting)
- [ ] Performance profiling on low-spec hardware (4GB RAM, HDD)
- [ ] Auto-update mechanism for drive content (when internet available)

---

## V3 — PRODUCT LINE EXPANSION

### 📦 Edition Variants
- [ ] **Harvest Edition** ($89): Agriculture, homesteading, food preservation library
- [ ] **Chaplain Edition** ($89): Extended theological library, pastoral care guides
- [ ] Edition-specific Modelfile personas (BEACON variants)
- [ ] Edition-specific prompt cards and welcome screen

### 💼 Business & Distribution
- [ ] Shopify store launch (copy exists in marketing/copy/)
- [ ] TikTok marketing campaign (scripts exist in marketing/copy/)
- [ ] Amazon listing
- [ ] Affiliate/reseller program
- [ ] Bulk pricing for organizations (churches, prepper groups)

### 🌐 The Blackout Drive Website (separate repo: The-Blackout-Drive-Web)
- [ ] Product landing page
- [ ] Feature comparison table (Basecamp vs Harvest vs Chaplain)
- [ ] FAQ / support documentation
- [ ] Blog content for SEO
- [ ] Email capture for launch list

---

## COMPLETED (V1 QA Audit — 2026-05-07)
- [x] P0-1: Reader search DOM destruction fix (TreeWalker highlights)
- [x] P0-2: Duplicate showToast() removal
- [x] P0-3: Rapid-click race condition (isGenerating synchronous)
- [x] P1-1: 20-message sliding window for Ollama context
- [x] P1-5: Search highlights preserve HTML structure
- [x] P1-7: Chat persistence to sessionStorage
- [x] P2-1: "BEACON IS THINKING" label during streaming
- [x] P2-3: Hide "RUNNING LOCALLY" bar when offline
- [x] P2-4: Custom themed confirm modal (replaced native confirm())
- [x] P2-6: Bible jump bar error feedback toast
- [x] P3-2: Dead Ham Radio CSS removed (175 lines)
- [x] P3-5: Send button tooltip wrapping fix
- [x] P3-6: --red-dim variable canonicalized
- [x] Root URL routing fix (/ → /ui/ redirect)
- [x] Reload flicker elimination (chat restore order)
- [x] RAG quality fix (library context conditional injection)
- [x] Server.py routing (302 redirect for root URL)
