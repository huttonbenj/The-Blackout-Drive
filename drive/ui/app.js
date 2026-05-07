/**
 * The Blackout Drive — Chat Application Logic
 * Connects to local Ollama instance, streams responses
 * Zero external dependencies — pure vanilla JS
 */

'use strict';

// ── Configuration (sourced from config.js) ────────────────
// All values live in drive/ui/config.js — do not hardcode here.
// Fallbacks are safety nets only; config.js should always load.
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
let messages      = [];   // { role, content }
let currentReader  = null; // Active stream reader for cancellation
let libContextStr  = '';   // RAG: library manifest injected into LLM system prompt

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
function showConnectingOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'connectingOverlay';
  overlay.className = 'connecting-overlay';
  overlay.innerHTML = `
    <div class="connecting-skull">📡</div>
    <div class="connecting-title">STARTING BEACON</div>
    <div class="connecting-sub">Loading your offline AI. This takes 10–30 seconds...</div>
    <div class="connecting-bar"><div class="connecting-progress"></div></div>
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
}

function hideConnectingOverlay() {
  const overlay = $('connectingOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.4s ease';
    setTimeout(() => overlay.remove(), 400);
  }
}

// ── Connection Management ─────────────────────────────────
/**
 * Check if Ollama is running AND the BEACON model is available.
 * We check /api/tags (model list) not just root /, because:
 * - root / returns 200 even if the model isn't loaded
 * - /api/chat returns 404 if model isn't registered
 * We verify the specific model exists in the tags list.
 */
async function checkConnection() {
  try {
    const res = await fetch(`${CONFIG.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return false;
    // Verify the BEACON model is registered
    const data = await res.json().catch(() => null);
    if (!data || !data.models) return false;
    const modelName = CONFIG.model || 'blackout-beacon';
    // Match either exact name or name without tag (e.g. "blackout-beacon:latest")
    return data.models.some(m =>
      m.name === modelName ||
      m.name.startsWith(modelName + ':') ||
      m.name.startsWith(modelName.split(':')[0] + ':')
    );
  } catch {
    return false;
  }
}

/**
 * Check if Ollama itself is running (even without the model).
 * Used to give more specific offline state messages.
 */
async function checkOllamaAlive() {
  try {
    const res = await fetch(`${CONFIG.ollamaHost}/`, {
      signal: AbortSignal.timeout(2000)
    });
    return res.ok || res.status === 400; // 400 = alive but bad request
  } catch {
    return false;
  }
}

function setStatus(state) {
  statusDot.className  = 'status-dot ' + state;
  statusText.className = 'status-text ' + state;

  if (state === 'online') {
    statusText.textContent = 'BEACON READY';
    sendBtn.disabled = userInput && !userInput.value.trim() ? true : false;
    document.body.classList.remove('beacon-offline');
    // Restore welcome title
    const welcomeTitle = document.querySelector('.welcome-title');
    if (welcomeTitle) {
      welcomeTitle.textContent = 'BEACON IS READY';
      welcomeTitle.style.color = '';
    }
    hideConnectingOverlay();
  } else if (state === 'error') {
    statusText.textContent = 'BEACON OFFLINE';
    sendBtn.disabled = true;
    document.body.classList.add('beacon-offline');
    // CRITICAL: hide the overlay so the user can still use the library
    hideConnectingOverlay();
    // Update welcome title to reflect offline state
    const welcomeTitle = document.querySelector('.welcome-title');
    if (welcomeTitle) {
      welcomeTitle.textContent = 'BEACON IS OFFLINE';
      welcomeTitle.style.color = 'var(--red, #cc3333)';
    }
    showWarning('BEACON is offline. Open the drive folder and double-click the START launcher for your system.');
  } else {
    // STARTING state — overlay is shown by showConnectingOverlay() in maintainConnection()
    statusText.textContent = 'STARTING...';
    sendBtn.disabled = true;
    // Don't add beacon-offline yet — still trying to connect
    const welcomeTitle = document.querySelector('.welcome-title');
    if (welcomeTitle) {
      welcomeTitle.textContent = 'STARTING BEACON...';
      welcomeTitle.style.color = 'var(--amber-dim, #8c7030)';
    }
  }
}

function showWarning(text) {
  warningText.textContent = text;
  warningBanner.style.display = 'flex';
}

function hideWarning() {
  warningBanner.style.display = 'none';
}

async function maintainConnection() {
  let retries = 0;
  showConnectingOverlay();
  setStatus('');

  while (true) {
    const modelReady = await checkConnection();

    if (modelReady && !isConnected) {
      isConnected = true;
      retries = 0;
      setStatus('online');
      hideWarning();
      // RAG Tier 1: fetch library manifest context for LLM injection
      fetch(`http://localhost:${CONFIG.uiPort}/api/library-context`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.context) libContextStr = d.context; })
        .catch(() => {});
    } else if (!modelReady && isConnected) {
      isConnected = false;
      setStatus('error');
    } else if (!modelReady && !isConnected) {
      retries++;
      if (retries > CONFIG.maxRetries) {
        // Distinguish: Ollama running but model missing vs Ollama not running
        const ollamaAlive = await checkOllamaAlive();
        if (ollamaAlive) {
          setStatus('error'); // this now calls hideConnectingOverlay()
          showWarning('BEACON model not found. Run scripts/download_models.sh to install the AI model, then restart the launcher.');
        } else {
          setStatus('error'); // this now calls hideConnectingOverlay()
        }
      }
    }

    await sleep(CONFIG.retryInterval);
  }
}

// ── Message Rendering ─────────────────────────────────────
function renderMessage(role, content, streaming = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatar  = role === 'user' ? '👤' : '📡';
  const label   = role === 'user' ? 'YOU' : (window.BLACKOUT_CONFIG?.aiName || 'BEACON');

  msgEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-label">${label}</div>
      <div class="message-body">${
        streaming
          ? '<span class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>'
          : renderMarkdown(content)
      }</div>
    </div>
  `;

  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

function updateMessageContent(msgEl, content) {
  const body = msgEl.querySelector('.message-body');
  body.innerHTML = renderMarkdown(content);
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

  // Process line by line — group consecutive list items into <ul>/<ol>
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

  // Hide welcome, add user message
  welcomeScreen.style.display = 'none';
  messages.push({ role: 'user', content: text });
  renderMessage('user', text);

  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';
  updateCharCount();

  // Set generating state
  isGenerating = true;
  sendBtn.disabled = true;
  sendBtn.classList.add('loading');
  sendIcon.textContent = '⏹';
  const sendLabel = document.getElementById('sendLabel');
  if (sendLabel) sendLabel.textContent = 'STOP';
  sendBtn.title = 'Stop generation (click to cancel)';
  sendBtn.onclick = cancelGeneration;

  // Add assistant message placeholder
  const assistantMsgEl = renderMessage('assistant', '', true);
  let fullContent = '';

  try {
    // ─ RAG Tier 2: Search library for relevant passages ───────────
    let searchContext = '';
    try {
      const searchRes = await fetch(`http://localhost:${CONFIG.uiPort}/api/search?q=${encodeURIComponent(text)}&limit=4`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          const excerpts = searchData.results.map(r =>
            `[SOURCE: ${r.file}]\n${r.excerpt}`
          ).join('\n\n');
          searchContext = `Relevant passages from the local library:\n\n${excerpts}\n\n---\n`;
        }
      }
    } catch (_) { /* search is best-effort, never block the chat */ }

    // ─ Build messages array with context injections ────────────
    const messagesWithContext = [];

    // Tier 1: Library manifest context (injected once as first system message)
    if (libContextStr) {
      messagesWithContext.push({ role: 'system', content: libContextStr });
    }

    // Conversation history
    messagesWithContext.push(...messages.slice(0, -1)); // all but last user msg

    // Tier 2: Prepend search results to the user's last message if found
    const lastUserContent = searchContext ? searchContext + text : text;
    messagesWithContext.push({ role: 'user', content: lastUserContent });

    const response = await fetch(`${CONFIG.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    CONFIG.model,
        messages: messagesWithContext,
        stream:   true,
      }),
      signal: AbortSignal.timeout(CONFIG.streamTimeout),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullContent += data.message.content;
            updateMessageContent(assistantMsgEl, fullContent);
          }
          if (data.done) break;
        } catch {
          // Partial JSON — skip
        }
      }
    }

    // Save to conversation history
    if (fullContent) {
      messages.push({ role: 'assistant', content: fullContent });
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled — already handled
      if (fullContent) {
        messages.push({ role: 'assistant', content: fullContent + '\n\n*[Generation stopped]*' });
        updateMessageContent(assistantMsgEl, fullContent + '\n\n*[Generation stopped]*');
      } else {
        assistantMsgEl.remove();
      }
    } else {
      let friendlyMsg;
      if (err.message.includes('404') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed')) {
        friendlyMsg = `**BEACON is offline.**\n\nThe AI engine is not responding. To start BEACON, open the drive folder and double-click the START launcher for your system (START_MAC.command on Mac, START_WINDOWS.bat on Windows). Keep the launcher window open while using the drive.`;
        showWarning('BEACON offline — start the launcher to connect the AI.');
        isConnected = false;
        setStatus('error');
      } else {
        friendlyMsg = `**Could not get a response.** (${err.message})\n\nTry again, or restart the launcher if the problem persists.`;
        showWarning('Response error — try again or restart the launcher.');
      }
      updateMessageContent(assistantMsgEl, friendlyMsg);
    }
  } finally {
    // Reset state
    isGenerating  = false;
    currentReader = null;
    sendBtn.classList.remove('loading');
    sendIcon.textContent = '⬭';
    const _sendLabel = document.getElementById('sendLabel');
    if (_sendLabel) _sendLabel.textContent = 'SEND';
    sendBtn.title = 'Send message (Enter)';
    sendBtn.onclick = sendMessage;
    if (isConnected) sendBtn.disabled = false;
    userInput.focus();
  }
}

function cancelGeneration() {
  if (currentReader) {
    currentReader.cancel();
  }
}

// ── Prompt Cards ──────────────────────────────────────────
function usePrompt(card) {
  if (isGenerating) return;
  if (!isConnected) {
    // Don't fire into the void — show a clear toast instead
    showOfflineToast();
    return;
  }
  const text = card.querySelector('p').textContent;
  userInput.value = text;
  updateCharCount();
  sendMessage();
}

function showOfflineToast() {
  // Remove any existing toast first
  const existing = document.getElementById('offlineToast');
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
  t.innerHTML = '📡 BEACON IS OFFLINE<br><span style="font-size:10px;opacity:0.7;letter-spacing:1px">Start the launcher to connect the AI</span>';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── UI Utilities ──────────────────────────────────────────
function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
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
}

// ── Event Listeners ───────────────────────────────────────
userInput.addEventListener('input', () => {
  updateCharCount();
  autoResize();
  sendBtn.disabled = !userInput.value.trim() || !isConnected || isGenerating;
  sendBtn.title = !isConnected
    ? 'Start the launcher to connect BEACON'
    : (!userInput.value.trim() ? 'Type a message first' : 'Send message (Enter)');
});

userInput.addEventListener('keydown', e => {
  // Enter sends, Shift+Enter adds newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
clearBtn.addEventListener('click', clearConversation);

// ── Initialize ────────────────────────────────────────────
// Anti-flicker strategy:
// 1. index.html sets body { opacity:0; transition: opacity 0.15s ease }
// 2. We synchronously restore session state before ANY frame is painted
// 3. Then fade the body in — user sees the correct page with no chat flash
(async function init() {
  sendBtn.disabled = true;
  sendIcon.textContent = '⬭';

  // Anti-flicker layer 3:
  // _restoreLibState() is defined in library.js (loaded before app.js).
  // It reads sessionStorage synchronously, sets up library panel if needed,
  // then calls openLibrary() async to load content.
  // It handles its own body.opacity reveal after content loads.
  // If library was NOT open, it reveals body immediately.
  if (typeof _restoreLibState === 'function') {
    try {
      _restoreLibState();
      // If library WAS open, _restoreLibState handles opacity reveal after load.
      // If NOT open (chat page), we reveal here after a frame for smooth paint.
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

  maintainConnection(); // runs forever in background
})();
