/**
 * The Blackout Drive — V3 Segmented AEAD Encryption
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Zero-dependency cryptography using the browser's native Web Crypto API.
 * Uses the SAME V3 Segmented AEAD format as the Python backend:
 *
 *   [4 bytes: magic "BKVF"]
 *   [1 byte:  version 0x03]
 *   [32 bytes: PBKDF2 salt]
 *   [8 bytes:  base nonce]
 *   [segments...]
 *
 * Each segment:
 *   [4 bytes: header — bit 31 = final flag, bits 0-30 = plaintext length]
 *   [N bytes: AES-256-GCM ciphertext]
 *   [16 bytes: GCM authentication tag]
 *
 * Per-segment nonce (12 bytes): base_nonce[8] || counter[4 big-endian]
 * Per-segment AAD (5 bytes): counter[4 big-endian] || final_flag[1]
 *
 * Key derivation: PBKDF2 with SHA-256, 100,000 iterations (matches backend).
 * Encryption:     Per-segment AES-256-GCM (STREAM construction).
 */

// ── V3 Constants ─────────────────────────────────────────────
const BKVF_MAGIC      = new Uint8Array([0x42, 0x4B, 0x56, 0x46]); // "BKVF"
const BKVF_VERSION    = 0x03;
const PBKDF2_ITERS    = 100000;  // Matches Python backend
const SALT_BYTES      = 32;
const BASE_NONCE_BYTES = 8;
const GCM_TAG_BYTES   = 16;
const SEGMENT_SIZE    = 65536;   // 64KB per segment
const FINAL_FLAG      = 0x80000000;
const V3_HEADER_LEN   = 4 + 1 + SALT_BYTES + BASE_NONCE_BYTES; // 45 bytes

// ── Master Password System ──────────────────────────────────
// One password governs all encryption: Locked files and encrypted chat history.
// The raw password is held in sessionStorage for the active session.
// A PBKDF2 verifier hash is stored server-side in ecosystem_key.json.

const _MP_SESSION_KEY = 'bd-master-password';

// ── Cross-Tab Auth Sync ─────────────────────────────────────
// sessionStorage is per-tab, so unlocking in one tab doesn't propagate.
// We use BroadcastChannel to sync auth state across all open tabs.
let _authBroadcast = null;
try {
  _authBroadcast = new BroadcastChannel('bd-auth-sync');
  _authBroadcast.onmessage = (e) => {
    if (!e.data) return;
    if (e.data.type === 'unlock' && e.data.password) {
      // Another tab unlocked — cache the password in THIS tab's sessionStorage
      sessionStorage.setItem(_MP_SESSION_KEY, e.data.password);
      // Fire local auth change event so all panels re-render
      document.dispatchEvent(new CustomEvent('bd-auth-state-changed', {
        detail: { unlocked: true, crossTab: true },
      }));
    } else if (e.data.type === 'lock') {
      // Another tab locked — clear this tab's session
      sessionStorage.removeItem(_MP_SESSION_KEY);
      document.dispatchEvent(new CustomEvent('bd-auth-state-changed', {
        detail: { unlocked: false, crossTab: true },
      }));
    }
  };
} catch { /* BroadcastChannel not supported — single-tab only */ }

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
 * Broadcast auth state change to all UI panels AND other tabs.
 * Fires a CustomEvent on document so that COMMS, Conversations,
 * Workspace, and any other panel can reactively re-render.
 * Also pushes state to other tabs via BroadcastChannel.
 */
function _notifyAuthChange(unlocked) {
  document.dispatchEvent(new CustomEvent('bd-auth-state-changed', {
    detail: { unlocked: !!unlocked },
  }));
  // Sync to other tabs
  try {
    if (_authBroadcast) {
      if (unlocked) {
        const pw = _getSessionPassword();
        if (pw) _authBroadcast.postMessage({ type: 'unlock', password: pw });
      } else {
        _authBroadcast.postMessage({ type: 'lock' });
      }
    }
  } catch { /* ignore broadcast errors */ }
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
    _notifyAuthChange(true);
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
  // Lock COMMS vault (server-side key wipe)
  fetch('/api/comms/lock', { method: 'POST' }).catch(() => {});
  // Broadcast lock to all panels (replaces ad-hoc _commsOnLock calls)
  _notifyAuthChange(false);
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
          <li>Your COMMS radio messages (encrypted automatically)</li>
          <li>Your saved conversations (encrypted so only you can read them)</li>
          <li>Your locked files (personal files you upload to the Locked tab)</li>
          <li>Exported conversation backups</li>
        </ul>
        <p style="margin-top:10px"><strong>⚠ Write this password down.</strong> There is no password recovery. If you forget it, you can reset it — but all encrypted data will be permanently deleted.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="mpCreate1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Choose a password (at least 8 characters)" autocomplete="off" />
        <input type="password" id="mpCreate2" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Type it again to confirm" autocomplete="off" />
        <input type="text" id="mpHint" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Password hint (optional — helps you remember)" maxlength="100" />
        <div style="font-size:0.72rem;opacity:0.45;margin-top:2px;padding-left:2px">⚠ Don't write your actual password here. This hint is stored unencrypted.</div>
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
    if (!password || password.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters'; return;
    }
    if (password !== pw2.value) {
      errEl.textContent = 'Passwords do not match'; pw2.value = ''; pw2.focus(); return;
    }
    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    try {
      const hint = (document.getElementById('mpHint')?.value || '').trim();
      const res = await fetch('/api/master-password/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, hint }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem(_MP_SESSION_KEY, password);
        _notifyAuthChange(true);
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
        <input type="password" id="mpVerify" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
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
      <div id="mpHintArea" style="margin-top:10px;text-align:center;display:none">
        <a href="#" id="mpShowHint" style="color:var(--amber-dim);font-size:0.8rem;opacity:0.7">Show hint</a>
        <div id="mpHintText" style="display:none;margin-top:6px;font-size:0.82rem;opacity:0.7;color:var(--amber-dim)"></div>
      </div>
      <div style="margin-top:8px;text-align:center">
        <a href="#" id="mpForgotLink" style="color:var(--amber-dim);font-size:0.8rem;opacity:0.7">Forgot password?</a>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pwInput = document.getElementById('mpVerify');
  const errEl = document.getElementById('mpVerifyError');
  const progress = document.getElementById('mpVerifyProgress');
  const confirmBtn = document.getElementById('mpVerifyConfirm');
  setTimeout(() => pwInput.focus(), 100);

  // Fetch and show password hint if available
  fetch('/api/master-password/hint').then(r => r.json()).then(d => {
    if (d.hasHint) {
      const area = document.getElementById('mpHintArea');
      const showLink = document.getElementById('mpShowHint');
      const hintText = document.getElementById('mpHintText');
      if (area) area.style.display = '';
      if (showLink) showLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        showLink.style.display = 'none';
        if (hintText) { hintText.textContent = '💡 ' + d.hint; hintText.style.display = ''; }
      });
    }
  }).catch(() => {});

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
        _notifyAuthChange(true);
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
          <li>All your COMMS radio message history</li>
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
        <input type="text" id="mpResetConfirmInput" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder='Type "RESET" to confirm' autocomplete="off" />
        <div class="export-modal-error" id="mpResetError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="mpResetCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-destructive" id="mpResetConfirm">YES, PURGE AND RESET</button>
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

// ── V3 Crypto Primitives ─────────────────────────────────────

/**
 * Derive a raw 256-bit AES key from a password and salt.
 * Uses PBKDF2-HMAC-SHA256 with 100,000 iterations (matches Python backend).
 * @param {string} password
 * @param {Uint8Array} salt  (32 bytes)
 * @returns {Promise<CryptoKey>}
 */
async function _deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  // Derive raw 256-bit key bytes
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  // Import as AES-GCM key
  return crypto.subtle.importKey(
    'raw',
    rawBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Build a 12-byte segment nonce: base_nonce[8] || counter[4 big-endian]
 */
function _segmentNonce(baseNonce, counter) {
  const nonce = new Uint8Array(12);
  nonce.set(baseNonce, 0);
  const dv = new DataView(nonce.buffer);
  dv.setUint32(8, counter, false); // big-endian
  return nonce;
}

/**
 * Build 5-byte segment AAD: counter[4 big-endian] || finalFlag[1]
 */
function _segmentAAD(counter, isFinal) {
  const aad = new Uint8Array(5);
  const dv = new DataView(aad.buffer);
  dv.setUint32(0, counter, false); // big-endian
  aad[4] = isFinal ? 0x01 : 0x00;
  return aad;
}

/**
 * Encrypt a JSON string into V3 Segmented AEAD format.
 * Produces a .blackout / .bkv file using the same binary format
 * as the Python backend (per-segment AES-256-GCM with AAD).
 *
 * @param {string} jsonStr  - The raw JSON to encrypt
 * @param {string} password - User-provided password
 * @returns {Promise<ArrayBuffer>} - Complete V3 .blackout file buffer
 */
async function _encryptToBlackout(jsonStr, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const baseNonce = crypto.getRandomValues(new Uint8Array(BASE_NONCE_BYTES));
  const key = await _deriveKey(password, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(jsonStr);

  // Split plaintext into 64KB segments
  const segments = [];
  for (let offset = 0; offset < plaintext.length; offset += SEGMENT_SIZE) {
    segments.push(plaintext.slice(offset, offset + SEGMENT_SIZE));
  }
  if (segments.length === 0) segments.push(new Uint8Array(0)); // empty data

  // Encrypt each segment
  const encryptedSegments = [];
  let totalSegmentBytes = 0;

  for (let i = 0; i < segments.length; i++) {
    const isFinal = (i === segments.length - 1);
    const nonce = _segmentNonce(baseNonce, i);
    const aad = _segmentAAD(i, isFinal);

    const ctWithTag = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
      key,
      segments[i]
    );
    // Web Crypto returns ciphertext + tag concatenated
    const ctBytes = new Uint8Array(ctWithTag);
    // ctBytes length = plaintext.length + 16 (tag)
    const ptLen = segments[i].length;

    // Build segment header: 4 bytes, bit 31 = final
    const segHeader = new Uint8Array(4);
    const hdrView = new DataView(segHeader.buffer);
    hdrView.setUint32(0, ptLen | (isFinal ? FINAL_FLAG : 0), false);

    // Segment on disk: header(4) + ciphertext(ptLen) + tag(16)
    // Web Crypto gives us ciphertext+tag together
    const segData = new Uint8Array(4 + ctBytes.length);
    segData.set(segHeader, 0);
    segData.set(ctBytes, 4);

    encryptedSegments.push(segData);
    totalSegmentBytes += segData.length;
  }

  // Build output: file header + all segments
  const output = new Uint8Array(V3_HEADER_LEN + totalSegmentBytes);
  output.set(BKVF_MAGIC, 0);
  output[4] = BKVF_VERSION;
  output.set(salt, 5);
  output.set(baseNonce, 5 + SALT_BYTES);

  let pos = V3_HEADER_LEN;
  for (const seg of encryptedSegments) {
    output.set(seg, pos);
    pos += seg.length;
  }

  return output.buffer;
}

// ── Universal Export Modal ───────────────────────────────────

function _showUniversalExportModal(title, desc, onFormatSelected) {
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:460px">
      <div class="export-modal-icon">🗄️</div>
      <div class="export-modal-title">${escapeHtml(title)}</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5;margin-bottom:16px;">
        <p>${escapeHtml(desc)}</p>
      </div>
      
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:24px;">
        <label class="settings-row" style="cursor:pointer; background:rgba(0,0,0,0.2); padding:12px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex; align-items:center; gap:12px;">
            <input type="radio" name="exportFormat" value="encrypted" checked style="accent-color:var(--amber);">
            <div style="flex:1;">
              <div style="color:var(--text-primary); font-size:13px; font-weight:bold; margin-bottom:2px;">Encrypted Vault Format</div>
              <div style="color:var(--text-dim); font-size:11px;">Wraps data in AES-256-GCM. Requires a password to open.</div>
            </div>
          </div>
        </label>
        
        <label class="settings-row" style="cursor:pointer; background:rgba(0,0,0,0.2); padding:12px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex; align-items:center; gap:12px;">
            <input type="radio" name="exportFormat" value="raw" style="accent-color:var(--amber);">
            <div style="flex:1;">
              <div style="color:var(--text-primary); font-size:13px; font-weight:bold; margin-bottom:2px;">Raw Plaintext</div>
              <div style="color:var(--text-dim); font-size:11px;">Exports standard, unencrypted files directly to your OS.</div>
            </div>
          </div>
        </label>
      </div>

      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="univExportCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="univExportConfirm">CONTINUE</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = document.getElementById('univExportCancel');
  const confirmBtn = document.getElementById('univExportConfirm');

  cancelBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  confirmBtn.addEventListener('click', () => {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    overlay.remove();
    onFormatSelected(format);
  });
}

// ── Master Archive Export ──────────────────────────────────────

function _exportMasterArchive() {
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon">🗄️</div>
      <div class="export-modal-title">FULL DRIVE ARCHIVE</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>This will create a complete, encrypted backup of your conversations, workspace files, tools state, and settings.</p>
        <p style="margin-top:8px">Please enter your <strong>Master Password</strong> to encrypt this archive.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="exportPw1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Master Password" autocomplete="off" spellcheck="false" />
        <div class="export-modal-error" id="exportPwError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="exportCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="exportConfirmBtn">CREATE ARCHIVE</button>
      </div>
      <div class="export-modal-progress" id="exportProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="exportProgressText">Packaging full system state...</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = document.getElementById('exportCancelBtn');
  const confirmBtn = document.getElementById('exportConfirmBtn');
  const pw1 = document.getElementById('exportPw1');
  const errDiv = document.getElementById('exportPwError');
  const fields = document.querySelector('.export-modal-fields');
  const actions = document.querySelector('.export-modal-actions');
  const progress = document.getElementById('exportProgress');

  pw1.focus();

  cancelBtn.addEventListener('click', () => overlay.remove());

  pw1.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
  });

  confirmBtn.addEventListener('click', async () => {
    const pw = pw1.value;
    if (!pw) {
      errDiv.textContent = 'Password is required.';
      return;
    }

    // Gather frontend state
    const state = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      state[key] = localStorage.getItem(key);
    }

    errDiv.textContent = '';
    fields.style.display = 'none';
    actions.style.display = 'none';
    progress.style.display = 'flex';

    try {
      const res = await fetch('/api/system/export-archive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Password': pw
        },
        body: JSON.stringify({ frontend_state: state })
      });

      const data = await res.json();
      if (data.cancelled) {
        overlay.remove();
        return;
      }
      
      if (!data.ok) {
        throw new Error(data.error || 'Archive export failed');
      }

      overlay.remove();
      if (typeof showToast === 'function') {
        showToast('✓ Master Archive created successfully', 4000);
      }
    } catch (err) {
      fields.style.display = 'block';
      actions.style.display = 'flex';
      progress.style.display = 'none';
      errDiv.textContent = err.message || 'Export failed.';
    }
  });
}

function _importMasterArchivePrompt() {
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  // Create a hidden file input on the fly
  let fileInput = document.getElementById('masterArchiveFileInput');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'masterArchiveFileInput';
    fileInput.accept = '.blackout';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        _handleImportMasterArchive(e.target.files[0]);
      }
      e.target.value = ''; // reset
    });
  }
  fileInput.click();
}

function _handleImportMasterArchive(file) {
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon" style="color:var(--amber);">⚠️</div>
      <div class="export-modal-title">RESTORE ARCHIVE</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>Restoring this archive will <strong>permanently overwrite</strong> your current drive state, including all conversations and locked files.</p>
        <p style="margin-top:8px">Enter the <strong>Master Password</strong> used when this archive was created.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="importPw1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Archive Password" autocomplete="off" spellcheck="false" />
        <div class="export-modal-error" id="importPwError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="importCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="importConfirmBtn">OVERWRITE & RESTORE</button>
      </div>
      <div class="export-modal-progress" id="importProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span id="importProgressText">Decrypting and restoring drive...</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = document.getElementById('importCancelBtn');
  const confirmBtn = document.getElementById('importConfirmBtn');
  const pw1 = document.getElementById('importPw1');
  const errDiv = document.getElementById('importPwError');
  const fields = document.querySelector('.export-modal-fields');
  const actions = document.querySelector('.export-modal-actions');
  const progress = document.getElementById('importProgress');

  pw1.focus();

  cancelBtn.addEventListener('click', () => overlay.remove());
  pw1.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
  });

  confirmBtn.addEventListener('click', async () => {
    const pw = pw1.value;
    if (!pw) {
      errDiv.textContent = 'Password is required.';
      return;
    }

    errDiv.textContent = '';
    fields.style.display = 'none';
    actions.style.display = 'none';
    progress.style.display = 'flex';

    try {
      const res = await fetch('/api/system/import-archive', {
        method: 'POST',
        headers: {
          'X-Password': pw
        },
        body: file
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Archive restore failed');
      }

      // Restore frontend state
      if (data.frontend_state) {
        localStorage.clear();
        for (const [k, v] of Object.entries(data.frontend_state)) {
          localStorage.setItem(k, v);
        }
      }

      overlay.innerHTML = `
        <div class="export-modal-dialog" style="max-width:420px; text-align:center;">
          <div class="export-modal-icon" style="color:var(--text-primary);">✓</div>
          <div class="export-modal-title">RESTORE COMPLETE</div>
          <div class="export-modal-body" style="font-size:0.85rem;line-height:1.5">
            The drive has been successfully restored. Rebooting system UI...
          </div>
        </div>
      `;
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (err) {
      fields.style.display = 'block';
      actions.style.display = 'flex';
      progress.style.display = 'none';
      errDiv.textContent = err.message || 'Restore failed.';
    }
  });
}

// ── Password Modal ───────────────────────────────────────────

function _showConversationExportModal() {
  _showUniversalExportModal(
    'EXPORT CONVERSATIONS',
    'Choose the export format for your conversation backup. You can export as a secure, encrypted vault file, or as a standard readable JSON file.',
    (format) => {
      if (format === 'encrypted') {
        _showConversationPasswordModal();
      } else {
        _executeRawConversationExport();
      }
    }
  );
}

async function _executeRawConversationExport() {
  try {
    const dataStr = localStorage.getItem('bd-conversations') || '[]';
    const fileName = `blackout-conversations-${new Date().toISOString().split('T')[0]}.json`;
    const res = await fetch('/api/save-to-disk', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(fileName) },
      body: new Blob([dataStr], { type: 'application/json' }),
    });
    const result = await res.json();
    if (result.cancelled) return;
    
    if (typeof showToast === 'function') {
      showToast('✓ Conversations exported securely', 4000);
    }
  } catch (err) {
    console.error('Raw export failed', err);
    alert('Failed to export conversations: ' + err.message);
  }
}

function _showConversationPasswordModal() {
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
        <input type="password" id="exportPw1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Password for this export" autocomplete="off" spellcheck="false" />
        <input type="password" id="exportPw2" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
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
  if (password.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
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

    // 5. Save to disk via native dialog
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `blackout_archive_${dateStr}.blackout`;
    const saveRes = await fetch('/api/save-to-disk', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(fileName) },
      body: new Blob([encrypted], { type: 'application/octet-stream' }),
    });
    const saveResult = await saveRes.json();
    if (saveResult.cancelled) {
      overlay.remove();
      return;
    }

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

// ── Data Import / Restore ────────────────────────────────────

async function _handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; // Reset input so same file can be selected again
  
  // Read file as ArrayBuffer
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });

  // Prompt for password
  _showImportPasswordModal(async (password, errEl, progressEl, confirmBtn, overlay) => {
    errEl.textContent = '';
    progressEl.style.display = 'flex';
    confirmBtn.disabled = true;
    try {
      // 1. Decrypt buffer
      const archiveJson = await _decryptFileBufferWithPassword(buffer, password);
      
      // 2. Validate format
      if (archiveJson.format !== 'blackout-archive' || !Array.isArray(archiveJson.conversations)) {
        throw new Error('Invalid archive format');
      }
      
      // 3. Post to backend
      let successCount = 0;
      for (const conv of archiveJson.conversations) {
        try {
          const res = await fetch('/api/conversations/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conv)
          });
          if (res.ok) successCount++;
        } catch { /* ignore individual failures */ }
      }
      
      overlay.remove();
      if (typeof showToast === 'function') {
        showToast(`Successfully imported ${successCount} conversation${successCount !== 1 ? 's' : ''}`, 5000);
      }
      if (typeof loadConversations === 'function') loadConversations();
    } catch (e) {
      errEl.textContent = e.message || 'Decryption failed. Wrong password?';
      progressEl.style.display = 'none';
      confirmBtn.disabled = false;
    }
  });
}

function _showImportPasswordModal(onSubmit) {
  const existing = document.getElementById('exportModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exportModal';
  overlay.className = 'export-modal-overlay';
  overlay.innerHTML = `
    <div class="export-modal-dialog" style="max-width:420px">
      <div class="export-modal-icon">🔓</div>
      <div class="export-modal-title">UNLOCK BACKUP</div>
      <div class="export-modal-body" style="text-align:left;font-size:0.85rem;line-height:1.5">
        <p>Enter the password you used when you originally exported this file.</p>
      </div>
      <div class="export-modal-fields">
        <input type="password" id="importPw" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Backup password" autocomplete="off" spellcheck="false" />
        <div class="export-modal-error" id="importPwError"></div>
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="importCancelBtn">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="importConfirmBtn">DECRYPT & RESTORE</button>
      </div>
      <div class="export-modal-progress" id="importProgress" style="display:none">
        <div class="export-modal-spinner"></div>
        <span>Decrypting...</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const pwInput = document.getElementById('importPw');
  const errEl = document.getElementById('importPwError');
  const progress = document.getElementById('importProgress');
  const confirmBtn = document.getElementById('importConfirmBtn');
  const cancelBtn = document.getElementById('importCancelBtn');

  setTimeout(() => pwInput.focus(), 100);

  cancelBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const doSubmit = () => {
    if (!pwInput.value) {
      errEl.textContent = 'Password required';
      return;
    }
    onSubmit(pwInput.value, errEl, progress, confirmBtn, overlay);
  };

  confirmBtn.addEventListener('click', doSubmit);
  pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSubmit();
  });
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
  return _decryptFileBufferWithPassword(buf, password);
}

async function _decryptFileBufferWithPassword(buffer, password) {
  const view = new Uint8Array(buffer);

  if (view.length < V3_HEADER_LEN + 4 + GCM_TAG_BYTES) {
    throw new Error('Invalid encrypted data — too short');
  }

  // Parse V3 header
  const magic = view.slice(0, 4);
  if (magic[0] !== 0x42 || magic[1] !== 0x4B || magic[2] !== 0x56 || magic[3] !== 0x46) {
    throw new Error('Invalid encrypted data — wrong magic bytes');
  }
  const version = view[4];
  if (version !== BKVF_VERSION) {
    throw new Error(`Unsupported encryption version: 0x${version.toString(16).padStart(2,'0')}`);
  }

  const salt = view.slice(5, 5 + SALT_BYTES);
  const baseNonce = view.slice(5 + SALT_BYTES, V3_HEADER_LEN);
  const key = await _deriveKey(password, salt);

  // Decrypt segments
  const plaintextChunks = [];
  let pos = V3_HEADER_LEN;
  let counter = 0;

  while (pos < view.length) {
    // Read segment header (4 bytes)
    if (pos + 4 > view.length) throw new Error('Corrupt data — truncated segment header');
    const segHdr = new DataView(view.buffer, view.byteOffset + pos, 4).getUint32(0, false);
    const isFinal = !!(segHdr & FINAL_FLAG);
    const ptLen = segHdr & ~FINAL_FLAG;
    pos += 4;

    if (ptLen > SEGMENT_SIZE) throw new Error(`Corrupt data — segment ${counter} too large`);

    // Read ciphertext + tag (ptLen + 16 bytes)
    const ctLen = ptLen + GCM_TAG_BYTES;
    if (pos + ctLen > view.length) throw new Error(`Corrupt data — truncated segment ${counter}`);
    const ctWithTag = view.slice(pos, pos + ctLen);
    pos += ctLen;

    // Derive nonce and AAD for this segment
    const nonce = _segmentNonce(baseNonce, counter);
    const aad = _segmentAAD(counter, isFinal);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
        key,
        ctWithTag
      );
      plaintextChunks.push(new Uint8Array(plaintext));
    } catch (e) {
      if (counter === 0) throw new Error('Wrong password');
      throw new Error(`Segment ${counter} authentication failed — tampered data`);
    }

    if (isFinal) break;
    counter++;
  }

  // Reassemble plaintext
  const totalLen = plaintextChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of plaintextChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(combined));
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
          <p style="margin-top:8px;opacity:0.7;font-size:0.8rem">You can change your password anytime in Settings → System & Data.</p>
        </div>
        <div class="export-modal-fields">
          <input type="password" id="mpCreate1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                 placeholder="Choose a password (at least 8 characters)" autocomplete="off" />
          <input type="password" id="mpCreate2" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                 placeholder="Type it again to confirm" autocomplete="off" />
          <input type="text" id="mpHint" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                 placeholder="Password hint (optional — helps you remember)" maxlength="100" />
          <div style="font-size:0.72rem;opacity:0.45;margin-top:2px;padding-left:2px">⚠ Don't write your actual password here. This hint is stored unencrypted.</div>
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
      if (!password || password.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters'; return;
      }
      if (password !== pw2.value) {
        errEl.textContent = 'Passwords do not match'; pw2.value = ''; pw2.focus(); return;
      }
      errEl.textContent = '';
      confirmBtn.disabled = true;
      progress.style.display = 'flex';
      try {
        const hint = (document.getElementById('mpHint')?.value || '').trim();
        const res = await fetch('/api/master-password/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, hint }),
        });
        const data = await res.json();
        if (data.ok) {
          sessionStorage.setItem(_MP_SESSION_KEY, password);
          _notifyAuthChange(true);
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
        <input type="password" id="cpCurrent" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="Your current password" autocomplete="off" />
        <input type="password" id="cpNew1" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
               placeholder="New password (at least 8 characters)" autocomplete="off" />
        <input type="password" id="cpNew2" class="export-modal-input" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
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
    if (!newPw || newPw.length < 8) { errEl.textContent = 'New password must be at least 8 characters'; return; }
    if (newPw !== newPw2.value) { errEl.textContent = 'New passwords do not match'; newPw2.value = ''; newPw2.focus(); return; }
    if (oldPw === newPw) { errEl.textContent = 'New password must be different from current'; return; }

    errEl.textContent = '';
    confirmBtn.disabled = true;
    progress.style.display = 'flex';
    progressText.textContent = 'Verifying & re-encrypting files...';

    try {
      // Step 1: Server re-encrypts locked files + updates verifier hash
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
      _notifyAuthChange(true);
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
