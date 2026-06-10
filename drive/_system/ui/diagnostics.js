/**
 * The Blackout Drive — Diagnostics Panel
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 * Fetches /api/diagnostics and renders a status panel with:
 *  - AI Engine (model, tier, RAM, auto-detect status)
 *  - Disk space
 *  - Content stats
 *  - OS / platform info
 *  - Connectivity status
 *  - RUN CHECK + COPY REPORT buttons
 */
'use strict';

let _diagOpen = false;
let _diagData = null;

function toggleDiagnosticsPanel(force) {
  const panel = document.getElementById('diagPanel');
  if (!panel) return;
  const opening = (force === undefined) ? !_diagOpen : !!force;
  if (opening) {
    if (typeof _closeSidePanels === 'function') _closeSidePanels(true);
    document.body.classList.add('has-left-panel');     // push main content right
    if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('statusNavBtn');
    if (!_diagData) runDiagnostics();
  } else {
    document.body.classList.remove('has-left-panel');  // restore main content width
    if (typeof _getActiveViewBtn === 'function') _setActiveSidebarBtn(_getActiveViewBtn());
    else if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('chatNavBtn');
  }
  _diagOpen = opening;
  panel.classList.toggle('diag-panel-open', _diagOpen);
}

async function runDiagnostics() {
  const body = document.getElementById('diagBody');
  const btn  = document.getElementById('diagRunBtn');
  if (!body) return;
  body.innerHTML = '<div class="diag-loading">Running checks...</div>';
  if (btn) { btn.disabled = true; btn.textContent = '↻ RUNNING...'; }

  try {
    const res = await fetch('/api/diagnostics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _diagData = await res.json();
    _renderDiag(_diagData);
  } catch (err) {
    body.innerHTML = `<div class="diag-error">Could not reach server: ${err.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ RUN CHECK'; }
  }

  // Also check Worker catalog connectivity
  _checkWorkerStatus();
}

async function _checkWorkerStatus() {
  const workerUrl = (window.BLACKOUT_CONFIG && window.BLACKOUT_CONFIG.content && window.BLACKOUT_CONFIG.content.remoteCatalogUrl)
    || 'https://blackout-catalog.hutton-benj.workers.dev';
  const els = document.querySelectorAll('.diag-worker-status');
  if (els.length === 0) return;
  try {
    const res = await fetch(workerUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const packCount = (data.packs || []).length;
      const fileCount = (data.packs || []).reduce((a, p) => a + (p.files || []).length, 0);
      els.forEach(el => el.innerHTML = _dot('ok') + ` AVAILABLE &mdash; ${packCount} packs, ${fileCount} files`);
    } else {
      els.forEach(el => el.innerHTML = _dot('warn') + ' REACHABLE BUT ERROR');
    }
  } catch (_) {
    els.forEach(el => el.innerHTML = _dot('miss') + ' UNREACHABLE (uses local fallback)');
  }
}

function _dot(state) {
  const colors = { ok: '#4caf79', warn: 'var(--amber)', miss: '#cc4444' };
  const labels = { ok: '●', warn: '●', miss: '●' };
  return `<span style="color:${colors[state]};font-size:14px">${labels[state]}</span>`;
}

/** Make platform info human-readable */
function _friendlyPlatform(os, arch) {
  const archLabel = (a) => {
    if (!a) return '';
    if (a === 'arm64' || a === 'aarch64') return 'Apple Silicon';
    if (a === 'x86_64' || a === 'AMD64') return 'Intel';
    return a;
  };
  if (!os) return '—';
  if (os === 'Darwin') return `macOS (${archLabel(arch)})`;
  if (os === 'Windows') return `Windows (${archLabel(arch)})`;
  if (os === 'Linux') return `Linux (${archLabel(arch)})`;
  return `${os} ${arch || ''}`;
}

/** Make engine tier human-readable */
function _friendlyTier(tier) {
  if (!tier) return '—';
  if (tier === 'max') return 'Performance';
  if (tier === 'base') return 'Compact';
  return tier;
}

/** Make engine source human-readable */
function _friendlySource(source) {
  if (!source) return '';
  if (source === 'auto') return 'Auto-detected';
  if (source === 'override') return 'Manual selection';
  return source;
}

function _renderDiag(d) {
  const body = document.getElementById('diagBody');
  if (!body) return;

  const ollamaOk   = d.ollama && d.ollama.running;
  const modelOk    = d.ollama && d.ollama.model_loaded;
  const diskOk     = d.disk && (d.disk.free_gb > 1);
  const engine     = d.engine || {};

  const diskUsedPct = d.disk
    ? Math.round((d.disk.used_gb / d.disk.total_gb) * 100)
    : 0;

  // Pluralize helper
  const pl = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  body.innerHTML = `
    <!-- Section: AI Engine -->
    <div class="diag-section">
      <div class="diag-section-title">AI ENGINE</div>
      <div class="diag-row">
        <span class="diag-label">Status</span>
        <span class="diag-value">${ollamaOk ? _dot('ok') + ' RUNNING' : _dot('miss') + ' NOT RUNNING'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Active model</span>
        <span class="diag-value">${modelOk
          ? _dot('ok') + ' blackout-beacon' + (engine.modelName ? ' (' + engine.modelName + ')' : '')
          : _dot('miss') + ' NOT LOADED'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Engine tier</span>
        <span class="diag-value diag-dim">${_friendlyTier(engine.tier)}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Selection</span>
        <span class="diag-value diag-dim">${_friendlySource(engine.source)}</span>
      </div>
      ${engine.detectedRamGB
        ? `<div class="diag-row"><span class="diag-label">Host RAM</span><span class="diag-value diag-dim">${engine.detectedRamGB} GB</span></div>`
        : ''}
      ${d.ollama && d.ollama.version
        ? `<div class="diag-row"><span class="diag-label">Ollama version</span><span class="diag-value diag-dim">${d.ollama.version}</span></div>`
        : ''}
    </div>

    <!-- Section: Storage -->
    <div class="diag-section">
      <div class="diag-section-title">STORAGE</div>
      <div class="diag-row">
        <span class="diag-label">Free space</span>
        <span class="diag-value">${diskOk ? _dot('ok') : _dot('warn')} ${d.disk ? d.disk.free_gb.toFixed(1) + ' GB free' : 'Unknown'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Drive total</span>
        <span class="diag-value diag-dim">${d.disk ? d.disk.total_gb.toFixed(1) + ' GB' : '—'}</span>
      </div>
      <div class="diag-disk-bar">
        <div class="diag-disk-fill" style="width:${diskUsedPct}%"></div>
      </div>
      <div class="diag-disk-label">${diskUsedPct}% used</div>
    </div>

    <!-- Section: Content -->
    <div class="diag-section">
      <div class="diag-section-title">CONTENT</div>
      <div class="diag-row">
        <span class="diag-label">Saved conversations</span>
        <span class="diag-value diag-dim">${d.conversations ? d.conversations.count : '—'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Library files</span>
        <span class="diag-value diag-dim">${d.content ? pl(d.content.library_files || d.content.file_count, 'file') : '—'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Workspace files</span>
        <span class="diag-value diag-dim">${d.content && d.content.user_files != null ? pl(d.content.user_files, 'file') : '0 files'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Content size</span>
        <span class="diag-value diag-dim">${d.content && d.content.total_size_mb ? d.content.total_size_mb.toFixed(0) + ' MB' : '—'}</span>
      </div>
    </div>

    <!-- Section: System -->
    <div class="diag-section">
      <div class="diag-section-title">SYSTEM</div>
      <div class="diag-row">
        <span class="diag-label">Platform</span>
        <span class="diag-value diag-dim">${d.platform ? _friendlyPlatform(d.platform.os, d.platform.arch) : '—'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Drive version</span>
        <span class="diag-value diag-dim">${d.version || '—'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Edition</span>
        <span class="diag-value diag-dim">${d.edition ? d.edition.charAt(0).toUpperCase() + d.edition.slice(1) : '—'}</span>
      </div>
      <div class="diag-row">
        <span class="diag-label">Last checked</span>
        <span class="diag-value diag-dim">${new Date().toLocaleTimeString()}</span>
      </div>
    </div>

    <!-- Section: Connectivity -->
    <div class="diag-section">
      <div class="diag-section-title">CONNECTIVITY</div>
      <div class="diag-row">
        <span class="diag-label">Mode</span>
        <span class="diag-value" id="diag-online-toggle-label">
          ${(typeof isOnlineModeEnabled === 'function' && isOnlineModeEnabled())
            ? '<span style="color:#788a4c">ONLINE</span>'
            : '<span style="color:var(--amber-dim)">NETWORK LOCKED</span>'}
        </span>
      </div>
      <div class="diag-row" id="diag-worker-row" style="${(typeof isOnlineModeEnabled === 'function' && isOnlineModeEnabled()) ? '' : 'opacity:0.4'}">
        <span class="diag-label">Catalog server</span>
        <span class="diag-value diag-worker-status">Checking...</span>
      </div>
      <div class="diag-row" style="margin-top: 2px;">
        <span class="diag-label diag-dim" style="font-size:10px">Toggle via Network Lock in Settings (requires Blackout Protocol OFF)</span>
      </div>
    </div>
  `;
}

function exportDiagnostics() {
  if (!_diagData) {
    showToast('Run a check first.');
    return;
  }
  const d = _diagData;
  const engine = d.engine || {};
  const report = [
    '=== BLACKOUT DRIVE SYSTEM REPORT ===',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Version: ${d.version || 'unknown'}`,
    `Edition: ${d.edition || 'unknown'}`,
    `Platform: ${d.platform ? _friendlyPlatform(d.platform.os, d.platform.arch) : 'unknown'}`,
    '',
    '--- AI ENGINE ---',
    `Status: ${d.ollama ? (d.ollama.running ? 'Running' : 'Stopped') : 'Unknown'}`,
    `Active model: ${engine.modelName || (d.ollama ? d.ollama.model_name : 'none')}`,
    `Engine tier: ${_friendlyTier(engine.tier)}`,
    `Selection: ${_friendlySource(engine.source)}`,
    `Host RAM: ${engine.detectedRamGB ? engine.detectedRamGB + ' GB' : 'unknown'}`,
    `Ollama version: ${d.ollama ? d.ollama.version : 'unknown'}`,
    '',
    '--- STORAGE ---',
    `Total: ${d.disk ? d.disk.total_gb.toFixed(1) + ' GB' : 'unknown'}`,
    `Free: ${d.disk ? d.disk.free_gb.toFixed(1) + ' GB' : 'unknown'}`,
    '',
    '--- CONTENT ---',
    `Library files: ${d.content ? d.content.library_files || d.content.file_count : 0}`,
    `User uploads: ${d.content ? d.content.user_files : 0}`,
    `Content size: ${d.content ? d.content.total_size_mb.toFixed(0) + ' MB' : '0 MB'}`,
    `Conversations: ${d.conversations ? d.conversations.count : 0}`,
  ].join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(report)
      .then(() => showToast('✓ Report copied to clipboard.'))
      .catch(() => showToast('⚠ Copy failed — try a different browser.'));
  } else {
    // Fallback: create a temporary input for legacy browsers
    const el = document.createElement('textarea');
    el.value = report;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
      const ok = document.execCommand('copy'); // legacy fallback only
      showToast(ok ? '✓ Report copied.' : '⚠ Copy failed — select and copy manually.');
    } catch { showToast('⚠ Copy failed — select and copy manually.'); }
    el.remove();
  }
}
