/**
 * The Blackout Drive — Chat Application Logic
 * Connects to local Ollama instance, streams responses
 * Zero external dependencies — pure vanilla JS
 */

'use strict';

// ── Configuration (sourced from config.js) ────────────────
const CONFIG = window.BLACKOUT_CONFIG || {
  appName:        'The Blackout Drive',
  version:        '1.0.0',
  model:          'blackout-beacon',
  ollamaPort:     11434,
  ollamaHost:     'http://localhost:11434',
  uiPort:         8080,
  streamTimeout:  120000,
  retryInterval:  2000,
  maxRetries:     30,
};

// ── State ─────────────────────────────────────────────────
let isConnected   = false;
let isGenerating  = false;
let messages      = [];
let currentReader  = null;
let libContextStr  = '';

// P1-1: Max messages sent to Ollama (sliding window to prevent context overflow).
// Full history stays in the DOM for scroll-back — only the API payload is trimmed.
const MAX_CONTEXT_MESSAGES = 20;

// P1-7: Chat persistence key
const CHAT_SS_KEY = 'dd_chat';

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
const clearBtn       = $('clearBtn');
const charCount      = $('charCount');

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
    <div class="connecting-skull">📡</div>
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
    const res = await fetch(`${CONFIG.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.models)) return false;
    const modelName = (CONFIG.model || 'blackout-beacon').split(':')[0];
    return data.models.some(m => (m.name || '').split(':')[0] === modelName);
  } catch {
    return false;
  }
}

async function checkOllamaAlive() {
  try {
    const res = await fetch(`${CONFIG.ollamaHost}/`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

function setStatus(state) {
  if (!statusDot || !statusText) return;
  statusDot.className  = 'status-dot ' + state;
  statusText.className = 'status-text ' + state;

  const welcomeTitle = document.querySelector('.welcome-title');

  if (state === 'online') {
    statusText.textContent = 'BEACON READY';
    sendBtn.disabled = !userInput.value.trim();
    document.body.classList.remove('beacon-offline');
    if (welcomeTitle) { welcomeTitle.textContent = 'BEACON IS READY'; welcomeTitle.style.color = ''; }
    hideConnectingOverlay();
    hideWarning();

  } else if (state === 'error') {
    statusText.textContent = 'BEACON OFFLINE';
    sendBtn.disabled = true;
    document.body.classList.add('beacon-offline');
    hideConnectingOverlay(); // ALWAYS dismiss on error — never leave user blocked
    if (welcomeTitle) { welcomeTitle.textContent = 'BEACON IS OFFLINE'; welcomeTitle.style.color = 'var(--red, #cc3333)'; }
    showWarning('BEACON is offline. Open the drive folder and run the START launcher for your system.');

  } else {
    // 'starting' / '' — overlay is showing
    statusText.textContent = 'STARTING...';
    sendBtn.disabled = true;
    if (welcomeTitle) { welcomeTitle.textContent = 'STARTING BEACON...'; welcomeTitle.style.color = 'var(--amber-dim, #8c7030)'; }
  }
}

function showWarning(text) {
  if (!warningBanner || !warningText) return;
  warningText.textContent = text;
  warningBanner.style.display = 'flex';
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

  // Poll interval for connection checks
  const POLL_INTERVAL = 2000;

  while (true) {
    const modelReady = await checkConnection();

    if (modelReady && !isConnected) {
      // Just came online
      isConnected = true;
      setStatus('online');
      // Load library context for RAG
      fetch(`http://localhost:${CONFIG.uiPort}/api/library-context`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.context) libContextStr = d.context; })
        .catch(() => {});

    } else if (!modelReady && isConnected) {
      // Lost connection mid-session
      isConnected = false;
      setStatus('error');

    }
    // If not ready and not connected: the overlay timeout handles dismissal.
    // We keep polling silently in the background so if Ollama starts later,
    // the UI automatically goes to BEACON READY without requiring a reload.

    await sleep(POLL_INTERVAL);
  }
}

// ── Message Rendering ─────────────────────────────────────
function renderMessage(role, content, streaming = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatar  = role === 'user' ? '👤' : '📡';
  const label   = role === 'user' ? 'YOU' : (window.BLACKOUT_CONFIG?.aiName || 'BEACON');

  // TTS button for BEACON messages (only when speechSynthesis is available)
  const ttsBtn = (role === 'assistant' && window.speechSynthesis)
    ? `<button class="tts-btn" title="Read aloud" onclick="toggleTTS(this)">🔊 <span class="tts-label">LISTEN</span></button>`
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

// ── Text-to-Speech (Web Speech API) ──────────────────────
let _ttsCurrentBtn = null;

function toggleTTS(btn) {
  const msgEl = btn.closest('.message');
  const body = msgEl.querySelector('.message-body');
  if (!body) return;

  // Get plain text from rendered HTML
  const text = body.innerText || body.textContent || '';
  if (!text.trim()) return;

  // If already speaking this message, stop it
  if (_ttsCurrentBtn === btn && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    _resetTTSBtn(btn);
    _ttsCurrentBtn = null;
    return;
  }

  // Stop any current speech
  window.speechSynthesis.cancel();
  if (_ttsCurrentBtn) _resetTTSBtn(_ttsCurrentBtn);

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  utter.pitch = 0.9;
  utter.volume = 1;

  // Prefer a natural voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Alex'))
    || voices.find(v => v.lang.startsWith('en') && !v.name.includes('Google'))
    || voices[0];
  if (preferred) utter.voice = preferred;

  utter.onstart = () => {
    _ttsCurrentBtn = btn;
    btn.innerHTML = '⏸ <span class="tts-label">STOP</span>';
    btn.classList.add('tts-active');
  };
  utter.onend = utter.onerror = () => {
    _resetTTSBtn(btn);
    if (_ttsCurrentBtn === btn) _ttsCurrentBtn = null;
  };

  window.speechSynthesis.speak(utter);
}

function _resetTTSBtn(btn) {
  if (btn) { btn.innerHTML = '🔊 <span class="tts-label">LISTEN</span>'; btn.classList.remove('tts-active'); }
}

function updateMessageContent(msgEl, content) {
  const body = msgEl.querySelector('.message-body');
  if (body) { body.innerHTML = renderMarkdown(content); }
  scrollToBottom();
}

// Minimal markdown renderer (no external deps)
function renderMarkdown(text) {
  if (!text) return '';

  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  safe = safe.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.trimEnd()}</code></pre>`);

  // Inline code
  safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  safe = safe.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  safe = safe.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  safe = safe.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / Italic
  safe = safe.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  safe = safe.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g,         '<em>$1</em>');

  // Horizontal rule
  safe = safe.replace(/^---+$/gm, '<hr>');

  // Process line by line — group list items into <ul>/<ol>
  const lines = safe.split('\n');
  const out = [];
  let inUl = false, inOl = false;

  for (const line of lines) {
    const ulMatch = line.match(/^[-*] (.+)$/);
    const olMatch = line.match(/^\d+\. (.+)$/);

    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      out.push(line === '' ? '\x00break\x00' : line);
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  let html = out.join('\n');
  html = html.replace(/(\x00break\x00\n?)+/g, '\x00break\x00');

  const segments = html.split('\x00break\x00');
  html = segments.map(seg => {
    seg = seg.trim();
    if (!seg) return '';
    if (/^<(ul|ol|pre|h[1-6]|hr)/.test(seg)) return seg;
    return `<p>${seg.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  return html || `<p>${safe}</p>`;
}

// ── Chat Logic ────────────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !isConnected || isGenerating) return;

  // P0-3 FIX: Set flag IMMEDIATELY (synchronously) before any async work.
  // This closes the race window where rapid clicks could slip through.
  isGenerating = true;
  sendBtn.disabled = true;

  welcomeScreen.style.display = 'none';
  messages.push({ role: 'user', content: text });
  renderMessage('user', text);
  _saveChatState(); // P1-7

  userInput.value = '';
  userInput.style.height = 'auto';
  updateCharCount();
  sendBtn.classList.add('loading');
  sendIcon.textContent = '⏹';
  const sendLabel = $('sendLabel');
  if (sendLabel) sendLabel.textContent = 'STOP';
  sendBtn.title = 'Stop generation';
  sendBtn.onclick = cancelGeneration;

  const assistantMsgEl = renderMessage('assistant', '', true);
  let fullContent = '';

  try {
    // RAG Tier 2: keyword search of local library files
    let searchContext = '';
    try {
      const searchRes = await fetch(`http://localhost:${CONFIG.uiPort}/api/search?q=${encodeURIComponent(text)}&limit=4`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          const excerpts = searchData.results.map(r => `[SOURCE: ${r.file}]\n${r.excerpt}`).join('\n\n');
          searchContext = `Relevant passages from the local library:\n\n${excerpts}\n\n---\n`;
        }
      }
    } catch (_) {}

    const messagesWithContext = [];
    if (libContextStr) messagesWithContext.push({ role: 'system', content: libContextStr });
    // P1-1: Sliding window — send only the last N messages to Ollama
    const historySlice = messages.slice(-MAX_CONTEXT_MESSAGES, -1);
    messagesWithContext.push(...historySlice);
    messagesWithContext.push({ role: 'user', content: searchContext ? searchContext + text : text });

    const response = await fetch(`${CONFIG.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model, messages: messagesWithContext, stream: true }),
      signal: AbortSignal.timeout(CONFIG.streamTimeout),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullContent += data.message.content;
            updateMessageContent(assistantMsgEl, fullContent);
          }
          if (data.done) break;
        } catch { /* partial JSON */ }
      }
    }

    if (fullContent) {
      messages.push({ role: 'assistant', content: fullContent });
      _saveChatState(); // P1-7
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
      const friendlyMsg = isOffline
        ? `**BEACON is offline.**\n\nThe AI engine is not responding. Open the drive folder and run the START launcher for your system (START_MAC.command on Mac, START_WINDOWS.bat on Windows). Keep the launcher window open while using the drive.`
        : `**Could not get a response.** (${err.message})\n\nTry again, or restart the launcher if the problem persists.`;
      updateMessageContent(assistantMsgEl, friendlyMsg);
      if (isOffline) { isConnected = false; setStatus('error'); }
      else showWarning('Response error — try again or restart the launcher.');
    }
  } finally {
    isGenerating  = false;
    currentReader = null;
    sendBtn.classList.remove('loading');
    sendIcon.textContent = '⬭';
    if (sendLabel) sendLabel.textContent = 'SEND';
    sendBtn.title = isConnected ? 'Send message (Enter)' : 'Start the launcher to connect BEACON';
    sendBtn.onclick = sendMessage;
    if (isConnected && userInput.value.trim()) sendBtn.disabled = false;
    else sendBtn.disabled = true;
    userInput.focus();
  }
}

function cancelGeneration() {
  if (currentReader) currentReader.cancel();
}

// ── Prompt Cards ──────────────────────────────────────────
function usePrompt(card) {
  if (isGenerating) return;
  if (!isConnected) {
    showOfflineToast();
    return;
  }
  const text = card.querySelector('p').textContent;
  userInput.value = text;
  updateCharCount();
  sendMessage();
}

function showOfflineToast() {
  const existing = $('offlineToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'offlineToast';
  t.style.cssText = [
    'position:fixed','bottom:100px','left:50%','transform:translateX(-50%)',
    'background:rgba(18,22,16,0.97)','border:1px solid rgba(200,160,74,0.5)',
    'color:var(--amber)','padding:14px 24px','border-radius:6px',
    'font-family:var(--font-mono,monospace)','font-size:12px',
    'letter-spacing:1.5px','z-index:9999','pointer-events:none',
    'max-width:460px','text-align:center','backdrop-filter:blur(12px)',
    'box-shadow:0 4px 32px rgba(0,0,0,0.6)'
  ].join(';');
  t.innerHTML = '📡 BEACON IS OFFLINE<br><span style="font-size:10px;opacity:0.7;letter-spacing:1px">Open the drive folder and run the START launcher</span>';
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

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('mic-active');
    micBtn.title = 'Listening... (click to stop)';
    userInput.placeholder = '🎤 Listening...';
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
      showToast('🎤 Microphone access denied. Allow microphone in browser settings.', 4000);
    } else if (event.error === 'no-speech') {
      showToast('🎤 No speech detected. Try again.', 2500);
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
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
    'background:rgba(18,22,16,0.95)','border:1px solid rgba(200,160,74,0.4)',
    'color:var(--amber)','padding:10px 20px','border-radius:8px',
    'font-size:13px','letter-spacing:1px','z-index:9999','pointer-events:none',
    'max-width:480px','text-align:center','backdrop-filter:blur(8px)',
    'box-shadow:0 4px 24px rgba(0,0,0,0.5)'
  ].join(';');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── UI Utilities ──────────────────────────────────────────
function scrollToBottom() {
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
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
  if (!confirm('Clear the conversation? This cannot be undone.')) return;
  messages = [];
  messagesEl.innerHTML = '';
  welcomeScreen.style.display = 'flex';
  try { sessionStorage.removeItem(CHAT_SS_KEY); } catch {} // P1-7
}

// P1-7: Persist chat messages to sessionStorage (max 50 messages to limit size)
function _saveChatState() {
  try {
    const toSave = messages.slice(-50);
    sessionStorage.setItem(CHAT_SS_KEY, JSON.stringify(toSave));
  } catch {}
}

function _restoreChatState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CHAT_SS_KEY) || 'null');
    if (!saved || !Array.isArray(saved) || !saved.length) return;
    messages = saved;
    welcomeScreen.style.display = 'none';
    for (const msg of messages) {
      renderMessage(msg.role, msg.content);
    }
  } catch {}
}

// ── Event Listeners ───────────────────────────────────────
userInput.addEventListener('input', () => {
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
clearBtn.addEventListener('click', clearConversation);

// ── Initialize ────────────────────────────────────────────
(async function init() {
  sendBtn.disabled = true;
  sendIcon.textContent = '⬭';

  // P1-7: Restore chat messages from sessionStorage
  _restoreChatState();

  // Restore library/view state — library.js must be loaded first
  if (typeof _restoreLibState === 'function') {
    try {
      _restoreLibState();
      // If library was NOT open, reveal body immediately
      const wasLib = sessionStorage.getItem('dd_lib');
      const parsed = wasLib ? JSON.parse(wasLib) : null;
      if (!parsed || !parsed.open) {
        requestAnimationFrame(() => { document.body.style.opacity = '1'; });
      }
    } catch(e) {
      requestAnimationFrame(() => { document.body.style.opacity = '1'; });
    }
  } else {
    requestAnimationFrame(() => { document.body.style.opacity = '1'; });
  }

  // Initialize voice input (shows mic button if browser supports it)
  initVoiceInput();

  // ── SMART CONNECTION STARTUP ──────────────────────────────
  // Fast-path: check if Ollama is ALREADY running.
  // If it responds within 600ms, we know it's up — skip the overlay entirely.
  // This eliminates the "flicker overlay" when Ollama is already running.
  const fastCheck = await Promise.race([
    checkConnection(),
    sleep(600).then(() => false)
  ]);

  if (fastCheck) {
    // Ollama was already running — go straight to READY, no overlay
    isConnected = true;
    setStatus('online');
    // Load library context for RAG in background
    fetch(`http://localhost:${CONFIG.uiPort}/api/library-context`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.context) libContextStr = d.context; })
      .catch(() => {});
  }
  // Whether or not fast-check passed, start the monitor loop
  // (handles disconnects mid-session and reconnects when launcher starts)
  maintainConnection(!fastCheck); // pass skipOverlay=true if already connected
})();
