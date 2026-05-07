/**
 * DOOMSDAY DRIVE — Chat Application Logic
 * Connects to local Ollama instance, streams responses
 * Zero external dependencies — pure vanilla JS
 */

'use strict';

// ── Configuration (sourced from config.js) ────────────────
// All values live in drive/ui/config.js — do not hardcode here.
// Fallbacks are safety nets only; config.js should always load.
const CONFIG = window.DOOMSDAY_CONFIG || {
  appName:        'DOOMSDAY.AI',
  version:        '1.0.0',
  model:          'doomsday-ai',
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
    <div class="connecting-skull">☠</div>
    <div class="connecting-title">STARTING DOOMSDAY.AI ENGINE</div>
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
async function checkConnection() {
  try {
    // Use root endpoint — more universally accessible than /api/tags
    // which can be blocked by API middleware or Ollama proxy configurations
    const res = await fetch(`${CONFIG.ollamaHost}/`, {
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function setStatus(state) {
  statusDot.className  = 'status-dot ' + state;
  statusText.className = 'status-text ' + state;

  if (state === 'online') {
    statusText.textContent = 'AI READY';
    sendBtn.disabled = false;
    hideConnectingOverlay();
  } else if (state === 'error') {
    statusText.textContent = 'AI OFFLINE';
    sendBtn.disabled = true;
    showWarning('The AI engine stopped responding. Try closing and relaunching the drive.');
  } else {
    statusText.textContent = 'STARTING...';
    sendBtn.disabled = true;
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
    const connected = await checkConnection();

    if (connected && !isConnected) {
      isConnected = true;
      retries = 0;
      setStatus('online');
      hideWarning();
      // RAG Tier 1: fetch library manifest context for LLM injection
      fetch(`http://localhost:${CONFIG.uiPort}/api/library-context`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.context) libContextStr = d.context; })
        .catch(() => {});
    } else if (!connected && isConnected) {
      isConnected = false;
      setStatus('error');
    } else if (!connected && !isConnected) {
      retries++;
      if (retries > CONFIG.maxRetries) {
        setStatus('error');
      }
    }

    await sleep(CONFIG.retryInterval);
  }
}

// ── Message Rendering ─────────────────────────────────────
function renderMessage(role, content, streaming = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatar  = role === 'user' ? '👤' : '☠';
  const label   = role === 'user' ? 'YOU' : 'DOOMSDAY.AI';

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
  sendBtn.title = 'Stop generation';
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
      const errMsg = `**System Error**\n\nFailed to get response: ${err.message}\n\nEnsure the launcher is still running.`;
      updateMessageContent(assistantMsgEl, errMsg);
      showWarning('Response error. Is the launcher still running?');
    }
  } finally {
    // Reset state
    isGenerating  = false;
    currentReader = null;
    sendBtn.classList.remove('loading');
    sendIcon.textContent = '⬭';
    sendBtn.title = 'Send message';
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
  if (!isConnected || isGenerating) return; // guard: AI must be ready
  const text = card.querySelector('p').textContent;
  userInput.value = text;
  updateCharCount();
  sendMessage(); // fire immediately — no intermediate textarea step
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
(async function init() {
  sendBtn.disabled = true;
  sendIcon.textContent = '⬭';
  maintainConnection(); // runs forever in background
})();
