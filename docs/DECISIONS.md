# Architecture Decision Record

> Key technical decisions made during development, with rationale.

---

## ADR-001: Zero JavaScript Dependencies

**Decision:** Build the entire UI with vanilla HTML/CSS/JS. No React, no Vue, no Tailwind, no npm.

**Rationale:** The product runs from a USB drive with no internet. Any CDN dependency is a single point of failure. npm/node_modules would add hundreds of MB to the drive. Vanilla JS keeps the total UI under 300KB.

**Consequence:** More manual DOM manipulation, but faster load times and zero supply chain risk.

---

## ADR-002: Python stdlib-only Server

**Decision:** Use only Python 3 standard library for the HTTP server. No pip, no Flask, no FastAPI.

**Rationale:** Target users have stock macOS/Windows with Python 3 pre-installed. Any pip dependency would require internet access to install, breaking the "plug and play" promise.

**Consequence:** Manual URL routing, manual JSON parsing, no middleware. But the server is a single ~1700-line file with zero external dependencies.

---

## ADR-003: Ollama as AI Runtime

**Decision:** Bundle Ollama portable binaries for each platform.

**Rationale:** Ollama provides a clean REST API, handles model loading/quantization, and runs on consumer hardware. The portable binary approach means no system installation required.

**Consequence:** ~200MB of binaries per platform. Three copies needed (Mac ARM, Mac Intel, Windows).

---

## ADR-004: Business Source License 1.1

**Decision:** Use BSL 1.1 instead of MIT/Apache.

**Rationale:** Prevents competitors from cloning the product and undercutting on price. The license converts to Apache 2.0 automatically in 2030, ensuring the project eventually becomes fully open source.

**Consequence:** GitHub repo is public for transparency, but commercial use requires a license from Hutton Technologies.

---

## ADR-005: Cloudflare R2 for Content CDN

**Decision:** Use Cloudflare R2 (with public bucket + Worker API) for downloadable content.

**Rationale:** R2 has zero egress fees (unlike S3), free tier covers expected bandwidth, and Workers provide serverless catalog generation. The Worker auto-generates catalog JSON from the bucket folder structure.

**Consequence:** Content uploads require Cloudflare dashboard or wrangler CLI. Catalog updates are automatic (Worker reads bucket on each request, cached 5 min).

---

## ADR-006: Anti-Flicker 3-Layer System

**Decision:** Implement a 3-layer rendering guard to prevent visible state transitions on page load.

**Rationale:** When users refresh while the library is open, there was a visible flash of the chat screen before the library restored. This felt broken.

**Implementation:**
1. Inline `<script>` in `<head>` reads sessionStorage before first paint, sets `data-restore` attribute
2. CSS rules immediately show library/hide chat when `data-restore` is present
3. JS `_restoreLibState()` loads content, then removes the attribute

**Consequence:** Zero visible state transition on refresh. Users see exactly what they left.

---

## ADR-007: Text Index for RAG (not Embeddings)

**Decision:** Use a pre-built TF-IDF text index instead of vector embeddings for library search and RAG.

**Rationale:** Embedding models require significant compute and storage. TF-IDF is fast, lightweight, and works well for keyword-based survival/reference queries. The pre-built index (18MB) loads instantly.

**Consequence:** Less semantic understanding than embeddings, but extremely fast and works offline without any ML inference.

---

## ADR-008: BEACON Persona Design

**Decision:** BEACON is a general-purpose assistant with a calm, direct communication style — not a survival-only chatbot.

**Rationale:** Users asked questions about everything: jokes, science, history, creative writing. Restricting to "survival only" would frustrate users. The persona emphasizes matching response length to question complexity and avoiding unnecessary disclaimers.

**Consequence:** The Modelfile system prompt is carefully tuned. Changes to the persona should be tested across diverse query types.

---

## ADR-009: Single Ecosystem Key Architecture

**Decision:** All cryptographic operations (chat encryption, Encrypted Storage) use a single master password. No per-file passwords.

**Rationale:** Multiple passwords create UX friction and increase the risk of forgotten credentials. Since there is no password recovery (by design — the drive is air-gapped), a single key simplifies the mental model while maintaining AES-256-GCM security. The master password is session-cached in memory and never persisted to disk.

**Implementation:** Browser-side AES-256-GCM via `window.crypto.subtle` for chat history. Server-side 7-Zip AES-256 for Encrypted Storage operations. Both use the same user-provided master password.

**Consequence:** If the user forgets their master password, all encrypted data is permanently inaccessible. This is a deliberate trade-off for zero-trust, zero-recovery security.

---

## ADR-010: Blackout Protocol Master Switch

**Decision:** A single top-level toggle ("Blackout Protocol") in the header that forces Network Lock ON and Encrypt Chat History ON simultaneously.

**Rationale:** Having separate toggles for Network Lock and Encrypt Chat History created decision fatigue. Most users want "maximum security" or "I need to download content." The Blackout Protocol provides a one-click security posture that defaults to ON, with individual toggles available when disabled.

**Consequence:** When Blackout Protocol is ON (default), the Network Lock and Encrypt Chat History toggles in Settings are greyed out and disabled. Users must explicitly disable Blackout Protocol (with a confirmation modal) before adjusting individual security settings.
