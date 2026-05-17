/**
 * The Blackout Drive — My Files (Upload + Crypto Helpers)
 *
 * Upload modal, view/decrypt routing, and temp session cleanup.
 * File browsing is now handled by Library → MY UPLOADS (showMyFilesPanel in library.js).
 * Uses the Single Ecosystem Key (Master Password) for all encryption.
 */

// ── State ────────────────────────────────────────────────────
const _MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
let _activeTempSession = null; // Track active temp session for cleanup

// ── Upload Flow (Master Password) ────────────────────────────

function _showUploadModal() {
  const existing = document.getElementById('uploadModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'uploadModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog">
      <div class="export-modal-icon">📤</div>
      <div class="export-modal-title">UPLOAD FILES</div>
      <div class="export-modal-body">
        Upload individual files or entire folders (max 2GB per file).<br><br>
        <strong>Unlocked</strong> — stored without encryption.<br>
        <strong>Locked</strong> — encrypted with your master password.
      </div>
      <div class="export-modal-fields">
        <div class="upload-mode-toggle">
          <button id="modeFileBtn" class="upload-dest-btn upload-dest-btn--active">📄 FILES</button>
          <button id="modeFolderBtn" class="upload-dest-btn">📁 FOLDER</button>
        </div>

        <input type="file" id="uploadFileInput" style="display:none" multiple />
        <input type="file" id="uploadFolderInput" style="display:none" webkitdirectory directory multiple />

        <button id="triggerInputBtn" class="upload-trigger-btn">SELECT FILES</button>
        <div id="fileSelectionText" class="upload-selection-text">No files chosen</div>

        <div class="upload-dest-toggle" style="margin-top:18px">
          <button class="upload-dest-btn upload-dest-btn--active" id="destUnlocked" data-dest="unlocked">
            📁 UNLOCKED
          </button>
          <button class="upload-dest-btn" id="destLocked" data-dest="locked">
            🔒 LOCKED
          </button>
        </div>
        <div class="export-modal-error" id="uploadError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="uploadCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="uploadConfirmBtn">UPLOAD</button>
      </div>
      <div class="export-modal-progress" id="uploadProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="uploadProgressText">Uploading...</span>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let selectedDest = 'unlocked';
  let uploadMode = 'file';
  let selectedFiles = [];

  // ── Destination toggle (unlocked/locked) ──
  const destBtns = overlay.querySelectorAll('.upload-dest-btn[data-dest]');
  destBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDest = btn.dataset.dest;
      destBtns.forEach(b => b.classList.toggle('upload-dest-btn--active', b === btn));
    });
  });

  // ── Mode toggle (file/folder) ──
  const modeFileBtn = document.getElementById('modeFileBtn');
  const modeFolderBtn = document.getElementById('modeFolderBtn');
  const fileInput = document.getElementById('uploadFileInput');
  const folderInput = document.getElementById('uploadFolderInput');
  const triggerBtn = document.getElementById('triggerInputBtn');
  const selectionText = document.getElementById('fileSelectionText');

  modeFileBtn.addEventListener('click', () => {
    uploadMode = 'file';
    modeFileBtn.classList.add('upload-dest-btn--active');
    modeFolderBtn.classList.remove('upload-dest-btn--active');
    triggerBtn.textContent = 'SELECT FILES';
    selectedFiles = [];
    selectionText.textContent = 'No files chosen';
  });

  modeFolderBtn.addEventListener('click', () => {
    uploadMode = 'folder';
    modeFolderBtn.classList.add('upload-dest-btn--active');
    modeFileBtn.classList.remove('upload-dest-btn--active');
    triggerBtn.textContent = 'SELECT FOLDER';
    selectedFiles = [];
    selectionText.textContent = 'No folder chosen';
  });

  triggerBtn.addEventListener('click', () => {
    if (uploadMode === 'file') fileInput.click();
    else folderInput.click();
  });

  function handleFilesChanged(e) {
    selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) {
      selectionText.textContent = 'No selection';
    } else if (selectedFiles.length === 1) {
      selectionText.textContent = selectedFiles[0].name;
    } else {
      selectionText.textContent = `${selectedFiles.length} files selected`;
    }
  }

  fileInput.addEventListener('change', handleFilesChanged);
  folderInput.addEventListener('change', handleFilesChanged);

  // ── Close handlers ──
  document.getElementById('uploadCancelBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // ── Upload handler ──
  document.getElementById('uploadConfirmBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('uploadError');
    const progress = document.getElementById('uploadProgress');
    const progressText = document.getElementById('uploadProgressText');
    const confirmBtn = document.getElementById('uploadConfirmBtn');

    if (selectedFiles.length === 0) {
      errEl.textContent = 'Please select files or a folder';
      return;
    }

    errEl.textContent = '';

    // For locked uploads, require master password
    let password = null;
    if (selectedDest === 'locked') {
      try {
        password = await _requireMasterPassword();
      } catch {
        return; // User cancelled the password modal
      }
    }

    confirmBtn.disabled = true;
    progress.style.display = 'flex';

    // ── FOLDER + LOCKED = Archive as single .7z ──
    if (selectedDest === 'locked' && uploadMode === 'folder') {
      try {
        // 1. Start staging session
        progressText.textContent = 'Creating encrypted archive...';
        const startRes = await fetch('/api/files/locked/upload-folder-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const startData = await startRes.json();
        if (!startData.ok) {
          errEl.textContent = startData.error || 'Failed to start upload session';
          confirmBtn.disabled = false;
          progress.style.display = 'none';
          return;
        }
        const session = startData.session;

        // 2. Stream all files to staging
        let failCount = 0;
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          progressText.textContent = `Staging ${i + 1} of ${selectedFiles.length}...`;
          if (file.size > _MAX_UPLOAD_SIZE) { failCount++; continue; }
          const relPath = file.webkitRelativePath || file.name;
          try {
            const res = await fetch('/api/files/locked/upload-folder-file', {
              method: 'POST',
              headers: {
                'X-Upload-Session': session,
                'X-File-Path': encodeURIComponent(relPath),
              },
              body: file,
            });
            const result = await res.json();
            if (!result.ok) failCount++;
          } catch { failCount++; }
        }

        // 3. Seal the archive
        progressText.textContent = 'Encrypting archive...';
        // Derive folder name from the first file's relative path root
        const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
        const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'archive';
        const sealRes = await fetch('/api/files/locked/upload-folder-seal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session, folderName, password }),
        });
        const sealData = await sealRes.json();

        overlay.remove();
        // Refresh the correct panel based on context
        if (typeof _wsOpen !== 'undefined' && _wsOpen && typeof _renderFileBrowser === 'function') {
          _wsTab = 'locked';
          _renderFileBrowser();
        } else if (typeof showMyFilesPanel === 'function') {
          showMyFilesPanel('locked');
        }
        if (typeof showToast === 'function') {
          if (sealData.ok) {
            showToast(`📦 Encrypted archive: ${sealData.filename}`, 4000);
          } else {
            showToast(`⚠ Archive failed: ${sealData.error || 'unknown'}`, 5000);
          }
        }
      } catch (e) {
        errEl.textContent = 'Upload error: ' + (e.message || 'unknown');
        confirmBtn.disabled = false;
        progress.style.display = 'none';
      }
      return;
    }

    // ── Standard per-file upload (unlocked, or single file locked) ──
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      progressText.textContent = `Uploading ${i + 1} of ${selectedFiles.length}...`;

      if (file.size > _MAX_UPLOAD_SIZE) {
        errEl.textContent = `File "${file.name}" exceeds 2GB limit`;
        failCount++;
        continue;
      }

      // webkitRelativePath preserves folder structure, falls back to name
      const relPath = file.webkitRelativePath || file.name;

      try {
        const headers = {
          'X-File-Path': encodeURIComponent(relPath),
        };
        if (selectedDest === 'locked' && password) {
          headers['X-Password'] = encodeURIComponent(password);
        }

        const res = await fetch(`/api/files/${selectedDest}/upload`, {
          method: 'POST',
          headers: headers,
          body: file, // Direct binary streaming — no Base64, no memory explosion
        });
        const result = await res.json();
        if (result.ok) successCount++;
        else { failCount++; errEl.textContent = result.error || 'Upload failed'; }
      } catch {
        failCount++;
      }
    }

    overlay.remove();

    // Refresh the correct panel based on which context invoked the upload
    if (typeof _wsOpen !== 'undefined' && _wsOpen && typeof _renderFileBrowser === 'function') {
      _wsTab = selectedDest;
      _renderFileBrowser();
    } else if (typeof showMyFilesPanel === 'function') {
      showMyFilesPanel(selectedDest);
    }

    if (typeof showToast === 'function') {
      if (failCount === 0) {
        showToast(`${successCount} file${successCount !== 1 ? 's' : ''} uploaded`, 3000);
      } else {
        showToast(`${successCount} uploaded, ${failCount} failed`, 5000);
      }
    }
  });
}

// ── View Unlocked File (via Library viewer) ─────────────────

function _viewUnlockedFile(filepath) {
  // filepath can be a relative path like "project/src/app.js"
  const filePath = 'api/files/unlocked/' + filepath.split('/').map(encodeURIComponent).join('/');
  const fileType = _detectFileType(filepath);
  const displayName = filepath.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

  // Open Library panel, then route through openUserFile
  if (typeof openLibrary === 'function') openLibrary();
  // Small delay to let Library panel mount
  setTimeout(() => {
    if (typeof openUserFile === 'function') {
      openUserFile(filePath, fileType, displayName);
    } else {
      window.open('/' + filePath, '_blank');
    }
  }, 100);
}

// ── Decrypt & View (via temp serve + Library viewer) ─────────

async function _decryptAndView(filepath) {
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
        sessionStorage.removeItem(_MP_SESSION_KEY);
      }
      return;
    }

    // Track the temp session for cleanup
    _activeTempSession = data.session;

    const filePath = data.tempPath;
    const fileType = _detectFileType(data.filename);
    const displayName = data.filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

    if (typeof showToast === 'function') showToast('File decrypted', 2000);

    // Open Library panel, then route through openUserFile
    if (typeof openLibrary === 'function') openLibrary();
    setTimeout(() => {
      if (typeof openUserFile === 'function') {
        openUserFile(filePath, fileType, displayName);
      } else {
        window.open('/' + filePath, '_blank');
      }
    }, 100);
  } catch {
    if (typeof showToast === 'function') showToast('Decryption failed', 3000);
  }
}

/** Clean up the active temp session (called by closeReader/closeLibrary). */
function _cleanupTempSession() {
  if (!_activeTempSession) return;
  const session = _activeTempSession;
  _activeTempSession = null;
  fetch(`/api/files/temp/${session}`, { method: 'DELETE' }).catch(() => {});
}

function _detectFileType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'txt' || ext === 'md') return 'text';
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','tif'].includes(ext)) return 'image';
  // Code files — route to Monaco viewer
  const codeExts = ['js','ts','tsx','jsx','py','go','rs','c','cpp','h','hpp','java',
    'html','css','json','sh','bat','yml','yaml','xml','sql','rb','php','swift','kt',
    'cs','lua','r','scala','mdx','toml','ini','cfg','env','dockerfile','makefile'];
  if (codeExts.includes(ext)) return 'code';
  return 'file';
}

// ── Dead code removed ───────────────────────────────────────
// _deleteFile, _formatFileSize, _getFileIcon, _escHtml:
// All replaced by equivalents in library.js (_deleteMyUploadFile, _fmtBytes, _myUploadFileIcon, escapeHtml)
