/**
 * DOOMSDAY DRIVE — UI Configuration
 * ============================================================
 * Single source of truth for all browser-side config values.
 * Loaded before app.js in index.html.
 *
 * ⚠ IMPORTANT: If you change ollamaPort or model here, you
 * MUST also update the matching values in:
 *   → drive/config.sh   (Mac/Linux launchers)
 *   → drive/config.bat  (Windows launchers)
 *
 * These cannot be auto-synced because the browser cannot
 * read shell variables (this is an offline, air-gapped app).
 * ============================================================
 */

window.DOOMSDAY_CONFIG = {

  // ── Product Identity ─────────────────────────────────────
  appName:        'DOOMSDAY.AI',
  version:        '1.0.0',

  // ── AI Model ─────────────────────────────────────────────
  // Must match MODEL_NAME in config.sh / config.bat
  model:          'doomsday-ai',

  // ── Network ──────────────────────────────────────────────
  // ollamaPort must match DOOMSDAY_OLLAMA_PORT in config.sh/bat
  // uiPort must match DOOMSDAY_UI_PORT in config.sh/bat
  ollamaPort:     11434,
  ollamaHost:     'http://localhost:11434',  // derived from ollamaPort
  uiPort:         8080,

  // ── Chat Behavior ─────────────────────────────────────────
  streamTimeout:  120000,  // max ms per streamed response (2 min)
  retryInterval:  2000,    // ms between connection retry attempts
  maxRetries:     30,      // give up after this many retries (~60s)

};
