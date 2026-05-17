/**
 * The Blackout Drive — AES-256-GCM Encrypted Export
 *
 * Zero-dependency cryptography using the browser's native Web Crypto API.
 * Produces .blackout archive files with the following binary format:
 *
 *   [4 bytes: magic "BKOT"]
 *   [1 byte:  version 0x01]
 *   [16 bytes: PBKDF2 salt]
 *   [12 bytes: AES-GCM IV]
 *   [remaining: AES-GCM ciphertext + 16-byte auth tag]
 *
 * Key derivation: PBKDF2 with SHA-256, 600,000 iterations.
 * Encryption:     AES-256-GCM (confidentiality + integrity).
 */

// ── Constants ────────────────────────────────────────────────
const BKOT_MAGIC   = new Uint8Array([0x42, 0x4B, 0x4F, 0x54]); // "BKOT"
const BKOT_VERSION = 0x01;
const PBKDF2_ITERS = 600000;
const SALT_BYTES   = 16;
const IV_BYTES     = 12;

// ── Master Password System ──────────────────────────────────
// One password governs all encryption: Locked files and encrypted chat history.
// The raw password is held in sessionStorage for the active session.
// A PBKDF2 verifier hash is stored server-side in ecosystem_key.json.

const _MP_SESSION_KEY = 'bd-master-password';

/** Check if a master password has been established on this drive. */
async function _isMasterPasswordSet() {
  try {
    const res = await fetch('/api/master-password/status');
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.established;
  } catch { return false; }
}

/** Get the current session password (null if not entered yet). */
function _getSessionPassword() {
  return sessionStorage.getItem(_MP_SESSION_KEY);
}

/**
 * Require the master password. Shows appropriate modal.
 * Returns a Promise that resolves with the password string, or rejects on cancel.
 */
function _requireMasterPassword() {
  return new Promise(async (resolve, reject) => {
    // If password is already in session, return immediately
    const cached = _getSessionPassword();
    if (cached) { resolve(cached); return; }

    const isSet = await _isMasterPasswordSet();
    if (isSet) {
      _showVerifyPasswordModal(resolve, reject);
    } else {
      _showCreatePasswordModal(resolve, reject);
    }
  });
}

/**
 * Centralized session unlock.
 * The ONE function to call anywhere in the codebase that needs the master password.
 * On success: caches the password in sessionStorage, hides the unsaved banner,
 *             and runs any pending save via the callback.
 * On cancel:  resolves with null — callers must handle this gracefully.
 * @param {Function} [onSuccess] - Optional callback to run after successful unlock
 * @returns {Promise<string|null>}
 */
async function _unlockSession(onSuccess) {
  try {
    const pw = await _requireMasterPassword();
    _hideUnsavedBanner();
    if (typeof onSuccess === 'function') {
      try { await onSuccess(pw); } catch {}
    }
    return pw;
  } catch {
    // User cancelled — do nothing, return null
    return null;
  }
}

/**
 * Lock the session — clears the cached master password.
 * Encrypted chat titles revert to redacted bars.
 * Auto-save will pause until the user unlocks again.
 */
function _lockSession() {
  sessionStorage.removeItem(_MP_SESSION_KEY);
  // If encryption is still enabled, auto-save can't work — show the banner
  if (typeof _isEncryptHistoryEnabled === 'function' && _isEncryptHistoryEnabled()) {
    if (typeof _showUnsavedBanner === 'function') _showUnsavedBanner();
  }
}

/** Show the persistent amber "chats unsaved" banner. */
function _showUnsavedBanner() {
  const existing = document.getElementById('encryptUnsavedBanner');
  if (existing) return; // Already showing

  const banner = document.createElement('div');
  banner.id = 'encryptUnsavedBanner';
  banner.className = 'encrypt-unsaved-banner';
  banner.innerHTML = `
    <span class="encrypt-unsaved-icon">🔒</span>
    <span class="encrypt-unsaved-text">Chat not being saved — encryption is on but the drive is locked.</span>
    <button class="encrypt-unsaved-btn" id="encryptUnlockBtn">UNLOCK TO SAVE</button>`;
  // Insert above the input area footer
  const footer = document.querySelector('.input-area');
  if (footer) {
    footer.insertBefore(banner, footer.firstChild);
  } else {
    document.body.appendChild(banner);
  }

  document.getElementById('encryptUnlockBtn').addEventListener('click', () => {
    _unlockSession(() => {
      // After unlock, trigger a save to catch up any missed messages
      if (typeof _saveToDisk === 'function') _saveToDisk();
    });
  });
}

/** Hide the persistent "chats unsaved" banner. */
function _hideUnsavedBanner() {
  const banner = document.getElementById('encryptUnsavedBanner');
  if (banner) banner.remove();
}

/** Modal: Create a new master password (first time). */
function _showCreatePasswordModal(resolve, reject) {
  _removeModal('masterPwModal');
  const overlay = document.createElement('div');
  overlay.id = 'masterPwModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon">🔐</div>
      <div class="export-modal-title">CREATE MASTER PASSWORD</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>You need a master password to use encryption on this drive.</p>
        <p style="margin-top:8px">This <strong>one password</strong> protects:</p>
        <ul style="margin:8px 0;padding-left:20px">
          <li>Your saved conversations (encrypted so only you can read them)</li>
          <li>Your locked files (personal files you upload to the Locked tab)</li>
          <li>Exported conversation backups</li>
        </ul>
        <p style="margin-top:10px"><strong>⚠ Write this password down.</strong> There is no password recovery. If you forget it, you can reset it — but all encrypted data will be permanently deleted.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="mpCreate1" class="export-modal-input"
               placeholder="Choose a password (at least 4 characters)" autocomplete="off" />
        <input type="password" id="mpCreate2" class="export-modal-input"
               placeholder="Type it again to confirm" autocomplete="off" />
        <div class="export-modal-error" id="mpCreateError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="mpCreateCancel">NOT NOW</button>
        <button class="export-modal-btn export-modal-confirm" id="mpCreateConfirm">SET PASSWORD</button>
      </div>
      <div class="export-modal-progress" id="mpCreateProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span>Setting up encryption...</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pw1 = document.getElementById('mpCreate1');
  const pw2 = document.getElementById('mpCreate2');
  const errEl = document.getElementById('mpCreateError');
  const progress = document.getElementById('mpCreateProgress');
  const confirmBtn = document.getElementById('mpCreateConfirm');
  setTimeout(() => pw1.focus(), 100);

  document.getElementById('mpCreateCancel').addEventListener('click', () => {
    overlay.remove(); reject(new Error('Cancelled'));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); reject(new Error('Cancelled')); }
  });

  const doCreate = async () => {
    const password = pw1.value;
    if (!password || password.length < 4) {
      errEl.textContent = 'Password must be at least 4 characters'; return;
    }
    if (password !== pw2.value) {
      errEl.textContent = 'Passwords do not match'; pw2.value = ''; pw2.focus(); return;
    }
    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    try {
      const res = await fetch('/api/master-password/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem(_MP_SESSION_KEY, password);
        overlay.remove();
        resolve(password);
      } else {
        errEl.textContent = data.error || 'Setup failed';
        confirmBtn.disabled = false;
        progress.style.display = 'none';
      }
    } catch {
      errEl.textContent = 'Setup failed';
      confirmBtn.disabled = false;
      progress.style.display = 'none';
    }
  };
  confirmBtn.addEventListener('click', doCreate);
  pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

/** Modal: Verify the existing master password. */
function _showVerifyPasswordModal(resolve, reject) {
  _removeModal('masterPwModal');
  const overlay = document.createElement('div');
  overlay.id = 'masterPwModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog">
      <div class="export-modal-icon">🔑</div>
      <div class="export-modal-title">UNLOCK YOUR DRIVE</div>
      <div class="export-modal-body">
        Your conversations and locked files are protected by your master password. Enter it below to unlock access.
      </div>
      <div class="export-modal-fields">
        <input type="password" id="mpVerify" class="export-modal-input"
               placeholder="Master password" autocomplete="off" />
        <div class="export-modal-error" id="mpVerifyError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="mpVerifyCancel">NOT NOW</button>
        <button class="export-modal-btn export-modal-confirm" id="mpVerifyConfirm">UNLOCK</button>
      </div>
      <div class="export-modal-progress" id="mpVerifyProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span>Verifying...</span>
      </div>
      <div style="margin-top:12px;text-align:center">
        <a href="#" id="mpForgotLink" style="color:var(--amber-dim,#b89c5a);font-size:0.8rem;opacity:0.7">Forgot password?</a>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pwInput = document.getElementById('mpVerify');
  const errEl = document.getElementById('mpVerifyError');
  const progress = document.getElementById('mpVerifyProgress');
  const confirmBtn = document.getElementById('mpVerifyConfirm');
  setTimeout(() => pwInput.focus(), 100);

  document.getElementById('mpVerifyCancel').addEventListener('click', () => {
    overlay.remove(); reject(new Error('Cancelled'));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); reject(new Error('Cancelled')); }
  });

  const doVerify = async () => {
    const password = pwInput.value;
    if (!password) { errEl.textContent = 'Password required'; return; }
    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    try {
      const res = await fetch('/api/master-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem(_MP_SESSION_KEY, password);
        overlay.remove();
        resolve(password);
      } else {
        errEl.textContent = data.error || 'Wrong password';
        confirmBtn.disabled = false;
        progress.style.display = 'none';
        pwInput.value = '';
        pwInput.focus();
      }
    } catch {
      errEl.textContent = 'Verification failed';
      confirmBtn.disabled = false;
      progress.style.display = 'none';
    }
  };
  confirmBtn.addEventListener('click', doVerify);
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doVerify(); });

  // Forgot password → destructive reset flow
  const forgotLink = document.getElementById('mpForgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.remove();
      _showResetPasswordModal(reject);
    });
  }
}

/** Modal: Destructive password reset — nukes all encrypted data. */
function _showResetPasswordModal(parentReject) {
  _removeModal('masterPwModal');
  const overlay = document.createElement('div');
  overlay.id = 'masterPwModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog">
      <div class="export-modal-icon">⚠️</div>
      <div class="export-modal-title">RESET MASTER PASSWORD</div>
      <div class="export-modal-body" style="color:#e8c56d">
        <strong>⚠ This will permanently delete:</strong>
        <ul style="text-align:left;margin:8px 0 0 0;padding-left:20px;line-height:1.6">
          <li>All your encrypted conversations</li>
          <li>All files in your Locked tab (Workspace)</li>
          <li>Your current master password</li>
        </ul>
        <p style="margin-top:10px;opacity:0.8">
          The following will <strong>NOT</strong> be affected: BEACON (the AI), the Library,
          Prompts, your unlocked files, and any conversations that were not encrypted.
        </p>
        <p style="margin-top:10px">
          Type <strong>RESET</strong> below to confirm.
        </p>
      </div>
      <div class="export-modal-fields">
        <input type="text" id="mpResetConfirmInput" class="export-modal-input"
               placeholder='Type "RESET" to confirm' autocomplete="off" />
        <div class="export-modal-error" id="mpResetError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="mpResetCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="mpResetConfirm"
                style="background:var(--danger-bg,#5a2020);border-color:var(--danger-border,#8b3030)">
          ERASE &amp; RESET
        </button>
      </div>
      <div class="export-modal-progress" id="mpResetProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span>Resetting...</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const confirmInput = document.getElementById('mpResetConfirmInput');
  const errEl = document.getElementById('mpResetError');
  const progress = document.getElementById('mpResetProgress');
  const confirmBtn = document.getElementById('mpResetConfirm');
  setTimeout(() => confirmInput.focus(), 100);

  document.getElementById('mpResetCancel').addEventListener('click', () => {
    overlay.remove();
    if (parentReject) parentReject(new Error('Cancelled'));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      if (parentReject) parentReject(new Error('Cancelled'));
    }
  });

  const doReset = async () => {
    if (confirmInput.value.trim() !== 'RESET') {
      errEl.textContent = 'Type RESET in all caps to confirm';
      return;
    }
    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    try {
      const res = await fetch('/api/master-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.removeItem(_MP_SESSION_KEY);
        overlay.remove();
        // Instead of a confusing page reload, immediately transition to creating
        // a new password — this is a single linear flow, not two separate events.
        _showCreatePasswordModal(
          (newPw) => {
            _hideUnsavedBanner();
            if (typeof showToast === 'function') {
              showToast('Password reset. New password set — drive re-armed.', 4000);
            }
            // Trigger a save to catch up any missed messages now that we're unlocked
            if (typeof _saveToDisk === 'function') _saveToDisk();
          },
          () => {
            // Cancelled new password creation — reload to get into a clean state
            if (typeof showToast === 'function') {
              showToast('All encrypted data deleted. Set a new password when ready.', 5000);
            }
            setTimeout(() => window.location.reload(), 2500);
          }
        );
      } else {
        errEl.textContent = data.error || 'Reset failed';
        confirmBtn.disabled = false;
        progress.style.display = 'none';
      }
    } catch {
      errEl.textContent = 'Reset failed — server error';
      confirmBtn.disabled = false;
      progress.style.display = 'none';
    }
  };
  confirmBtn.addEventListener('click', doReset);
  confirmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doReset(); });
}

function _removeModal(id) {
  const m = document.getElementById(id);
  if (m) m.remove();
}

// ── Crypto Primitives ────────────────────────────────────────

/**
 * Derive a 256-bit AES-GCM key from a password and salt.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function _deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

/**
 * Encrypt a JSON string into the .blackout binary format.
 * @param {string} jsonStr  - The raw JSON to encrypt
 * @param {string} password - User-provided password
 * @returns {Promise<ArrayBuffer>} - Complete .blackout file buffer
 */
async function _encryptToBlackout(jsonStr, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key  = await _deriveKey(password, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(jsonStr);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Pack: MAGIC(4) + VERSION(1) + SALT(16) + IV(12) + CIPHERTEXT(n)
  const header = new Uint8Array(4 + 1 + SALT_BYTES + IV_BYTES);
  header.set(BKOT_MAGIC, 0);
  header[4] = BKOT_VERSION;
  header.set(salt, 5);
  header.set(iv, 5 + SALT_BYTES);

  const output = new Uint8Array(header.length + ciphertext.byteLength);
  output.set(header, 0);
  output.set(new Uint8Array(ciphertext), header.length);

  return output.buffer;
}

// ── Password Modal ───────────────────────────────────────────

function _showExportModal() {
  // Prevent stacking
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon">🔒</div>
      <div class="export-modal-title">EXPORT CONVERSATIONS</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>This creates an encrypted backup file of your current conversation that you can save to your computer.</p>
        <p style="margin-top:8px">Choose a password for this export file. It can be the same as your master password or a different one — it's up to you.</p>
        <p style="margin-top:8px;opacity:0.7;font-size:0.8rem">⚠ If you forget this password, the exported file cannot be opened. There is no recovery.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="exportPw1" class="export-modal-input"
               placeholder="Password for this export" autocomplete="off" spellcheck="false" />
        <input type="password" id="exportPw2" class="export-modal-input"
               placeholder="Type it again to confirm" autocomplete="off" spellcheck="false" />
        <div class="export-modal-error" id="exportPwError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="exportCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="exportConfirmBtn">ENCRYPT & EXPORT</button>
      </div>
      <div class="export-modal-progress" id="exportProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span>Encrypting...</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus first input
  const pw1 = document.getElementById('exportPw1');
  const pw2 = document.getElementById('exportPw2');
  const errEl = document.getElementById('exportPwError');
  const confirmBtn = document.getElementById('exportConfirmBtn');
  const cancelBtn = document.getElementById('exportCancelBtn');
  const progress = document.getElementById('exportProgress');

  setTimeout(() => pw1.focus(), 100);

  // Cancel
  cancelBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Submit
  confirmBtn.addEventListener('click', () => _executeExport(pw1, pw2, errEl, confirmBtn, cancelBtn, progress, overlay));

  // Enter key
  pw2.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _executeExport(pw1, pw2, errEl, confirmBtn, cancelBtn, progress, overlay);
  });
}

async function _executeExport(pw1, pw2, errEl, confirmBtn, cancelBtn, progress, overlay) {
  const password = pw1.value;
  const confirm  = pw2.value;

  // Validation
  if (!password) {
    errEl.textContent = 'Password is required';
    pw1.focus();
    return;
  }
  if (password.length < 4) {
    errEl.textContent = 'Password must be at least 4 characters';
    pw1.focus();
    return;
  }
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match';
    pw2.value = '';
    pw2.focus();
    return;
  }

  errEl.textContent = '';

  // Show progress, disable buttons
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  confirmBtn.style.opacity = '0.4';
  cancelBtn.style.opacity = '0.4';
  progress.style.display = 'flex';

  try {
    // 1. Fetch all conversations
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error('Could not load conversations');
    const data = await res.json();
    const convs = data.conversations || data;

    if (!convs || convs.length === 0) {
      errEl.textContent = 'No conversations to export';
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.style.opacity = '';
      cancelBtn.style.opacity = '';
      progress.style.display = 'none';
      return;
    }

    // 2. Fetch full message history for each conversation
    //    For encrypted conversations, decrypt them first so the export
    //    contains usable plaintext inside the encrypted .blackout archive.
    const fullArchive = [];
    for (const conv of convs) {
      try {
        const cRes = await fetch(`/api/conversations/${encodeURIComponent(conv.id)}`);
        if (!cRes.ok) continue;
        const cData = await cRes.json();

        // If conversation has encryptedMessages, decrypt before archiving
        if (cData.encryptedMessages && typeof _decryptConvWithPassword === 'function') {
          let sessionPw = _getSessionPassword();
          // If no session password cached, prompt the user (only happens once)
          if (!sessionPw) {
            try {
              sessionPw = await _requireMasterPassword();
            } catch {
              // User cancelled — include encrypted blob as-is
            }
          }
          if (sessionPw) {
            try {
              const decrypted = await _decryptConvWithPassword(cData.encryptedMessages, sessionPw);
              if (decrypted && decrypted.messages) {
                cData.messages = decrypted.messages;
                delete cData.encryptedMessages; // Remove encrypted blob from export
              }
            } catch {
              // Decryption failed — include as-is (better than skipping)
            }
          }
        }

        fullArchive.push(cData);
      } catch {
        // Skip individual failures silently
      }
    }

    if (fullArchive.length === 0) {
      errEl.textContent = 'No conversation data found';
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.style.opacity = '';
      cancelBtn.style.opacity = '';
      progress.style.display = 'none';
      return;
    }

    // 3. Serialize the archive
    const archiveJson = JSON.stringify({
      format: 'blackout-archive',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: fullArchive.length,
      conversations: fullArchive,
    }, null, 2);

    // 4. Encrypt
    const encrypted = await _encryptToBlackout(archiveJson, password);

    // 5. Trigger download
    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `blackout_archive_${dateStr}.blackout`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Done — close modal
    overlay.remove();
    if (typeof showToast === 'function') {
      showToast(`Exported ${fullArchive.length} conversation${fullArchive.length !== 1 ? 's' : ''} (AES-256 encrypted)`, 5000);
    }

  } catch (err) {
    errEl.textContent = err.message || 'Export failed';
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.style.opacity = '';
    cancelBtn.style.opacity = '';
    progress.style.display = 'none';
  }
}

// ── Phase E: Chat History Encryption ─────────────────────────
// Encrypt/decrypt individual conversation JSON objects in-flight
// using the master password + AES-256-GCM.

/** Check if chat encryption is enabled. */
function _isEncryptHistoryEnabled() {
  return localStorage.getItem('bd-setting-encrypt-history') === 'true';
}

/**
 * Encrypt a conversation JSON object into a base64 blob.
 * Returns { encrypted: true, data: "<base64>" } or the original object if
 * encryption is OFF or no password is available.
 */
async function _encryptConversationJSON(convObj) {
  if (!_isEncryptHistoryEnabled()) return convObj;
  const password = _getSessionPassword();
  if (!password) return convObj; // Can't encrypt without password
  return _encryptConvWithPassword(convObj, password);
}

/**
 * Encrypt a conversation JSON object with an explicit password.
 * Used by the change-password re-encryption flow.
 */
async function _encryptConvWithPassword(convObj, password) {
  try {
    const jsonStr = JSON.stringify(convObj);
    const buf = await _encryptToBlackout(jsonStr, password);
    const b64 = _arrayBufferToBase64(buf);
    return { encrypted: true, data: b64 };
  } catch {
    return convObj; // Fail open — save unencrypted rather than lose data
  }
}

/**
 * Decrypt an encrypted conversation object back to its original form.
 * If the object is not encrypted ({ encrypted: true }), returns it as-is.
 */
async function _decryptConversationJSON(obj) {
  if (!obj || !obj.encrypted || !obj.data) return obj;
  const password = _getSessionPassword();
  if (!password) {
    // Need to prompt for password
    try {
      const pw = await _requireMasterPassword();
      return await _decryptConvWithPassword(obj.data, pw);
    } catch {
      return null; // User cancelled
    }
  }
  return _decryptConvWithPassword(obj.data, password);
}

async function _decryptConvWithPassword(b64Data, password) {
  const buf = _base64ToArrayBuffer(b64Data);
  const view = new Uint8Array(buf);

  // Parse .blackout format: MAGIC(4) + VERSION(1) + SALT(16) + IV(12) + CIPHERTEXT
  const headerLen = 4 + 1 + SALT_BYTES + IV_BYTES;
  if (view.length < headerLen + 16) throw new Error('Invalid encrypted data');

  const salt = view.slice(5, 5 + SALT_BYTES);
  const iv = view.slice(5 + SALT_BYTES, 5 + SALT_BYTES + IV_BYTES);
  const ciphertext = view.slice(headerLen);

  // Derive the same key
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

// ── Mandatory First-Run Password Creation ────────────────────
// Called after the welcome overlay is dismissed on first boot.
// Cannot be cancelled — the user MUST create a password before
// using the drive. This ensures BP + Encrypt is real from msg 1.

function _showMandatoryPasswordCreation() {
  return new Promise((resolve) => {
    _removeModal('masterPwModal');
    const overlay = document.createElement('div');
    overlay.id = 'masterPwModal';
    overlay.className = 'export-modal-overlay';
    // No click-outside-to-dismiss for mandatory flow
    overlay.innerHTML = `
      <div class="export-modal-dialog" style="max-width:420px">
        <div class="export-modal-icon">🔐</div>
        <div class="export-modal-title">CREATE YOUR MASTER PASSWORD</div>
        <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
          <p>Before you start, you need to create a master password.</p>
          <p style="margin-top:8px">This is the <strong>one password</strong> for your entire Blackout Drive. It protects:</p>
          <ul style="margin:8px 0;padding-left:20px">
            <li>Your saved conversations (encrypted so only you can read them)</li>
            <li>Your locked files (personal files you upload to the Locked tab)</li>
            <li>Exported conversation backups</li>
          </ul>
          <p style="margin-top:10px"><strong>⚠ IMPORTANT — Write this password down and keep it safe.</strong><br>There is NO way to recover a forgotten password. If you forget it, you can reset it, but all your encrypted conversations and locked files will be permanently deleted. BEACON, the Library, your Prompts, and your unlocked files will NOT be affected.</p>
          <p style="margin-top:8px;opacity:0.7;font-size:0.8rem">You can change your password anytime in Settings → Data.</p>
        </div>
        <div class="export-modal-fields">
          <input type="password" id="mpCreate1" class="export-modal-input"
                 placeholder="Choose a password (at least 4 characters)" autocomplete="off" />
          <input type="password" id="mpCreate2" class="export-modal-input"
                 placeholder="Type it again to confirm" autocomplete="off" />
          <div class="export-modal-error" id="mpCreateError"></div>
        </div>
        <div class="export-modal-actions">
          <button class="export-modal-btn export-modal-confirm" id="mpCreateConfirm" style="width:100%">CREATE PASSWORD</button>
        </div>
        <div class="export-modal-progress" id="mpCreateProgress" style="display:none">
          <div class="export-modal-spinner"></div>
          <span>Setting up encryption...</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const pw1 = document.getElementById('mpCreate1');
    const pw2 = document.getElementById('mpCreate2');
    const errEl = document.getElementById('mpCreateError');
    const progress = document.getElementById('mpCreateProgress');
    const confirmBtn = document.getElementById('mpCreateConfirm');
    setTimeout(() => pw1.focus(), 200);

    // No cancel button, no backdrop dismiss, no Escape dismiss

    const doCreate = async () => {
      const password = pw1.value;
      if (!password || password.length < 4) {
        errEl.textContent = 'Password must be at least 4 characters'; return;
      }
      if (password !== pw2.value) {
        errEl.textContent = 'Passwords do not match'; pw2.value = ''; pw2.focus(); return;
      }
      errEl.textContent = '';
      confirmBtn.disabled = true;
      progress.style.display = 'flex';
      try {
        const res = await fetch('/api/master-password/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (data.ok) {
          sessionStorage.setItem(_MP_SESSION_KEY, password);
          overlay.remove();
          if (typeof showToast === 'function') showToast('Master password created — encryption active', 4000);
          resolve(password);
        } else {
          errEl.textContent = data.error || 'Setup failed';
          confirmBtn.disabled = false;
          progress.style.display = 'none';
        }
      } catch {
        errEl.textContent = 'Setup failed — is the server running?';
        confirmBtn.disabled = false;
        progress.style.display = 'none';
      }
    };
    confirmBtn.addEventListener('click', doCreate);
    pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
    pw1.addEventListener('keydown', (e) => { if (e.key === 'Enter') pw2.focus(); });
  });
}

// ── Change Password (Non-Destructive) ────────────────────────
// Lets a user who KNOWS their current password change it.
// Re-encrypts all locked files (server-side) and encrypted
// conversations (client-side) with the new password.

function _showChangePasswordModal() {
  _removeModal('masterPwModal');
  const overlay = document.createElement('div');
  overlay.id = 'masterPwModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon">🔑</div>
      <div class="export-modal-title">CHANGE MASTER PASSWORD</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>Change your master password without losing any data.</p>
        <p style="margin-top:8px"><strong>How it works:</strong></p>
        <ol style="margin:6px 0;padding-left:20px;line-height:1.6">
          <li>Verify your current password</li>
          <li>Your encrypted conversations and locked files are automatically re-encrypted with the new password</li>
          <li>Nothing is deleted — your data stays intact</li>
        </ol>
        <p style="margin-top:8px;opacity:0.7;font-size:0.8rem">If you've forgotten your current password, cancel this and use "Forgot password?" instead (this deletes all encrypted data).</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="cpCurrent" class="export-modal-input"
               placeholder="Your current password" autocomplete="off" />
        <input type="password" id="cpNew1" class="export-modal-input"
               placeholder="New password (at least 4 characters)" autocomplete="off" />
        <input type="password" id="cpNew2" class="export-modal-input"
               placeholder="Type new password again to confirm" autocomplete="off" />
        <div class="export-modal-error" id="cpError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="cpCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="cpConfirm">CHANGE PASSWORD</button>
      </div>
      <div class="export-modal-progress" id="cpProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="cpProgressText">Verifying...</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const currentPw = document.getElementById('cpCurrent');
  const newPw1 = document.getElementById('cpNew1');
  const newPw2 = document.getElementById('cpNew2');
  const errEl = document.getElementById('cpError');
  const progress = document.getElementById('cpProgress');
  const progressText = document.getElementById('cpProgressText');
  const confirmBtn = document.getElementById('cpConfirm');
  setTimeout(() => currentPw.focus(), 100);

  document.getElementById('cpCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const doChange = async () => {
    const oldPw = currentPw.value;
    const newPw = newPw1.value;
    if (!oldPw) { errEl.textContent = 'Current password is required'; return; }
    if (!newPw || newPw.length < 4) { errEl.textContent = 'New password must be at least 4 characters'; return; }
    if (newPw !== newPw2.value) { errEl.textContent = 'New passwords do not match'; newPw2.value = ''; newPw2.focus(); return; }
    if (oldPw === newPw) { errEl.textContent = 'New password must be different from current'; return; }

    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    progressText.textContent = 'Verifying & re-encrypting files...';

    try {
      // Step 1: Server re-encrypts 7z files + updates verifier hash
      const res = await fetch('/api/master-password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: oldPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!data.ok) {
        errEl.textContent = data.error || 'Password change failed';
        confirmBtn.disabled = false;
        progress.style.display = 'none';
        return;
      }

      // Step 2: Client re-encrypts conversations
      const encIds = data.encryptedConversationIds || [];
      if (encIds.length > 0) {
        progressText.textContent = `Re-encrypting ${encIds.length} conversation${encIds.length !== 1 ? 's' : ''}...`;
        let reEncrypted = 0;
        for (const convId of encIds) {
          try {
            const cRes = await fetch(`/api/conversations/${encodeURIComponent(convId)}`);
            if (!cRes.ok) continue;
            const conv = await cRes.json();
            if (!conv.encryptedMessages) continue;

            // Decrypt with old password
            const decrypted = await _decryptConvWithPassword(conv.encryptedMessages, oldPw);
            if (!decrypted || !decrypted.messages) continue;

            // Re-encrypt with new password
            const reEncResult = await _encryptConvWithPassword({ messages: decrypted.messages }, newPw);
            if (!reEncResult || !reEncResult.encrypted) continue;

            // Save back
            await fetch('/api/conversations/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: convId,
                title: conv.title || '',
                messages: [],
                encryptedMessages: reEncResult.data,
                messageCount: conv.message_count || decrypted.messages.length,
              }),
            });
            reEncrypted++;
          } catch {
            // Skip individual failures — don't block the whole change
          }
        }
        progressText.textContent = `Re-encrypted ${reEncrypted} of ${encIds.length} conversations`;
        // Brief pause so user sees the count
        await new Promise(r => setTimeout(r, 800));
      }

      // Step 3: Update session cache
      sessionStorage.setItem(_MP_SESSION_KEY, newPw);
      overlay.remove();
      if (typeof showToast === 'function') {
        const fileMsg = data.reEncryptedFiles > 0 ? `, ${data.reEncryptedFiles} locked file${data.reEncryptedFiles !== 1 ? 's' : ''}` : '';
        const convMsg = encIds.length > 0 ? `, ${encIds.length} conversation${encIds.length !== 1 ? 's' : ''}` : '';
        showToast(`Password changed${fileMsg}${convMsg} re-encrypted`, 5000);
      }

    } catch (err) {
      errEl.textContent = err.message || 'Password change failed';
      confirmBtn.disabled = false;
      progress.style.display = 'none';
    }
  };
  confirmBtn.addEventListener('click', doChange);
  newPw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') doChange(); });
}

// ── Base64 Helpers ───────────────────────────────────────────

function _arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function _base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
