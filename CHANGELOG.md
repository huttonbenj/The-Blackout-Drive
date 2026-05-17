# Changelog

All notable changes to The Blackout Drive will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.0.0] — 2026-05-17

### Initial Release — "Basecamp Edition"

**Core**
- BEACON offline AI engine powered by Qwen3 (4B/8B, auto-selected by RAM)
- Custom Ollama Modelfile with layered system prompt (identity, tuning, device facts)
- Python 3 stdlib HTTP server — zero pip dependencies
- Cross-platform: Windows 10/11, macOS (ARM + Intel), Linux

**Security**
- Optional master password with PBKDF2-SHA256 hashing (600K iterations)
- AES-256-GCM encrypted chat history (browser-side, Web Crypto API)
- 7-Zip AES-256 encrypted file vault (Locked files)
- Blackout Protocol — one-click toggle enforcing Network Lock + Encrypt Chat History
- Localhost-only server binding (127.0.0.1)
- Path traversal protection on all file operations
- Prompt injection defense in BEACON persona

**Features**
- Offline Reference Library with built-in EPUB and text reader
- Scripture reader with book/chapter/verse navigation (KJV, WEB, ASV, YLT)
- Workspace with Unlocked and Locked (encrypted) file storage
- Monaco code editor (air-gapped, no CDN)
- 113 curated prompts across 11 knowledge domains
- Conversation history with save, export, and purge
- Font size settings (Small / Default / Large)
- Text-to-speech for AI responses
- Voice input via browser microphone
- Diagnostics panel with system health reporting
- Performance metrics logging (TTFT, tok/s)

**Content**
- 48 offline reference files (books, manuals, field guides)
- Content catalog with R2-backed download system
- Full-text search index for library content

**DevOps**
- Automated flash script with post-flash verification
- Model rebuild script with tier auto-detection
- Factory reset via EMERGENCY_RESTORE.sh
- GitHub Actions CI (Python lint, JS lint, content URL health check)
