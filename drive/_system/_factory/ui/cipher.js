/**
 * The Blackout Drive — Cipher Studio
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: AES-256-GCM encryption for text, files, and folders.
 * All output uses the proprietary .bkv format.
 *
 * This module registers itself via registerTool() at load time.
 * No modifications to tools.js or index.html structure are needed.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════
let _cipherFileSelected = null;   // File object or { _isFolder: true, _zip: Blob, name, size }
let _cipherFolderMode = false;
let _cipherMode = 'text';         // 'text' or 'files'

// ═══════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════

function _cipherTogglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🔒'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

function _cipherCopy(elId) {
  const el = document.getElementById(elId);
  if (!el || !el.value) return;
  navigator.clipboard.writeText(el.value).then(() => {
    const btn = el.parentElement.querySelector('.cipher-copy-btn');
    if (btn) { const orig = btn.textContent; btn.textContent = 'COPIED!'; setTimeout(() => btn.textContent = orig, 1500); }
  }).catch(() => {
    el.select(); document.execCommand('copy');
  });
}

function _cipherFmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ═══════════════════════════════════════════════════════════
// RENDER — Mode-switched view
// ═══════════════════════════════════════════════════════════

function _cipherRender(container) {
  container.innerHTML = '';

  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  content.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">ENCRYPT / DECRYPT</div>
      <div class="cipher-desc">
        Securely encrypt text, files, or entire folders with AES-256-GCM encryption.
        There are no file size limits. All encrypted files are saved in the secure <code>.bkv</code> format,
        which can only be unlocked by another Blackout Drive.
      </div>

      <!-- ── Mode selector ── -->
      <div class="cipher-mode-selector" id="cipherModeSelector">
        <button class="cipher-mode-btn ${_cipherMode === 'text' ? 'cipher-mode-btn--active' : ''}" id="cipherModeText" onclick="_cipherSwitchMode('text')">
          <span class="cipher-mode-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          </span>
          <span class="cipher-mode-label">TEXT</span>
          <span class="cipher-mode-hint">Encrypt or decrypt typed messages</span>
        </button>
        <button class="cipher-mode-btn ${_cipherMode === 'files' ? 'cipher-mode-btn--active' : ''}" id="cipherModeFiles" onclick="_cipherSwitchMode('files')">
          <span class="cipher-mode-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </span>
          <span class="cipher-mode-label">FILES & FOLDERS</span>
          <span class="cipher-mode-hint">Encrypt or decrypt files and folders</span>
        </button>
      </div>

      <!-- ── Shared password field ── -->
      <div class="cipher-form" style="margin-top:16px">
        <div class="cipher-field">
          <label class="hr-label">PASSWORD</label>
          <input class="hr-input cipher-password" id="cipherPass" type="password" placeholder="Enter encryption password" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other">
          <button class="cipher-toggle-pw" onclick="_cipherTogglePw('cipherPass', this)" title="Show/hide password">👁</button>
        </div>
      </div>
    </div>

    <!-- ════════════════ TEXT MODE ════════════════ -->
    <div class="cipher-mode-panel" id="cipherPanelText" style="${_cipherMode === 'text' ? '' : 'display:none'}">
      <div class="hr-section">
        <div class="cipher-form">
          <div class="cipher-field">
            <label class="hr-label">PLAINTEXT</label>
            <textarea class="hr-input cipher-textarea" id="cipherTextPlain" rows="5" placeholder="Type or paste the text you want to encrypt..." autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"></textarea>
          </div>
          <div class="cipher-actions">
            <button class="hr-btn" onclick="_cipherDoEncryptText()">🔒 ENCRYPT TEXT</button>
            <button class="hr-btn hr-btn--secondary" onclick="_cipherDoDecryptText()">🔓 DECRYPT TEXT</button>
          </div>
          <div class="cipher-field">
            <label class="hr-label">ENCRYPTED OUTPUT</label>
            <textarea class="hr-input cipher-textarea cipher-textarea--output" id="cipherTextOutput" rows="5" placeholder="Encrypted text will appear here..." readonly autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"></textarea>
            <button class="cipher-copy-btn" onclick="_cipherCopy('cipherTextOutput')">COPY</button>
          </div>
          <div class="cipher-status" id="cipherTextStatus"></div>

          <div class="cipher-text-instructions">
            <div class="cipher-instruction-title">How to use</div>
            <div class="cipher-instruction-step"><strong>To encrypt:</strong> Type your message above, enter a password, and click <em>Encrypt Text</em>. Copy the encrypted output to share it.</div>
            <div class="cipher-instruction-step"><strong>To decrypt:</strong> Paste the encrypted text into the <em>Encrypted Output</em> field, enter the password, and click <em>Decrypt Text</em>.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ════════════════ FILES & FOLDERS MODE ════════════════ -->
    <div class="cipher-mode-panel" id="cipherPanelFiles" style="${_cipherMode === 'files' ? '' : 'display:none'}">
      <div class="hr-section">
        <div class="cipher-form">
          <div style="display:flex;gap:8px;margin-bottom:4px">
            <button class="hr-btn ${!_cipherFolderMode ? '' : 'hr-btn--secondary'}" id="cipherModeFile" onclick="_cipherSetMode(false)" style="flex:1;font-size:0.7rem">📄 FILE</button>
            <button class="hr-btn ${_cipherFolderMode ? '' : 'hr-btn--secondary'}" id="cipherModeFolder" onclick="_cipherSetMode(true)" style="flex:1;font-size:0.7rem">📂 FOLDER</button>
          </div>
          <div class="cipher-file-dropzone" id="cipherFileDropzone">
            <div class="cipher-file-dropzone-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div class="cipher-file-dropzone-text" id="cipherFileDropText">${_cipherFolderMode ? 'Click to select a folder' : 'Drop a file here or click to browse'}</div>
            <div class="cipher-file-dropzone-hint">${_cipherFolderMode ? 'The entire folder will be zipped and encrypted' : 'Any file to encrypt, or a .bkv file to decrypt'}</div>
          </div>
          <div class="cipher-file-info" id="cipherFileInfo" style="display:none">
            <span class="cipher-file-info-name" id="cipherFileInfoName"></span>
            <span class="cipher-file-info-size" id="cipherFileInfoSize"></span>
            <button class="cipher-file-info-clear" onclick="_cipherFileClear()" title="Clear">✕</button>
          </div>
          <div class="cipher-actions">
            <button class="hr-btn" id="cipherEncryptFileBtn" onclick="_cipherDoEncryptFile()">🔒 ENCRYPT</button>
            <button class="hr-btn hr-btn--secondary" id="cipherDecryptFileBtn" onclick="_cipherDoDecryptFile()">🔓 DECRYPT .BKV</button>
          </div>
          <div class="cipher-file-progress" id="cipherFileProgress" style="display:none">
            <div class="export-modal-spinner"></div>
            <span id="cipherFileProgressText">Processing...</span>
          </div>
          <div class="cipher-status" id="cipherFileStatus"></div>

          <div class="cipher-text-instructions">
            <div class="cipher-instruction-title">How to use</div>
            <div class="cipher-instruction-step"><strong>To encrypt:</strong> Select a file or folder, enter a password, and click <em>Encrypt</em>. You will be prompted to choose where to save the secure <code>.bkv</code> file.</div>
            <div class="cipher-instruction-step"><strong>To decrypt:</strong> Select an encrypted <code>.bkv</code> file, enter its password, and click <em>Decrypt .bkv</em>. You will be asked where to save the unlocked contents.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ════════════════ HOW IT WORKS (always visible) ════════════════ -->
    <div class="hr-section">
      <div class="hr-section-title">HOW IT WORKS</div>
      <div class="cipher-info">
        <div class="cipher-info-row"><span class="cipher-info-key">Security Level</span><span class="cipher-info-val">AES-256-GCM Encryption</span></div>
        <div class="cipher-info-row"><span class="cipher-info-key">File Size Limit</span><span class="cipher-info-val">None — securely processes files of any size</span></div>
        <div class="cipher-info-row"><span class="cipher-info-key">Vault Compatible</span><span class="cipher-info-val">✓ Files work seamlessly with the Workspace → Locked tab</span></div>
        <div class="cipher-info-row"><span class="cipher-info-key">Password</span><span class="cipher-info-val">Independent — choose a unique password for each file</span></div>
        <div class="cipher-info-row"><span class="cipher-info-key">Folders</span><span class="cipher-info-val">Automatically zipped together before encryption</span></div>
      </div>
    </div>`;

  // Set up file/folder input
  _cipherSetupDropzone(content);

  // Restore selection if we had one
  if (_cipherFileSelected) {
    _cipherFileShowInfo(_cipherFileSelected);
  }
}

// ═══════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════

function _cipherSwitchMode(mode) {
  _cipherMode = mode;

  // Toggle panels
  const textPanel = document.getElementById('cipherPanelText');
  const filesPanel = document.getElementById('cipherPanelFiles');
  if (textPanel) textPanel.style.display = mode === 'text' ? '' : 'none';
  if (filesPanel) filesPanel.style.display = mode === 'files' ? '' : 'none';

  // Toggle button active states
  const textBtn = document.getElementById('cipherModeText');
  const filesBtn = document.getElementById('cipherModeFiles');
  if (textBtn) textBtn.className = 'cipher-mode-btn' + (mode === 'text' ? ' cipher-mode-btn--active' : '');
  if (filesBtn) filesBtn.className = 'cipher-mode-btn' + (mode === 'files' ? ' cipher-mode-btn--active' : '');
}

// ═══════════════════════════════════════════════════════════
// TEXT ENCRYPT / DECRYPT
// ═══════════════════════════════════════════════════════════

async function _cipherDoEncryptText() {
  const pass = document.getElementById('cipherPass').value;
  const plain = document.getElementById('cipherTextPlain').value;
  const status = document.getElementById('cipherTextStatus');
  const output = document.getElementById('cipherTextOutput');

  if (!pass) { status.textContent = '⚠ Enter a password.'; status.className = 'cipher-status cipher-status--err'; return; }
  if (!plain) { status.textContent = '⚠ Enter text to encrypt.'; status.className = 'cipher-status cipher-status--err'; return; }

  status.textContent = 'Encrypting...';
  status.className = 'cipher-status';

  try {
    const res = await fetch('/api/tools/encrypt-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: plain, password: pass }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Encryption failed');

    output.value = data.encrypted;
    status.textContent = '✓ Encrypted successfully. Copy the output to share it securely.';
    status.className = 'cipher-status cipher-status--ok';
  } catch (e) {
    status.textContent = '✗ Encryption failed: ' + e.message;
    status.className = 'cipher-status cipher-status--err';
  }
}

async function _cipherDoDecryptText() {
  const pass = document.getElementById('cipherPass').value;
  const encrypted = document.getElementById('cipherTextOutput').value;
  const plain = document.getElementById('cipherTextPlain');
  const status = document.getElementById('cipherTextStatus');

  if (!pass) { status.textContent = '⚠ Enter the password used for encryption.'; status.className = 'cipher-status cipher-status--err'; return; }
  if (!encrypted) { status.textContent = '⚠ Paste encrypted text into the output field.'; status.className = 'cipher-status cipher-status--err'; return; }

  status.textContent = 'Decrypting...';
  status.className = 'cipher-status';

  try {
    const res = await fetch('/api/tools/decrypt-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted, password: pass }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Decryption failed');

    plain.value = data.text;
    status.textContent = '✓ Decrypted successfully.';
    status.className = 'cipher-status cipher-status--ok';
  } catch (e) {
    status.textContent = '✗ Decryption failed — wrong password or corrupted data.';
    status.className = 'cipher-status cipher-status--err';
  }
}

// ═══════════════════════════════════════════════════════════
// FILE / FOLDER MODE
// ═══════════════════════════════════════════════════════════

function _cipherSetMode(folderMode) {
  _cipherFolderMode = folderMode;
  _cipherFileClear();
  // Update mode buttons
  const fileBtn = document.getElementById('cipherModeFile');
  const folderBtn = document.getElementById('cipherModeFolder');
  if (fileBtn) {
    fileBtn.className = 'hr-btn ' + (!folderMode ? 'hr-btn--active' : 'hr-btn--secondary');
  }
  if (folderBtn) {
    folderBtn.className = 'hr-btn ' + (folderMode ? 'hr-btn--active' : 'hr-btn--secondary');
  }
  // Update dropzone text
  const dropText = document.getElementById('cipherFileDropText');
  const dropzone = document.getElementById('cipherFileDropzone');
  const hint = dropzone ? dropzone.querySelector('.cipher-file-dropzone-hint') : null;
  if (dropText) dropText.textContent = folderMode ? 'Click to select a folder' : 'Drop a file here or click to browse';
  if (hint) hint.textContent = folderMode ? 'The entire folder will be zipped and encrypted' : 'Any file to encrypt, or a .bkv file to decrypt';
  // Re-setup the input
  const container = document.querySelector('.hr-content');
  if (container) _cipherSetupDropzone(container);
}

function _cipherSetupDropzone(container) {
  const dropzone = document.getElementById('cipherFileDropzone');
  if (!dropzone) return;

  // Remove old input if exists
  const oldInput = container.querySelector('input[type="file"]._cipher-file-input');
  if (oldInput) oldInput.remove();

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.className = '_cipher-file-input';
  fileInput.style.display = 'none';
  if (_cipherFolderMode) {
    fileInput.setAttribute('webkitdirectory', '');
    fileInput.setAttribute('directory', '');
  }
  container.appendChild(fileInput);

  // Clone dropzone to remove old listeners
  const newDropzone = dropzone.cloneNode(true);
  dropzone.parentNode.replaceChild(newDropzone, dropzone);

  newDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    if (_cipherFolderMode && fileInput.files.length > 0) {
      await _cipherSelectFolder(fileInput.files);
    } else if (fileInput.files.length > 0) {
      _cipherFileSelect(fileInput.files[0]);
    }
  });

  if (!_cipherFolderMode) {
    newDropzone.addEventListener('dragover', (e) => { e.preventDefault(); newDropzone.classList.add('cipher-file-dropzone--active'); });
    newDropzone.addEventListener('dragleave', () => newDropzone.classList.remove('cipher-file-dropzone--active'));
    newDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      newDropzone.classList.remove('cipher-file-dropzone--active');
      if (e.dataTransfer.files.length > 0) {
        _cipherFileSelect(e.dataTransfer.files[0]);
      }
    });
  }
}

async function _cipherSelectFolder(files) {
  const status = document.getElementById('cipherFileStatus');
  if (status) { status.textContent = 'Zipping folder...'; status.className = 'cipher-status'; }

  try {
    // files is a FileList from webkitdirectory — all paths are relative
    const zip = new JSZip();
    let totalSize = 0;
    // Get the root folder name from the first file's webkitRelativePath
    let rootName = 'folder';
    if (files[0] && files[0].webkitRelativePath) {
      rootName = files[0].webkitRelativePath.split('/')[0];
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const relativePath = f.webkitRelativePath || f.name;
      const data = await f.arrayBuffer();
      zip.file(relativePath, data);
      totalSize += f.size;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    _cipherFileSelected = {
      _isFolder: true,
      _zip: zipBlob,
      name: rootName + '.zip',
      size: zipBlob.size,
      _originalSize: totalSize,
      _fileCount: files.length,
    };
    _cipherFileShowInfo(_cipherFileSelected);
    if (status) { status.textContent = `✓ Zipped ${files.length} files (${_cipherFmtSize(totalSize)} → ${_cipherFmtSize(zipBlob.size)})`; status.className = 'cipher-status cipher-status--ok'; }
  } catch (e) {
    if (status) { status.textContent = '✗ Failed to zip folder: ' + e.message; status.className = 'cipher-status cipher-status--err'; }
  }
}

function _cipherFileSelect(file) {
  _cipherFileSelected = file;
  _cipherFileShowInfo(file);
  const status = document.getElementById('cipherFileStatus');
  if (status) { status.textContent = ''; status.className = 'cipher-status'; }
}

function _cipherFileShowInfo(fileOrFolder) {
  const dropzone = document.getElementById('cipherFileDropzone');
  const info = document.getElementById('cipherFileInfo');
  const nameEl = document.getElementById('cipherFileInfoName');
  const sizeEl = document.getElementById('cipherFileInfoSize');
  if (!dropzone || !info) return;
  dropzone.style.display = 'none';
  info.style.display = 'flex';

  if (fileOrFolder._isFolder) {
    nameEl.textContent = '📂 ' + fileOrFolder.name.replace('.zip', '') + ` (${fileOrFolder._fileCount} files)`;
    sizeEl.textContent = _cipherFmtSize(fileOrFolder._originalSize);
  } else {
    nameEl.textContent = fileOrFolder.name.endsWith('.bkv') ? '🔒 ' + fileOrFolder.name : '📄 ' + fileOrFolder.name;
    sizeEl.textContent = _cipherFmtSize(fileOrFolder.size);
  }
}

function _cipherFileClear() {
  _cipherFileSelected = null;
  const dropzone = document.getElementById('cipherFileDropzone');
  const info = document.getElementById('cipherFileInfo');
  const status = document.getElementById('cipherFileStatus');
  if (dropzone) dropzone.style.display = '';
  if (info) info.style.display = 'none';
  if (status) { status.textContent = ''; status.className = 'cipher-status'; }
}

// ═══════════════════════════════════════════════════════════
// FILE ENCRYPT / DECRYPT
// ═══════════════════════════════════════════════════════════

async function _cipherDoEncryptFile() {
  const pass = document.getElementById('cipherPass').value;
  const status = document.getElementById('cipherFileStatus');
  const progress = document.getElementById('cipherFileProgress');
  const progressText = document.getElementById('cipherFileProgressText');

  if (!pass) { status.textContent = '⚠ Enter a password.'; status.className = 'cipher-status cipher-status--err'; return; }
  if (!_cipherFileSelected) { status.textContent = '⚠ Select a file or folder first.'; status.className = 'cipher-status cipher-status--err'; return; }

  const selected = _cipherFileSelected;
  const fileName = selected.name;
  const fileBody = selected._isFolder ? selected._zip : selected;

  status.textContent = '';
  status.className = 'cipher-status';
  progress.style.display = 'flex';
  progressText.textContent = `Encrypting ${selected._isFolder ? 'folder' : fileName}...`;

  try {
    const res = await fetch('/api/tools/encrypt-file', {
      method: 'POST',
      headers: {
        'X-Password': encodeURIComponent(pass),
        'X-File-Name': encodeURIComponent(fileName),
      },
      body: fileBody,
    });

    const data = await res.json();
    if (!data.ok) {
      if (data.cancelled) {
        status.textContent = 'Save cancelled.';
        status.className = 'cipher-status';
      } else {
        throw new Error(data.error || 'Encryption failed');
      }
    } else {
      status.textContent = `✓ Encrypted → ${data.name} (${_cipherFmtSize(data.size)}) saved to ${data.path}`;
      status.className = 'cipher-status cipher-status--ok';
    }
  } catch (e) {
    status.textContent = '✗ Encryption failed: ' + e.message;
    status.className = 'cipher-status cipher-status--err';
  } finally {
    progress.style.display = 'none';
  }
}

async function _cipherDoDecryptFile() {
  const pass = document.getElementById('cipherPass').value;
  const status = document.getElementById('cipherFileStatus');
  const progress = document.getElementById('cipherFileProgress');
  const progressText = document.getElementById('cipherFileProgressText');

  if (!pass) { status.textContent = '⚠ Enter the password used for encryption.'; status.className = 'cipher-status cipher-status--err'; return; }
  if (!_cipherFileSelected) { status.textContent = '⚠ Select a .bkv file first.'; status.className = 'cipher-status cipher-status--err'; return; }

  const file = _cipherFileSelected._isFolder ? null : _cipherFileSelected;
  if (!file) { status.textContent = '⚠ Switch to FILE mode and select a .bkv file to decrypt.'; status.className = 'cipher-status cipher-status--err'; return; }
  if (!file.name.endsWith('.bkv')) {
    status.textContent = '⚠ Only .bkv files can be decrypted. Select a .bkv file.';
    status.className = 'cipher-status cipher-status--err';
    return;
  }

  status.textContent = '';
  status.className = 'cipher-status';
  progress.style.display = 'flex';
  progressText.textContent = `Decrypting ${file.name}...`;

  try {
    const res = await fetch('/api/tools/decrypt-file', {
      method: 'POST',
      headers: {
        'X-Password': encodeURIComponent(pass),
      },
      body: file,
    });

    const data = await res.json();
    if (!data.ok) {
      if (data.cancelled) {
        status.textContent = 'Save cancelled.';
        status.className = 'cipher-status';
      } else {
        throw new Error(data.error || 'Decryption failed');
      }
    } else if (data.isFolder) {
      status.textContent = `✓ Decrypted folder "${data.name}" → ${data.path}`;
      status.className = 'cipher-status cipher-status--ok';
    } else {
      status.textContent = `✓ Decrypted → ${data.name} (${_cipherFmtSize(data.size)}) saved to ${data.path}`;
      status.className = 'cipher-status cipher-status--ok';
    }
  } catch (e) {
    status.textContent = '✗ Decryption failed: ' + e.message;
    status.className = 'cipher-status cipher-status--err';
  } finally {
    progress.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'cipher-studio',
    name: 'CIPHER STUDIO',
    icon: ICONS.lock,
    description: 'AES-256-GCM encryption for text, files, and folders',
    render: _cipherRender,
    cleanup: function() { _cipherFileSelected = null; _cipherFolderMode = false; },
  });
}
