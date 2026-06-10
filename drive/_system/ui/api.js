/**
 * The Blackout Drive — API Layer
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 * ============================================================
 * ALL HTTP calls go through this module. Zero UI logic here.
 * Pure data in, pure data out.
 *
 * Loaded before app.js and library.js in index.html.
 * Reads network config from window.BLACKOUT_CONFIG (set by config.js).
 * ============================================================
 */

'use strict';

window.DDAPI = (() => {

  // ── Internal helpers ─────────────────────────────────────
  function cfg() {
    return window.BLACKOUT_CONFIG || {};
  }

  function ollamaBase() {
    const port = (cfg().network || cfg()).ollamaPort || 11434;
    return `http://127.0.0.1:${port}`;
  }

  // Active download jobs: { jobId: { progress, total, done, error, xhr } }
  const _jobs = {};
  let _jobCounter = 0;

  // ── Ollama ────────────────────────────────────────────────

  /**
   * Check if Ollama is responding.
   * @returns {Promise<boolean>}
   */
  async function checkOllama() {
    try {
      const res = await fetch(`${ollamaBase()}/api/tags`, {
        signal: AbortSignal.timeout(3000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Stream a chat completion from Ollama.
   * @param {string} model
   * @param {Array<{role:string, content:string}>} messages
   * @param {function} onChunk   - called with each text delta
   * @param {function} onDone    - called when stream completes
   * @param {function} onError   - called with Error on failure
   * @returns {AbortController} — call .abort() to cancel
   */
  function streamChat(model, messages, onChunk, onDone, onError) {
    const ctrl = new AbortController();
    const timeout = (cfg().chat || cfg()).streamTimeoutMs || 300000;
    const timer = setTimeout(() => ctrl.abort(), timeout);

    // Track whether we're inside a <think> block (Qwen3 "thinking" mode)
    // so we can silently strip it from the user-visible response.
    let _inThinkBlock = false;
    let _thinkBuffer = '';

    fetch(`${ollamaBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal
    })
    .then(res => {
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { clearTimeout(timer); onDone(); return; }
          const lines = decoder.decode(value, { stream: true }).split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                // Strip <think>...</think> blocks from streaming output
                let text = parsed.message.content;
                if (_inThinkBlock) {
                  _thinkBuffer += text;
                  const endIdx = _thinkBuffer.indexOf('</think>');
                  if (endIdx !== -1) {
                    _inThinkBlock = false;
                    text = _thinkBuffer.substring(endIdx + 8);
                    _thinkBuffer = '';
                    if (text) onChunk(text);
                  }
                  // else: still inside think block, swallow
                } else if (text.includes('<think>')) {
                  const startIdx = text.indexOf('<think>');
                  const before = text.substring(0, startIdx);
                  if (before) onChunk(before);
                  const rest = text.substring(startIdx + 7);
                  const endIdx = rest.indexOf('</think>');
                  if (endIdx !== -1) {
                    // Think block opened and closed in same chunk
                    const after = rest.substring(endIdx + 8);
                    if (after) onChunk(after);
                  } else {
                    _inThinkBlock = true;
                    _thinkBuffer = rest;
                  }
                } else {
                  onChunk(text);
                }
              }
              if (parsed.done) { clearTimeout(timer); onDone(); return; }
            } catch { /* partial line */ }
          }
          pump();
        }).catch(err => { clearTimeout(timer); onError(err); });
      }
      pump();
    })
    .catch(err => { clearTimeout(timer); onError(err); });

    return ctrl;
  }

  // ── Local Server API ──────────────────────────────────────

  /**
   * Get the drive manifest (which files are present).
   * @returns {Promise<{schema, assembled, file_count, total_bytes, files}|null>}
   */
  async function getManifest() {
    try {
      const res = await fetch('/api/manifest');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Get drive status (disk usage, version).
   * @returns {Promise<{content_size_bytes, free_bytes, version}|null>}
   */
  async function getStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Delete a file from the drive. Updates manifest.json automatically.
   * @param {string} relPath  - relative to drive root, e.g. "content/books/file.txt"
   * @returns {Promise<{ok:boolean, removed:string}|{error:string}>}
   */
  async function deleteFile(relPath) {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(relPath)}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Start downloading a file from a URL to a drive path.
   * Non-blocking — returns a jobId immediately.
   * Poll getDownloadStatus(jobId) to track progress.
   * @param {string} url   - remote URL to download
   * @param {string} dest  - destination path relative to drive root
   * @returns {Promise<{ok:boolean, jobId:string}|{error:string}>}
   */
  async function startDownload(url, dest) {
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, dest })
      });
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Poll the progress of a running download.
   * @param {string} jobId
   * @returns {Promise<{progress:number, total:number, done:boolean, error:string|null}>}
   */
  async function getDownloadStatus(jobId) {
    try {
      const res = await fetch(`/api/download/${encodeURIComponent(jobId)}`);
      if (!res.ok) return { done: true, error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      return { done: true, error: e.message };
    }
  }

  /**
   * Cancel a running download.
   * @param {string} jobId
   */
  async function cancelDownload(jobId) {
    try {
      await fetch(`/api/download/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch { /* best effort */ }
  }

  // ── Remote Catalog (online only) ──────────────────────────

  /**
   * Fetch the available pack catalog from the CDN.
   * Respects the user's OFFLINE/ONLINE toggle — will NOT fetch
   * if the user has chosen to stay offline, even if WiFi is on.
   * @returns {Promise<{packs: Array}|null>}
   */
  async function fetchRemoteCatalog() {
    if (!isOnline()) return null;  // Respect user's privacy toggle
    const url = (cfg().content || {}).remoteCatalogUrl;
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * True ONLY when:
   *   1. The browser reports internet connectivity (navigator.onLine), AND
   *   2. The user has explicitly enabled online mode via the UI toggle.
   * This ensures the user's deliberate OFFLINE preference is NEVER bypassed,
   * even if the laptop happens to have WiFi connected.
   */
  function isOnline() {
    if (typeof isOnlineModeEnabled === 'function') {
      return navigator.onLine === true && isOnlineModeEnabled();
    }
    return false; // Default to offline if toggle function isn't loaded yet
  }

  /**
   * openFile — asks the server to shell-open a file in the OS native app.
   * Used for PDFs (Preview on Mac, Edge/Adobe on Windows), ZIM files, etc.
   * @param {string} relPath - path relative to drive root
   */
  async function openFile(relPath) {
    try {
      const res = await fetch(`/api/open-file?path=${encodeURIComponent(relPath)}`);
      return res.ok ? await res.json() : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  // ── Public surface ────────────────────────────────────────
  return {
    // Ollama
    checkOllama,
    streamChat,
    // Local server
    getManifest,
    getStatus,
    deleteFile,
    startDownload,
    getDownloadStatus,
    cancelDownload,
    openFile,
    // Remote
    fetchRemoteCatalog,
    // Utilities
    isOnline,
  };

})();
