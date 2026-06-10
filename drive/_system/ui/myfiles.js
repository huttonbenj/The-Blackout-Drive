/**
 * The Blackout Drive — My Files (Upload + Crypto Helpers)
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Upload modal, view/decrypt routing, and temp session cleanup.
 * File browsing is handled by Workspace (workspace.js). Library bookmarks are in library.js.
 * Uses the Single Ecosystem Key (Master Password) for all encryption.
 */




// ── Upload Flow (Master Password) ────────────────────────────

/**
 * Recursively read all files from a FileSystemDirectoryHandle.
 * Returns an array of File objects with webkitRelativePath set for upload compatibility.
 */
async function _readDirectoryFiles(dirHandle, rootName, subPath = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    const entryPath = subPath ? `${subPath}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      // Shadow the readonly webkitRelativePath with a writable instance property
      Object.defineProperty(file, 'webkitRelativePath', {
        value: `${rootName}/${entryPath}`,
        writable: false,
        configurable: true,
      });
      files.push(file);
    } else if (entry.kind === 'directory') {
      const subFiles = await _readDirectoryFiles(entry, rootName, entryPath);
      files.push(...subFiles);
    }
  }
  return files;
}

/**
 * Recursively read files from a DataTransferItem (drag-and-drop).
 */
async function _readDropEntry(entry, rootName, subPath = '') {
  const files = [];
  if (entry.isFile) {
    const file = await new Promise(resolve => entry.file(resolve));
    const entryPath = subPath ? `${subPath}/${file.name}` : file.name;
    Object.defineProperty(file, 'webkitRelativePath', {
      value: `${rootName}/${entryPath}`,
      writable: false,
      configurable: true,
    });
    files.push(file);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve, reject) => {
      const allEntries = [];
      const readBatch = () => {
        reader.readEntries(batch => {
          if (batch.length === 0) { resolve(allEntries); return; }
          allEntries.push(...batch);
          readBatch();
        }, reject);
      };
      readBatch();
    });
    for (const child of entries) {
      const childPath = subPath ? `${subPath}/${entry.name}` : entry.name;
      const childFiles = await _readDropEntry(child, rootName, childPath);
      files.push(...childFiles);
    }
  }
  return files;
}

function _showUploadModal() {
  const existing = document.getElementById('uploadModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'uploadModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog upload-dialog-redesign">
      <div class="export-modal-icon">📤</div>
      <div class="export-modal-title">UPLOAD</div>
      <div class="upload-subtitle">Where should your files be stored?</div>

      <div class="upload-dest-cards" id="uploadDestCards">
        <button class="upload-dest-card" id="destCardUnlocked" data-dest="unlocked">
          <div class="upload-dest-card-icon">📂</div>
          <div class="upload-dest-card-label">UNLOCKED</div>
          <div class="upload-dest-card-desc">Regular storage — no encryption</div>
        </button>
        <button class="upload-dest-card" id="destCardLocked" data-dest="locked">
          <div class="upload-dest-card-icon">🔒</div>
          <div class="upload-dest-card-label">LOCKED</div>
          <div class="upload-dest-card-desc">Encrypted vault — requires master password</div>
        </button>
      </div>

      <div class="upload-drop-area" id="uploadDropArea" style="display:none">
        <div class="upload-drop-zone" id="uploadDropZone">
          <div class="upload-drop-icon" id="uploadDropIcon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="upload-drop-text" id="uploadDropText">
            Drag &amp; drop files or folders here
          </div>
          <div class="upload-browse-actions">
            <button class="upload-browse-btn" id="uploadBrowseBtn">BROWSE FILES</button>
            <button class="upload-browse-btn" id="uploadBrowseFolderBtn">BROWSE FOLDERS</button>
          </div>
          <div class="upload-drop-hint">You can select individual files, multiple files, or entire folders</div>
        </div>

        <div class="upload-selection-info" id="uploadSelectionInfo" style="display:none">
          <div class="upload-selection-summary">
            <span class="upload-selection-icon">✓</span>
            <span id="uploadSelectionText">0 files selected</span>
            <button class="upload-clear-btn" id="uploadClearBtn" title="Clear selection">✕</button>
          </div>
        </div>

        <div class="upload-dest-indicator" id="uploadDestIndicator"></div>

        <div class="export-modal-error" id="uploadError"></div>

        <div class="export-modal-actions" id="uploadActions">
          <button class="export-modal-btn export-modal-cancel" id="uploadCancelBtn">CANCEL</button>
          <button class="export-modal-btn export-modal-confirm" id="uploadConfirmBtn" disabled>UPLOAD</button>
        </div>
      </div>

      <div class="export-modal-progress" id="uploadProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="uploadProgressText">Uploading...</span>
      </div>

      <button class="upload-back-link" id="uploadBackToCards" style="display:none">← Change destination</button>
    </div>`;

  document.body.appendChild(overlay);

  let selectedDest = null;
  let selectedFiles = [];

  // Hidden file inputs
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  overlay.appendChild(fileInput);

  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');
  folderInput.style.display = 'none';
  overlay.appendChild(folderInput);

  const dropArea = document.getElementById('uploadDropArea');
  const dropZone = document.getElementById('uploadDropZone');
  const selectionInfo = document.getElementById('uploadSelectionInfo');
  const selectionText = document.getElementById('uploadSelectionText');
  const destIndicator = document.getElementById('uploadDestIndicator');
  const destCards = document.getElementById('uploadDestCards');
  const backBtn = document.getElementById('uploadBackToCards');
  const confirmBtn = document.getElementById('uploadConfirmBtn');
  const errEl = document.getElementById('uploadError');

  function updateSelectionUI() {
    if (selectedFiles.length > 0) {
      selectionInfo.style.display = 'flex';
      if (selectedFiles.length === 1) {
        selectionText.textContent = selectedFiles[0].name;
      } else {
        selectionText.textContent = `${selectedFiles.length} files selected`;
      }
      confirmBtn.disabled = false;
    } else {
      selectionInfo.style.display = 'none';
      confirmBtn.disabled = true;
    }
  }

  // ── Step 1: Destination choice (big cards) ──
  destCards.querySelectorAll('.upload-dest-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedDest = card.dataset.dest;

      // Show the drop area, hide the cards
      destCards.style.display = 'none';
      dropArea.style.display = 'flex';
      backBtn.style.display = '';

      // Update destination indicator
      if (selectedDest === 'locked') {
        destIndicator.innerHTML = '🔒 <strong>LOCKED</strong> — encrypted vault';
        destIndicator.className = 'upload-dest-indicator';
      } else {
        destIndicator.innerHTML = '📂 <strong>UNLOCKED</strong> — regular storage';
        destIndicator.className = 'upload-dest-indicator';
      }
    });
  });

  // ── Back button to re-choose destination ──
  backBtn.addEventListener('click', () => {
    selectedDest = null;
    selectedFiles = [];
    destCards.style.display = '';
    dropArea.style.display = 'none';
    backBtn.style.display = 'none';
    confirmBtn.disabled = true;
    updateSelectionUI();
    errEl.textContent = '';
  });

  // ── Browse files button ──
  document.getElementById('uploadBrowseBtn').addEventListener('click', async () => {
    // Try File System Access API first
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        const newFiles = [];
        for (const h of handles) {
          newFiles.push(await h.getFile());
        }
        selectedFiles = [...selectedFiles, ...newFiles];
        updateSelectionUI();
      } catch (e) {
        if (e.name !== 'AbortError') {
          errEl.textContent = 'Could not read files';
        }
      }
    } else {
      // Fallback: standard file input
      fileInput.click();
    }
  });

  // ── Browse folders button ──
  document.getElementById('uploadBrowseFolderBtn').addEventListener('click', async () => {
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        const dropText = document.getElementById('uploadDropText');
        const originalText = dropText.textContent;
        dropText.textContent = 'Reading folder...';
        
        const newFiles = await _readDirectoryFiles(dirHandle, dirHandle.name);
        selectedFiles = [...selectedFiles, ...newFiles];
        
        dropText.textContent = originalText;
        updateSelectionUI();
      } catch (e) {
        if (e.name !== 'AbortError') {
          errEl.textContent = 'Could not read folder';
        }
      }
    } else {
      // Fallback for older browsers
      folderInput.click();
    }
  });

  // File input change handler
  fileInput.addEventListener('change', (e) => {
    const newFiles = Array.from(e.target.files);
    selectedFiles = [...selectedFiles, ...newFiles];
    updateSelectionUI();
    fileInput.value = '';
  });

  folderInput.addEventListener('change', (e) => {
    const newFiles = Array.from(e.target.files);
    selectedFiles = [...selectedFiles, ...newFiles];
    updateSelectionUI();
    folderInput.value = '';
  });

  // ── Drag and drop ──
  let dragCounter = 0;
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('upload-drop-zone--active');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropZone.classList.remove('upload-drop-zone--active');
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('upload-drop-zone--active');

    const items = e.dataTransfer.items;
    if (!items) {
      // Fallback for browsers without DataTransferItem
      const droppedFiles = Array.from(e.dataTransfer.files);
      selectedFiles = [...selectedFiles, ...droppedFiles];
      updateSelectionUI();
      return;
    }

    const dropText = document.getElementById('uploadDropText');
    const dropIcon = document.getElementById('uploadDropIcon');
    dropText.textContent = 'Reading files...';
    dropIcon.style.opacity = '0.3';

    try {
      const newFiles = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
        if (entry) {
          const rootName = entry.name;
          if (entry.isDirectory) {
            const dirFiles = await _readDropEntry(entry, rootName);
            newFiles.push(...dirFiles);
          } else {
            const file = await new Promise(resolve => entry.file(resolve));
            newFiles.push(file);
          }
        } else {
          const file = items[i].getAsFile();
          if (file) newFiles.push(file);
        }
      }
      selectedFiles = [...selectedFiles, ...newFiles];
    } catch (err) {
      errEl.textContent = 'Could not read dropped files';
    }

    dropText.textContent = 'Drag & drop files or folders here';
    dropIcon.style.opacity = '1';
    updateSelectionUI();
  });

  // ── Clear selection ──
  document.getElementById('uploadClearBtn').addEventListener('click', () => {
    selectedFiles = [];
    updateSelectionUI();
  });

  // ── Close handlers ──
  document.getElementById('uploadCancelBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // ── Upload handler ──
  confirmBtn.addEventListener('click', async () => {
    const progress = document.getElementById('uploadProgress');
    const progressText = document.getElementById('uploadProgressText');

    if (selectedFiles.length === 0) {
      errEl.textContent = 'Please select files to upload';
      return;
    }

    errEl.textContent = '';

    // For locked uploads, require master password
    let password = null;
    if (selectedDest === 'locked') {
      // Use centralized _unlockSession so all panels get notified
      password = await _unlockSession();
      if (!password) return; // User cancelled
    }

    confirmBtn.disabled = true;
    document.getElementById('uploadActions').style.display = 'none';
    progress.style.display = 'flex';
    backBtn.style.display = 'none';

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      progressText.textContent = `Uploading ${i + 1} of ${selectedFiles.length}...`;

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

// ── File Type Detection ─────────────────────────────────────

function _detectFileType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'txt' || ext === 'md') return 'text';
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','tif'].includes(ext)) return 'image';
  const codeExts = ['js','ts','tsx','jsx','py','go','rs','c','cpp','h','hpp','java',
    'html','css','json','sh','bat','yml','yaml','xml','sql','rb','php','swift','kt',
    'cs','lua','r','scala','mdx','toml','ini','cfg','env','dockerfile','makefile'];
  if (codeExts.includes(ext)) return 'code';
  return 'file';
}
