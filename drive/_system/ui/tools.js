/**
 * The Blackout Drive — Tools Panel
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-contained controller for the TOOLS panel — a full-screen overlay
 * identical in pattern to Library and Workspace. Tools register themselves
 * via registerTool() and are auto-discovered by this controller.
 *
 * ADDING A NEW TOOL:
 *   1. Create a new JS file (e.g., ui/mytool.js)
 *   2. At load time, call registerTool({ id, name, icon, description, render, cleanup })
 *   3. Add <script src="mytool.js"> to index.html AFTER tools.js
 *   4. Add CSS to style.css
 *   5. Mirror to _factory/
 *   That's it — the tool appears automatically in the grid.
 */
'use strict';

// ── Tool Registry ────────────────────────────────────────────
// Each tool is an object: { id, name, icon, description, render(container), cleanup?() }
const TOOLS_REGISTRY = [];

/**
 * Register a tool module. Called at load time by each tool's JS file.
 * @param {Object} toolModule
 * @param {string} toolModule.id         Unique identifier (e.g., 'ham-radio')
 * @param {string} toolModule.name       Display name (e.g., 'Ham Radio')
 * @param {string} toolModule.icon       Emoji or SVG string
 * @param {string} toolModule.description Short description for the card
 * @param {Function} toolModule.render   render(containerElement) — renders the tool UI
 * @param {Function} [toolModule.cleanup] Optional cleanup when navigating away
 */
function registerTool(toolModule) {
  if (!toolModule || !toolModule.id || !toolModule.render) {
    console.warn('registerTool: invalid tool module', toolModule);
    return;
  }
  // Prevent duplicate registration
  if (TOOLS_REGISTRY.find(t => t.id === toolModule.id)) return;
  TOOLS_REGISTRY.push(toolModule);
}

// ── State ────────────────────────────────────────────────────
let _toolsOpen = false;
let _activeToolId = null;  // null = showing grid, string = active tool id

const TOOLS_SS_KEY = 'dd_tools';

function _saveToolsState() {
  try {
    sessionStorage.setItem(TOOLS_SS_KEY, JSON.stringify({
      open: _toolsOpen,
      activeTool: _activeToolId,
    }));
  } catch {}
}

// ── Panel Management ─────────────────────────────────────────

let _toolsOpening = false;  // guard against re-entry

function openTools() {
  // If tools panel is already open, navigate back to the grid dashboard
  if (_toolsOpen) {
    if (_activeToolId) {
      _toolsGoBack();
    }
    return;
  }

  _toolsOpening = true;

  // Close side panels (Settings, Help, Status, Conversations, Prompts)
  if (typeof _closeSidePanels === 'function') _closeSidePanels();

  // Close Library directly without restoring main-content
  const libPanel = document.getElementById('libraryPanel');
  if (libPanel && libPanel.style.display !== 'none') {
    if (typeof _libraryOpening !== 'undefined') _libraryOpening = false;
    libPanel.style.display = 'none';
    document.body.style.overflow = '';
    if (typeof _setLibrarySidebarActive === 'function') _setLibrarySidebarActive(false);
    try { sessionStorage.removeItem('dd_lib'); } catch {}
  }

  // Close Workspace directly without restoring main-content
  const wsPanel = document.getElementById('workspacePanel');
  if (wsPanel && wsPanel.style.display !== 'none') {
    wsPanel.style.display = 'none';
    if (typeof _wsOpen !== 'undefined') _wsOpen = false;
    if (typeof _wsIdeOpen !== 'undefined') _wsIdeOpen = false;
    document.body.style.overflow = '';
    if (typeof _wsMonacoInstance !== 'undefined' && _wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }
    const ideMode = document.getElementById('ideMode');
    if (ideMode) ideMode.style.display = 'none';
    try { sessionStorage.removeItem('dd_ws'); } catch {}
  }

  // Close COMMS directly without restoring main-content
  const commsPanel = document.getElementById('commsPanel');
  if (commsPanel && commsPanel.style.display !== 'none') {
    if (typeof _commsOpening !== 'undefined') _commsOpening = false;
    commsPanel.style.display = 'none';
    if (typeof _commsOpen !== 'undefined') _commsOpen = false;
    document.body.style.overflow = '';
    try { sessionStorage.removeItem('dd_comms'); } catch {}
  }

  _toolsOpening = false;

  // Show Tools panel
  const panel = document.getElementById('toolsPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  _toolsOpen = true;
  document.body.style.overflow = 'hidden';

  // Hide main chat content
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = 'none';

  // Set sidebar active
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('toolsNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();

  // Render current state
  if (_activeToolId) {
    _renderActiveTool(_activeToolId);
  } else {
    _renderToolsGrid();
  }

  _saveToolsState();
}

function closeTools() {
  if (_toolsOpening) return;

  // Cleanup active tool
  if (_activeToolId) {
    const tool = TOOLS_REGISTRY.find(t => t.id === _activeToolId);
    if (tool && typeof tool.cleanup === 'function') tool.cleanup();
    _activeToolId = null;
  }

  const panel = document.getElementById('toolsPanel');
  if (!panel) return;
  panel.style.display = 'none';
  _toolsOpen = false;
  document.body.style.overflow = '';

  // Restore main chat content
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = '';

  // Reset sidebar
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('chatNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();

  // Clear persisted state
  try { sessionStorage.removeItem(TOOLS_SS_KEY); } catch {}
}

// ── Grid Rendering ───────────────────────────────────────────

function _renderToolsGrid() {
  _activeToolId = null;
  const main = document.getElementById('toolsMain');
  const title = document.getElementById('toolsHeaderTitle');
  const backBtn = document.getElementById('toolsBackBtn');
  if (!main) return;

  if (title) title.textContent = 'TOOLS';
  if (backBtn) backBtn.style.display = 'none';

  if (TOOLS_REGISTRY.length === 0) {
    main.innerHTML = `
      <div class="tools-empty">
        <div class="tools-empty-icon">🔧</div>
        <div class="tools-empty-title">No tools available</div>
        <div class="tools-empty-desc">Tools will appear here as they are added to the drive.</div>
      </div>`;
    return;
  }

  let html = '<div class="tools-dashboard-wrapper"><div class="tools-dashboard">';

  // Dashboard header
  html += `
    <div class="tools-dashboard-header">
      <div class="tools-dashboard-title">TOOLKIT</div>
      <div class="tools-dashboard-sub">// OFFLINE CRYPTOGRAPHIC &amp; SURVIVAL MODULES</div>
    </div>`;

  // Grid
  html += '<div class="tools-grid">';
  TOOLS_REGISTRY.forEach(tool => {
    html += `
      <div class="tools-card" data-tool-id="${tool.id}" onclick="_openToolById('${tool.id}')">
        <div class="tools-card-top">
          <div class="tools-card-icon">${tool.icon || '🔧'}</div>
        </div>
        <div class="tools-card-name">${tool.name || tool.id}</div>
        <div class="tools-card-desc">${tool.description || ''}</div>
      </div>`;
  });
  html += '</div>';

  // Footer
  html += `
    <div class="tools-dashboard-footer">
      <span>${TOOLS_REGISTRY.length} MODULES LOADED</span>
      <span>ALL SYSTEMS NOMINAL</span>
    </div>`;

  html += '</div></div>';
  main.innerHTML = html;

  _saveToolsState();
}

// ── Tool Navigation ──────────────────────────────────────────

function _openToolById(toolId) {
  const tool = TOOLS_REGISTRY.find(t => t.id === toolId);
  if (!tool) return;

  // Cleanup previous tool
  if (_activeToolId && _activeToolId !== toolId) {
    const prev = TOOLS_REGISTRY.find(t => t.id === _activeToolId);
    if (prev && typeof prev.cleanup === 'function') prev.cleanup();
  }

  _activeToolId = toolId;
  _renderActiveTool(toolId);
  _saveToolsState();
}

function _renderActiveTool(toolId) {
  const tool = TOOLS_REGISTRY.find(t => t.id === toolId);
  if (!tool) { _renderToolsGrid(); return; }

  const main = document.getElementById('toolsMain');
  const title = document.getElementById('toolsHeaderTitle');
  const backBtn = document.getElementById('toolsBackBtn');
  if (!main) return;

  if (title) title.textContent = tool.name || 'TOOLS';
  if (backBtn) backBtn.style.display = '';

  // Clear and render
  main.innerHTML = '';
  tool.render(main);
}

function _toolsGoBack() {
  // Cleanup active tool
  if (_activeToolId) {
    const tool = TOOLS_REGISTRY.find(t => t.id === _activeToolId);
    if (tool && typeof tool.cleanup === 'function') tool.cleanup();
  }
  _activeToolId = null;
  _renderToolsGrid();
}

// ── Anti-Flicker State Restore ───────────────────────────────
/**
 * Restore tools state on page reload — called from app.js init().
 * Mirrors the Library/Workspace anti-flicker pattern:
 *   1. index.html inline <script> sets html[data-restore="tools"]
 *   2. CSS makes toolsPanel display:flex BEFORE paint
 *   3. This function re-opens the panel with the saved tool
 *   4. Hides main-content, removes data-restore, reveals body
 */
function _restoreToolsState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(TOOLS_SS_KEY) || 'null');
    if (!s || !s.open) return false;

    _activeToolId = s.activeTool || null;
    openTools();

    // Lock main-content hidden
    const mc = document.querySelector('.main-content');
    if (mc) mc.style.display = 'none';

    // Remove CSS guard
    document.documentElement.removeAttribute('data-restore');
    document.documentElement.removeAttribute('data-restore-chat');

    // Reveal body immediately
    document.body.style.transition = 'none';
    document.body.style.opacity = '1';
    requestAnimationFrame(() => { document.body.style.transition = ''; });
    return true;
  } catch {
    return false;
  }
}

// ── Keyboard Shortcut ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _toolsOpen) {
    if (_activeToolId) {
      _toolsGoBack();
    } else {
      closeTools();
    }
  }
});
