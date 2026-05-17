/**
 * The Blackout Drive — Workspace Panel
 * Handles file browsing, IDE mode, and Engine access.
 * Uses shared viewer infrastructure from library.js (openUserFile, Monaco).
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
const _LIBRARY_EXTS = new Set(['epub','pdf','txt','md','jpg','jpeg','png','gif','webp','svg']);
function _isLibraryCompatible(ext) { return _LIBRARY_EXTS.has((ext || '').toLowerCase()); }

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
  // Header is clean — just BACK + title. Actions moved inline below tabs.
  actions.innerHTML = '';

  main.innerHTML = '<div class="lib-loading"><span>Scanning your files...</span></div>';

  // Fetch files
  const endpoint = _wsTab === 'unlocked' ? '/api/files/unlocked' : '/api/files/locked';
  const url = `${endpoint}?path=${encodeURIComponent(_wsPath)}`;
  let files = [];
  try {
    const res = await fetch(url);
    if (res.ok) { const d = await res.json(); files = d.files || []; }
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

  // Engine pinned entry (always visible at root — above tabs)
  if (!_wsPath) {
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

  // Tab bar — larger pills with icons
  html += `
  <div class="ws-tabs">
    <button class="ws-tab ${_wsTab === 'unlocked' ? 'ws-tab--active' : ''}" onclick="_wsTab='unlocked';_wsPath='';_saveWsState();_renderFileBrowser()">📂 UNLOCKED</button>
    <button class="ws-tab ${_wsTab === 'locked' ? 'ws-tab--active' : ''}" onclick="_wsTab='locked';_wsPath='';_saveWsState();_renderFileBrowser()">🔒 LOCKED</button>
  </div>`;

  // Action row: breadcrumbs + upload/explorer/refresh
  html += `
  <div class="ws-action-row">
    <div class="hub-breadcrumbs">${crumbHtml}</div>
    <div class="ws-action-buttons">
      <button class="ws-upload-btn" onclick="_showUploadModal()">+ UPLOAD</button>
      <button class="ws-explorer-btn" onclick="_openExplorerMode()" title="Tree view explorer">📁 EXPLORER</button>
      <button class="ws-refresh-btn" onclick="_renderFileBrowser()" title="Refresh">↻</button>
    </div>
  </div>`;

  // Info for locked tab — compact banner
  if (_wsTab === 'locked' && !_wsPath) {
    html += `<div class="ws-locked-banner">
      <span>🔒</span>
      <div><strong>ENCRYPTED VAULT</strong> — Files are protected at rest. Click <strong>🔓 OPEN</strong> to decrypt and view.</div>
    </div>`;
  }

  // File list
  if (files.length === 0) {
    html += `<div class="ws-empty-state">
      <div class="ws-empty-icon">${_wsTab === 'locked' ? '🔒' : '📂'}</div>
      <div class="ws-empty-title">No files yet</div>
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
      const icon = isDir ? '📁' : (_wsTab === 'locked' ? '🔒' : _fileIcon(ext));
      const sizeStr = !isDir && f.size != null ? _fmtSize(f.size) : '';
      const canView = !isDir && (_wsTab === 'locked' ? true : _canViewFile(ext));
      const canEdit = !isDir && _isCodeFile(ext);

      html += `<div class="myfile-item ${isDir ? 'myfile-item--dir' : ''}" data-path="${_esc(fullPath)}">
        <span class="myfile-icon">${icon}</span>
        <div class="myfile-info">
          <div class="myfile-name">${_esc(f.name)}</div>
          <div class="myfile-meta">${isDir ? 'Folder' : sizeStr}</div>
        </div>
        <div class="myfile-actions">
          ${isDir && _wsTab === 'unlocked' ? `<button class="myfile-open-btn" data-ws-action="ide">EDITOR</button>` : ''}
          ${isDir ? `<button class="myfile-open-btn" data-ws-action="enter">ENTER →</button>` : ''}
          ${!isDir && _wsTab === 'unlocked' && _isLibraryCompatible(ext) ? `<button class="myfile-open-btn ws-library-btn" data-ws-action="library" title="Add to Library">${ICONS.library}</button>` : ''}
          ${canView || canEdit ? `<button class="myfile-open-btn" data-ws-action="view">${_wsTab === 'locked' ? '🔓 OPEN' : 'OPEN'}</button>` : ''}
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
      if (action === 'enter') { _wsPath = path; _renderFileBrowser(); }
      else if (action === 'ide') { _openIde(_wsTab, path, path.split('/').pop()); }
      else if (action === 'view') {
        if (_wsTab === 'locked') _wsDecryptAndView(path);
        else _wsViewFile(path);
      }
      else if (action === 'library') { _wsSendToLibrary(path); }
      else if (action === 'delete') { _wsDeleteFile(path); }
    });
  });
}

function _wsViewFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  const filePath = `api/files/${_wsTab}/${path}`;
  const type = _getFileType(ext);
  const name = path.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

  if (_isCodeFile(ext)) {
    // Open in Monaco within workspace
    _openIde(_wsTab, _wsPath || '', _wsPath ? _wsPath.split('/').pop() : 'Files');
    const relFile = _wsPath && path.startsWith(_wsPath + '/') ? path.slice(_wsPath.length + 1) : path;
    setTimeout(() => _ideOpenFile(relFile, ext), 300);
    return;
  }

  // For non-code files, render viewer directly into workspaceMain
  _wsRenderViewer(filePath, type, name);
}

/**
 * Decrypt a locked file and view it inside the workspace.
 */
async function _wsDecryptAndView(filepath) {
  let password;
  try {
    password = await _requireMasterPassword();
  } catch {
    return; // User cancelled
  }

  if (typeof showToast === 'function') showToast('Decrypting...', 10000);

  try {
    const res = await fetch('/api/files/locked/decrypt-to-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filepath, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (typeof showToast === 'function') {
        showToast(data.error || 'Decryption failed', 4000);
      }
      if (data.error && data.error.toLowerCase().includes('password')) {
        try { sessionStorage.removeItem(_MP_SESSION_KEY); } catch {}
      }
      return;
    }

    // Track the temp session for cleanup
    if (typeof _activeTempSession !== 'undefined') _activeTempSession = data.session;

    const filePath = data.tempPath;
    const ext = (data.filename.split('.').pop() || '').toLowerCase();
    const fileType = _getFileType(ext);
    const displayName = data.filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

    if (typeof showToast === 'function') showToast('File decrypted', 2000);

    // Code files → open in workspace Monaco IDE with the temp URL
    if (_isCodeFile(ext)) {
      _wsRenderCodeViewer(filePath, ext, displayName);
      return;
    }

    // Non-code files → render viewer directly in workspace
    _wsRenderViewer(filePath, fileType, displayName);
  } catch (e) {
    console.warn('Decrypt error:', e);
    if (typeof showToast === 'function') showToast('Decryption failed', 3000);
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

  const fileUrl = '/' + filePath;
  const esc = escapeHtml;

  if (fileType === 'image') {
    main.innerHTML = `
      <div style="padding:0">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <button class="lib-back-btn" onclick="_renderFileBrowser()">← BACK</button>
          <div style="font-family:var(--font-mono);font-size:12px;letter-spacing:1px;color:var(--text-primary)">${esc(displayName)}</div>
          <div style="flex:1"></div>
          <a href="${fileUrl}" download class="hub-action-btn" style="text-decoration:none;font-size:11px">⬇ DOWNLOAD</a>
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
          <a href="${fileUrl}" target="_blank" class="hub-action-btn" style="text-decoration:none;font-size:11px">↗ NEW TAB</a>
        </div>
        <iframe src="${fileUrl}" style="flex:1;border:none;background:#2a2a2a;min-height:500px"></iframe>
      </div>`;
    return;
  }

  if (fileType === 'epub') {
    // For EPUB, use the library's built-in reader by swapping libMain briefly
    const origLibMain = (typeof libMain !== 'undefined') ? libMain : null;
    libMain = main;
    const item = { type: 'epub', file: filePath, name: displayName, always_available: true };
    if (typeof renderEpubReader === 'function') {
      main.innerHTML = '<div class="lib-loading"><span>Loading book...</span></div>';
      renderEpubReader(item);
    }
    setTimeout(() => { if (origLibMain) libMain = origLibMain; }, 100);
    return;
  }

  // text / unknown → fetch and display as plain text
  main.innerHTML = '<div class="lib-loading"><span>Loading...</span></div>';
  fetch(fileUrl)
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

/**
 * Render a code file viewer in workspaceMain using Monaco (read-only for decrypted temps).
 */
async function _wsRenderCodeViewer(filePath, ext, displayName) {
  const main = document.getElementById('workspaceMain');
  if (!main) return;

  // Expand to full width for code viewer
  main.classList.add('ws-viewer-active');

  const fileUrl = '/' + filePath;
  const esc = escapeHtml;
  const langMap = { js:'javascript', py:'python', html:'html', css:'css', json:'json', md:'markdown', sh:'shell', bat:'bat', txt:'plaintext', xml:'xml', yml:'yaml', yaml:'yaml', toml:'plaintext', cfg:'plaintext', ini:'ini', command:'shell' };
  const lang = langMap[ext] || 'plaintext';

  main.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <button class="lib-back-btn" onclick="_renderFileBrowser()">← BACK</button>
        <div style="font-family:var(--font-mono);font-size:12px;letter-spacing:1px;color:var(--text-primary)">${esc(displayName)}</div>
        <div style="font-size:10px;padding:3px 8px;background:rgba(200,160,74,0.15);color:var(--amber);border-radius:4px;font-family:var(--font-mono);letter-spacing:1px">${lang.toUpperCase()}</div>
        <div style="font-size:10px;padding:3px 8px;background:rgba(255,255,255,0.06);color:var(--text-secondary);border-radius:4px;font-family:var(--font-mono)">READ-ONLY</div>
      </div>
      <div id="wsDecryptedEditor" style="flex:1;min-height:400px">
        <div class="lib-loading"><span>Loading editor...</span></div>
      </div>
    </div>`;

  try {
    const [content, monaco] = await Promise.all([
      fetch(fileUrl).then(r => r.text()),
      _ensureMonaco(),
    ]);

    const container = document.getElementById('wsDecryptedEditor');
    if (!container) return;
    container.innerHTML = '';

    _defineBlackoutTheme(monaco);

    monaco.editor.create(container, {
      value: content, language: lang, theme: 'blackout-tactical',
      readOnly: true, minimap: { enabled: true }, scrollBeyondLastLine: false,
      fontSize: 13, fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
      lineNumbers: 'on', renderLineHighlight: 'all', wordWrap: 'on',
      automaticLayout: true, padding: { top: 12 },
    });
  } catch (err) {
    // Fallback: show plain text
    try {
      const text = await fetch(fileUrl).then(r => r.text());
      const container = document.getElementById('wsDecryptedEditor');
      if (container) {
        container.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--font-mono);line-height:1.6;color:var(--text-primary);font-size:13px;padding:16px;margin:0">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
      }
    } catch { if (typeof showToast === 'function') showToast('Error loading file'); }
  }
}

async function _wsDeleteFile(path) {
  const name = path.split('/').pop();
  // Use themed modal if available
  if (typeof _showThemedConfirm === 'function') {
    const ok = await _showThemedConfirm(`Delete "${name}"?`, 'This cannot be undone.');
    if (!ok) return;
  } else if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/files/${_wsTab}/${encodeURIComponent(path)}`, { method: 'DELETE' });
    if (res.ok) {
      if (typeof showToast === 'function') showToast(`Deleted: ${name}`);
      _renderFileBrowser();
    } else {
      if (typeof showToast === 'function') showToast('⚠ Failed to delete');
    }
  } catch { if (typeof showToast === 'function') showToast('⚠ Error deleting file'); }
}

/**
 * Send an unlocked file to the Library (copy to USER_DATA/content/).
 */
async function _wsSendToLibrary(path) {
  const name = path.split('/').pop();
  try {
    const res = await fetch('/api/files/send-to-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'unlocked', path }),
    });
    const data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast(`📚 "${name}" added to Library`, 3000);
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
    } else {
      // Use file tree API — server expects path=<source>/<rootPath>
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

  // Reset editor
  const container = document.getElementById('ideEditorContainer');
  container.style.display = 'none';
  document.getElementById('ideEmptyState').style.display = 'flex';
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

  // Determine URLs
  let fetchUrl, saveUrl;
  if (_wsIdeSource === 'system') {
    fetchUrl = `/api/system/files/${encodeURIComponent(filePath)}`;
    saveUrl = fetchUrl;
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
      const res = await fetch(fetchUrl);
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
function _ideViewBinary(fetchUrl, ext, filePath) {
  const container = document.getElementById('ideEditorContainer');
  const emptyState = document.getElementById('ideEmptyState');
  if (!container) return;

  // Dispose Monaco if active
  if (_wsMonacoInstance) { _wsMonacoInstance.dispose(); _wsMonacoInstance = null; }

  emptyState.style.display = 'none';
  container.style.display = 'flex';

  const displayName = filePath.split('/').pop();
  const imageExts = ['jpg','jpeg','png','gif','svg','webp','bmp','tiff'];

  if (imageExts.includes(ext)) {
    container.innerHTML = `
      <div class="ide-viewer-wrap">
        <div class="ide-viewer-toolbar">
          <div class="ide-viewer-name">${escapeHtml(displayName)}</div>
          <a href="${fetchUrl}" download class="ide-viewer-action">⬇ DOWNLOAD</a>
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
  const content = _wsMonacoInstance.getValue();
  try {
    const res = await fetch(_wsCurrentFile.saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
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
  const icons = { js: '📜', py: '🐍', html: '🌐', css: '🎨', json: '📋', md: '📝', txt: '📄', sh: '⚡', bat: '⚡', command: '⚡', epub: '📚', pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', mp3: '🎵', mp4: '🎬', zip: '📦', '7z': '📦', gz: '📦' };
  return icons[ext] || '📄';
}

function _isCodeFile(ext) {
  return ['js','py','html','css','json','md','txt','sh','bat','command','xml','yml','yaml','toml','cfg','ini','sql','rb','go','rs','ts','tsx','jsx','c','cpp','h','hpp','java','kt','swift','r','lua','pl','php','cs','ps1','psm1','log','env','gitignore','dockerfile','makefile'].includes(ext);
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
