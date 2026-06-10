/**
 * The Blackout Drive — Workspace Panel
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 * Handles file browsing, IDE mode, and Engine access.
 * Uses Monaco editor for code/text files.
 */
'use strict';

// ── State ────────────────────────────────────────────────────
let _wsOpen = false;
let _wsTab = 'unlocked';   // 'unlocked' | 'locked'
let _wsPath = '';           // current subfolder path
let _wsIdeOpen = false;     // IDE mode active
let _wsIdeSource = '';      // 'unlocked' | 'system'
let _wsIdePath = '';        // root path for IDE tree
let _wsIdeTitle = '';
let _wsCurrentFile = null;  // { path, saveUrl, source }
let _wsMonacoInstance = null;
let _wsOriginalContent = '';
let _wsDirty = false;
let _wsEngineDisclaimerAccepted = false;

// Check localStorage for previous disclaimer acceptance
try { _wsEngineDisclaimerAccepted = localStorage.getItem('bd_engine_disclaimer') === '1'; } catch {}

// ── sessionStorage state: persist workspace open/tab across reloads ──
const WS_SS_KEY = 'dd_ws';
function _saveWsState() {
  try {
    sessionStorage.setItem(WS_SS_KEY, JSON.stringify({
      open: _wsOpen,
      tab: _wsTab,
      path: _wsPath,
    }));
  } catch {}
}

/**
 * Restore workspace state on page reload — called from app.js init().
 * Mirrors the Library anti-flicker pattern:
 *   1. index.html inline <script> already added html[data-restore="ws"]
 *      if workspace was open, making workspacePanel display:flex BEFORE paint.
 *   2. This function re-opens workspace with the saved tab/path.
 *   3. Hides main-content, removes data-restore, reveals body.
 */
function _restoreWsState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(WS_SS_KEY) || 'null');
    if (!s || !s.open) {
      // No workspace was open — nothing to restore
      return false;
    }
    // Restore state variables before rendering
    _wsTab = s.tab || 'unlocked';
    _wsPath = s.path || '';
    // Open workspace (it renders the file browser)
    openWorkspace();
    // Lock .main-content hidden (same pattern as library)
    const mc = document.querySelector('.main-content');
    if (mc) mc.style.display = 'none';
    // Remove CSS guard — workspace is now visible
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

// ── Panel Management ─────────────────────────────────────────

function openWorkspace() {
  // Close side panels + library WITHOUT showing main-content (prevents chat flash).
  // Workspace will hide main-content itself on line below.
  if (typeof _closeSidePanels === 'function') _closeSidePanels();
  // Close library directly without restoring main-content visibility
  const libPanel = document.getElementById('libraryPanel');
  if (libPanel && libPanel.style.display !== 'none') {
    if (typeof _libraryOpening !== 'undefined') _libraryOpening = false;
    libPanel.style.display = 'none';
    document.body.style.overflow = '';
    if (typeof _setLibrarySidebarActive === 'function') _setLibrarySidebarActive(false);
    try { sessionStorage.removeItem('dd_lib'); } catch {}
  }
  // Close Tools panel directly without restoring main-content
  const toolsPanel = document.getElementById('toolsPanel');
  if (toolsPanel && toolsPanel.style.display !== 'none') {
    toolsPanel.style.display = 'none';
    if (typeof _toolsOpen !== 'undefined') _toolsOpen = false;
    if (typeof _activeToolId !== 'undefined') _activeToolId = null;
    document.body.style.overflow = '';
    try { sessionStorage.removeItem('dd_tools'); } catch {}
  }
  // Close COMMS panel directly without restoring main-content
  const commsPanel = document.getElementById('commsPanel');
  if (commsPanel && commsPanel.style.display !== 'none') {
    if (typeof _commsOpening !== 'undefined') _commsOpening = false;
    commsPanel.style.display = 'none';
    if (typeof _commsOpen !== 'undefined') _commsOpen = false;
    document.body.style.overflow = '';
    try { sessionStorage.removeItem('dd_comms'); } catch {}
  }
  const panel = document.getElementById('workspacePanel');
  if (!panel) return;
  panel.style.display = 'flex';
  _wsOpen = true;
  document.body.style.overflow = 'hidden';
  // Hide main chat content while workspace is open (prevents flicker on reload)
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = 'none';
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('workspaceNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();
  if (!_wsIdeOpen) _renderFileBrowser();
  _saveWsState();
}

function closeWorkspace() {
  const panel = document.getElementById('workspacePanel');
  if (!panel) return;
  panel.style.display = 'none';
  _wsOpen = false;
  _wsIdeOpen = false;
  document.body.style.overflow = '';
  // Restore main chat content visibility
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = '';
  // Dispose Monaco if active
  if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }
  const ideMode = document.getElementById('ideMode');
  if (ideMode) ideMode.style.display = 'none';
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('chatNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();
  // Clear persisted state so refresh returns to chat
  try { sessionStorage.removeItem(WS_SS_KEY); } catch {}
}

// ── File Browser ─────────────────────────────────────────────

// Library-compatible extensions (viewable in the Library's readers)
const _LIBRARY_EXTS = new Set(['epub','pdf','txt','md','csv','jpg','jpeg','png','gif','webp','svg']);
function _isLibraryCompatible(ext) { return _LIBRARY_EXTS.has((ext || '').toLowerCase()); }

/**
 * Get the X-Password header for locked tab API calls.
 * Returns header object or null if no password is cached.
 */
function _wsLockedHeaders() {
  try {
    const pw = sessionStorage.getItem(_MP_SESSION_KEY);
    if (pw) return { 'X-Password': pw };
  } catch {}
  return null;
}

/**
 * Ensure locked tab is unlocked (password available).
 * Uses _unlockSession() so ALL panels get notified.
 * Returns password string or null if user cancelled.
 */
async function _wsEnsureUnlocked() {
  const pw = await _unlockSession();
  return pw;
}

async function _renderFileBrowser() {
  const main = document.getElementById('workspaceMain');
  const header = document.getElementById('workspaceHeader');
  const actions = document.getElementById('workspaceHeaderActions');
  const title = document.getElementById('workspaceHeaderTitle');
  if (!main) return;

  // Restore normal width when returning from viewer
  main.classList.remove('ws-viewer-active');

  // Show file browser, hide IDE
  document.getElementById('workspaceBody').style.display = '';
  const ideMode = document.getElementById('ideMode');
  if (ideMode) ideMode.style.display = 'none';

  title.textContent = 'WORKSPACE';
  actions.innerHTML = '';

  main.innerHTML = '<div class="lib-loading"><span>Scanning your files...</span></div>';

  // ── Fetch file listing ──
  // For locked tab, prompt for password if needed and send as header
  let files = [];
  const isLocked = _wsTab === 'locked';

  if (isLocked) {
    const pw = await _wsEnsureUnlocked();
    if (!pw) {
      // User cancelled — switch back to unlocked
      _wsTab = 'unlocked';
      _wsPath = '';
      _saveWsState();
      _renderFileBrowser();
      return;
    }
    const url = `/api/files/locked?path=${encodeURIComponent(_wsPath)}`;
    try {
      const res = await fetch(url, { headers: { 'X-Password': pw } });
      if (res.ok) { const d = await res.json(); files = d.files || []; }
      else if (res.status === 403) {
        try { sessionStorage.removeItem(_MP_SESSION_KEY); } catch {}
        if (typeof showToast === 'function') showToast('Wrong password', 3000);
        _wsTab = 'unlocked';
        _renderFileBrowser();
        return;
      }
    } catch {}
  } else {
    const url = `/api/files/unlocked?path=${encodeURIComponent(_wsPath)}`;
    try {
      const res = await fetch(url);
      if (res.ok) { const d = await res.json(); files = d.files || []; }
    } catch {}
  }

  // Fetch existing bookmarks for this tab to show "already in library" state
  let _bookmarkedPaths = new Set();
  try {
    const bmRes = await fetch('/api/user-files', { cache: 'no-store' });
    if (bmRes.ok) {
      const bmData = await bmRes.json();
      (bmData.files || []).forEach(f => {
        if (f.source === _wsTab) _bookmarkedPaths.add(f.path);
      });
    }
  } catch {}

  // Build breadcrumbs
  const parts = _wsPath ? _wsPath.split('/').filter(Boolean) : [];
  let crumbHtml = `<span class="hub-breadcrumb-link" onclick="_wsPath='';_renderFileBrowser()">HOME</span>`;
  let bp = '';
  parts.forEach((p, i) => {
    bp += (bp ? '/' : '') + p;
    crumbHtml += ' <span class="hub-breadcrumb-sep">/</span> ';
    if (i === parts.length - 1) {
      crumbHtml += `<span class="hub-breadcrumb-current">${_esc(p)}</span>`;
    } else {
      const pp = bp;
      crumbHtml += `<span class="hub-breadcrumb-link" onclick="_wsPath='${pp}';_renderFileBrowser()">${_esc(p)}</span>`;
    }
  });

  // Build HTML
  let html = '';

  // Engine pinned entry (only at root, only when Developer Mode is ON)
  if (!_wsPath && localStorage.getItem('bd-setting-dev-mode') === 'true') {
    html += `
    <div class="ws-engine-card" onclick="_openEngine()">
      <div class="ws-engine-icon">⚙️</div>
      <div class="ws-engine-info">
        <div class="ws-engine-title">THE ENGINE</div>
        <div class="ws-engine-desc">Edit the drive's source code, themes, and configuration</div>
      </div>
      <button class="myfile-open-btn" onclick="event.stopPropagation();_openEngine()">EDITOR</button>
    </div>`;
  }

  // Action row: Tabs + buttons
  const hasFiles = files.length > 0;
  html += `
  <div class="ws-action-row">
    <div class="ws-tabs">
      <button class="ws-tab ${_wsTab === 'unlocked' ? 'ws-tab--active' : ''}" onclick="_wsTab='unlocked';_wsPath='';_saveWsState();_renderFileBrowser()">📂 UNLOCKED</button>
      <button class="ws-tab ${_wsTab === 'locked' ? 'ws-tab--active' : ''}" onclick="_wsTab='locked';_wsPath='';_saveWsState();_renderFileBrowser()">🔒 LOCKED</button>
    </div>
    <div class="ws-action-buttons">
      ${hasFiles ? `<button class="ws-export-btn" onclick="_wsExportPath('${_esc(_wsPath)}')" title="Export ${_wsPath ? 'this folder' : 'all files'} to a location you choose">⬇ EXPORT${_wsPath ? '' : ' ALL'}</button>` : ''}
      ${isLocked ? `<button class="ws-import-btn" onclick="_showVaultImportModal()" title="Import externally encrypted .bkv files into the vault">⬆ IMPORT .BKV</button>` : ''}
      <button class="ws-upload-btn" onclick="_showUploadModal()">+ UPLOAD</button>
      <button class="ws-explorer-btn" onclick="_wsExplorer()" title="Tree view explorer">📁 EXPLORER</button>
      <button class="ws-refresh-btn" onclick="_renderFileBrowser()" title="Refresh">↻</button>
    </div>
  </div>`;
  
  if (_wsPath) {
    html += `
    <div class="ws-breadcrumb-row">
      <div class="hub-breadcrumbs">${crumbHtml}</div>
    </div>`;
  }

  // Info for locked tab (at root)
  if (isLocked && !_wsPath) {
    html += `<div class="ws-locked-banner">
      <span>🔒</span>
      <div><strong>ENCRYPTED VAULT</strong> — Files are individually encrypted with your master password (AES-256-GCM). Only you can access them.</div>
    </div>`;
  }

  // File list
  if (files.length === 0) {
    html += `<div class="ws-empty-state">
      <div class="ws-empty-icon">${isLocked ? '🔒' : '📂'}</div>
      <div class="ws-empty-title">NO FILES DETECTED</div>
      <div class="ws-empty-subtitle">${isLocked ? 'Encrypted Vault Empty' : 'Directory Empty'}</div>
      <button class="ws-upload-btn ws-empty-cta" onclick="_showUploadModal()">+ UPLOAD FILES</button>
    </div>`;
  } else {
    html += '<div class="myfiles-list">';
    // Sort: dirs first, then files
    files.sort((a, b) => ((b.is_dir || b.type === 'directory') ? 1 : 0) - ((a.is_dir || a.type === 'directory') ? 1 : 0) || a.name.localeCompare(b.name));
    files.forEach(f => {
      const isDir = f.is_dir || f.type === 'directory';
      const fullPath = _wsPath ? `${_wsPath}/${f.name}` : f.name;
      const ext = f.name.split('.').pop().toLowerCase();
      const icon = isDir ? '📁' : _fileIcon(ext);
      const sizeStr = !isDir && f.size != null ? _fmtSize(f.size) : '';
      const canView = !isDir && (_canViewFile(ext) || _isCodeFile(ext));

      html += `<div class="myfile-item ${isDir ? 'myfile-item--dir' : ''}" data-path="${_esc(fullPath)}">
        <span class="myfile-icon">${icon}</span>
        <div class="myfile-info">
          <div class="myfile-name">${_esc(f.name)}</div>
          <div class="myfile-meta">${isDir ? 'Folder' : sizeStr}</div>
        </div>
        <div class="myfile-actions">
          ${isDir ? `<button class="myfile-open-btn ws-export-item-btn" data-ws-action="export" title="Export folder to...">⬇</button>` : ''}
          ${isDir ? `<button class="myfile-open-btn" data-ws-action="ide">EDITOR</button>` : ''}
          ${isDir ? `<button class="myfile-open-btn" data-ws-action="enter">ENTER →</button>` : ''}
          ${!isDir && _isLibraryCompatible(ext) ? (
            _bookmarkedPaths.has(fullPath)
              ? `<button class="myfile-open-btn ws-library-btn ws-in-library" data-ws-action="library" title="Already in Library" disabled>✓ 📚</button>`
              : `<button class="myfile-open-btn ws-library-btn" data-ws-action="library" title="Add to Library">${ICONS.library}</button>`
          ) : ''}
          ${!isDir ? `<button class="myfile-open-btn ws-export-item-btn" data-ws-action="export" title="Export file to...">⬇</button>` : ''}
          ${canView ? `<button class="myfile-open-btn" data-ws-action="view">OPEN</button>` : ''}
          <button class="myfile-open-btn myfile-delete-btn" data-ws-action="delete">✕</button>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  main.innerHTML = html;

  // Wire up event handlers
  main.querySelectorAll('[data-ws-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = btn.closest('.myfile-item');
      const path = item ? item.dataset.path : '';
      const action = btn.dataset.wsAction;

      if (action === 'enter') {
        _wsPath = path; _renderFileBrowser();
      }
      else if (action === 'ide') {
        _openIde(_wsTab, path, path.split('/').pop());
      }
      else if (action === 'view') {
        _wsViewFile(path);
      }
      else if (action === 'export') { _wsExportPath(path); }
      else if (action === 'library') { _wsSendToLibrary(path); }
      else if (action === 'delete') { _wsDeleteFile(path); }
    });
  });
}

/**
 * View a file from either tab. Locked files are decrypted in memory by the server
 * via the X-Password header — zero temp files.
 */
function _wsViewFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  const isLocked = _wsTab === 'locked';

  if (isLocked) {
    // For locked files, construct the URL with password header
    // The file will be decrypted in memory by the server
    const filePath = `api/files/locked/${path}`;
    const type = _getFileType(ext);
    const name = path.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

    if (_isCodeFile(ext)) {
      _openIde(_wsTab, _wsPath || '', _wsPath ? _wsPath.split('/').pop() : 'Files');
      // Pass full vault-root path — _ideOpenFile uses it directly for locked files
      setTimeout(() => _ideOpenFile(path, ext), 300);
      return;
    }
    _wsRenderViewer(filePath, type, name);
  } else {
    const filePath = `api/files/unlocked/${path}`;
    const type = _getFileType(ext);
    const name = path.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

    if (_isCodeFile(ext)) {
      _openIde(_wsTab, _wsPath || '', _wsPath ? _wsPath.split('/').pop() : 'Files');
      const relFile = _wsPath && path.startsWith(_wsPath + '/') ? path.slice(_wsPath.length + 1) : path;
      setTimeout(() => _ideOpenFile(relFile, ext), 300);
      return;
    }
    _wsRenderViewer(filePath, type, name);
  }
}

/**
 * Context-aware EXPLORER button handler.
 * Both tabs use the same IDE — locked tab sends password header for tree.
 */
function _wsExplorer() {
  _openExplorerMode();
}

/**
 * Save a workspace file to disk via native OS Save As dialog.
 * Works for both locked and unlocked files.
 */
async function _wsSaveToDisk(filePath, displayName) {
  if (!filePath) return;

  const isLocked = filePath.startsWith('api/files/locked/');

  try {
    let res;
    if (isLocked) {
      const pw = _getSessionPassword();
      if (!pw) {
        if (typeof showToast === 'function') showToast('Unlock the vault first to download locked files', 3000);
        return;
      }
      const relativePath = filePath.replace('api/files/locked/', '');
      res = await fetch('/api/save-to-disk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Password': pw,
        },
        body: JSON.stringify({ source: 'locked', path: relativePath }),
      });
    } else {
      const relativePath = filePath.replace('api/files/unlocked/', '');
      res = await fetch('/api/save-to-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'unlocked', path: relativePath }),
      });
    }

    const data = await res.json();
    if (data.cancelled) return;
    if (!data.ok) throw new Error(data.error || 'Save failed');
    if (typeof showToast === 'function') showToast(`✓ Saved to ${data.path}`, 3000);
  } catch (e) {
    console.error('Save to disk failed:', e);
    if (typeof showToast === 'function') showToast('✗ Save failed: ' + e.message, 4000);
  }
}


/**
 * Render a non-code file viewer (text, image, PDF, epub) directly in workspaceMain
 * with a BACK button that returns to the workspace file browser.
 */
function _wsRenderViewer(filePath, fileType, displayName) {
  const main = document.getElementById('workspaceMain');
  if (!main) return;

  // Expand to full width for viewer
  main.classList.add('ws-viewer-active');

  const esc = escapeHtml;
  const isLocked = filePath.startsWith('api/files/locked/');

  // For locked files, fetch with password header and create blob URL
  // For unlocked files, use direct URL
  if (isLocked) {
    main.innerHTML = '<div class="lib-loading"><span>Decrypting file...</span></div>';
    const headers = _wsLockedHeaders();
    if (!headers) {
      main.innerHTML = '<div class="myfiles-empty">Password required to view locked files</div>';
      return;
    }
    fetch('/' + filePath, { headers })
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        const ctype = r.headers.get('Content-Type') || 'application/octet-stream';
        return r.blob().then(blob => ({ blob, ctype }));
      })
      .then(({ blob, ctype }) => {
        const blobUrl = URL.createObjectURL(blob);
        _wsRenderViewerContent(main, blobUrl, fileType, displayName, esc, true, filePath);
      })
      .catch(e => {
        main.innerHTML = `<div class="myfiles-empty">Error loading file: ${esc(e.message)}</div>`;
      });
  } else {
    const fileUrl = '/' + filePath;
    _wsRenderViewerContent(main, fileUrl, fileType, displayName, esc, false, filePath);
  }
}

/**
 * Render viewer content using a given URL (direct or blob).
 */
function _wsRenderViewerContent(main, fileUrl, fileType, displayName, esc, isBlob, filePath) {
  // Download via native Save As dialog
  const downloadBtn = `<button class="hub-action-btn" style="font-size:11px;cursor:pointer;background:none;border:1px solid var(--border);color:var(--text-primary);padding:4px 10px;font-family:var(--font-mono);letter-spacing:0.5px" onclick="_wsSaveToDisk('${esc(filePath || '')}', '${esc(displayName)}')">⬇ DOWNLOAD</button>`;

  if (fileType === 'image') {
    main.innerHTML = `
      <div style="padding:0">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <button class="lib-back-btn" onclick="_renderFileBrowser()">← BACK</button>
          <div style="font-family:var(--font-mono);font-size:12px;letter-spacing:1px;color:var(--text-primary)">${esc(displayName)}</div>
          <div style="flex:1"></div>
          ${downloadBtn}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;min-height:400px;padding:24px">
          <img src="${fileUrl}" style="max-width:100%;max-height:70vh;border-radius:4px" alt="${esc(displayName)}">
        </div>
      </div>`;
    return;
  }

  if (fileType === 'pdf') {
    main.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <button class="lib-back-btn" onclick="_renderFileBrowser()">← BACK</button>
          <div style="font-family:var(--font-mono);font-size:12px;letter-spacing:1px;color:var(--text-primary)">${esc(displayName)}</div>
          <div style="flex:1"></div>
          ${downloadBtn}
        </div>
        <iframe src="${fileUrl}" style="flex:1;border:none;background:#2a2a2a;min-height:500px"></iframe>
      </div>`;
    return;
  }

  if (fileType === 'epub') {
    const origLibMain = (typeof libMain !== 'undefined') ? libMain : null;
    libMain = main;
    const isBlobUrl = fileUrl.startsWith('blob:');
    const epubFile = isBlobUrl ? fileUrl : (fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl);
    const item = { type: 'epub', file: epubFile, name: displayName, always_available: true, ...(isBlobUrl ? { _blobUrl: true } : {}) };
    if (typeof renderEpubReader === 'function') {
      main.innerHTML = '<div class="lib-loading"><span>Loading book...</span></div>';
      renderEpubReader(item);
    }
    setTimeout(() => { if (origLibMain) libMain = origLibMain; }, 100);
    return;
  }

  // text / unknown → fetch and display as plain text
  main.innerHTML = '<div class="lib-loading"><span>Loading...</span></div>';
  const fetchOpts = isBlob ? {} : {};
  fetch(fileUrl, fetchOpts)
    .then(r => { if (!r.ok) throw new Error('Not found'); return r.text(); })
    .then(text => {
      main.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <button class="lib-back-btn" onclick="_renderFileBrowser()">← BACK</button>
          <div style="font-family:var(--font-mono);font-size:12px;letter-spacing:1px;color:var(--text-primary)">${esc(displayName)}</div>
        </div>
        <div style="padding:24px 0;max-width:800px">
          <pre style="white-space:pre-wrap;font-family:var(--font-body);line-height:1.8;color:var(--text-primary);font-size:15px">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        </div>`;
    })
    .catch(() => {
      main.innerHTML = '<div class="myfiles-empty">Error loading file</div>';
    });
}


async function _wsDeleteFile(path) {
  const name = path.split('/').pop();
  // Use themed modal (promise-based)
  const ok = await _showThemedConfirm(`Delete "${name}"?`, 'This cannot be undone.');
  if (!ok) return;

  try {
    const opts = { method: 'DELETE' };
    // Locked files require X-Password header
    if (_wsTab === 'locked') {
      const headers = _wsLockedHeaders();
      if (headers) opts.headers = headers;
    }
    const res = await fetch(`/api/files/${_wsTab}/${encodeURIComponent(path)}`, opts);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const bmRemoved = data.bookmarks_removed || 0;
      if (bmRemoved > 0) {
        if (typeof showToast === 'function') showToast(`Deleted: ${name} (also removed from Library)`, 4000);
        // Refresh Library sidebar and panel if open
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof libActiveCat !== 'undefined' && libActiveCat === '__userlibrary' &&
            typeof showUserLibraryPanel === 'function') {
          showUserLibraryPanel();
        }
      } else {
        if (typeof showToast === 'function') showToast(`Deleted: ${name}`);
      }
      _renderFileBrowser();
    } else {
      if (typeof showToast === 'function') showToast('⚠ Failed to delete');
    }
  } catch { if (typeof showToast === 'function') showToast('⚠ Error deleting file'); }
}

/**
 * Export a file or folder to a user-chosen location.
 * Opens a native OS directory picker (via server-side API), then copies
 * the file/folder to the selected destination. Works on Mac, Windows, Linux.
 */
async function _wsExportPath(path) {
  const isLocked = _wsTab === 'locked';
  const name = path ? path.split('/').pop() : (isLocked ? 'Locked Vault' : 'Unlocked Files');

  if (typeof _showUniversalExportModal === 'function') {
    _showUniversalExportModal(
      `EXPORT ${isLocked ? 'LOCKED' : 'UNLOCKED'} FILES`,
      `How do you want to export ${name}?`,
      async (format) => {
        await _executeWorkspaceExport(path, isLocked, name, format);
      }
    );
  } else {
    // Fallback if not loaded
    await _executeWorkspaceExport(path, isLocked, name, 'raw');
  }
}

async function _executeWorkspaceExport(path, isLocked, name, format) {
  if (typeof showToast === 'function') showToast(`Choose export location for: ${name}...`, 3000);

  try {
    const headers = { 'Content-Type': 'application/json' };
    
    // For locked files OR encrypted exports, we need the master password
    if (isLocked || format === 'encrypted') {
      const pw = await _wsEnsureUnlocked();
      if (!pw) return;
      headers['X-Password'] = pw;
    }

    const res = await fetch('/api/files/export-to', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: _wsTab, path: path || '', encrypt: format === 'encrypted' }),
    });

    const data = await res.json();

    if (data.cancelled) {
      // User cancelled the directory picker — no-op
      return;
    }

    if (data.ok) {
      const count = data.count || 0;
      const dest = data.destination || '';
      const short = dest.split('/').pop() || dest.split('\\').pop() || dest;
      if (typeof showToast === 'function') {
        showToast(`✓ Exported ${count} file${count !== 1 ? 's' : ''} to ${short}`, 4000);
      }
    } else {
      throw new Error(data.error || 'Export failed');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast(`⚠ Export failed: ${e.message}`, 5000);
  }
}

/**
 * Add a file to the Library as a bookmark (no file copy).
 * Works for both unlocked and locked files.
 */
async function _wsSendToLibrary(path) {
  const name = path.split('/').pop();
  const isLocked = _wsTab === 'locked';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (isLocked) {
      const pw = await _wsEnsureUnlocked();
      if (!pw) return;
      headers['X-Password'] = pw;
    }
    const res = await fetch('/api/library/bookmark', {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: _wsTab, path }),
    });
    const data = await res.json();
    if (data.ok) {
      if (data.duplicate) {
        if (typeof showToast === 'function') showToast(`📚 "${name}" is already in Library`, 3000);
      } else {
        if (typeof showToast === 'function') showToast(`📚 "${name}" added to Library`, 3000);
      }
      // Update the library button in-place to show "in library" state
      const item = document.querySelector(`.myfile-item[data-path="${CSS.escape(path)}"]`);
      if (item) {
        const libBtn = item.querySelector('.ws-library-btn');
        if (libBtn) {
          libBtn.classList.add('ws-in-library');
          libBtn.innerHTML = '✓ 📚';
          libBtn.title = 'Already in Library';
          libBtn.disabled = true;
        }
      }
      // Auto-refresh Library sidebar and panel if open
      if (typeof renderSidebar === 'function') renderSidebar();
      if (typeof libActiveCat !== 'undefined' && libActiveCat === '__userlibrary' &&
          typeof showUserLibraryPanel === 'function') {
        showUserLibraryPanel();
      }
    } else {
      if (typeof showToast === 'function') showToast(`⚠ ${data.error || 'Failed to add to library'}`, 4000);
    }
  } catch {
    if (typeof showToast === 'function') showToast('⚠ Error sending to library');
  }
}

// ── Explorer Mode (tree view for file browser) ──────────────

function _openExplorerMode() {
  const root = _wsPath || '';
  const title = root ? root.split('/').pop() : (_wsTab === 'unlocked' ? 'UNLOCKED FILES' : 'LOCKED FILES');
  _openIde(_wsTab, root, title);
}

// ── Engine Access ────────────────────────────────────────────

function _openEngine() {
  if (!_wsEngineDisclaimerAccepted) {
    _showEngineDisclaimer(() => {
      _wsEngineDisclaimerAccepted = true;
      try { localStorage.setItem('bd_engine_disclaimer', '1'); } catch {}
      _openIde('system', '', 'THE ENGINE');
    });
    return;
  }
  _openIde('system', '', 'THE ENGINE');
}

function _showEngineDisclaimer(onAccept) {
  const overlay = document.createElement('div');
  overlay.className = 'engine-disclaimer-overlay';

  overlay.innerHTML = `
    <div class="engine-disclaimer-dialog">
      <div class="engine-disclaimer-icon">⚠️</div>
      <div class="engine-disclaimer-title">CODE MODIFICATION DISCLAIMER</div>
      <div class="engine-disclaimer-body">
        The Blackout Drive allows you to modify its source code. This is a powerful feature for advanced users.<br><br>
        By proceeding, you acknowledge:<br>
        • All modifications are <strong>at your own risk</strong><br>
        • Hutton Technologies is not liable for damage caused by code modifications<br>
        • <strong>EMERGENCY_RESTORE</strong> can reset to factory defaults<br>
        • Your personal data (files, conversations) is never affected by a restore
      </div>
      <div class="engine-disclaimer-actions">
        <button id="engineDisclaimerCancel" class="engine-disclaimer-cancel">CANCEL</button>
        <button id="engineDisclaimerAccept" class="engine-disclaimer-accept">I UNDERSTAND — PROCEED</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#engineDisclaimerCancel').onclick = () => overlay.remove();
  overlay.querySelector('#engineDisclaimerAccept').onclick = () => { overlay.remove(); onAccept(); };
}

// ── IDE Mode ─────────────────────────────────────────────────

async function _openIde(source, rootPath, title) {
  _wsIdeOpen = true;
  _wsIdeSource = source;
  _wsIdePath = rootPath;
  _wsIdeTitle = title || 'EDITOR';
  _wsCurrentFile = null;
  _wsDirty = false;

  // Hide file browser, show IDE
  document.getElementById('workspaceBody').style.display = 'none';
  const ideMode = document.getElementById('ideMode');
  ideMode.style.display = 'flex';

  document.getElementById('ideTitle').textContent = _wsIdeTitle;
  _updateDirtyIndicator();

  // Load file tree
  const tree = document.getElementById('ideTree');
  tree.innerHTML = '<div class="lib-loading"><span>Loading...</span></div>';

  try {
    let treeData;
    if (source === 'system') {
      // Use system files API
      const res = await fetch('/api/system/files');
      const data = await res.json();
      treeData = _sysFilesToTree(data.files || []);
    } else if (source === 'locked') {
      // Locked vault — use manifest tree with password header
      const pw = _wsLockedHeaders();
      if (!pw) {
        tree.innerHTML = '<div class="myfiles-empty">Password required for locked files</div>';
        return;
      }
      const combinedPath = rootPath ? `locked/${rootPath}` : 'locked';
      const apiPath = `/api/files/tree?path=${encodeURIComponent(combinedPath)}`;
      const res = await fetch(apiPath, { headers: pw });
      const data = await res.json();
      treeData = data.tree || [];
    } else {
      // Unlocked — use file tree API directly
      const combinedPath = rootPath ? `${source}/${rootPath}` : source;
      const apiPath = `/api/files/tree?path=${encodeURIComponent(combinedPath)}`;
      const res = await fetch(apiPath);
      const data = await res.json();
      treeData = data.tree || [];
    }
    tree.innerHTML = '';
    _renderTree(tree, treeData, 0);
  } catch (e) {
    tree.innerHTML = '<div class="myfiles-empty">Error loading file tree</div>';
  }

  // Reset editor — clear any stale error text from previous sessions
  const container = document.getElementById('ideEditorContainer');
  container.style.display = 'none';
  const emptyState = document.getElementById('ideEmptyState');
  emptyState.innerHTML = '<span style="font-size:28px;opacity:0.3">📡</span><span>SELECT A FILE TO EDIT</span><span style="font-size:10px;opacity:0.4;letter-spacing:1px">← Choose a file from the explorer</span>';
  emptyState.style.display = 'flex';
  if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }
}

function closeIdeMode() {
  _wsIdeOpen = false;
  if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }
  _wsDirty = false;
  document.getElementById('ideMode').style.display = 'none';
  document.getElementById('workspaceBody').style.display = '';
  _renderFileBrowser();
}

// ── File Tree Rendering ──────────────────────────────────────

function _sysFilesToTree(files) {
  // Convert flat list of {path, name, category} to nested tree
  const root = [];
  const dirs = {};
  files.forEach(f => {
    const parts = f.path.split('/');
    if (parts.length === 1) {
      root.push({ name: f.name, path: f.path, type: 'file', category: f.category });
    } else {
      const dir = parts[0];
      if (!dirs[dir]) { dirs[dir] = { name: dir, type: 'dir', children: [] }; root.push(dirs[dir]); }
      dirs[dir].children.push({ name: parts.slice(1).join('/'), path: f.path, type: 'file', category: f.category });
    }
  });
  return root;
}

/**
 * Build a tree structure from the temp session listing API (recursive).
 * Returns the same format as /api/files/tree for _renderTree compatibility.
 */

function _renderTree(container, items, depth) {
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'ide-tree-item';
    el.style.paddingLeft = (12 + depth * 16) + 'px';

    if (item.type === 'dir' || item.children) {
      let expanded = true;
      el.innerHTML = `<span class="ide-tree-arrow">▼</span><span class="ide-tree-icon">📁</span><span class="ide-tree-name">${_esc(item.name)}</span>`;
      container.appendChild(el);

      const childContainer = document.createElement('div');
      childContainer.className = 'ide-tree-children';
      container.appendChild(childContainer);
      _renderTree(childContainer, item.children || [], depth + 1);

      el.addEventListener('click', () => {
        expanded = !expanded;
        childContainer.style.display = expanded ? '' : 'none';
        el.querySelector('.ide-tree-arrow').textContent = expanded ? '▼' : '▶';
      });
    } else {
      const ext = (item.name || item.path || '').split('.').pop().toLowerCase();
      const icon = _fileIcon(ext);
      el.innerHTML = `<span class="ide-tree-icon">${icon}</span><span class="ide-tree-name">${_esc(item.name || item.path)}</span>`;
      el.addEventListener('click', () => {
        // Highlight active file
        container.closest('#ideTree').querySelectorAll('.ide-tree-item--active').forEach(x => x.classList.remove('ide-tree-item--active'));
        el.classList.add('ide-tree-item--active');
        _ideOpenFile(item.path || item.name, ext);
      });
      container.appendChild(el);
    }
  });
}

// ── Monaco Editor (unified) ──────────────────────────────────

async function _ideOpenFile(filePath, ext) {
  const container = document.getElementById('ideEditorContainer');
  const emptyState = document.getElementById('ideEmptyState');

  // Determine URLs and fetch options
  let fetchUrl, saveUrl, fetchOpts = {};
  if (_wsIdeSource === 'system') {
    fetchUrl = `/api/system/files/${encodeURIComponent(filePath)}`;
    saveUrl = fetchUrl;
  } else if (_wsIdeSource === 'locked') {
    // Locked vault — tree returns full vault-root paths, use directly
    fetchUrl = `/api/files/locked/${encodeURIComponent(filePath)}`;
    saveUrl = null; // Locked files are read-only in the IDE
    const headers = _wsLockedHeaders();
    if (headers) fetchOpts = { headers };
  } else {
    fetchUrl = `/api/files/${_wsIdeSource}/${encodeURIComponent(_wsIdePath ? _wsIdePath + '/' + filePath : filePath)}`;
    saveUrl = `/api/files/${_wsIdeSource}/${encodeURIComponent(_wsIdePath ? _wsIdePath + '/' + filePath : filePath)}`;
  }

  _wsCurrentFile = { path: filePath, fetchUrl, saveUrl, source: _wsIdeSource };

  // Route binary/viewable files to proper viewers instead of Monaco
  const imageExts = ['jpg','jpeg','png','gif','svg','webp','bmp','tiff'];
  if (imageExts.includes(ext) || ext === 'pdf' || ext === 'epub') {
    _ideViewBinary(fetchUrl, ext, filePath);
    return;
  }

  // Get language from extension
  const langMap = { js: 'javascript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'shell', bat: 'bat', txt: 'plaintext', xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'plaintext', cfg: 'plaintext', ini: 'ini', command: 'shell' };
  const lang = langMap[ext] || 'plaintext';

  try {
    // Fetch content
    let content;
    if (_wsIdeSource === 'system') {
      const res = await fetch(fetchUrl);
      const data = await res.json();
      content = data.content || '';
    } else {
      const res = await fetch(fetchUrl, fetchOpts);
      if (!res.ok) throw new Error('File not found');
      content = await res.text();
    }

    // Ensure Monaco is loaded (use library.js shared loader)
    const monaco = await _ensureMonaco();

    emptyState.style.display = 'none';
    container.style.display = 'block';

    // Dispose previous instance
    if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }
    container.innerHTML = '';

    _defineBlackoutTheme(monaco);

    _wsOriginalContent = content;
    _wsDirty = false;
    _updateDirtyIndicator();

    _wsMonacoInstance = monaco.editor.create(container, {
      value: content, language: lang, theme: 'blackout-tactical',
      readOnly: false, minimap: { enabled: true }, scrollBeyondLastLine: false,
      fontSize: 13, fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
      lineNumbers: 'on', renderLineHighlight: 'all', wordWrap: 'on',
      automaticLayout: true, padding: { top: 12 },
    });

    // Track changes
    _wsMonacoInstance.onDidChangeModelContent(() => {
      const current = _wsMonacoInstance.getValue();
      _wsDirty = current !== _wsOriginalContent;
      _updateDirtyIndicator();
    });

    // Ctrl+S
    _wsMonacoInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => _workspaceSaveFile()
    );

  } catch (err) {
    emptyState.style.display = 'flex';
    emptyState.textContent = 'Error loading file: ' + (err.message || err);
  }
}

/**
 * Render a binary/viewable file (image, PDF, EPUB) inside the IDE editor container
 * instead of trying to open it in Monaco.
 */
async function _ideViewBinary(fetchUrl, ext, filePath) {
  const container = document.getElementById('ideEditorContainer');
  const emptyState = document.getElementById('ideEmptyState');
  if (!container) return;

  // Dispose Monaco if active
  if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }

  emptyState.style.display = 'none';
  container.style.display = 'flex';

  const displayName = filePath.split('/').pop();
  const imageExts = ['jpg','jpeg','png','gif','svg','webp','bmp','tiff'];
  const isLocked = _wsIdeSource === 'locked';

  // For locked files, we must fetch with X-Password header and use blob URLs,
  // because <img src="..."> / <iframe src="..."> cannot send custom headers.
  if (isLocked) {
    const headers = _wsLockedHeaders();
    if (!headers) {
      container.innerHTML = '<div class="ide-empty-state">Password required to view locked files</div>';
      return;
    }
    container.innerHTML = '<div class="lib-loading"><span>Decrypting file...</span></div>';

    try {
      const res = await fetch(fetchUrl, { headers });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      if (imageExts.includes(ext)) {
        container.innerHTML = `
          <div class="ide-viewer-wrap">
            <div class="ide-viewer-toolbar">
              <div class="ide-viewer-name">${escapeHtml(displayName)}</div>
              <button class="ide-viewer-action" onclick="_wsSaveToDisk('${escapeHtml(filePath)}', '${escapeHtml(displayName)}')">⬇ DOWNLOAD</button>
            </div>
            <div class="ide-viewer-stage">
              <img src="${blobUrl}" class="ide-viewer-img" alt="${escapeHtml(displayName)}">
            </div>
          </div>`;
      } else if (ext === 'pdf') {
        container.innerHTML = `
          <div class="ide-viewer-wrap">
            <div class="ide-viewer-toolbar">
              <div class="ide-viewer-name">${escapeHtml(displayName)}</div>
              <button class="ide-viewer-action" onclick="_wsSaveToDisk('${escapeHtml(filePath)}', '${escapeHtml(displayName)}')">⬇ DOWNLOAD</button>
            </div>
            <iframe src="${blobUrl}" class="ide-viewer-iframe"></iframe>
          </div>`;
      } else if (ext === 'epub') {
        const item = { type: 'epub', file: blobUrl, _blobUrl: true, name: displayName, always_available: true };
        const origLibMain = (typeof libMain !== 'undefined') ? libMain : null;
        libMain = container;
        if (typeof renderEpubReader === 'function') renderEpubReader(item);
        setTimeout(() => { if (origLibMain) libMain = origLibMain; }, 100);
      } else {
        container.innerHTML = `<div class="ide-empty-state">Cannot preview this file type (.${ext})</div>`;
      }
    } catch (e) {
      container.innerHTML = `<div class="ide-empty-state">Error loading file: ${escapeHtml(e.message)}</div>`;
    }
    return;
  }

  // Unlocked files — direct URL access (no header needed)
  if (imageExts.includes(ext)) {
    container.innerHTML = `
      <div class="ide-viewer-wrap">
        <div class="ide-viewer-toolbar">
          <div class="ide-viewer-name">${escapeHtml(displayName)}</div>
          <button class="ide-viewer-action" onclick="_wsSaveToDisk('${escapeHtml(filePath)}', '${escapeHtml(displayName)}')">⬇ DOWNLOAD</button>
        </div>
        <div class="ide-viewer-stage">
          <img src="${fetchUrl}" class="ide-viewer-img" alt="${escapeHtml(displayName)}">
        </div>
      </div>`;
    return;
  }

  if (ext === 'pdf') {
    container.innerHTML = `
      <div class="ide-viewer-wrap">
        <div class="ide-viewer-toolbar">
          <div class="ide-viewer-name">${escapeHtml(displayName)}</div>
          <a href="${fetchUrl}" target="_blank" class="ide-viewer-action">↗ NEW TAB</a>
        </div>
        <iframe src="${fetchUrl}" class="ide-viewer-iframe"></iframe>
      </div>`;
    return;
  }

  if (ext === 'epub') {
    container.innerHTML = '<div class="lib-loading"><span>Loading book...</span></div>';
    const item = { type: 'epub', file: fetchUrl.replace(/^\//, ''), name: displayName, always_available: true };
    // Temporarily redirect libMain to our container for the EPUB reader
    const origLibMain = (typeof libMain !== 'undefined') ? libMain : null;
    libMain = container;
    if (typeof renderEpubReader === 'function') renderEpubReader(item);
    setTimeout(() => { if (origLibMain) libMain = origLibMain; }, 100);
    return;
  }

  // Fallback
  container.innerHTML = `<div class="ide-empty-state">Cannot preview this file type (.${ext})</div>`;
}

async function _workspaceSaveFile() {
  if (!_wsCurrentFile || !_wsMonacoInstance) return;
  if (!_wsCurrentFile.saveUrl) {
    if (typeof showToast === 'function') showToast('Read-only file — cannot save', 3000);
    return;
  }
  const content = _wsMonacoInstance.getValue();
  try {
    const headers = { 'Content-Type': 'application/octet-stream' };

    // F-07: For system file saves, non-safe files require master password auth
    if (_wsCurrentFile.source === 'system') {
      const SAFE_FILES = new Set([
        'ui/style.css', 'ui/index.html', 'ui/config.js', 'ui/prompts.js',
        'ui/help.js', 'ui/icons.js', 'config.json', 'content/prompts.json',
      ]);
      if (!SAFE_FILES.has(_wsCurrentFile.path)) {
        const pw = await _unlockSession();
        if (!pw) return; // User cancelled
        headers['X-Password'] = encodeURIComponent(pw);
      }
    }

    const res = await fetch(_wsCurrentFile.saveUrl, {
      method: 'PUT',
      headers,
      body: content,
    });
    if (res.ok) {
      _wsOriginalContent = content;
      _wsDirty = false;
      _updateDirtyIndicator();
      if (typeof showToast === 'function') showToast(`Saved: ${_wsCurrentFile.path}`);
    } else {
      const err = await res.json().catch(() => ({}));
      if (typeof showToast === 'function') showToast(`⚠ Save failed: ${err.error || 'unknown'}`);
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('⚠ Save error');
  }
}

function _updateDirtyIndicator() {
  const ind = document.getElementById('ideDirtyIndicator');
  if (ind) ind.style.display = _wsDirty ? 'inline' : 'none';
}

// ── Helpers ──────────────────────────────────────────────────

// _esc / _fmtSize: aliases for canonical functions in library.js (loaded before this file)
const _esc = escapeHtml;
const _fmtSize = _fmtBytes;

function _fileIcon(ext) {
  const icons = { js: '📜', py: '🐍', html: '🌐', css: '🎨', json: '📋', md: '📝', txt: '📄', sh: '⚡', bat: '⚡', command: '⚡', epub: '📚', pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', mp3: '🎵', mp4: '🎬', zip: '📦', bkv: '🔒', gz: '📦' };
  return icons[ext] || '📄';
}

function _isCodeFile(ext) {
  return ['js','py','html','css','json','md','txt','csv','sh','bat','command','xml','yml','yaml','toml','cfg','ini','sql','rb','go','rs','ts','tsx','jsx','c','cpp','h','hpp','java','kt','swift','r','lua','pl','php','cs','ps1','psm1','log','env','gitignore','dockerfile','makefile'].includes(ext);
}

function _canViewFile(ext) {
  return ['epub','pdf','jpg','jpeg','png','gif','svg','webp','bmp','tiff','txt','md'].includes(ext) || _isCodeFile(ext);
}

function _getFileType(ext) {
  if (['jpg','jpeg','png','gif','svg','webp','bmp','tiff'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'txt') return 'text';
  if (_isCodeFile(ext)) return 'code';
  return 'file';
}

// ── Vault Import (.bkv) ─────────────────────────────────────

function _showVaultImportModal() {
  const existing = document.getElementById('vaultImportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vaultImportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:500px">
      <div class="export-modal-icon">⬆</div>
      <div class="export-modal-title">IMPORT .BKV FILES</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>Import <code>.bkv</code> files from a previous export or another Blackout Drive back into your encrypted vault.</p>
        <p style="margin-top:8px;opacity:0.7;font-size:0.8rem">Files will be decrypted with the source password and re-encrypted with your current vault password.</p>
      </div>

      <div class="export-modal-fields" style="margin-top:12px">
        <label style="font-size:0.75rem;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase">Password these files were encrypted with</label>
        <input type="password" id="vaultImportPassword" class="export-modal-input" autocomplete="off"
               data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Source password">
        <div style="font-size:0.7rem;opacity:0.45;margin-top:2px;padding-left:2px">Pre-filled with your current master password</div>
      </div>

      <div class="vault-import-dropzone" id="vaultImportDropzone">
        <div class="vault-import-dropzone-icon">📂</div>
        <div class="vault-import-dropzone-text">Drop .bkv files here or click to browse</div>
      </div>

      <div class="vault-import-file-list" id="vaultImportFileList" style="display:none"></div>

      <div class="export-modal-error" id="vaultImportError"></div>

      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="vaultImportCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="vaultImportConfirmBtn" disabled>IMPORT .BKV</button>
      </div>

      <div class="export-modal-progress" id="vaultImportProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="vaultImportProgressText">Importing...</span>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Pre-fill with current master password
  const pwInput = document.getElementById('vaultImportPassword');
  const sessionPw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : '';
  if (sessionPw) pwInput.value = sessionPw;

  let selectedFiles = [];

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.bkv';
  fileInput.style.display = 'none';
  overlay.appendChild(fileInput);

  const dropzone = document.getElementById('vaultImportDropzone');
  const fileList = document.getElementById('vaultImportFileList');
  const confirmBtn = document.getElementById('vaultImportConfirmBtn');
  const errorEl = document.getElementById('vaultImportError');

  function updateFileList() {
    if (selectedFiles.length === 0) {
      fileList.style.display = 'none';
      confirmBtn.disabled = true;
      return;
    }
    fileList.style.display = 'block';
    confirmBtn.disabled = false;
    let html = `<div class="vault-import-file-count">${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected</div>`;
    selectedFiles.forEach((f, i) => {
      html += `<div class="vault-import-file-item">
        <span class="vault-import-file-name">🔒 ${_esc(f.name)}</span>
        <span class="vault-import-file-size">${_fmtSize(f.size)}</span>
        <button class="vault-import-file-remove" data-idx="${i}" title="Remove">✕</button>
      </div>`;
    });
    fileList.innerHTML = html;
    fileList.querySelectorAll('.vault-import-file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        updateFileList();
      });
    });
  }

  // Click to browse
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const newFiles = Array.from(fileInput.files).filter(f => f.name.endsWith('.bkv'));
    selectedFiles = [...selectedFiles, ...newFiles];
    updateFileList();
    fileInput.value = '';
  });

  // Drag and drop
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('vault-import-dropzone--active'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('vault-import-dropzone--active'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('vault-import-dropzone--active');
    const newFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.bkv'));
    if (newFiles.length === 0) {
      errorEl.textContent = '⚠ Only .bkv files can be imported.';
      return;
    }
    errorEl.textContent = '';
    selectedFiles = [...selectedFiles, ...newFiles];
    updateFileList();
  });

  // Cancel
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('vaultImportCancelBtn').addEventListener('click', () => overlay.remove());

  // Import
  confirmBtn.addEventListener('click', async () => {
    const sourcePw = pwInput.value;
    if (!sourcePw) {
      errorEl.textContent = '⚠ Enter the password these files were encrypted with.';
      return;
    }
    errorEl.textContent = '';
    await _executeVaultImport(selectedFiles, sourcePw, overlay);
  });
}

async function _executeVaultImport(files, sourcePassword, modal) {
  const progress = document.getElementById('vaultImportProgress');
  const progressText = document.getElementById('vaultImportProgressText');
  const actions = modal.querySelector('.export-modal-actions');
  const errorEl = document.getElementById('vaultImportError');

  actions.style.display = 'none';
  progress.style.display = 'flex';

  const vaultPw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : '';
  if (!vaultPw) {
    errorEl.textContent = '⚠ Vault is locked. Please unlock first.';
    actions.style.display = 'flex';
    progress.style.display = 'none';
    return;
  }

  let imported = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progressText.textContent = `Importing ${i + 1} of ${files.length}: ${file.name}...`;

    try {
      const res = await fetch('/api/files/locked/import-bkv', {
        method: 'POST',
        headers: {
          'X-Password': encodeURIComponent(vaultPw),
          'X-Source-Password': encodeURIComponent(sourcePassword),
          'Content-Length': file.size.toString(),
        },
        body: file,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        imported++;
      } else {
        failed++;
        _logger_ws(`Import failed for ${file.name}: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      failed++;
      _logger_ws(`Import error for ${file.name}: ${e.message}`);
    }
  }

  modal.remove();

  if (failed === 0) {
    if (typeof showToast === 'function') showToast(`✓ Imported ${imported} file${imported !== 1 ? 's' : ''} to vault`, 4000);
  } else {
    if (typeof showToast === 'function') showToast(`⚠ Imported ${imported}, failed ${failed}`, 5000);
  }

  _renderFileBrowser();
}

function _logger_ws(msg) {
  if (typeof console !== 'undefined') console.warn('[workspace]', msg);
}

// Re-render workspace when Developer Mode is toggled in Settings
document.addEventListener('blackout:devmode-changed', () => {
  if (_wsOpen && !_wsIdeOpen) _renderFileBrowser();
});
