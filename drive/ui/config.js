/**
 * The Blackout Drive — UI Configuration Loader
 * ============================================================
 * Fetches drive/config.json (the master config) and merges
 * it into window.DOOMSDAY_CONFIG for use by all JS modules.
 *
 * Falls back to safe defaults if config.json can't be loaded
 * (e.g., opened as a file:// without a server).
 *
 * Load order in index.html: config.js → api.js → app.js → library.js
 * ============================================================
 */

(function () {
  'use strict';

  // Safe defaults — match config.json values exactly.
  // These are ONLY used if config.json cannot be fetched.
  const DEFAULTS = {
    app: {
      name:    'The Blackout Drive',
      version: '1.0.0',
      tagline: 'Offline AI Intelligence',
    },
    model: {
      name: 'blackout-scout',
      base: 'phi3:mini',
    },
    network: {
      ollamaPort: 11434,
      uiPort:     8080,
      ollamaBind: '127.0.0.1',
    },
    content: {
      remoteCatalogUrl: 'https://cdn.blackoutdrive.com/catalog.json',
      remoteFilesBase:  'https://cdn.blackoutdrive.com/files',
      contentDir:       'content',
      booksDir:         'content/books',
      zimDir:           'content/zim',
      packsDir:         'content/packs',
    },
    chat: {
      streamTimeoutMs: 120000,
      retryIntervalMs: 2000,
      maxRetries:      30,
      maxInputChars:   4000,
    },
  };

  // Flatten nested config for backward compatibility with app.js/library.js
  // that use window.DOOMSDAY_CONFIG.model, .ollamaPort, etc. (flat keys)
  function flattenConfig(c) {
    return {
      // Structured (new style)
      ...c,
      // Flat aliases (backward compat)
      appName:       (c.app  || {}).name    || DEFAULTS.app.name,
      aiName:        (c.app  || {}).aiName   || 'Scout',
      version:       (c.app  || {}).version || DEFAULTS.app.version,
      model:         (c.model || {}).name   || DEFAULTS.model.name,
      ollamaPort:    (c.network || {}).ollamaPort || DEFAULTS.network.ollamaPort,
      ollamaHost:    `http://localhost:${(c.network || {}).ollamaPort || DEFAULTS.network.ollamaPort}`,
      uiPort:        (c.network || {}).uiPort     || DEFAULTS.network.uiPort,
      streamTimeout: (c.chat  || {}).streamTimeoutMs || DEFAULTS.chat.streamTimeoutMs,
      retryInterval: (c.chat  || {}).retryIntervalMs || DEFAULTS.chat.retryIntervalMs,
      maxRetries:    (c.chat  || {}).maxRetries      || DEFAULTS.chat.maxRetries,
    };
  }

  // Set defaults immediately so downstream code always has a config object
  window.DOOMSDAY_CONFIG = flattenConfig(DEFAULTS);

  // Attempt to load the real config.json from the server
  fetch('/config.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      window.DOOMSDAY_CONFIG = flattenConfig(data);
      // Notify any listeners that config is ready
      document.dispatchEvent(new CustomEvent('doomsday:config-ready', { detail: window.DOOMSDAY_CONFIG }));
    })
    .catch(() => {
      // Silently fall back to defaults — already set above
      document.dispatchEvent(new CustomEvent('doomsday:config-ready', { detail: window.DOOMSDAY_CONFIG }));
    });

})();
