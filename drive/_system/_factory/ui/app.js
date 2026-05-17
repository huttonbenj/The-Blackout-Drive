/**
 * The Blackout Drive — Chat Application Logic
 * Connects to local Ollama instance, streams responses
 * Zero external dependencies — pure vanilla JS
 */

'use strict';

// ── Configuration (sourced from config.js → config.json) ──
// config.js sets window.BLACKOUT_CONFIG from config.json on load.
// CONFIG starts with defaults and updates when config-ready fires.
let CONFIG = window.BLACKOUT_CONFIG;
document.addEventListener('blackout:config-ready', (e) => { CONFIG = e.detail; });

// ── State ─────────────────────────────────────────────────
let isConnected       = false;
let _wasEverConnected = false;  // tracks if Ollama ever connected this session
let isGenerating  = false;
let messages      = [];
let currentReader  = null;
let _currentAbortController = null;  // AbortController for the active fetch
let lastUserMessage = '';  // For retry button on failed responses

// Max messages sent to Ollama (sliding window to prevent context overflow).
// Full history stays in the DOM for scroll-back — only the API payload is trimmed.
const MAX_CONTEXT_MESSAGES = 6;

// Chat persistence — session key (fast restore on refresh)
const CHAT_SS_KEY = 'dd_chat';
// Current conversation tracking
let _currentConvId   = null;   // UUID of the active saved conversation (null = unsaved)
let _currentConvTitle = null;  // null = auto-generated from first message
let _convPanelOpen   = false;  // whether the conversations sidebar is visible
let _autoSaveTimer   = null;   // debounce timer for auto-save

// ── DOM References ────────────────────────────────────────
const $ = id => document.getElementById(id);
const statusDot      = $('statusDot');
const statusText     = $('statusText');
const warningBanner  = $('warningBanner');
const warningText    = $('warningText');
const chatContainer  = $('chatContainer');
const messagesEl     = $('messages');
const welcomeScreen  = $('welcomeScreen');
const userInput      = $('userInput');
const sendBtn        = $('sendBtn');
const sendIcon       = $('sendIcon');
const charCount      = $('charCount');

// ── Welcome Screen visibility helper ──────────────────────
function _showWelcome(visible) {
  welcomeScreen.style.display = visible ? 'flex' : 'none';
  document.body.classList.toggle('welcome-visible', visible);
  // Re-evaluate warmup overlay — it should only show on welcome screen
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();
}

// ── Connecting Overlay ────────────────────────────────────
// The overlay shows while we attempt to reach Ollama.
// It auto-dismisses after OVERLAY_TIMEOUT_MS regardless — we never
// leave the user staring at a black screen.
const OVERLAY_TIMEOUT_MS = 12000; // 12 seconds max — then show offline state

let _overlayTimer = null;

function showConnectingOverlay() {
  // Remove stale overlay if any
  const old = $('connectingOverlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'connectingOverlay';
  overlay.className = 'connecting-overlay';
  overlay.innerHTML = `
    <div class="connecting-beacon">${ICONS.beaconLg}</div>
    <div class="connecting-title">STARTING BEACON</div>
    <div class="connecting-sub">Loading your offline AI. This takes 10–30 seconds...</div>
    <div class="connecting-bar"><div class="connecting-progress" id="connectingProgress"></div></div>
    <div class="connecting-instructions">
      <p>
        <strong>Keep the launcher window open.</strong><br>
        The AI runs entirely on your computer — no internet needed.<br><br>
        If this takes more than 60 seconds,<br>
        your computer may need <strong>8GB+ RAM</strong> to run the AI.
      </p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Animate the progress bar
  const bar = overlay.querySelector('.connecting-progress');
  if (bar) {
    bar.style.width = '0%';
    bar.style.transition = `width ${OVERLAY_TIMEOUT_MS}ms linear`;
    requestAnimationFrame(() => { bar.style.width = '85%'; });
  }

  // GUARANTEED dismissal: after OVERLAY_TIMEOUT_MS, hide overlay and show offline state
  // This is the core fix — the overlay CANNOT block the UI indefinitely
  clearTimeout(_overlayTimer);
  _overlayTimer = setTimeout(() => {
    const el = $('connectingOverlay');
    if (el) {
      // If we're still not connected by now, switch to error state
      if (!isConnected) {
        setStatus('error');
      }
    }
  }, OVERLAY_TIMEOUT_MS);
}

function hideConnectingOverlay() {
  clearTimeout(_overlayTimer);
  _overlayTimer = null;
  const overlay = $('connectingOverlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.4s ease';
  setTimeout(() => overlay.remove(), 400);
}

// ── Connection Management ─────────────────────────────────
/**
 * Check if Ollama is running AND the BEACON model is registered.
 * /api/tags returns 200 even with no models, so we verify model list.
 */
async function checkConnection() {
  try {
    const res = await fetch(`${CONFIG.ollamaHost}/api/ps`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) return 'error';
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.models)) return 'error';
    const modelName = (CONFIG.model || 'blackout-beacon').split(':')[0];
    const isLoaded = data.models.some(m => (m.name || '').split(':')[0] === modelName);
    return isLoaded ? 'online' : 'warming_up';
  } catch {
    return 'error';
  }
}

function setStatus(state) {
  if (!statusDot || !statusText) return;
  statusDot.className  = 'status-dot ' + state;
  statusText.className = 'status-text ' + state;

  const welcomeTitle = document.querySelector('.welcome-title');
  const actionBtn = document.getElementById('warningActionBtn');

  // ── Always clean up warmup elements when leaving warming_up state ──
  if (state !== 'warming_up') {
    document.body.classList.remove('beacon-warming');
    _destroyWarmupElements();
  }

  if (state === 'online') {
    _wasEverConnected = true;
    statusText.textContent = 'BEACON:READY';
    userInput.placeholder = 'Ask BEACON anything...';
    sendBtn.disabled = !userInput.value.trim();
    document.body.classList.remove('beacon-offline');
    if (welcomeTitle) { welcomeTitle.textContent = 'BEACON:READY'; welcomeTitle.style.color = ''; }
    // Explicitly clear blur that warmup overlay may have applied
    if (chatContainer) chatContainer.style.filter = '';
    hideConnectingOverlay();
    hideWarning();

  } else if (state === 'warming_up') {
    statusText.textContent = 'BEACON:LOADING';
    sendBtn.disabled = true;
    document.body.classList.remove('beacon-offline');
    document.body.classList.add('beacon-warming');
    hideConnectingOverlay();
    hideWarning();
    if (welcomeTitle) {
      welcomeTitle.textContent = 'BEACON:LOADING';
      welcomeTitle.style.color = 'var(--amber-dim, #8a6a28)';
    }
    // Create overlay + bar elements (they manage their own visibility)
    _ensureWarmupElements();
    _updateWarmupVisibility();

  } else if (state === 'error') {
    const wasEverConnected = _wasEverConnected;
    statusText.textContent = wasEverConnected ? 'BEACON:PAUSED' : 'BEACON:OFFLINE';
    sendBtn.disabled = true;
    document.body.classList.add('beacon-offline');
    hideConnectingOverlay();
    if (welcomeTitle) {
      welcomeTitle.textContent = wasEverConnected ? 'BEACON:PAUSED' : 'BEACON:START';
      welcomeTitle.style.color = 'var(--amber-dim, #8a6a28)';
    }
    const ua = navigator.userAgent || '';
    let launcherName = 'the START launcher from your drive folder';
    if (/Win/.test(ua))           launcherName = '"Start (Windows).bat" from your drive folder';
    else if (/Mac|iPhone/.test(ua)) launcherName = '"The Blackout Drive" app from your drive folder';
    else if (/Linux/.test(ua))     launcherName = '"Start (Linux).sh" from your drive folder';

    const errMsg = wasEverConnected
      ? 'AI disconnected — double-click ' + launcherName + ' to reconnect.'
      : 'AI is not running yet. Double-click ' + launcherName + ' to start.';
    showWarning(errMsg, 'info', true);

  } else {
    statusText.textContent = 'BEACON:STARTING';
    sendBtn.disabled = true;
    if (welcomeTitle) { welcomeTitle.textContent = 'BEACON:STARTING'; welcomeTitle.style.color = 'var(--amber-dim, #8c7030)'; }
  }
}

// ── Warmup Overlay Management ───────────────────────────────
// The overlay + blur should ONLY show when:
//   1. State is warming_up (body.beacon-warming exists)
//   2. Welcome screen is visible (no conversation loaded)
//   3. No full-screen panels (Library) are covering the chat area
// If a user loads a conversation during warmup, they see messages
// with the warmup bar at the bottom (no overlay/blur).

const _warmupTips = [
  'BEACON runs 100% offline — no internet, no cloud, no tracking.',
  'Your conversations are encrypted with AES-256-GCM and stored only on this drive.',
  'Use the Library tab to access offline reference books, manuals, and field guides.',
  'Blackout Protocol forces encryption and blocks all outbound network requests.',
  'BEACON covers 10+ knowledge domains: medicine, engineering, law, agriculture, and more.',
  'All data lives on the USB drive. Remove it and nothing remains on the host machine.',
  'Try voice input — click the microphone button to speak your questions.',
  'The Chats panel lets you save, encrypt, and revisit past conversations.',
  'First launch loads the AI model into GPU memory. Subsequent starts are much faster.',
  'BEACON works on Mac, Windows, and Linux — plug in and go.',
];

function _ensureWarmupElements() {
  // Create overlay if not present
  if (!document.getElementById('beaconWarmupOverlay')) {
    const tip = _warmupTips[Math.floor(Math.random() * _warmupTips.length)];
    const overlay = document.createElement('div');
    overlay.id = 'beaconWarmupOverlay';
    overlay.className = 'beacon-warmup-overlay';
    overlay.innerHTML = `
      <div class="warmup-ov-header">
        <div class="warmup-ov-bars">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="warmup-ov-status">SYSTEM INITIALIZATION</div>
        <div class="warmup-ov-bars">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="warmup-ov-title">BEACON:LOADING</div>
      <div class="warmup-ov-desc">AI engine loading into memory</div>
      <div class="warmup-ov-meta">
        <span>MODE: OFFLINE</span>
        <span class="warmup-ov-sep">|</span>
        <span>ENCRYPTION: ACTIVE</span>
        <span class="warmup-ov-sep">|</span>
        <span>NETWORK: BLOCKED</span>
      </div>
      <div class="warmup-ov-tip">
        <span class="warmup-ov-tip-label">DID YOU KNOW</span>
        <span class="warmup-ov-tip-text">${tip}</span>
      </div>
      <div class="warmup-ov-footer">Library · Settings · Chats available while loading</div>`;
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer && chatContainer.parentNode) {
      chatContainer.parentNode.insertBefore(overlay, chatContainer.nextSibling);
    }
    // Rotate tips every 6 seconds
    overlay._tipInterval = setInterval(() => {
      const tipEl = overlay.querySelector('.warmup-ov-tip-text');
      if (tipEl) {
        const newTip = _warmupTips[Math.floor(Math.random() * _warmupTips.length)];
        tipEl.style.opacity = '0';
        setTimeout(() => { tipEl.textContent = newTip; tipEl.style.opacity = '1'; }, 400);
      }
    }, 6000);
  }
  // Create bottom bar if not present
  if (!document.getElementById('beaconWarmupBar')) {
    const bar = document.createElement('div');
    bar.id = 'beaconWarmupBar';
    bar.className = 'beacon-warmup-bar';
    bar.innerHTML = `
      <div class="beacon-warmup-spinner"></div>
      <span class="beacon-warmup-text">BEACON:LOADING</span>
      <span class="beacon-warmup-hint">Library · Settings · Chats available now</span>`;
    const inputArea = document.querySelector('.input-area');
    if (inputArea && inputArea.parentNode) {
      inputArea.parentNode.insertBefore(bar, inputArea);
    }
  }
}

function _destroyWarmupElements() {
  const warmBar = document.getElementById('beaconWarmupBar');
  if (warmBar) warmBar.remove();
  const warmOverlay = document.getElementById('beaconWarmupOverlay');
  if (warmOverlay) {
    if (warmOverlay._tipInterval) clearInterval(warmOverlay._tipInterval);
    warmOverlay.remove();
  }
}

/**
 * Show/hide the warmup overlay + chat blur based on current view state.
 * Called from: setStatus, _showWelcome, loadConversation, openLibrary,
 * closeLibrary, and all panel toggle functions.
 */
function _updateWarmupVisibility() {
  const isWarming = document.body.classList.contains('beacon-warming');
  const overlay = document.getElementById('beaconWarmupOverlay');
  const chatContainer = document.getElementById('chatContainer');

  if (!isWarming) {
    // Not warming — ensure everything is clean
    if (overlay) overlay.style.display = 'none';
    if (chatContainer) chatContainer.style.filter = '';
    return;
  }

  // Warming up — decide if overlay should show
  const welcomeVisible = welcomeScreen && welcomeScreen.style.display !== 'none';
  const libPanel = (typeof libraryPanel !== 'undefined' && libraryPanel)
    || document.getElementById('libraryPanel');
  const libraryOpen = libPanel && libPanel.style.display !== 'none';
  const wsPanel = document.getElementById('workspacePanel');
  const workspaceOpen = wsPanel && wsPanel.style.display !== 'none';

  if (welcomeVisible && !libraryOpen && !workspaceOpen) {
    // Show overlay + blur — user is on the empty chat view
    if (overlay) overlay.style.display = 'flex';
    if (chatContainer) chatContainer.style.filter = 'blur(6px) saturate(0.5)';
  } else {
    // Hide overlay — user is viewing a conversation, library, or workspace
    if (overlay) overlay.style.display = 'none';
    if (chatContainer) chatContainer.style.filter = '';
  }
}

function showWarning(text, variant = 'error', showAction = false) {
  if (!warningBanner || !warningText) return;
  warningText.textContent = text;
  warningBanner.className = 'warning-banner warning-banner--' + variant;
  warningBanner.style.display = 'flex';
  const actionBtn = document.getElementById('warningActionBtn');
  if (actionBtn) actionBtn.style.display = showAction ? 'inline-block' : 'none';
}

function hideWarning() {
  if (warningBanner) warningBanner.style.display = 'none';
}

async function maintainConnection(showOverlay = true) {
  // Show overlay only if we didn't already connect in the fast-path check
  if (showOverlay) {
    showConnectingOverlay();
    setStatus('');
  }

  // Adaptive polling: fast when disconnected, slow when connected.
  // Disconnected: 2s — fast reconnect detection
  // Connected: 15s — lightweight health check (reduces /api/tags from 30/min to 4/min)
  const POLL_FAST = 2000;
  const POLL_SLOW = 15000;

  let _lastState = null;

  while (true) {
    const currentState = await checkConnection();

    if (currentState !== _lastState) {
      _lastState = currentState;
      isConnected = (currentState === 'online');
      setStatus(currentState);
    }

    await sleep(isConnected ? POLL_SLOW : POLL_FAST);
  }
}

// ── Message Rendering ─────────────────────────────────────
function renderMessage(role, content, streaming = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatar  = role === 'user' ? '>' : '>';
  const label   = role === 'user' ? 'YOU' : (window.BLACKOUT_CONFIG?.aiName || 'BEACON');

  // TTS button for BEACON messages (only when speechSynthesis is available)
  const ttsBtn = (role === 'assistant' && window.speechSynthesis)
    ? `<button class="tts-btn" title="Read aloud" onclick="toggleTTS(this)"><span class="tts-label">LISTEN</span></button>`
    : '';

  msgEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-label">${label}${ttsBtn}</div>
      <div class="message-body">${
        streaming
          ? '<span class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span><div class="thinking-label">BEACON IS THINKING\u2026</div>'
          : renderMarkdown(content)
      }</div>
    </div>
  `;

  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

// ── Text-to-Speech (Web Speech API) ──────────────────
let _ttsCurrentBtn  = null;
let _ttsAutoRead    = false;  // auto-read all BEACON responses
let _ttsSpeed       = 1.0;    // speed multiplier (0.75 / 1.0 / 1.25)

function toggleTTS(btn) {
  const msgEl = btn.closest('.message');
  const body = msgEl ? msgEl.querySelector('.message-body') : null;
  if (!body) return;

  const text = body.innerText || body.textContent || '';
  if (!text.trim()) return;

  // Toggle: if already speaking THIS message, stop it
  if (_ttsCurrentBtn === btn && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    _resetTTSBtn(btn);
    _ttsCurrentBtn = null;
    return;
  }

  _ttsSpeak(text, btn);
}

// Internal: speak text, optionally highlight a button
function _ttsSpeak(text, btn) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  if (_ttsCurrentBtn) _resetTTSBtn(_ttsCurrentBtn);

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate  = _ttsSpeed * 0.95;
  utter.pitch = 0.9;
  utter.volume = 1;

  // Prefer a calm, natural English voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Alex'))
    || voices.find(v => v.lang.startsWith('en') && !v.name.includes('Google'))
    || voices[0];
  if (preferred) utter.voice = preferred;

  utter.onstart = () => {
    if (btn) {
      _ttsCurrentBtn = btn;
      btn.innerHTML = '⏸ <span class="tts-label">STOP</span>';
      btn.classList.add('tts-active');
    }
  };
  utter.onend = utter.onerror = () => {
    _resetTTSBtn(btn);
    if (_ttsCurrentBtn === btn) _ttsCurrentBtn = null;
  };

  window.speechSynthesis.speak(utter);
}

function _resetTTSBtn(btn) {
  if (btn) { btn.innerHTML = '<span class="tts-label">LISTEN</span>'; btn.classList.remove('tts-active'); }
}

// Auto-read the latest BEACON response when enabled
function _ttsAutoReadMessage(msgEl) {
  if (!_ttsAutoRead || !window.speechSynthesis) return;
  const body = msgEl ? msgEl.querySelector('.message-body') : null;
  if (!body) return;
  const text = body.innerText || body.textContent || '';
  if (text.trim()) _ttsSpeak(text, null);
}

// Toggle global auto-read on/off
function toggleAutoRead() {
  _ttsAutoRead = !_ttsAutoRead;
  try { localStorage.setItem('bd-setting-autoread', _ttsAutoRead); } catch {}
  const btn = document.getElementById('autoReadBtn');
  if (btn) {
    btn.classList.toggle('auto-read-active', _ttsAutoRead);
    btn.title = _ttsAutoRead ? 'Auto-read ON — click to disable' : 'Auto-read BEACON responses';
    btn.textContent = _ttsAutoRead ? 'AUTO' : 'AUTO';
  }
  if (!_ttsAutoRead && window.speechSynthesis) window.speechSynthesis.cancel();
  showToast(_ttsAutoRead ? 'Auto-read enabled' : 'Auto-read disabled');
}

// Cycle TTS speed  1.0x → 1.25x → 0.75x → 1.0x
function cycleTTSSpeed() {
  const speeds = [1.0, 1.25, 0.75];
  const idx = speeds.indexOf(_ttsSpeed);
  _ttsSpeed = speeds[(idx + 1) % speeds.length];
  try { localStorage.setItem('bd-setting-speech-speed', String(_ttsSpeed)); } catch {}
  const btn = document.getElementById('ttsSpeedBtn');
  if (btn) btn.textContent = _ttsSpeed + 'x';
  showToast(`Speed: ${_ttsSpeed}x`);
}

// Restore persisted TTS settings from localStorage
function _restoreTTSSettings() {
  try {
    const speed = parseFloat(localStorage.getItem('bd-setting-speech-speed') || '1.0');
    const auto  = localStorage.getItem('bd-setting-autoread') === 'true';
    if ([0.75, 1.0, 1.25].includes(speed)) _ttsSpeed = speed;
    _ttsAutoRead = auto;
    const speedBtn = document.getElementById('ttsSpeedBtn');
    if (speedBtn) speedBtn.textContent = _ttsSpeed + 'x';
    const autoBtn = document.getElementById('autoReadBtn');
    if (autoBtn) {
      autoBtn.classList.toggle('auto-read-active', _ttsAutoRead);
      autoBtn.textContent = _ttsAutoRead ? 'AUTO' : 'AUTO';
    }
  } catch {}
}

// ── Throttled Streaming Render ────────────────────────────
// During streaming, tokens arrive rapidly. We throttle rendering to
// ~3x/sec using renderMarkdown(). This gives live formatted output
// (bold, lists, headers) without the O(n²) cost of rendering every token.
//
// Key: we ALWAYS use renderMarkdown (never raw textContent), so the user
// always sees formatted text. The throttle prevents excessive DOM work.
let _pendingContent = null;
let _pendingMsgEl = null;
let _renderRafId = null;
let _lastRenderTime = 0;
const _RENDER_THROTTLE = 80; // ms between renders (~12x/sec — smooth streaming without choking on large markdown)

function updateMessageContent(msgEl, content) {
  _pendingContent = content;
  _pendingMsgEl = msgEl;

  const now = performance.now();
  if (now - _lastRenderTime < _RENDER_THROTTLE) {
    // Too soon — schedule update on next animation frame
    if (!_renderRafId) {
      _renderRafId = requestAnimationFrame(_flushRender);
    }
    return;
  }
  _flushRender();
}

function _flushRender() {
  _renderRafId = null;
  if (!_pendingMsgEl || _pendingContent === null) return;
  // Render into .message-response (child of .message-body) to preserve
  // sibling elements like the think block and warmup indicator.
  const body = _pendingMsgEl.querySelector('.message-body');
  if (!body) return;
  let responseEl = body.querySelector('.message-response');
  if (!responseEl) {
    responseEl = document.createElement('div');
    responseEl.className = 'message-response';
    body.appendChild(responseEl);
  }
  responseEl.innerHTML = renderMarkdown(_pendingContent);
  _lastRenderTime = performance.now();
  _pendingContent = null;
  _scrollToBottomThrottled();
}

// Final render: ensure last tokens are rendered with full markdown
function flushMessageContent() {
  if (_renderRafId) cancelAnimationFrame(_renderRafId);
  if (_pendingMsgEl && _pendingContent !== null) {
    const body = _pendingMsgEl.querySelector('.message-body');
    if (body) {
      let responseEl = body.querySelector('.message-response');
      if (!responseEl) {
        responseEl = document.createElement('div');
        responseEl.className = 'message-response';
        body.appendChild(responseEl);
      }
      responseEl.innerHTML = renderMarkdown(_pendingContent);
    }
    _pendingContent = null;
    _scrollToBottomThrottled();
  }
  _lastRenderTime = 0;
}

// Robust markdown renderer using marked.js
// Custom renderer: escape raw HTML tokens so the AI can't inject DOM nodes
const _mdRenderer = new marked.Renderer();
_mdRenderer.html = function(token) {
  const raw = typeof token === 'string' ? token : (token.raw || token.text || '');
  return raw.replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// Syntax highlighting for fenced code blocks via highlight.js
_mdRenderer.code = function(token) {
  const code = typeof token === 'string' ? token : (token.text || '');
  const lang = (typeof token === 'object' ? token.lang : '') || '';
  let highlighted;
  if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } catch { highlighted = null; }
  }
  if (!highlighted && typeof hljs !== 'undefined') {
    try {
      highlighted = hljs.highlightAuto(code).value;
    } catch { highlighted = null; }
  }
  if (!highlighted) {
    highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const langLabel = lang ? `<div class="code-lang-label">${lang}</div>` : '';
  return `<pre>${langLabel}<code class="hljs${lang ? ' language-' + lang : ''}">${highlighted}</code></pre>`;
};

// Ordered list renderer: inject counter-reset based on start attribute so
// CSS counters match the markdown numbering when lists are split by headers.
_mdRenderer.list = function(token) {
  const ordered = token.ordered;
  const start = token.start;
  let body = '';
  for (let i = 0; i < token.items.length; i++) {
    body += this.listitem(token.items[i]);
  }
  const tag = ordered ? 'ol' : 'ul';
  // Preserve the native start attribute (matches marked's default behavior)
  const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
  // Add inline counter-reset so our CSS counter matches the start value
  const counterStyle = ordered && start !== 1
    ? ` style="counter-reset:ol-counter ${start - 1}"`
    : '';
  return `<${tag}${startAttr}${counterStyle}>\n${body}</${tag}>\n`;
};

function renderMarkdown(text) {
  if (!text) return '';

  let safe = text;

  // Strip model artifacts: [End of Solution], [End of Response], etc.
  safe = safe.replace(/\[(?:End of (?:Solution|Response|Answer|Output|Text|Message|Explanation)|Note:?|Warning:?|Important:?|Disclaimer:?)[^\]]*\]/gi, '');
  // Also strip standalone bracket pairs that wrap a single word/phrase artifact
  safe = safe.replace(/^\s*\[\/?\w+\]\s*$/gm, '');

  let html = marked.parse(safe, {
    gfm: true,
    breaks: true,
    renderer: _mdRenderer
  });

  // Highlight "BEACON" in amber — post-parse so markdown isn't disrupted.
  // Negative lookbehind/lookahead avoids double-wrapping inside HTML tags/attrs.
  html = html.replace(/(?<![="'a-zA-Z-])BEACON(?![a-zA-Z"'])/g,
    '<span class="beacon-name">BEACON</span>');

  return html;
}

// ── Chat Logic ────────────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !isConnected) return;

  // If a response is actively streaming, abort it cleanly before starting a new one.
  // Uses AbortController for instant, race-free cancellation.
  if (isGenerating && _currentAbortController) {
    _currentAbortController.abort();
    // Wait for the previous finally{} block to reset state
    await new Promise(r => setTimeout(r, 50));
  }

  lastUserMessage = text;  // Store for retry button

  // P0-3 FIX: Set flag IMMEDIATELY (synchronously) before any async work.
  // This closes the race window where rapid clicks could slip through.
  isGenerating = true;
  sendBtn.disabled = true;

  _showWelcome(false);
  messages.push({ role: 'user', content: text });
  renderMessage('user', text);
  _saveChatState(true); // save session state (silent — don't flash indicator)

  userInput.value = '';
  userInput.style.height = 'auto';
  updateCharCount();
  sendBtn.classList.add('loading');
  sendIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor"/></svg>';
  const sendLabel = $('sendLabel');
  if (sendLabel) sendLabel.textContent = 'STOP';
  sendBtn.title = 'Stop generation';
  // Remove click listener and add stop handler
  sendBtn.removeEventListener('click', sendMessage);
  sendBtn.addEventListener('click', cancelGeneration, { once: false });

  const assistantMsgEl = renderMessage('assistant', '', true);
  let fullContent = '';

  try {
    // ── Direct chat: pure 1-to-1 with LLM ────────────────────
    // No RAG injection. No library context. No book search.
    // The user's message goes directly to Ollama unmodified.
    const messagesWithContext = [];
    const historySlice = messages.slice(-MAX_CONTEXT_MESSAGES, -1);
    messagesWithContext.push(...historySlice);
    messagesWithContext.push({ role: 'user', content: text });

    // Token budget enforcement: rough estimate (chars ÷ 4), protect system prompt.
    // System prompt ~1000 tokens, num_predict 2048, so history budget ~1000 tokens.
    const TOKEN_BUDGET = 1000;
    let estimatedTokens = messagesWithContext.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    while (estimatedTokens > TOKEN_BUDGET && messagesWithContext.length > 1) {
      messagesWithContext.shift(); // trim oldest, never the current user message
      estimatedTokens = messagesWithContext.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    }

    // Create a per-request AbortController — combines user cancel + timeout
    _currentAbortController = new AbortController();
    const timeoutId = setTimeout(() => _currentAbortController.abort(), CONFIG.streamTimeout);

    const response = await fetch(`${CONFIG.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model, messages: messagesWithContext, stream: true }),
      signal: _currentAbortController.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();

    // Performance telemetry
    const _perfStart = performance.now();
    let _perfFirstToken = 0;
    let _tokenCount = 0;
    let _ollamaEvalCount = 0;  // from Ollama's done response
    let _ollamaEvalDuration = 0;
    let _ollamaPromptEvalDuration = 0;

    // Cold-start indicator: if no token arrives within 2s, show prominent warmup banner.
    // This is a SEPARATE element from message-body so it can't be overwritten by tokens.
    let _warmupEl = null;
    const _warmupTimer = setTimeout(() => {
      if (!fullContent) {
        const body = assistantMsgEl.querySelector('.message-body');
        if (body) {
          _warmupEl = document.createElement('div');
          _warmupEl.className = 'warmup-indicator';
          _warmupEl.innerHTML = '<span class="warmup-pulse"></span> Loading AI model into memory — first response takes a moment...';
          body.prepend(_warmupEl);
        }
      }
    }, 2000);

    // ── Think-block handler ──────────────────────────────────
    // Supports TWO pathways for capturing model reasoning:
    //
    // PATH A: Ollama's message.thinking field
    //   When using a registry-pulled model (e.g., ollama pull qwen3:4b),
    //   Ollama can return thinking in a separate message.thinking field.
    //   This requires think: true in the API body AND that Ollama's
    //   runtime recognizes the model as "thinking-capable." GGUF-imported
    //   models (our setup) do NOT support this — Ollama gates it with a
    //   hardcoded capability check, not template logic. Path A exists
    //   here for future-proofing if we ever switch to registry models.
    //
    // PATH B (Primary): <think>...</think> tag parsing
    //   Qwen3 models are trained to emit <think> tags in their output.
    //   This parser intercepts them token-by-token from message.content
    //   and renders them in the collapsible thinking UI.
    //
    // If NEITHER pathway fires (e.g., non-reasoning model, or thinking
    // suppressed via /no_think in the prompt), the UI simply shows the
    // response with no thinking block. The code won't break.

    let _thinkState = 'scanning';  // 'scanning' | 'in_think' | 'done_think'
    let _thinkRaw = '';            // raw content accumulator for tag detection
    let _thinkContent = '';        // accumulated thinking text
    let _thinkEl = null;           // collapsible DOM element
    let _thinkUsedApiField = false; // true = thinking came via message.thinking

    function _createThinkElement() {
      const body = assistantMsgEl.querySelector('.message-body');
      if (!body || _thinkEl) return; // prevent duplicates
      // Clear the typing indicator before inserting think block
      const typingEl = body.querySelector('.typing-indicator');
      if (typingEl) typingEl.remove();
      const thinkingLabel = body.querySelector('.thinking-label');
      if (thinkingLabel) thinkingLabel.remove();
      // Create the think block
      _thinkEl = document.createElement('div');
      _thinkEl.className = 'think-block active';
      _thinkEl.innerHTML =
        '<div class="think-header">' +
          '<span class="think-chevron">▸</span> ' +
          '<span class="think-label">Thinking</span>' +
          '<span class="think-pulse"></span>' +
        '</div>' +
        '<div class="think-body"></div>';
      // Click to expand/collapse
      _thinkEl.querySelector('.think-header').addEventListener('click', function() {
        _thinkEl.classList.toggle('expanded');
      });
      body.prepend(_thinkEl);
      // Ensure .message-response div exists for response content
      if (!body.querySelector('.message-response')) {
        const responseDiv = document.createElement('div');
        responseDiv.className = 'message-response';
        body.appendChild(responseDiv);
      }
    }

    let _thinkLastUpdate = 0;
    function _updateThinkContent(text) {
      if (!_thinkEl) return;
      const now = performance.now();
      if (now - _thinkLastUpdate < 80) return; // throttle think updates too
      _thinkLastUpdate = now;
      const bodyEl = _thinkEl.querySelector('.think-body');
      if (bodyEl) bodyEl.textContent = text;
    }

    // Force-flush think content (used when thinking ends)
    function _flushThinkContent(text) {
      if (!_thinkEl) return;
      const bodyEl = _thinkEl.querySelector('.think-body');
      if (bodyEl) bodyEl.textContent = text;
    }

    function _finalizeThink() {
      if (!_thinkEl) return;
      _thinkEl.classList.remove('active');
      _thinkEl.classList.add('complete');
      const label = _thinkEl.querySelector('.think-label');
      if (label) label.textContent = 'Thought process';
      const pulse = _thinkEl.querySelector('.think-pulse');
      if (pulse) pulse.remove();
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        try {
          const data = JSON.parse(line);

          // ── PATH A: Ollama's separate thinking field ────────
          if (data.message?.thinking) {
            if (!_perfFirstToken) {
              _perfFirstToken = performance.now();
              clearTimeout(_warmupTimer);
              if (_warmupEl) { _warmupEl.remove(); _warmupEl = null; }
            }
            _tokenCount++;
            _thinkUsedApiField = true;
            _thinkContent += data.message.thinking;
            if (!_thinkEl) _createThinkElement();
            _updateThinkContent(_thinkContent);
            // API field path skips tag scanning entirely
            _thinkState = 'done_think';
          }

          // ── Response content ────────────────────────────────
          if (data.message?.content) {
            if (!_perfFirstToken) {
              _perfFirstToken = performance.now();
              clearTimeout(_warmupTimer);
              if (_warmupEl) { _warmupEl.remove(); _warmupEl = null; }
              // Clear typing indicator on first token
              const body = assistantMsgEl.querySelector('.message-body');
              if (body) {
                const ti = body.querySelector('.typing-indicator');
                if (ti) ti.remove();
                const tl = body.querySelector('.thinking-label');
                if (tl) tl.remove();
              }
            }
            _tokenCount++;

            // If thinking came via API field, content is clean — just stream it
            if (_thinkUsedApiField) {
              // Finalize think element on first content token after thinking ends
              if (_thinkEl && _thinkEl.classList.contains('active')) {
                _finalizeThink();
              }
              fullContent += data.message.content;
              updateMessageContent(assistantMsgEl, fullContent);
            } else {
              // ── PATH B: Fallback <think> tag parsing ─────────
              const token = data.message.content;
              _thinkRaw += token;

              if (_thinkState === 'scanning') {
                if (_thinkRaw.includes('<think>')) {
                  _thinkState = 'in_think';
                  const afterTag = _thinkRaw.split('<think>').slice(1).join('<think>');
                  const beforeTag = _thinkRaw.split('<think>')[0].replace(/^\n+/, '');
                  if (beforeTag) {
                    fullContent += beforeTag;
                    updateMessageContent(assistantMsgEl, fullContent);
                  }
                  _thinkContent = afterTag;
                  _thinkRaw = afterTag;
                  _createThinkElement();
                  if (_thinkContent) _updateThinkContent(_thinkContent);
                } else if (_thinkRaw.length > 10 && !_thinkRaw.startsWith('<')) {
                  fullContent += _thinkRaw;
                  _thinkRaw = '';
                  _thinkState = 'done_think';
                  updateMessageContent(assistantMsgEl, fullContent);
                } else if (_thinkRaw.length > 10 && _thinkRaw.startsWith('<') && !_thinkRaw.startsWith('<think') && !_thinkRaw.startsWith('<th') && !_thinkRaw.startsWith('<t')) {
                  fullContent += _thinkRaw;
                  _thinkRaw = '';
                  _thinkState = 'done_think';
                  updateMessageContent(assistantMsgEl, fullContent);
                }
              } else if (_thinkState === 'in_think') {
                _thinkContent += token;
                _thinkRaw += token;
                if (_thinkContent.includes('</think>')) {
                  const parts = _thinkContent.split('</think>');
                  _thinkContent = parts[0];
                  const afterThink = parts.slice(1).join('</think>').replace(/^\n+/, '');
                  _flushThinkContent(_thinkContent);
                  _finalizeThink();
                  _thinkState = 'done_think';
                  if (afterThink) {
                    fullContent += afterThink;
                    updateMessageContent(assistantMsgEl, fullContent);
                  }
                } else {
                  _updateThinkContent(_thinkContent);
                }
              } else {
                fullContent += token;
                updateMessageContent(assistantMsgEl, fullContent);
              }
            }
          }

          if (data.done) {
            _ollamaEvalCount = data.eval_count || 0;
            _ollamaEvalDuration = data.eval_duration || 0;
            _ollamaPromptEvalDuration = data.prompt_eval_duration || 0;
            break;
          }
        } catch { /* partial JSON */ }
      }
    }
    clearTimeout(_warmupTimer);

    // Flush any unresolved scanning buffer
    if (_thinkState === 'scanning' && _thinkRaw) {
      fullContent += _thinkRaw;
      updateMessageContent(assistantMsgEl, fullContent);
    }
    // Finalize think block if stream ended during thinking
    if (_thinkEl && _thinkEl.classList.contains('active')) {
      _finalizeThink();
    }

    // Flush any pending throttled render so the final content is shown
    flushMessageContent();

    if (fullContent) {
      messages.push({ role: 'assistant', content: fullContent });
      _saveChatState();
      // Auto-read if enabled
      _ttsAutoReadMessage(assistantMsgEl);

      // Log performance metrics — prefer Ollama's server-side eval if available
      const totalMs = performance.now() - _perfStart;
      const ttftMs = _ollamaPromptEvalDuration
        ? (_ollamaPromptEvalDuration / 1e6)  // Ollama reports nanoseconds
        : (_perfFirstToken ? (_perfFirstToken - _perfStart) : 0);
      const tokPerSec = _ollamaEvalDuration > 0
        ? (_ollamaEvalCount / (_ollamaEvalDuration / 1e9)).toFixed(1)
        : (_tokenCount > 0 && totalMs > 0 ? (_tokenCount / (totalMs / 1000)).toFixed(1) : '?');
      if (window.BLACKOUT_CONFIG && window.BLACKOUT_CONFIG.debug) {
        console.log(`[PERF] TTFT: ${(ttftMs/1000).toFixed(1)}s | Speed: ${tokPerSec} tok/s | Tokens: ${_ollamaEvalCount || _tokenCount} | Total: ${(totalMs/1000).toFixed(1)}s`);
      }

      // Show subtle perf stats in message footer (debug aid)
      const body = assistantMsgEl.querySelector('.message-body');
      if (body) {
        const perfEl = document.createElement('div');
        perfEl.className = 'perf-stats';
        perfEl.textContent = `${tokPerSec} tok/s · ${(totalMs/1000).toFixed(1)}s`;
        body.appendChild(perfEl);
      }

      // Persist perf metrics to USB drive (survives unplug — console.log doesn't)
      fetch('/api/perf-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ttft: (ttftMs/1000).toFixed(2),
          tokPerSec: tokPerSec,
          tokens: _ollamaEvalCount || _tokenCount,
          totalTime: (totalMs/1000).toFixed(2),
          prompt: text.substring(0, 80)
        })
      }).catch(() => {}); // Fire-and-forget
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      if (fullContent) {
        messages.push({ role: 'assistant', content: fullContent + '\n\n*[Generation stopped]*' });
        updateMessageContent(assistantMsgEl, fullContent + '\n\n*[Generation stopped]*');
      } else {
        assistantMsgEl.remove();
      }
    } else {
      const isOffline = err.message.includes('404') || err.message.includes('Failed to fetch')
        || err.message.includes('NetworkError') || err.message.includes('Load failed');
      // Use platform-specific launcher name
      const _ua = navigator.userAgent || '';
      let _launcher = 'the START launcher';
      if (/Win/.test(_ua))            _launcher = '**Start (Windows).bat**';
      else if (/Mac|iPhone/.test(_ua)) _launcher = '**The Blackout Drive** app';
      else if (/Linux/.test(_ua))      _launcher = '**Start (Linux).sh**';
      const friendlyMsg = isOffline
        ? `**BEACON needs to be started.**\n\nOpen the drive folder and double-click ${_launcher}. Keep the launcher window open while using the drive.`
        : `**Could not get a response.** (${err.message})\n\nTry again, or restart the launcher if the problem persists.`;
      updateMessageContent(assistantMsgEl, friendlyMsg);
      // Add retry button
      const body = assistantMsgEl.querySelector('.message-body');
      if (body && lastUserMessage) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry-btn';
        retryBtn.innerHTML = '↻ RETRY';
        retryBtn.addEventListener('click', () => {
          assistantMsgEl.remove();
          // Pop the failed assistant entry if it was pushed
          if (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
          userInput.value = lastUserMessage;
          sendMessage();
        });
        body.appendChild(retryBtn);
      }
      if (isOffline) { isConnected = false; setStatus('error'); }
      else showWarning('Response error — try again or restart the launcher.');
    }
  } finally {
    isGenerating  = false;
    currentReader = null;
    sendBtn.classList.remove('loading');
    sendIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (sendLabel) sendLabel.textContent = 'SEND';
    sendBtn.title = isConnected ? 'Send message (Enter)' : 'Start the launcher to connect BEACON';
    // Restore send handler
    sendBtn.removeEventListener('click', cancelGeneration);
    sendBtn.addEventListener('click', sendMessage);
    if (isConnected && userInput.value.trim()) sendBtn.disabled = false;
    else sendBtn.disabled = true;
    userInput.focus();
  }
}

function cancelGeneration() {
  if (_currentAbortController) _currentAbortController.abort();
}

// ── Prompt Cards ──────────────────────────────────────────
function usePrompt(card) {
  if (isGenerating) return;
  // Block prompt cards while engine is still warming up
  if (document.body.classList.contains('beacon-warming')) {
    showToast('BEACON is still loading — try again in a moment', 3000);
    return;
  }
  // Navigate to Chat view if we're on Library/Workspace
  _navigateToChat();
  const text = card.querySelector('p').textContent;
  userInput.value = text;
  updateCharCount();
  autoResize();
  userInput.focus();
  if (isConnected) {
    sendMessage();
  } else {
    showToast('Prompt loaded — start BEACON, then press Enter to send', 4000);
    sendBtn.title = 'Start the launcher to activate BEACON';
  }
}

function showOfflineToast() {
  const existing = $('offlineToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'offlineToast';
  t.className = 'bd-toast bd-toast--offline';
  t.innerHTML = 'START BEACON FIRST<br><span class="bd-toast-sub">Open the drive folder and run the START launcher</span>';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Voice Input (Web Speech API) ─────────────────────────
let recognition = null;
let isListening = false;

function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // Browser doesn't support — mic button stays hidden

  const micBtn = $('micBtn');
  if (!micBtn) return;
  micBtn.style.display = 'flex'; // Show the button

  // Show TTS speed/auto-read controls if speechSynthesis available
  if (window.speechSynthesis) {
    const vc = $('voiceControls');
    if (vc) vc.style.display = 'inline-flex';
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('mic-active');
    micBtn.title = 'Listening... (click to stop)';
    userInput.placeholder = 'Listening...';
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    userInput.value = transcript;
    updateCharCount();
    autoResize();
    // If final result, enable send
    if (event.results[event.results.length - 1].isFinal) {
      sendBtn.disabled = !transcript.trim() || !isConnected;
    }
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied. Allow microphone in browser settings.', 4000);
    } else if (event.error === 'no-speech') {
      showToast('No speech detected. Try again.', 2500);
    }
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
    // Auto-send if we captured something and BEACON is online
    if (userInput.value.trim() && isConnected && !isGenerating) {
      setTimeout(() => sendMessage(), 300);
    }
  };

  micBtn.addEventListener('click', () => {
    if (isListening) stopListening();
    else startListening();
  });
}

function startListening() {
  if (!recognition || isListening) return;
  try { recognition.start(); } catch (e) { console.warn('Could not start recognition:', e); }
}

function stopListening() {
  isListening = false;
  const micBtn = $('micBtn');
  if (micBtn) { micBtn.classList.remove('mic-active'); micBtn.title = 'Voice input'; }
  if (userInput) userInput.placeholder = 'Ask BEACON anything...';
  try { if (recognition) recognition.stop(); } catch (_) {}
}

function showToast(msg, duration = 3500) {
  // Ensure toast container exists
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'bd-toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = 'bd-toast';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ── UI Utilities ──────────────────────────────────────────
function scrollToBottom() {
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Throttled version for streaming — coalesces rapid calls into one paint frame
let _scrollRafId = null;
function _scrollToBottomThrottled() {
  if (_scrollRafId) return; // already scheduled
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    scrollToBottom();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateCharCount() {
  const len = userInput.value.length;
  charCount.textContent = `${len} / 4000`;
  charCount.style.color = len > 3500 ? '#cc3333' : '';
}

function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
}

function clearConversation() {
  if (messages.length === 0) return;
  _showConfirmModal('Clear the conversation? This cannot be undone.', () => {
    messages = [];
    messagesEl.innerHTML = '';
    _showWelcome(true);
    // Reset conversation identity so the next chat creates a new ID
    _currentConvId = null;
    _currentConvTitle = null;

    // Clear input field
    userInput.value = '';
    userInput.style.height = 'auto';
    updateCharCount();

    clearTimeout(_autoSaveTimer);
    try {
      sessionStorage.removeItem(CHAT_SS_KEY);
      sessionStorage.removeItem('dd_conv_id');
    } catch {}
  });
}

// Disk-based conversation persistence ─────────────────────────────────

// Start a new conversation (saves current first)
async function _newConversation() {
  if (messages.length > 0) {
    await _saveToDisk();
  }
  // Reset state
  messages = [];
  _currentConvId = null;
  _currentConvTitle = null;
  clearTimeout(_autoSaveTimer);
  try { sessionStorage.removeItem(CHAT_SS_KEY); } catch (_) {}
  // Reset UI
  messagesEl.innerHTML = '';
  _showWelcome(true);
  toggleConversationsPanel(false);

  // Navigate to Chat view — close Library/Workspace if open
  _navigateToChat();

  // Clear input field
  userInput.value = '';
  userInput.style.height = 'auto';
  updateCharCount();

  userInput.focus();
}

function _genId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// Auto-save current conversation to disk (debounced — 1s after last message)
function _scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => _saveToDisk(), 1000);
}

async function _saveToDisk(title = null) {
  // Check if auto-save is enabled in settings (defaults to ON)
  const stored = localStorage.getItem('bd-setting-autosave');
  const autoSaveEnabled = stored === null ? true : stored === 'true';
  if (!autoSaveEnabled && !title) return; // Only skip for auto-saves, not explicit saves
  if (!messages || messages.length === 0) return;
  if (!_currentConvId) _currentConvId = _genId();

  // Generate title client-side if needed — must happen BEFORE encryption
  // blanks out the messages array, otherwise the server falls back to "Conversation".
  let useTitle = title || _currentConvTitle || null;
  if (!useTitle) {
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      const text = (firstUserMsg.content || '').trim();
      useTitle = text.length > 57 ? text.substring(0, 57) + '...' : text;
    }
  }

  // Build the save payload
  const plainMessages = messages.map(m => ({ role: m.role, content: m.content }));
  const payload = { id: _currentConvId, title: useTitle, messageCount: messages.length };

  // Encrypt messages if history encryption is enabled
  if (typeof _isEncryptHistoryEnabled === 'function' && _isEncryptHistoryEnabled()) {
    const sessionPw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : null;
    if (!sessionPw) {
      // Drive is locked — skip save silently, show the unsaved banner
      // The banner's UNLOCK button will re-trigger _saveToDisk() after unlock.
      if (typeof _showUnsavedBanner === 'function') _showUnsavedBanner();
      return;
    }
    try {
      const convObj = { messages: plainMessages };
      const encrypted = await _encryptConversationJSON(convObj);
      if (encrypted && encrypted.encrypted) {
        payload.encryptedMessages = encrypted.data;
        payload.messages = []; // Send empty array — metadata only
      } else {
        payload.messages = plainMessages;
      }
    } catch {
      payload.messages = plainMessages; // Fail open
    }
  } else {
    payload.messages = plainMessages;
  }

  try {
    const res = await fetch(`/api/conversations/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      _currentConvTitle = data.title;
      // Persist active conversation ID
      sessionStorage.setItem('dd_conv_id', _currentConvId);
      // Show auto-save indicator
      _flashAutoSave();
      // Refresh conversation list if panel is open so new chats appear immediately
      if (_convPanelOpen) _loadConversationList();
    }
  } catch (_) {
    // Server not running — show subtle feedback so user knows save failed
    showToast('Auto-save unavailable — server not running', 2000);
  }
}

function _flashAutoSave() {
  const indicator = document.getElementById('autosaveIndicator');
  if (!indicator) return;
  indicator.style.display = 'block';
  // Re-trigger animation by removing and re-adding the element
  indicator.style.animation = 'none';
  indicator.offsetHeight; // force reflow
  indicator.style.animation = '';
  // Hide after animation completes
  clearTimeout(indicator._timer);
  indicator._timer = setTimeout(() => { indicator.style.display = 'none'; }, 2200);
}

// Load a conversation from disk and restore it to the chat
async function loadConversation(convId) {
  // Already viewing this conversation — no-op (check BEFORE network fetch)
  if (_currentConvId === convId) return;

  try {
    const res = await fetch(`/api/conversations/${convId}`);
    if (!res.ok) return;
    const conv = await res.json();

    // Handle encrypted conversations
    if (conv.encryptedMessages && typeof _decryptConversationJSON === 'function') {
      try {
        const decrypted = await _decryptConversationJSON({ encrypted: true, data: conv.encryptedMessages });
        if (!decrypted || !decrypted.messages) {
          if (typeof showToast === 'function') showToast('Could not decrypt conversation', 3000);
          return;
        }
        conv.messages = decrypted.messages;
      } catch {
        if (typeof showToast === 'function') showToast('Decryption failed', 3000);
        return;
      }
    }

    if (!conv.messages || !conv.messages.length) return;

    // Auto-save current chat silently before switching — no confirmation needed.
    // The user clicked a specific chat; that intent is clear enough.
    if (messages.length > 0) {
      await _saveToDisk();
    }
    // Navigate to Chat view — close Library/Workspace if open
    _navigateToChat();
    _doLoadConversation(conv);
  } catch (_) {}
}

function _doLoadConversation(conv) {
  messages = conv.messages.map(m => ({ role: m.role, content: m.content }));
  _currentConvId = conv.id;
  _currentConvTitle = conv.title;

  // Clear input field
  userInput.value = '';
  userInput.style.height = 'auto';
  updateCharCount();

  // Re-render chat
  messagesEl.innerHTML = '';
  _showWelcome(false);
  for (const msg of messages) renderMessage(msg.role, msg.content);

  // Update sessionStorage
  try { sessionStorage.setItem(CHAT_SS_KEY, JSON.stringify(messages)); } catch (_) {}

  // Update active highlight in conversation list (don't close the panel)
  document.querySelectorAll('.conv-item').forEach(el => {
    const elId = el.id.replace('conv-item-', '');
    el.classList.toggle('conv-item-active', elId === conv.id);
  });

  showToast(`Loaded: ${conv.title}`);
}

async function deleteConversation(convId, titleEl) {
  _showConfirmModal('Delete this conversation? This cannot be undone.', async () => {
    try {
      await fetch(`/api/conversations/${convId}`, { method: 'DELETE' });
      // Remove from list
      const item = document.getElementById(`conv-item-${convId}`);
      if (item) item.remove();
      // If it was the current conversation, mark as unsaved
      if (_currentConvId === convId) {
        _currentConvId = null;
        _currentConvTitle = null;
      }
      // If panel is empty, show empty state
      const list = document.getElementById('convList');
      if (list && list.children.length === 0) {
        list.innerHTML = '<div class="conv-empty">No saved conversations yet.<br>Chat with BEACON and save your sessions here.</div>';
      }
      showToast('Conversation deleted');
    } catch (_) {}
  });
}

// ── Panel Mutual Exclusion ────────────────────────────────────────────────────
// All secondary panels (prompts, history, status, help) must call this before
// opening. Only one panel can be open at a time. Library is handled separately
// (it takes over the full viewport so other panels never show behind it).
function _setActiveSidebarBtn(id) {
  document.querySelectorAll('.sidebar-btn').forEach(b => {
    b.classList.remove('sidebar-btn--active');
    b.setAttribute('aria-expanded', 'false');
  });
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('sidebar-btn--active');
    el.setAttribute('aria-expanded', 'true');
  }
}

/**
 * Close only the slide-in side panels (Settings, Help, Status, Conversations, Prompts).
 * Does NOT close Library or Workspace full-screen overlays.
 * Use this when opening a side panel that should coexist with Library/Workspace.
 */
function _closeSidePanels(keepSpacer = false) {
  // Close all slide-in panels directly (don't call toggle functions,
  // which each independently remove has-left-panel and cause a snap)
  _promptPanelOpen = false;
  const pp = document.getElementById('promptPanel');
  if (pp) pp.classList.remove('prompt-panel-open');

  _diagOpen = false;
  const dp = document.getElementById('diagPanel');
  if (dp) dp.classList.remove('diag-panel-open');

  _helpPanelOpen = false;
  const hp = document.getElementById('helpPanel');
  if (hp) hp.classList.remove('help-panel-open');

  _convPanelOpen = false;
  const cp = document.getElementById('conversationsPanel');
  if (cp) cp.classList.remove('conv-panel-open');

  _settingsPanelOpen = false;
  const sp = document.getElementById('settingsPanel');
  if (sp) sp.classList.remove('open');

  // Only remove the spacer push if we're truly closing (not switching panels)
  if (!keepSpacer) {
    document.body.classList.remove('has-left-panel');
  }
}

/**
 * Close EVERYTHING — side panels + full-screen overlays (Library, Workspace).
 * Use this when switching TO a full-screen view (Library, Workspace) or going back to chat.
 */
function closeAllPanels(keepSpacer = false) {
  // Close Library overlay first (it covers everything else)
  if (typeof closeLibrary === 'function') closeLibrary();
  // Close Workspace overlay
  if (typeof closeWorkspace === 'function') closeWorkspace();
  // Close all slide-in panels
  _closeSidePanels(keepSpacer);
}

/**
 * Determine which sidebar button should be active based on what view is currently showing.
 * Library and Workspace are full-screen overlays; if either is open, they take priority.
 */
function _getActiveViewBtn() {
  const libPanel = document.getElementById('libraryPanel');
  if (libPanel && libPanel.style.display !== 'none') return 'libraryNavBtn';
  const wsPanel = document.getElementById('workspacePanel');
  if (wsPanel && wsPanel.style.display !== 'none') return 'workspaceNavBtn';
  return 'chatNavBtn';
}

// Go back to the primary CHAT view — closes all panels + library
function goToChat() {
  _navigateToChat();
}

/**
 * Navigate to the Chat view from ANY panel state.
 * Closes Library, Workspace, and all side panels, restores main-content visibility.
 * Safe to call from anywhere — no-ops if already on Chat.
 */
function _navigateToChat() {
  // Close Library overlay
  if (typeof closeLibrary === 'function') {
    const libPanel = document.getElementById('libraryPanel');
    if (libPanel && libPanel.style.display !== 'none') closeLibrary();
  }
  // Close Workspace overlay
  if (typeof closeWorkspace === 'function') {
    const wsPanel = document.getElementById('workspacePanel');
    if (wsPanel && wsPanel.style.display !== 'none') closeWorkspace();
  }
  // Restore main chat content visibility
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = '';
  // Close side panels
  _closeSidePanels();
  _setActiveSidebarBtn('chatNavBtn');
}

// Toggle the conversations sidebar panel
function toggleConversationsPanel(forceState = null) {
  const opening = forceState !== null ? !!forceState : !_convPanelOpen;
  if (opening) _closeSidePanels(true); // close other side panels, keep spacer
  _convPanelOpen = opening;
  const panel = document.getElementById('conversationsPanel');
  if (!panel) return;
  if (_convPanelOpen) {
    panel.classList.add('conv-panel-open');
    document.body.classList.add('has-left-panel');     // push main content right
    _setActiveSidebarBtn('chatNavBtn');
    _loadConversationList();
  } else {
    panel.classList.remove('conv-panel-open');
    document.body.classList.remove('has-left-panel');  // restore main content width
    _setActiveSidebarBtn(_getActiveViewBtn());
  }
}

// ── Settings Panel ─────────────────────────────────────────────────────────
let _settingsPanelOpen = false;

function toggleSettingsPanel(forceState = null) {
  const opening = forceState !== null ? !!forceState : !_settingsPanelOpen;
  if (opening) _closeSidePanels(true); // close other side panels only, keep lib/ws
  _settingsPanelOpen = opening;
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  if (_settingsPanelOpen) {
    panel.classList.add('open');
    document.body.classList.add('has-left-panel');
    _setActiveSidebarBtn('settingsNavBtn');
    _loadSettingsState(); // Refresh toggle states from localStorage
  } else {
    panel.classList.remove('open');
    document.body.classList.remove('has-left-panel');
    _setActiveSidebarBtn(_getActiveViewBtn());
  }
}

// Load settings from localStorage into UI controls
function _loadSettingsState() {
  const autoSave = document.getElementById('settingAutoSave');
  const autoRead = document.getElementById('settingAutoRead');
  const speechSpeed = document.getElementById('settingSpeechSpeed');
  const fontSize = document.getElementById('settingFontSize');
  const engineTier = document.getElementById('settingEngineTier');
  const tierInfo = document.getElementById('settingsTierInfo');
  const networkLock = document.getElementById('settingNetworkLock');
  const encryptHistory = document.getElementById('settingEncryptHistory');
  const encryptRow = document.getElementById('encryptHistoryRow');

  // Network Lock — defaults to ON
  if (networkLock) {
    const stored = localStorage.getItem('bd-setting-network-lock');
    networkLock.checked = stored === null ? true : stored === 'true';
    if (stored === null) localStorage.setItem('bd-setting-network-lock', 'true');
  }

  // Save Chat History — defaults to ON
  if (autoSave) {
    const stored = localStorage.getItem('bd-setting-autosave');
    autoSave.checked = stored === null ? true : stored === 'true';
    if (stored === null) localStorage.setItem('bd-setting-autosave', 'true');
  }

  // Encrypt History toggle — dims when Save History is OFF (dependency is visible)
  if (encryptRow) {
    const saveIsOn = autoSave && autoSave.checked;
    encryptRow.style.opacity = saveIsOn ? '' : '0.45';
    encryptRow.style.pointerEvents = saveIsOn ? '' : 'none';
    const encryptDesc = encryptRow.querySelector('.settings-label-desc');
    if (encryptDesc && !saveIsOn) {
      encryptDesc.textContent = 'Enable Save Chat History above to use encryption.';
    }
  }
  if (encryptHistory) {
    encryptHistory.checked = localStorage.getItem('bd-setting-encrypt-history') === 'true';
  }

  if (autoRead) autoRead.checked = localStorage.getItem('bd-setting-autoread') === 'true';
  if (speechSpeed) speechSpeed.value = localStorage.getItem('bd-setting-speech-speed') || '1';
  if (fontSize) fontSize.value = localStorage.getItem('bd-setting-font-size') || 'default';

  // Load current engine tier from server
  if (engineTier || tierInfo) {
    fetch('/api/settings/tier').then(r => r.json()).then(data => {
      if (engineTier) {
        engineTier.value = data.override || 'auto';
      }
      if (tierInfo && data.active) {
        tierInfo.innerHTML = `<span class="settings-tier-active">Active: ${data.active.modelName || data.active.tier.toUpperCase()}</span>`
          + (data.active.source === 'auto' && data.active.detectedRamGB
            ? ` <span class="settings-tier-ram">(${data.active.detectedRamGB} GB RAM detected)</span>` : '');
      }
    }).catch(() => {
      if (tierInfo) tierInfo.textContent = 'Could not load engine info';
    });
  }
}

// Apply font size class to body
function _applyFontSize(size) {
  document.body.classList.remove('font-small', 'font-large');
  if (size === 'small') document.body.classList.add('font-small');
  else if (size === 'large') document.body.classList.add('font-large');
}

// Initialize settings event listeners (called once at page load)
function _initSettings() {
  const autoSave = document.getElementById('settingAutoSave');
  const autoRead = document.getElementById('settingAutoRead');
  const speechSpeed = document.getElementById('settingSpeechSpeed');
  const fontSize = document.getElementById('settingFontSize');
  const networkLock = document.getElementById('settingNetworkLock');
  const encryptHistory = document.getElementById('settingEncryptHistory');

  // Network Lock toggle — modal when turning OFF, instant when turning ON
  if (networkLock) networkLock.addEventListener('change', () => {
    if (_blackoutProtocolOn) {
      // Should not happen (toggle is disabled), but safety check
      networkLock.checked = true;
      return;
    }
    if (!networkLock.checked) {
      // Turning OFF Network Lock — revert toggle & show warning modal
      networkLock.checked = true; // revert until confirmed
      _showNetworkLockWarning();
    } else {
      // Turning ON — instant, no modal
      _onlineMode = false;
      try { localStorage.setItem('bd_online_mode', '0'); } catch {}
      localStorage.setItem('bd-setting-network-lock', 'true');
      _syncBlackoutUI();
      showToast('Network locked — no internet connections', 3000);
    }
  });

  // Save Chat History toggle
  if (autoSave) autoSave.addEventListener('change', () => {
    localStorage.setItem('bd-setting-autosave', autoSave.checked);
    _updateConvPanelMode();
    const encryptRow = document.getElementById('encryptHistoryRow');
    if (encryptRow) {
      const saveOn = autoSave.checked;
      encryptRow.style.opacity = saveOn ? '' : '0.45';
      encryptRow.style.pointerEvents = saveOn ? '' : 'none';
      const encryptDesc = encryptRow.querySelector('.settings-label-desc');
      if (encryptDesc) {
        if (!saveOn) {
          encryptDesc.textContent = 'Enable Save Chat History above to use encryption.';
        } else if (!_blackoutProtocolOn) {
          encryptDesc.textContent = 'When ON, saved conversations are encrypted with your master password so no one else can read them.';
        }
      }
    }
    // Re-sync forced toggle states (BP may need to force Encrypt ON)
    _syncBlackoutUI();
  });

  // Encrypt Chat History toggle — requires master password
  if (encryptHistory) encryptHistory.addEventListener('change', async () => {
    if (_blackoutProtocolOn) {
      // Forced ON by Blackout Protocol — do not allow changes
      encryptHistory.checked = true;
      return;
    }
    if (encryptHistory.checked) {
      // Turning ON encryption — require master password
      try {
        await _requireMasterPassword();
        localStorage.setItem('bd-setting-encrypt-history', 'true');
        if (typeof showToast === 'function') showToast('Chat encryption enabled', 2000);
      } catch {
        // User cancelled — revert toggle
        encryptHistory.checked = false;
      }
    } else {
      localStorage.setItem('bd-setting-encrypt-history', 'false');
      if (typeof showToast === 'function') showToast('Chat encryption disabled', 2000);
    }
  });
  if (autoRead) autoRead.addEventListener('change', () => {
    localStorage.setItem('bd-setting-autoread', autoRead.checked);
    // Directly update TTS engine state
    _ttsAutoRead = autoRead.checked;
    const autoBtn = document.getElementById('autoReadBtn');
    if (autoBtn) {
      autoBtn.classList.toggle('auto-read-active', _ttsAutoRead);
      autoBtn.textContent = _ttsAutoRead ? 'AUTO' : 'AUTO';
    }
    if (!_ttsAutoRead && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  if (speechSpeed) speechSpeed.addEventListener('change', () => {
    localStorage.setItem('bd-setting-speech-speed', speechSpeed.value);
    // Directly update TTS engine speed
    _ttsSpeed = parseFloat(speechSpeed.value) || 1.0;
    const speedBtn = document.getElementById('ttsSpeedBtn');
    if (speedBtn) speedBtn.textContent = _ttsSpeed + 'x';
  });
  if (fontSize) fontSize.addEventListener('change', () => {
    localStorage.setItem('bd-setting-font-size', fontSize.value);
    _applyFontSize(fontSize.value);
  });

  // Engine tier selector — live hot-swap
  const engineTier = document.getElementById('settingEngineTier');
  if (engineTier) engineTier.addEventListener('change', async () => {
    const tier = engineTier.value; // 'auto', 'base', or 'max'
    const tierLabel = tier === 'auto' ? 'Auto-Detect'
      : tier === 'max' ? 'Performance (8B)' : 'Compact (4B)';
    engineTier.disabled = true;
    showToast('Switching engines... please wait', 15000);
    try {
      const res = await fetch('/api/settings/tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (data.ok) {
        // Wait for the background hot-swap to finish (model rebuild takes ~5-15s)
        await new Promise(r => setTimeout(r, 12000));
        showToast(`Engine switched to ${tierLabel}`, 4000);
      } else {
        showToast('Engine switch failed', 4000);
      }
    } catch {
      showToast('Could not switch engine tier', 3000);
    } finally {
      engineTier.disabled = false;
    }
  });

  // Apply saved font size on load
  _applyFontSize(localStorage.getItem('bd-setting-font-size') || 'default');

  // Update conversations panel to reflect save mode
  _updateConvPanelMode();

  // Purge all conversations button
  const purgeBtn = document.getElementById('purgeAllConvBtn');
  if (purgeBtn) purgeBtn.addEventListener('click', () => {
    _showConfirmModal(
      'PURGE ALL CONVERSATIONS: This will permanently delete every saved conversation from this drive. This cannot be undone.',
      async () => {
        try {
          const res = await fetch('/api/conversations');
          if (!res.ok) throw new Error();
          const data = await res.json();
          const convList = data.conversations || [];
          for (const c of convList) {
            await fetch(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
          }
          // Clear current session too
          messages = [];
          messagesEl.innerHTML = '';
          _currentConvId = null;
          _currentConvTitle = null;
          userInput.value = '';
          userInput.style.height = 'auto';
          updateCharCount();
          try { sessionStorage.removeItem(CHAT_SS_KEY); } catch {}
          _showWelcome(true);
          showToast('All conversations purged', 3000);
          if (_convPanelOpen) _loadConversationList();
        } catch {
          showToast('Could not purge — server not running', 3000);
        }
      }
    );
  });
}

async function _loadConversationList() {
  const list = document.getElementById('convList');
  if (!list) return;

  const sessionUnlocked = typeof _getSessionPassword === 'function' && !!_getSessionPassword();

  list.innerHTML = '<div class="conv-loading">Loading...</div>';
  try {
    const res = await fetch(`/api/conversations`);
    if (!res.ok) throw new Error('server error');
    const data = await res.json();
    const convs = data.conversations || [];

    if (convs.length === 0) {
      list.innerHTML = '<div class="conv-empty">No saved conversations yet.<br>Chat with BEACON and save your sessions here.</div>';
      return;
    }

    list.innerHTML = '';

    // ── Compact "Unlock/Lock" bar if any encrypted chats OR encryption enabled ──
    const encryptedCount = convs.filter(c => c.encrypted).length;
    const encryptionEnabled = localStorage.getItem('bd-setting-encrypt-history') === 'true' || _blackoutProtocolOn;
    
    if (encryptedCount > 0 || encryptionEnabled) {
      const bar = document.createElement('div');
      bar.className = 'conv-unlock-bar';

      if (!sessionUnlocked) {
        // LOCKED state — show count + UNLOCK button
        bar.innerHTML = `
          <span class="conv-unlock-bar-icon">🔒</span>
          <span class="conv-unlock-bar-text">${encryptedCount} encrypted chat${encryptedCount > 1 ? 's' : ''}</span>
          <button class="conv-unlock-bar-btn" id="convToggleLockBtn">UNLOCK</button>`;
        list.appendChild(bar);
        bar.querySelector('#convToggleLockBtn').addEventListener('click', (e) => {
          e.stopPropagation();
          _unlockSession(() => {
            _loadConversationList();
            if (typeof _hideUnsavedBanner === 'function') _hideUnsavedBanner();
          });
        });
      } else {
        // UNLOCKED state — show LOCK button to re-hide titles
        bar.innerHTML = `
          <span class="conv-unlock-bar-icon">🔓</span>
          <span class="conv-unlock-bar-text">Chats unlocked</span>
          <button class="conv-unlock-bar-btn conv-unlock-bar-btn--lock" id="convToggleLockBtn">LOCK</button>`;
        list.appendChild(bar);
        bar.querySelector('#convToggleLockBtn').addEventListener('click', (e) => {
          e.stopPropagation();
          _lockSession();
          _loadConversationList();
        });
      }
    }

    // ── Render unified conversation list ──
    for (const conv of convs) {
      const dateStr = conv.last_message_at || conv.updated_at;
      const date = dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const isActive = conv.id === _currentConvId;
      const isEncrypted = !!conv.encrypted;
      const isLocked = isEncrypted && !sessionUnlocked;

      const item = document.createElement('div');
      item.className = `conv-item${isActive ? ' conv-item-active' : ''}${isLocked ? ' conv-item--locked' : ''}`;
      item.id = `conv-item-${conv.id}`;
      item.style.cursor = 'pointer';

      // Icon: 🔒 locked, 🔓 unlocked-encrypted, nothing for plaintext
      const icon = isEncrypted ? (isLocked ? '🔒 ' : '🔓 ') : '';
      const metaSuffix = isEncrypted ? ' &middot; encrypted' : '';
      // Redact title when locked so no content leaks through the sidebar
      const displayTitle = isLocked ? '━━━━━━━━━━━━' : escapeHtml(conv.title);

      item.innerHTML = `
        <div class="conv-item-title">${icon}${displayTitle}</div>
        <div class="conv-item-meta">${isLocked ? '🔒 encrypted · UNLOCK TO VIEW' : `${date} &middot; ${conv.message_count} msg${metaSuffix}`}</div>
        <button class="conv-item-delete" title="Delete">&times;</button>
      `;

      // Click handler — locked chats trigger unlock first
      item.addEventListener('click', (e) => {
        if (e.target.closest('.conv-item-delete')) return;
        if (isLocked) {
          _unlockSession(() => {
            _loadConversationList(); // Refresh list to show unlocked state
            loadConversation(conv.id);
          });
        } else {
          loadConversation(conv.id);
        }
      });

      // Delete button — always works, no password needed
      item.querySelector('.conv-item-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(conv.id);
      });

      list.appendChild(item);
    }
  } catch (_) {
    list.innerHTML = '<div class="conv-empty">Could not load conversations.<br>Make sure the server is running.</div>';
  }
}


// ── Custom confirm modal (replaces native confirm()) ──────────
function _showConfirmModal(message, onConfirm) {
  // Remove any existing modal
  const old = document.getElementById('bdConfirmModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'bdConfirmModal';
  modal.className = 'bd-confirm-overlay';
  modal.innerHTML = `
    <div class="bd-confirm-box">
      <div class="bd-confirm-msg">${message}</div>
      <div class="bd-confirm-actions">
        <button class="bd-confirm-btn bd-confirm-cancel">CANCEL</button>
        <button class="bd-confirm-btn bd-confirm-ok">CONFIRM</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Fade in
  requestAnimationFrame(() => modal.classList.add('bd-confirm-visible'));

  const close = () => {
    modal.classList.remove('bd-confirm-visible');
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector('.bd-confirm-cancel').addEventListener('click', close);
  modal.querySelector('.bd-confirm-ok').addEventListener('click', () => {
    close();
    onConfirm();
  });
  // Escape to cancel
  const esc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  // Click outside to cancel
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  // Focus the cancel button
  modal.querySelector('.bd-confirm-cancel').focus();
}

// ── Promise-based themed confirm (for async/await callers) ────
// Returns a Promise<boolean> — true if user clicks CONFIRM, false for CANCEL/Escape/outside
function _showThemedConfirm(title, detail) {
  return new Promise(resolve => {
    const old = document.getElementById('bdConfirmModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'bdConfirmModal';
    modal.className = 'bd-confirm-overlay';
    modal.innerHTML = `
      <div class="bd-confirm-box">
        <div class="bd-confirm-msg">${escapeHtml(title)}</div>
        ${detail ? `<div class="bd-confirm-detail" style="margin-top:8px;font-size:0.85rem;opacity:0.65">${escapeHtml(detail)}</div>` : ''}
        <div class="bd-confirm-actions">
          <button class="bd-confirm-btn bd-confirm-cancel">CANCEL</button>
          <button class="bd-confirm-btn bd-confirm-ok">CONFIRM</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('bd-confirm-visible'));

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      modal.classList.remove('bd-confirm-visible');
      setTimeout(() => modal.remove(), 200);
      document.removeEventListener('keydown', esc);
      resolve(result);
    };

    modal.querySelector('.bd-confirm-cancel').addEventListener('click', () => finish(false));
    modal.querySelector('.bd-confirm-ok').addEventListener('click', () => finish(true));
    const esc = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', esc);
    modal.addEventListener('click', (e) => { if (e.target === modal) finish(false); });
    modal.querySelector('.bd-confirm-cancel').focus();
  });
}

// Persist chat messages to sessionStorage (max 50 messages to limit size)
function _saveChatState(silent = false) {
  const stored = localStorage.getItem('bd-setting-autosave');
  const autoSaveEnabled = stored === null ? true : stored === 'true';
  if (autoSaveEnabled) {
    try {
      const toSave = messages.slice(-50);
      sessionStorage.setItem(CHAT_SS_KEY, JSON.stringify(toSave));
    } catch {}
  }
  // Persist active conversation ID so reload can skip re-confirm
  try {
    if (_currentConvId) sessionStorage.setItem('dd_conv_id', _currentConvId);
    else sessionStorage.removeItem('dd_conv_id');
  } catch {}
  // Schedule disk auto-save (shows indicator) — skip when silent
  if (!silent) _scheduleAutoSave();
}

function _restoreChatState() {
  // If auto-save is off, don't restore — start fresh
  const stored = localStorage.getItem('bd-setting-autosave');
  const autoSaveEnabled = stored === null ? true : stored === 'true';
  if (!autoSaveEnabled) {
    try { sessionStorage.removeItem(CHAT_SS_KEY); } catch {}
    return;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(CHAT_SS_KEY) || 'null');
    if (!saved || !Array.isArray(saved) || !saved.length) return;
    messages = saved;
    // Restore active conversation ID so re-clicking the same chat is a no-op
    _currentConvId = sessionStorage.getItem('dd_conv_id') || null;
    _showWelcome(false);
    for (const msg of messages) {
      renderMessage(msg.role, msg.content);
    }
  } catch {}
}


// ── Blackout Protocol & Network Lock ──────────────────────
// Blackout Protocol = master security override.
// When ON: Network Lock = ON (forced), Encrypt Chat History = ON (forced).
// Network Lock controls library.js online catalog access.
let _onlineMode = false;
let _blackoutProtocolOn = true;

function _initBlackoutProtocol() {
  // Read stored BP state — defaults to ON
  const stored = localStorage.getItem('bd-blackout-protocol');
  _blackoutProtocolOn = stored === null ? true : stored === 'true';

  // ALWAYS default network to offline on fresh boot
  _onlineMode = false;
  try { localStorage.setItem('bd_online_mode', '0'); } catch {}

  // If BP is ON, force encrypt history ON
  if (_blackoutProtocolOn) {
    localStorage.setItem('bd-setting-network-lock', 'true');
    localStorage.setItem('bd-setting-encrypt-history', 'true');
  }

  _syncBlackoutUI();
}

async function toggleBlackoutProtocol() {
  if (_blackoutProtocolOn) {
    // Turning OFF — show confirmation (lowering shields)
    const overlay = document.getElementById('bpConfirmOverlay');
    if (overlay) overlay.style.display = 'flex';
  } else {
    // Turning ON — instant, no modal (raising shields)
    _blackoutProtocolOn = true;
    localStorage.setItem('bd-blackout-protocol', 'true');

    // Force Network Lock ON
    _onlineMode = false;
    try { localStorage.setItem('bd_online_mode', '0'); } catch {}
    localStorage.setItem('bd-setting-network-lock', 'true');
    const nlToggle = document.getElementById('settingNetworkLock');
    if (nlToggle) nlToggle.checked = true;

    // Force Encrypt Chat History ON
    localStorage.setItem('bd-setting-encrypt-history', 'true');
    const ehToggle = document.getElementById('settingEncryptHistory');
    if (ehToggle) ehToggle.checked = true;

    _syncBlackoutUI();

    // Prompt for password immediately — the right moment, not deferred to first save
    const pw = await _unlockSession();
    if (!pw) {
      // User cancelled — abort BP activation, revert everything
      _blackoutProtocolOn = false;
      localStorage.setItem('bd-blackout-protocol', 'false');
      _syncBlackoutUI();
      showToast('Master password required to enable Blackout Protocol', 3000);
      return;
    }

    showToast('Blackout Protocol enabled — drive locked', 3000);
  }
}

function confirmBlackoutDisable() {
  _blackoutProtocolOn = false;
  localStorage.setItem('bd-blackout-protocol', 'false');
  const overlay = document.getElementById('bpConfirmOverlay');
  if (overlay) overlay.style.display = 'none';
  _syncBlackoutUI();
  showToast('Blackout Protocol disabled — individual controls unlocked', 3000);
}

function cancelBlackoutDisable() {
  const overlay = document.getElementById('bpConfirmOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ── Network Lock modal flow (used by Settings toggle when BP is OFF) ──
function _showNetworkLockWarning() {
  const overlay = document.getElementById('networkLockOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function confirmNetworkUnlock() {
  _onlineMode = true;
  try { localStorage.setItem('bd_online_mode', '1'); } catch {}
  localStorage.setItem('bd-setting-network-lock', 'false');
  const nlToggle = document.getElementById('settingNetworkLock');
  if (nlToggle) nlToggle.checked = false;
  const overlay = document.getElementById('networkLockOverlay');
  if (overlay) overlay.style.display = 'none';
  _syncBlackoutUI();
  showToast('Network unlocked — will check for new content', 3000);
}

function cancelNetworkUnlock() {
  const overlay = document.getElementById('networkLockOverlay');
  if (overlay) overlay.style.display = 'none';
  // Revert the toggle (user cancelled)
  const nlToggle = document.getElementById('settingNetworkLock');
  if (nlToggle) nlToggle.checked = true;
}

/**
 * Synchronize ALL Blackout Protocol UI surfaces.
 * Updates badge, diagnostics panel, and forced-toggle states.
 */
function _syncBlackoutUI() {
  // 1. Update the header badge
  const badge = document.getElementById('blackoutBadge');
  if (badge) {
    if (_blackoutProtocolOn) {
      badge.classList.remove('protocol-off');
      badge.title = 'Blackout Protocol active — maximum security';
    } else {
      badge.classList.add('protocol-off');
      badge.title = 'Blackout Protocol disabled — click to re-enable';
    }
  }

  // 2. Force/unforce Network Lock toggle
  const nlRow = document.getElementById('settingNetworkLock')?.closest('.settings-row');
  const nlToggle = document.getElementById('settingNetworkLock');
  const nlLabel = nlRow?.querySelector('.settings-toggle');
  if (_blackoutProtocolOn) {
    if (nlToggle) nlToggle.checked = true;
    if (nlLabel) nlLabel.classList.add('settings-toggle--disabled');
    if (nlRow) {
      nlRow.classList.add('settings-row--forced');
      const desc = nlRow.querySelector('.settings-label-desc');
      if (desc) desc.textContent = 'Blackout Protocol is ON — internet is blocked automatically.';
    }
  } else {
    if (nlLabel) nlLabel.classList.remove('settings-toggle--disabled');
    if (nlRow) {
      nlRow.classList.remove('settings-row--forced');
      const desc = nlRow.querySelector('.settings-label-desc');
      if (desc) desc.textContent = 'Prevents the drive from accessing the internet. BEACON works 100% offline — this only needs to be off if you want to download new library content.';
    }
  }

  // 3. Force/unforce Encrypt History toggle
  const ehRow = document.getElementById('encryptHistoryRow');
  const ehToggle = document.getElementById('settingEncryptHistory');
  const ehLabel = ehRow?.querySelector('.settings-toggle');
  const saveOn = document.getElementById('settingAutoSave')?.checked;
  if (_blackoutProtocolOn) {
    if (ehToggle) ehToggle.checked = true;
    if (ehLabel) ehLabel.classList.add('settings-toggle--disabled');
    if (ehRow) {
      ehRow.classList.add('settings-row--forced');
      // Dim if Save History is OFF — dimmed is better than hidden (shows it exists)
      ehRow.style.opacity = saveOn ? '' : '0.45';
      ehRow.style.pointerEvents = saveOn ? '' : 'none';
      const desc = ehRow.querySelector('.settings-label-desc');
      if (desc) {
        desc.textContent = saveOn
          ? 'Blackout Protocol is ON — your conversations are encrypted automatically. You can change your password in Settings → Data.'
          : 'Enable Save Chat History above to use encryption.';
      }
    }
  } else {
    if (ehLabel) ehLabel.classList.remove('settings-toggle--disabled');
    if (ehRow) {
      ehRow.classList.remove('settings-row--forced');
      ehRow.style.opacity = saveOn ? '' : '0.45';
      ehRow.style.pointerEvents = saveOn ? '' : 'none';
    }
    // Restore original desc
    const desc = ehRow?.querySelector('.settings-label-desc');
    if (desc) {
      desc.textContent = saveOn
        ? 'When ON, saved conversations are encrypted with your master password so no one else can read them.'
        : 'Enable Save Chat History above to use encryption.';
    }
  }

  // 4. Patch the diagnostics panel's read-only CONNECTIVITY label
  const toggleLabel = document.getElementById('diag-online-toggle-label');
  if (toggleLabel) {
    toggleLabel.innerHTML = _onlineMode
      ? '<span style="color:#788a4c">ONLINE — content sync enabled</span>'
      : '<span style="color:var(--amber-dim)">NETWORK LOCKED — local catalog only</span>';
  }
  const workerRow = document.getElementById('diag-worker-row');
  if (workerRow) {
    workerRow.style.opacity = _onlineMode ? '' : '0.4';
  }
}

// Expose online mode to library.js
function isOnlineModeEnabled() { return _onlineMode; }

/**
 * Update the Conversations panel UI based on save mode.
 * SAVE HISTORY ON: +NEW button visible, normal empty message.
 * SAVE HISTORY OFF: +NEW hidden (nothing to save).
 */
function _updateConvPanelMode() {
  const stored = localStorage.getItem('bd-setting-autosave');
  const autoSaveOn = stored === null ? true : stored === 'true';

  // +NEW CONVERSATION button is ALWAYS visible — it resets the session,
  // which is useful even when auto-save is off.

  // Update empty state message only when no saved conversations exist
  const emptyMsg = document.getElementById('convEmptyMsg');
  if (emptyMsg) {
    const convList = document.getElementById('convList');
    const hasItems = convList && convList.querySelector('.conv-item');
    if (!hasItems) {
      emptyMsg.textContent = autoSaveOn
        ? 'No saved conversations yet.'
        : 'Save Chat History is OFF — conversations will not be saved.';
      emptyMsg.style.display = '';
    }
  }
}

// ── Event Listeners ───────────────────────────────────────
userInput.addEventListener('input', () => {
  // Stop TTS when user starts typing
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (_ttsCurrentBtn) { _resetTTSBtn(_ttsCurrentBtn); _ttsCurrentBtn = null; }
  }
  updateCharCount();
  autoResize();
  const hasText = !!userInput.value.trim();
  sendBtn.disabled = !hasText || !isConnected || isGenerating;
  sendBtn.title = !isConnected
    ? 'Start the launcher to connect BEACON'
    : (!hasText ? 'Type a message first' : 'Send message (Enter)');
});

userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
// clearBtn removed — Clear is now in Settings panel + NEW CONVERSATION in History

// ── Global Keyboard Shortcuts ─────────────────────────────
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;  // Cmd on Mac, Ctrl on Win/Linux
  const tag = (e.target.tagName || '').toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

  // Escape — always works, closes the topmost open panel
  if (e.key === 'Escape') {
    const libPanel = document.getElementById('libraryPanel');
    if (libPanel && libPanel.style.display !== 'none') {
      if (typeof closeLibrary === 'function') closeLibrary();
    } else {
      closeAllPanels();
    }
    userInput.focus();
    return;
  }

  // Don't intercept shortcuts when user is typing in a field
  if (isInput && !mod) return;

  if (mod && e.key === 'k') {
    e.preventDefault();
    clearConversation();
    return;
  }
  if (mod && e.key === 'l') {
    e.preventDefault();
    const libPanel = document.getElementById('libraryPanel');
    if (libPanel && libPanel.style.display !== 'none') {
      if (typeof closeLibrary === 'function') closeLibrary();
    } else {
      if (typeof openLibrary === 'function') openLibrary();
    }
    return;
  }
  if (mod && e.key === 'p') {
    e.preventDefault();
    if (typeof togglePromptPanel === 'function') togglePromptPanel();
    return;
  }
  if (mod && e.key === '/') {
    e.preventDefault();
    if (typeof toggleHelpPanel === 'function') toggleHelpPanel();
    return;
  }
});

// ── First-Run Onboarding ──────────────────────────────────
function _checkFirstRun() {
  try {
    if (localStorage.getItem('bd_onboarded')) return;
    const overlay = document.getElementById('firstRunOverlay');
    if (overlay) overlay.style.display = 'flex';
  } catch {}
}

function dismissFirstRun() {
  const overlay = document.getElementById('firstRunOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.style.display = 'none', 300);
  }
  try {
    localStorage.setItem('bd_onboarded', '1');
    localStorage.setItem('bd_eula_accepted', '1');
  } catch {}

  // Only require password creation on first-run if Blackout Protocol is ON.
  // BP is ON by default, so most users will be prompted. Users who immediately
  // disable BP are not forced to create a password they won't use — they'll be
  // prompted naturally if/when they later enable encryption or BP.
  if (_blackoutProtocolOn) {
    _ensureMasterPassword();
  }
}

/**
 * Ensure a master password exists. Called after first-run dismiss AND
 * on every boot (safety check). If BP is ON and no password exists,
 * shows the mandatory creation modal that cannot be dismissed.
 */
async function _ensureMasterPassword() {
  // Retry up to 3 times — server may still be starting during first boot
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const isSet = await _isMasterPasswordSet();
      if (!isSet && typeof _showMandatoryPasswordCreation === 'function') {
        await _showMandatoryPasswordCreation();
      }
      return; // Success — exit
    } catch {
      // Server not ready — wait and retry
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  // All retries failed — log for debugging but don't block the UI forever
  console.warn('[SECURITY] Could not verify master password status after 3 attempts');
}


// ── Initialize ────────────────────────────────────────────
(async function init() {
  sendBtn.disabled = true;
  sendIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
   document.body.classList.add('welcome-visible'); // Set initial scroll state

  // Initialize Settings panel
  _initSettings();



  // Show first-run welcome overlay if user hasn't been onboarded
  _checkFirstRun();

  // ── Inject SVG icons into DOM placeholders ──────────────────
  _initIcons();

  // Restore library/view state — library.js must be loaded first
  if (typeof _restoreLibState === 'function') {
    try {
      _restoreLibState();
    } catch(e) {}
  }

  // Restore workspace state if it was open (workspace.js must be loaded first)
  if (typeof _restoreWsState === 'function') {
    try {
      _restoreWsState();
    } catch(e) {}
  }

  // Restore chat messages from sessionStorage (single call only)
  _restoreChatState();

  // ── REVEAL BODY: all state is now restored ──────────────────────
  // Body started at opacity:0 (anti-flicker). Reveal now that library,
  // workspace, and chat state are all hydrated — no flash of empty chat.
  const isPanelRestore = document.documentElement.hasAttribute('data-restore');
  if (!isPanelRestore) {
    // No library/workspace restore — safe to reveal chat and body now
    document.documentElement.removeAttribute('data-restore-chat');
    document.body.style.opacity = '1';
  }
  // If library or workspace IS being restored, their restore functions
  // handle revealing body and removing data-restore + data-restore-chat.

  // Initialize voice input (shows mic button if browser supports it)
  initVoiceInput();

  // Restore persisted TTS settings
  _restoreTTSSettings();

  // ── SMART CONNECTION STARTUP ──────────────────────────────
  // Fast-path: check if Ollama is ALREADY running and model is loaded.
  // If it responds within 600ms, we know it's up — skip the overlay entirely.
  // This eliminates the "flicker overlay" when Ollama is already running.
  const fastCheck = await Promise.race([
    checkConnection(),
    sleep(600).then(() => 'timeout')
  ]);

  if (fastCheck === 'online') {
    // Ollama was already running with model loaded — go straight to READY
    isConnected = true;
    setStatus('online');
  } else if (fastCheck === 'warming_up') {
    // Ollama is up but model not loaded yet — show warmup state (no overlay)
    setStatus('warming_up');
  }
  // Init Blackout Protocol & badge (reads from localStorage)
  _initBlackoutProtocol();

  // Safety check: if user is already onboarded but has no master password
  // (e.g., after a destructive reset and reboot), force password creation.
  // Skipped if first-run overlay is showing (it handles password creation itself).
  if (localStorage.getItem('bd_onboarded') === '1') {
    _ensureMasterPassword();
  }

  // ── HEARTBEAT ───────────────────────────────────────────────
  // Ping the server every 30 seconds so it knows the browser is still open.
  // If the browser is closed and heartbeats stop, the server auto-shuts down
  // after 45 seconds (kills Ollama and exits cleanly).
  setInterval(() => {
    fetch('/api/heartbeat').catch(() => {});
  }, 30000);
  // Send first heartbeat immediately
  fetch('/api/heartbeat').catch(() => {});

  // Whether or not fast-check passed, start the monitor loop
  // (handles disconnects mid-session and reconnects when launcher starts)
  // Show overlay only if Ollama isn't running at all (error/timeout)
  const showOverlay = (fastCheck !== 'online' && fastCheck !== 'warming_up');
  maintainConnection(showOverlay);
})();
