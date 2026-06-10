# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in The Blackout Drive, **please report it responsibly**.

**Email:** [security@huttontechnologies.com](mailto:security@huttontechnologies.com)

Include:
- A description of the vulnerability
- Steps to reproduce
- Impact assessment (if known)
- Your preferred attribution name (if you'd like credit)

## Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Patch release | Within 30 days for critical issues |

## Scope

The following are in scope for security reports:

- **Authentication bypass** — Circumventing master password verification
- **Encryption weaknesses** — Issues in AES-256-GCM chat encryption or 7-Zip file encryption
- **Path traversal** — Accessing files outside the drive's sandboxed directories
- **Prompt injection** — Extracting the BEACON system prompt or overriding its safety constraints
- **Session hijacking** — Accessing another user's session data on a shared machine
- **Code execution** — Achieving arbitrary code execution through the UI or API

The following are **out of scope**:

- Physical access attacks (the drive is a USB device — physical access = game over by design)
- Social engineering
- Denial of service against the local server
- Issues in third-party dependencies (Ollama, 7-Zip) — report those upstream

## Architecture Overview

For security reviewers, key implementation details:

- **Server binds to `127.0.0.1` only** — no network exposure
- **Password hashing:** PBKDF2-SHA256 with 600,000 iterations + random salt
- **Chat encryption:** AES-256-GCM via Web Crypto API (browser-side)
- **File encryption:** AES-256-GCM (native BKV format, server-side)
- **Path sanitization:** All file operations validated against `DRIVE_ROOT`
- **No external network calls** — the server makes zero outbound requests
- **No telemetry, no analytics, no tracking**

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ Yes    |
| < 1.0   | ❌ No     |

## Disclosure Policy

We follow coordinated disclosure. We ask that you:

1. Do **not** publicly disclose the vulnerability before a fix is available
2. Allow reasonable time for us to develop and test a patch
3. Do **not** access or modify other users' data during testing

We will credit all valid reporters in the release notes (unless anonymity is requested).

---

© 2026 Hutton Technologies LLC. **The Blackout Drive™** is a trademark of Hutton Technologies LLC.
