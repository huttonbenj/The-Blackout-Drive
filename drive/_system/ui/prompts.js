/**
 * The Blackout Drive — Prompt Library
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 * Categorized prompts. Tap to populate the chat input.
 * Searchable. Offline. Zero dependencies.
 */
'use strict';

let _promptsData     = null;
let _promptPanelOpen = false;
let _promptActivecat = null;
let _promptSearch    = '';

// ── Toggle Panel ─────────────────────────────────────────────
function togglePromptPanel(force) {
  const panel = document.getElementById('promptPanel');
  if (!panel) return;
  const opening = (force === undefined) ? !_promptPanelOpen : !!force;
  if (opening) {
    // Close other side panels but NOT Library/Workspace overlays
    // (mirrors toggleConversationsPanel behavior — user stays on current view)
    if (typeof _closeSidePanels === 'function') _closeSidePanels(true);
    document.body.classList.add('has-left-panel');    // push main content right
    if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('promptsNavBtn');
    if (!_promptsData) _loadPrompts();
  } else {
    document.body.classList.remove('has-left-panel'); // restore main content width
    if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn(_getActiveViewBtn ? _getActiveViewBtn() : 'chatNavBtn');
  }
  _promptPanelOpen = opening;
  panel.classList.toggle('prompt-panel-open', _promptPanelOpen);
}

// ── Load prompts.json ─────────────────────────────────────────
async function _loadPrompts() {
  const body = document.getElementById('promptBody');
  if (!body) return;
  body.innerHTML = '<div class="prompt-panel-loading">Loading prompts...</div>';
  try {
    const res = await fetch('/_system/content/prompts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _promptsData = await res.json();
    _updatePromptCount();
    _renderPromptPanel();
  } catch (err) {
    body.innerHTML = `<div class="prompt-panel-loading" style="color:#e07777">Could not load prompts: ${err.message}</div>`;
  }
}

// ── Dynamic Prompt Count ─────────────────────────────────────
// Updates all UI references to the prompt count after data loads.
// This way adding prompts to prompts.json requires zero code changes.
function _updatePromptCount() {
  if (!_promptsData || !_promptsData.categories) return;
  const total = _promptsData.categories.reduce((sum, cat) => sum + (cat.prompts ? cat.prompts.length : 0), 0);
  // Update search placeholder
  const searchEl = document.getElementById('promptSearch');
  if (searchEl) searchEl.placeholder = `Search ${total} prompts...`;
  // Update help panel count
  const helpCount = document.getElementById('helpPromptCount');
  if (helpCount) helpCount.textContent = String(total);
}

// ── Render Panel ─────────────────────────────────────────────
function _renderPromptPanel() {
  const body = document.getElementById('promptBody');
  if (!body || !_promptsData) return;

  const cats = _promptsData.categories || [];
  const search = _promptSearch.toLowerCase().trim();

  // If searching — flat list of all matching prompts
  if (search) {
    const matches = [];
    cats.forEach(cat => {
      cat.prompts.forEach(p => {
        if (
          p.title.toLowerCase().includes(search) ||
          (p.tags || []).some(t => t.includes(search))
        ) {
          matches.push({ ...p, _catName: cat.name, _catIcon: cat.icon });
        }
      });
    });

    if (matches.length === 0) {
      body.innerHTML = `<div class="prompt-panel-loading" style="font-size:12px">No prompts match "${_escHtml(search)}"</div>`;
      return;
    }

    body.innerHTML = `<div class="prompt-search-results-label">${matches.length} result${matches.length !== 1 ? 's' : ''}</div>`;
    const grid = document.createElement('div');
    grid.className = 'prompt-grid-inner';
    matches.forEach(p => grid.appendChild(_makePromptCard(p)));
    body.appendChild(grid);
    return;
  }

  // No search — show category nav + prompts for active category
  body.innerHTML = '';

  // Category tabs
  const tabs = document.createElement('div');
  tabs.className = 'prompt-cat-tabs';
  cats.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'prompt-cat-tab' + (cat.id === _promptActivecat ? ' active' : '');
    tab.innerHTML = `${PROMPT_ICONS[cat.id] || getCategoryIcon(cat.id)} <span>${cat.name}</span>`;
    tab.onclick = () => {
      _promptActivecat = cat.id;
      _renderPromptPanel();
    };
    tabs.appendChild(tab);
  });
  body.appendChild(tabs);

  // If no category selected, default to first
  if (!_promptActivecat && cats.length > 0) {
    _promptActivecat = cats[0].id;
  }

  const activeCat = cats.find(c => c.id === _promptActivecat);
  if (!activeCat) return;

  const grid = document.createElement('div');
  grid.className = 'prompt-grid-inner';
  activeCat.prompts.forEach(p => grid.appendChild(_makePromptCard(p)));
  body.appendChild(grid);
}

function _makePromptCard(p) {
  const card = document.createElement('div');
  card.className = 'prompt-panel-card';
  card.innerHTML = `
    <div class="prompt-panel-title">${_escHtml(p.title)}</div>
    <div class="prompt-panel-text">${_escHtml(p.prompt.slice(0, 120))}${p.prompt.length > 120 ? '…' : ''}</div>
    <div class="prompt-panel-meta">${(p.tags || []).map(t => `<span class="prompt-tag">${_escHtml(t)}</span>`).join('')}</div>
  `;
  card.addEventListener('click', () => _usePrompt(p.prompt));
  return card;
}

function _usePrompt(text) {
  const input = document.getElementById('userInput');
  if (!input) return;
  // Navigate to Chat view if user is on Library/Workspace
  if (typeof _navigateToChat === 'function') _navigateToChat();
  // Close the prompts panel
  togglePromptPanel(false);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  // Trigger resize + char count update
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  if (typeof updateCharCount === 'function') updateCharCount();
  // Auto-send if BEACON is connected (matches welcome card behavior)
  if (typeof sendMessage === 'function' && typeof isConnected !== 'undefined' && isConnected) {
    sendMessage();
  } else {
    // Not connected — just load the prompt, let user send when ready
    if (typeof showToast === 'function') {
      showToast('Prompt loaded — start BEACON, then press Enter to send', 4000);
    }
    input.focus();
  }
}

// ── Search handler ─────────────────────────────────────────
function onPromptSearch(e) {
  _promptSearch = e.target.value || '';
  _renderPromptPanel();
}

// _escHtml: alias for the canonical escapeHtml() defined in library.js (loaded before this file)
const _escHtml = escapeHtml;
