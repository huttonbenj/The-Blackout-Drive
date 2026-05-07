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
  appName:        'DOOMSDAY',
  version:        '1.0.0',
  model:          'doomsday',
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
    <div class="connecting-title">STARTING AI ENGINE</div>
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
  const label   = role === 'user' ? 'YOU' : 'DOOMSDAY';

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

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (must come before inline code)
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,         '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');

  // Single newlines
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph if not already structured
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  return html;
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
    const response = await fetch(`${CONFIG.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    CONFIG.model,
        messages: messages,
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
  const text = card.querySelector('p').textContent;
  userInput.value = text;
  updateCharCount();
  autoResize();
  userInput.focus();
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
