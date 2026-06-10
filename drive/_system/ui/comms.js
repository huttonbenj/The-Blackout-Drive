/**
 * The Blackout Drive — COMMS Panel
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Full-screen overlay for mesh communication via Meshtastic-compatible radios.
 * Follows the identical open/close/sidebar pattern as tools.js.
 *
 * States:
 *   - RADIO_SILENCE: All TX blocked (toggled in Settings)
 *   - HARDWARE_REQUIRED: No serial port detected
 *   - CONNECTED: Live message feed + compose bar + dispatch controls
 *
 * Polls /api/comms/status every 5s and /api/comms/messages every 3s.
 * Radio Silence toggle is handled in Settings (separate from Blackout Protocol).
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// AUDIO ALERT SYSTEM — Web Audio API
// ═══════════════════════════════════════════════════════════
// Tactical audio cues for COMMS events.
// All sounds are generated procedurally via Web Audio API — zero file dependencies.
//
// SECURITY: Blackout Protocol forces ALL audio OFF. The audio toggle
// in Settings is greyed out and locked when BP is active.
//
// Audio Events:
//   - RX_MSG:      Short ascending tone — incoming mesh message
//   - TX_CONFIRM:  Quick dual-beep — your message transmitted successfully
//   - ALERT:       Urgent triple-pulse — ALERT-classified incoming message
//   - CONNECTION:  Status chime — radio connected/disconnected
//   - ERROR:       Low descending tone — send failure / error

let _commsAudioCtx = null;    // Lazy-initialized AudioContext
const COMMS_AUDIO_KEY = 'bd-comms-audio'; // localStorage key

function _commsAudioEnabled() {
  // Blackout Protocol forces all audio OFF — non-negotiable
  if (typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn) return false;
  return localStorage.getItem(COMMS_AUDIO_KEY) !== 'false'; // Default ON
}

function _commsGetAudioCtx() {
  if (!_commsAudioCtx) {
    try {
      _commsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return null; }
  }
  // Resume if suspended (autoplay policy)
  if (_commsAudioCtx.state === 'suspended') {
    _commsAudioCtx.resume().catch(() => {});
  }
  return _commsAudioCtx;
}

function _commsPlayTone(frequency, duration, type, gainLevel, rampDown) {
  if (!_commsAudioEnabled()) return;
  const ctx = _commsGetAudioCtx();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(gainLevel || 0.08, ctx.currentTime);
  if (rampDown !== false) {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  }
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

// ── Audio Event Functions ──────────────────────────────────

function _commsAudioRxMsg() {
  // Ascending two-note chirp: 440Hz → 660Hz
  _commsPlayTone(440, 0.08, 'sine', 0.06);
  setTimeout(() => _commsPlayTone(660, 0.12, 'sine', 0.06), 90);
}

function _commsAudioTxConfirm() {
  // Quick dual-beep confirmation: 880Hz × 2
  _commsPlayTone(880, 0.06, 'sine', 0.04);
  setTimeout(() => _commsPlayTone(880, 0.06, 'sine', 0.04), 100);
}

function _commsAudioAlert() {
  // Urgent triple-pulse: 1000Hz, staccato
  for (let i = 0; i < 3; i++) {
    setTimeout(() => _commsPlayTone(1000, 0.08, 'square', 0.05), i * 120);
  }
}

function _commsAudioConnection(connected) {
  if (connected) {
    // Rising chime: C5 → E5 → G5
    _commsPlayTone(523, 0.12, 'sine', 0.05);
    setTimeout(() => _commsPlayTone(659, 0.12, 'sine', 0.05), 130);
    setTimeout(() => _commsPlayTone(784, 0.18, 'sine', 0.05), 260);
  } else {
    // Falling: G4 → E4 → C4
    _commsPlayTone(392, 0.12, 'sine', 0.05);
    setTimeout(() => _commsPlayTone(330, 0.12, 'sine', 0.05), 130);
    setTimeout(() => _commsPlayTone(262, 0.18, 'sine', 0.05), 260);
  }
}

function _commsAudioError() {
  // Low descending buzz: 300Hz → fade
  _commsPlayTone(300, 0.25, 'sawtooth', 0.04);
  setTimeout(() => _commsPlayTone(200, 0.3, 'sawtooth', 0.03), 200);
}

// ── Audio Toggle UI ────────────────────────────────────────

function _commsToggleAudio() {
  // Blackout Protocol check
  if (typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn) return;

  const current = localStorage.getItem(COMMS_AUDIO_KEY) !== 'false';
  localStorage.setItem(COMMS_AUDIO_KEY, (!current).toString());
  _commsUpdateAudioToggleUI();

  // Play a test tone when enabling
  if (!current) _commsAudioTxConfirm();
}

function _commsUpdateAudioToggleUI() {
  const btn = document.getElementById('commsAudioToggle');
  if (!btn) return;

  const bpActive = typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn;
  const enabled = _commsAudioEnabled();

  if (bpActive) {
    btn.className = 'comms-audio-toggle comms-audio-toggle--locked';
    btn.innerHTML = '🔇 <span class="comms-audio-toggle-text">AUDIO LOCKED (Blackout Protocol)</span>';
    btn.title = 'Blackout Protocol forces all audio OFF';
    btn.disabled = true;
  } else if (enabled) {
    btn.className = 'comms-audio-toggle comms-audio-toggle--on';
    btn.innerHTML = '🔊 <span class="comms-audio-toggle-text">AUDIO ON</span>';
    btn.title = 'Click to disable audio alerts';
    btn.disabled = false;
  } else {
    btn.className = 'comms-audio-toggle comms-audio-toggle--off';
    btn.innerHTML = '🔇 <span class="comms-audio-toggle-text">AUDIO OFF</span>';
    btn.title = 'Click to enable audio alerts';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let _commsOpen = false;
let _commsOpening = false; // guard against re-entry
let _commsHardwareConnected = false; // Set by status polling
let _commsInitializing = true;       // True until server COMMS subsystem is ready
let _commsStoreUnlocked = false;     // COMMS vault lock state (tracks server store_unlocked)
let _commsReunlockInFlight = false;  // Guard against parallel re-unlock storms (F-05)
let _commsLastMsgId = 0; // Last msg_id received (replaces timestamp)
let _commsRenderedIds = new Set(); // msg_ids already in DOM
let _commsStatusTimer = null;
let _commsMsgTimer = null;
// _commsConfigExpanded removed — config bar absorbed into Intel Dashboard
let _commsIntelTab = 'roster'; // LEGACY — kept for compat, no longer used for tabs
let _commsNodeViewMode = localStorage.getItem('bd-comms-node-view') || 'compact'; // 'compact' | 'tactical'
let _commsAudioSuppressed = false; // Suppress audio AND unread counting during initial batch load
let _commsNodes = []; // Cached node list from status API
let _commsLastStatus = null; // Cached full status response (updated every poll cycle)
let _commsProvisioningStatus = null; // Cached provisioning status from API
let _commsActiveFilter = 'all'; // 'all' | 'ch0'..'ch7' | 'dm:!nodeid'
let _commsAllMessages = []; // Full message buffer for re-filtering
const COMMS_UNREAD_KEY = 'bd-comms-unread'; // localStorage persistence key
let _commsUnread = {}; // { 'ch0': 2, 'ch1': 0, 'dm:!abc': 3 } unread counts per filter
// Restore persisted unreads from localStorage so badges survive page refresh.
// The _commsAudioSuppressed guard in _commsAppendMessages prevents the initial
// batch from re-counting historical messages on top of these restored values.
try {
  const saved = localStorage.getItem(COMMS_UNREAD_KEY);
  if (saved) _commsUnread = JSON.parse(saved);
} catch {}

const COMMS_SS_KEY = 'dd_comms';
const COMMS_STATUS_INTERVAL = 5000; // 5s
const COMMS_STATUS_FAST_INTERVAL = 1000; // 1s (during active dispatch)
const COMMS_MSG_INTERVAL = 3000;    // 3s

// Fast-polling state: when @beacon is sent, we poll at 1s instead of 5s
// to catch the PROCESSING → IDLE transition in real time.
let _commsFastPollTimer = null;
let _commsFastPollUntil = 0;

function _saveCommsState() {
  try {
    sessionStorage.setItem(COMMS_SS_KEY, JSON.stringify({ open: _commsOpen }));
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// FAST-POLLING — catch BEACON dispatch state transitions
// ═══════════════════════════════════════════════════════════

/**
 * Start fast-polling status at 1s intervals after sending @beacon.
 * Auto-stops after 60 seconds or when dispatch returns to idle.
 */
function _commsStartFastPoll() {
  // Clear any existing fast-poll timer
  if (_commsFastPollTimer) clearInterval(_commsFastPollTimer);
  _commsFastPollUntil = Date.now() + 60000; // 60s max
  _commsFastPollTimer = setInterval(() => {
    if (Date.now() > _commsFastPollUntil) {
      _commsStopFastPoll();
      return;
    }
    _commsPollStatus();
  }, COMMS_STATUS_FAST_INTERVAL);
  // Also do an immediate poll right now
  _commsPollStatus();
}

function _commsStopFastPoll() {
  if (_commsFastPollTimer) {
    clearInterval(_commsFastPollTimer);
    _commsFastPollTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════
// THINKING INDICATOR — shows animated dots while BEACON processes
// ═══════════════════════════════════════════════════════════

function _commsShowThinkingIndicator() {
  _commsRemoveThinkingIndicator(); // Remove any existing
  const feed = document.getElementById('commsFeed');
  if (!feed) return;
  const el = document.createElement('div');
  el.className = 'comms-msg comms-msg--rx comms-msg--ai comms-msg--thinking';
  el.id = 'commsThinkingIndicator';
  el.innerHTML = `
    <div class="comms-msg-header">
      <span class="comms-msg-sender">BEACON</span>
      <span class="comms-msg-badge">AI</span>
    </div>
    <div class="comms-msg-body comms-thinking-body">
      <span class="comms-thinking-dots">
        <span></span><span></span><span></span>
      </span>
    </div>`;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function _commsRemoveThinkingIndicator() {
  const el = document.getElementById('commsThinkingIndicator');
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════
// PANEL OPEN / CLOSE
// ═══════════════════════════════════════════════════════════

function openComms() {
  _commsOpening = true;

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

  // Close Tools directly without restoring main-content
  const toolsPanel = document.getElementById('toolsPanel');
  if (toolsPanel && toolsPanel.style.display !== 'none') {
    if (typeof _toolsOpening !== 'undefined') _toolsOpening = false;
    // Cleanup active tool
    if (typeof _activeToolId !== 'undefined' && _activeToolId) {
      const tool = (typeof TOOLS_REGISTRY !== 'undefined' ? TOOLS_REGISTRY : []).find(t => t.id === _activeToolId);
      if (tool && typeof tool.cleanup === 'function') tool.cleanup();
      _activeToolId = null;
    }
    toolsPanel.style.display = 'none';
    if (typeof _toolsOpen !== 'undefined') _toolsOpen = false;
    document.body.style.overflow = '';
    try { sessionStorage.removeItem('dd_tools'); } catch {}
  }

  _commsOpening = false;

  // Show COMMS panel
  const panel = document.getElementById('commsPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  _commsOpen = true;
  document.body.style.overflow = 'hidden';

  // Hide main chat content
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = 'none';

  // Set sidebar active
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('commsNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();

  // Render and start polling
  _commsRender();
  _commsStartPolling();
  _commsStartHeartbeat();
  _commsUpdateAudioToggleUI();
  _commsFetchProvisioningStatus(); // Compose hint needs this
  _saveCommsState();
}

function closeComms() {
  if (_commsOpening) return;

  const panel = document.getElementById('commsPanel');
  if (!panel) return;
  panel.style.display = 'none';
  _commsOpen = false;
  document.body.style.overflow = '';

  // Restore main chat content
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = '';

  // Reset sidebar
  if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('chatNavBtn');
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();

  // Stop polling and heartbeat
  _commsStopPolling();
  _commsStopHeartbeat();
  _commsStopElapsedTimer();

  // Clear persisted state
  try { sessionStorage.removeItem(COMMS_SS_KEY); } catch {}
}

// ═══════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════

function _commsStartPolling() {
  _commsStopPolling();
  // Immediate first poll
  _commsPollStatus();
  _commsPollMessages();
  _commsStatusTimer = setInterval(_commsPollStatus, COMMS_STATUS_INTERVAL);
  _commsMsgTimer = setInterval(_commsPollMessages, COMMS_MSG_INTERVAL);
}

function _commsStopPolling() {
  if (_commsStatusTimer) { clearInterval(_commsStatusTimer); _commsStatusTimer = null; }
  if (_commsMsgTimer) { clearInterval(_commsMsgTimer); _commsMsgTimer = null; }
}

function _commsPollStatus() {
  fetch('/api/comms/status')
    .then(r => r.json())
    .then(data => {
      // Check for server-side errors (e.g. 500 Internal Server Error)
      if (data.error) {
        console.error("COMMS API Error:", data.error);
        return; // Preserve existing connection state on temporary server errors
      }

      // Capture previous state BEFORE updating
      const isFirstPoll = _commsLastStatus === null;
      const prevConnected = _commsHardwareConnected;
      const prevUnlocked = _commsStoreUnlocked;
      const prevInitializing = _commsInitializing;

      // Update current state
      _commsHardwareConnected = !!(data.serial && data.serial.connected);
      // Show loading screen when COMMS is either not yet initialized
      // OR actively performing its first radio scan (before first scan result)
      _commsInitializing = !!(data.initializing || data.scanning);
      _commsStoreUnlocked = !!data.store_unlocked;
      if (data.nodes) _commsNodes = data.nodes;
      _commsLastStatus = data;

      // ── C9 fix: Radio Silence state reconciliation ──
      // The server is the source of truth for radio_silence state.
      // Sync localStorage from the server response so that all tabs
      // and page reloads reflect the real server state, not a stale
      // localStorage value from a previous session.
      if (typeof data.radio_silence === 'boolean') {
        const serverRS = data.radio_silence;
        const localRS = localStorage.getItem('bd-setting-radio-silence') === 'true';
        if (serverRS !== localRS) {
          localStorage.setItem('bd-setting-radio-silence', serverRS.toString());
          // Update toggle if rendered
          const rsToggle = document.getElementById('commsEmitRadioSilence');
          if (rsToggle && rsToggle.checked !== serverRS) {
            rsToggle.checked = serverRS;
          }
        }
      }

      // ENH-5: Connection state change notification
      // Only fire after we've polled at least once (isFirstPoll === false).
      // On the very first poll, we don't know the "previous" state — it's
      // just the JS initializer default. Firing here would cause a phantom
      // "Radio connected" notification on every page load.
      if (!isFirstPoll && prevConnected !== _commsHardwareConnected && _commsOpen) {
        const sysMsg = {
          type: 'system',
          text: _commsHardwareConnected ? '● Radio connected' : '● Radio disconnected',
          msg_id: `sys_conn_${Date.now()}`,
          _localTs: Date.now(),
        };
        _commsAllMessages.push(sysMsg);
        const feed = document.getElementById('commsFeed');
        if (feed) {
          feed.appendChild(_commsBuildMsgElement(sysMsg));
          feed.scrollTop = feed.scrollHeight;
        }
        if (_commsHardwareConnected) _commsAudioConnection(true);
        else _commsAudioConnection(false);
      }

      // ── Multi-tab resilience (F-05) ──
      // If backend is locked but we have a cached password, silently re-unlock.
      // Handles: Tab B locked backend, server restarted, etc.
      if (!_commsStoreUnlocked && _commsHardwareConnected && !_commsReunlockInFlight) {
        const cachedPw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : null;
        if (cachedPw) {
          _commsReunlockInFlight = true;
          fetch('/api/comms/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: cachedPw }),
          })
            .then(r => r.json())
            .then(d => {
              if (d.ok) {
                _commsStoreUnlocked = true;
                if (_commsOpen) {
                  _commsAudioSuppressed = true;
                  _commsRender();
                }
              }
            })
            .catch(() => {})
            .finally(() => { _commsReunlockInFlight = false; });
          return; // Skip re-render, will happen in the .then()
        }
      }

      // Re-render if state changed (connected/unlocked transition).
      // This MUST fire on first poll too — the initial render shows the
      // disconnected view because _commsHardwareConnected starts as false.
      // The first status poll updates it, and we need to re-render to show
      // the active interface. The _commsAudioSuppressed flag prevents
      // phantom unreads/audio during the re-render cycle.
      if ((prevConnected !== _commsHardwareConnected || prevUnlocked !== _commsStoreUnlocked || prevInitializing !== _commsInitializing) && _commsOpen) {
        _commsAudioSuppressed = true;
        _commsRender();
        // Trigger immediate message poll so the feed populates instantly
        // (the first poll from _commsStartPolling returned early because
        // _commsHardwareConnected was still false when it ran).
        if (_commsHardwareConnected && _commsStoreUnlocked) {
          _commsPollMessages();
        }
      }
      // Update vitals strip if connected and unlocked
      if (_commsHardwareConnected && _commsStoreUnlocked && _commsOpen) {
        _commsUpdateVitals(data);
      }
    })
    .catch(() => {});

  // BUG-11 fix: provisioning status is polled on-demand (panel open,
  // after provisioning actions) rather than every status cycle.
  // Exception: if an async provisioning job is running, fast-poll to
  // track progress and react when it completes.
  if (_commsProvisioningStatus && _commsProvisioningStatus.job
      && _commsProvisioningStatus.job.status === 'running') {
    fetch('/api/comms/provision/status')
      .then(r => r.json())
      .then(d => {
        _commsProvisioningStatus = d;
        // Job just finished — handle result
        if (d.job && d.job.status === 'complete') {
          _commsShowQRModal(d.job.qr_url);
          // Clear the job on the server
          fetch('/api/comms/provision/clear', { method: 'POST' }).catch(() => {});
          _commsProvisioningInFlight = false;
          _commsRender();
        } else if (d.job && d.job.status === 'failed') {
          if (typeof showToast === 'function') showToast('Provisioning failed: ' + (d.job.error || 'Unknown error'), 5000);
          fetch('/api/comms/provision/clear', { method: 'POST' }).catch(() => {});
          _commsProvisioningInFlight = false;
          _commsRender();
        } else {
          // Still running — update the UI with current step
          _commsRender();
        }
      })
      .catch(() => {});
  }
}

function _commsPollMessages() {
  if (!_commsHardwareConnected || !_commsStoreUnlocked) return;
  fetch(`/api/comms/messages?since_id=${_commsLastMsgId}`)
    .then(r => r.json())
    .then(data => {
      if (data.messages && data.messages.length > 0) {
        _commsAppendMessages(data.messages);
        const last = data.messages[data.messages.length - 1];
        if (last.msg_id) _commsLastMsgId = last.msg_id;
      }
    })
    .catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// RENDER — State Router
// ═══════════════════════════════════════════════════════════

function _commsRender() {
  const main = document.getElementById('commsMain');
  if (!main) return;

  const radioSilence = localStorage.getItem('bd-setting-radio-silence') === 'true';
  const isProvisioning = _commsProvisioningInFlight || (_commsProvisioningStatus && _commsProvisioningStatus.job && _commsProvisioningStatus.job.status === 'running');

  if (isProvisioning) {
    _commsRenderProvisioningActive(main);
  } else if (radioSilence) {
    _commsRenderRadioSilence(main);
  } else if (!_commsHardwareConnected) {
    _commsRenderHardwareRequired(main);
  } else if (!_commsStoreUnlocked) {
    _commsRenderVaultLocked(main);
  } else {
    _commsRenderActive(main);
  }
}

// ═══════════════════════════════════════════════════════════
// PROVISIONING STATE
// ═══════════════════════════════════════════════════════════

function _commsRenderProvisioningActive(container) {
  // If we are already showing the provisioning screen, just update the text
  const existing = container.querySelector('.comms-prov-overlay');
  if (existing) {
    const stepEl = document.getElementById('commsProvStepText');
    if (stepEl && _commsProvisioningStatus && _commsProvisioningStatus.job) {
      stepEl.textContent = _commsFormatProvisionStep(_commsProvisioningStatus.job.step);
    }
    return;
  }

  let initialStepText = 'Initializing provisioning engine...';
  if (_commsProvisioningStatus && _commsProvisioningStatus.job) {
    initialStepText = _commsFormatProvisionStep(_commsProvisioningStatus.job.step);
  }

  container.innerHTML = `
    <div class="comms-state-screen comms-prov-overlay">
      <div class="comms-prov-spinner">
        <div class="comms-prov-ring"></div>
      </div>
      <div class="comms-state-title">PROVISIONING IN PROGRESS</div>
      <div class="comms-state-desc">
        Generating secure keys and configuring the radio hardware.
        The radio will drop offline and reboot automatically during this process.
        Please do not disconnect the drive or the radio.
        <br><br>
        <span style="opacity:0.6; font-size:0.85em">This usually takes 30–60 seconds. The radio reboots twice during setup.</span>
      </div>
      <div class="comms-state-detail" style="margin-top: 24px; text-align: center;">
        <div class="comms-detail-val comms-detail-val--warn" id="commsProvStepText" style="font-size: 1.1em; color: var(--color-warn)">
          ${initialStepText}
        </div>
        <div class="comms-prov-progress-bar" style="margin-top:16px">
          <div class="comms-prov-progress-fill"></div>
        </div>
      </div>
    </div>`;
}

function _commsFormatProvisionStep(stepName) {
  const stepLabels = {
    generating_key: 'Generating AES-256 key…',
    encrypting_key: 'Encrypting key…',
    setting_lora: 'Setting LoRa region…',
    waiting_lora_reboot: 'Waiting for radio reboot…',
    programming_radio: 'Programming BEACON channel…',
    naming_basecamp: 'Naming radio Basecamp…',
    waiting_reboot: 'Waiting for radio reboot…',
    saving_state: 'Saving provisioning state…',
  };
  return stepLabels[stepName] || stepName;
}

// ═══════════════════════════════════════════════════════════
// RADIO SILENCE STATE
// ═══════════════════════════════════════════════════════════

function _commsRenderRadioSilence(container) {
  container.innerHTML = `
    <div class="comms-state-screen">
      <div class="comms-state-icon">🔇</div>
      <div class="comms-state-title">RADIO SILENCE ACTIVE</div>
      <div class="comms-state-desc">
        Your radio is muted. No outgoing messages will be sent and the AI will not respond
        to anyone on the mesh. Messages are still received in the background.
      </div>
      <div class="comms-state-detail">
        <div class="comms-detail-row">
          <span class="comms-detail-key">STATUS</span>
          <span class="comms-detail-val comms-detail-val--warn">ALL TRANSMISSIONS BLOCKED</span>
        </div>
      </div>
      <button class="comms-provision-btn" id="commsResumeRadioBtn" style="margin-top:16px">
        📡 RESUME COMMUNICATIONS
      </button>
      <div class="comms-state-note" style="margin-top:12px">
        <strong>Note:</strong> Radio Silence only controls software transmission.
        For true zero-emission security, physically disconnect the radio hardware.
      </div>
    </div>`;

  const resumeBtn = document.getElementById('commsResumeRadioBtn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      // Must update localStorage BEFORE the API call — the render loop
      // reads localStorage to decide which screen to show.
      localStorage.setItem('bd-setting-radio-silence', 'false');
      fetch('/api/comms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_silence: false }),
      })
        .then(() => {
          if (typeof showToast === 'function') showToast('Radio Silence disabled — communications resumed', 3000);
          _commsRender(); // Re-render to exit Radio Silence screen
        })
        .catch(() => {
          if (typeof showToast === 'function') showToast('Failed to disable Radio Silence', 3000);
        });
    });
  }
}

// ═══════════════════════════════════════════════════════════
// HARDWARE REQUIRED STATE
// ═══════════════════════════════════════════════════════════

function _commsRenderHardwareRequired(container) {
  const isWindows = navigator.platform && navigator.platform.indexOf('Win') > -1;

  // If initializing, show a loading banner at the top of the page.
  // Otherwise this is the standard "CONNECT A RADIO" setup page.
  const loadingBanner = _commsInitializing ? `
    <div class="comms-init-banner">
      <div class="comms-init-ring comms-init-ring--small"></div>
      <span>SCANNING FOR RADIO — detecting hardware, please wait...</span>
    </div>` : '';

  container.innerHTML = `
    <div class="comms-state-screen">
      ${loadingBanner}
      <div class="comms-state-icon">📡</div>
      <div class="comms-state-title">CONNECT A RADIO TO GET STARTED</div>
      <div class="comms-state-desc">
        The COMMS panel lets you send and receive encrypted text messages over
        radio — no cell service or internet needed. Plug in a Meshtastic radio
        via USB and this panel activates automatically.
      </div>
      <div class="comms-setup-steps">
        <div class="comms-setup-title">SETUP</div>
        <div class="comms-setup-step">
          <span class="comms-step-num">1</span>
          <span class="comms-step-text">If you bought the Mesh Bundle, your radio came in the box — just plug it into your computer's USB port with the included cable.</span>
        </div>
        <div class="comms-setup-step">
          <span class="comms-step-num">2</span>
          <span class="comms-step-text">If you're using your own radio, it needs Meshtastic firmware. Visit <a href="https://flasher.meshtastic.org" target="_blank" rel="noopener" class="comms-link">flasher.meshtastic.org</a> to set it up.</span>
        </div>
        <div class="comms-setup-step">
          <span class="comms-step-num">3</span>
          <span class="comms-step-text">Once the radio is detected, this screen disappears and the messaging interface loads automatically.</span>
        </div>
      </div>
      <div class="comms-hw-card">
        <div class="comms-hw-card-title">ADDING PEOPLE TO YOUR MESH</div>
        <div class="comms-hw-item">
          <div class="comms-hw-item-name">How Other People Connect</div>
          <div class="comms-hw-item-desc">Your Blackout Drive + radio is one station on the mesh. Anyone with a Meshtastic radio can join — there's no limit. Each person needs their own radio. If they don't have a computer with a Blackout Drive, they use the free Meshtastic app on their phone:</div>
        </div>
        <div class="comms-setup-steps" style="margin-top:0;padding-top:0">
          <div class="comms-setup-step">
            <span class="comms-step-num">1</span>
            <span class="comms-step-text">Download "Meshtastic" (free — App Store and Google Play)</span>
          </div>
          <div class="comms-setup-step">
            <span class="comms-step-num">2</span>
            <span class="comms-step-text">Turn on Bluetooth on their phone</span>
          </div>
          <div class="comms-setup-step">
            <span class="comms-step-num">3</span>
            <span class="comms-step-text">Open the app — it finds nearby radios automatically</span>
          </div>
          <div class="comms-setup-step">
            <span class="comms-step-num">4</span>
            <span class="comms-step-text">They type messages in the app — the radio sends them over the air</span>
          </div>
        </div>
        <div class="comms-hw-item" style="margin-top:8px">
          <div class="comms-hw-item-desc">You don't need the app — your Blackout Drive IS your interface.</div>
        </div>
        <div class="comms-hw-item" style="margin-top:16px">
          <div class="comms-hw-item-name">Channels &amp; Direct Messages</div>
          <div class="comms-hw-item-desc">
            • <strong>Channels</strong> are group conversations. All radios start on the same default channel (CH 0), so everyone in range can talk out of the box with no setup.<br>
            • To create a <strong>private encrypted channel</strong> for your group, use Mesh Provisioning in the COMMS panel (click the 📡 button in the top-right).<br>
            • To send a <strong>private message</strong> to one person, click their name in the sidebar — the compose bar switches to DM mode.
          </div>
        </div>
        <div class="comms-hw-item" style="margin-top:16px">
          <div class="comms-hw-item-name">Extending Range</div>
          <div class="comms-hw-item-desc">Every radio on the mesh relays messages automatically. The more radios between two people, the further messages travel. You can place radios as relays — on a windowsill, a hilltop, or solar-powered outdoors.</div>
        </div>
      </div>
      ${isWindows ? `
      <div class="comms-driver-notice">
        <div class="comms-driver-notice-icon">⚠️</div>
        <div class="comms-driver-notice-text">
          <strong>WINDOWS USERS:</strong> If your radio is plugged in but not detected,
          you need a one-time driver install. Open your drive folder and double-click
          <code>Install Radio Driver (Windows).bat</code>. You'll be asked for
          administrator access once. After that, unplug and re-plug the radio.
          <div style="margin-top:10px">
            <button class="comms-driver-btn" onclick="_commsOpenDriveFolder()">OPEN DRIVE FOLDER</button>
          </div>
        </div>
      </div>` : ''}
      <div class="comms-state-detail" style="margin-top:16px">
        <div class="comms-detail-row">
          <span class="comms-detail-key">PROTOCOL</span>
          <span class="comms-detail-val">Meshtastic (LoRa mesh)</span>
        </div>
        <div class="comms-detail-row">
          <span class="comms-detail-key">ENCRYPTION</span>
          <span class="comms-detail-val">AES-256</span>
        </div>
        <div class="comms-detail-row">
          <span class="comms-detail-key">RANGE</span>
          <span class="comms-detail-val">1–10+ miles</span>
        </div>
        <div class="comms-detail-row">
          <span class="comms-detail-key">POWER</span>
          <span class="comms-detail-val">USB powered</span>
        </div>
      </div>
    </div>`;
}

function _commsOpenDriveFolder() {
  fetch('/api/open-drive-root', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.ok && typeof showToast === 'function') showToast('Drive folder opened', 2000);
    })
    .catch(() => {
      if (typeof showToast === 'function') {
        showToast('Could not open folder automatically. Find your USB drive in File Explorer and run "Install Radio Driver (Windows).bat"', 6000);
      }
    });
}

// ═══════════════════════════════════════════════════════════
// VAULT LOCKED STATE
// ═══════════════════════════════════════════════════════════

function _commsRenderVaultLocked(container) {
  container.innerHTML = `
    <div class="comms-state-screen">
      <div class="comms-state-icon">🔒</div>
      <div class="comms-state-title">COMMS VAULT LOCKED</div>
      <div class="comms-state-desc">
        Your radio messages are stored in an encrypted log on this drive.
        If your computer is ever lost or stolen, no one can read your
        conversations without your password.
      </div>
      <div style="text-align:center;margin:20px 0">
        <button class="comms-unlock-btn" id="commsUnlockBtn">🔑 UNLOCK VAULT</button>
      </div>
      <div class="comms-state-detail">
        <div class="comms-detail-row">
          <span class="comms-detail-key">WHY IS THIS LOCKED?</span>
          <span class="comms-detail-val">Every message you send and receive is automatically saved and encrypted. Your master password is required to open this log.</span>
        </div>
        <div class="comms-detail-row">
          <span class="comms-detail-key">FORGOT PASSWORD?</span>
          <span class="comms-detail-val">Click UNLOCK VAULT above — then use "Forgot password?" at the bottom of the prompt</span>
        </div>
      </div>
    </div>`;

  const btn = document.getElementById('commsUnlockBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      // Use centralized _unlockSession so ALL panels get notified
      const pw = await _unlockSession(async (password) => {
        // Tell server to unlock the COMMS store with this password
        const res = await fetch('/api/comms/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (data.ok) {
          _commsStoreUnlocked = true;
          _commsAudioSuppressed = true;
          _commsRender();
          if (typeof showToast === 'function') showToast('COMMS vault unlocked', 2000);
        } else {
          if (typeof showToast === 'function') showToast(data.error || 'Unlock failed', 3000);
        }
      });
      // If user cancelled, pw is null — no-op
    });
  }
}

/** Called by crypto.js _lockSession() to re-lock the COMMS vault. */
function _commsOnLock() {
  _commsStoreUnlocked = false;
  if (_commsOpen) {
    _commsAudioSuppressed = true;
    _commsRender();
  }
}

// ── Global auth state listener ─────────────────────────────────
// When any panel unlocks/locks the session, this fires to keep COMMS in sync.
document.addEventListener('bd-auth-state-changed', (e) => {
  if (e.detail && e.detail.unlocked === false) {
    _commsOnLock();
  }
  // On unlock: if COMMS hardware is connected but vault is still locked,
  // proactively unlock the server-side vault using the now-cached password.
  if (e.detail && e.detail.unlocked === true && !_commsStoreUnlocked && _commsHardwareConnected) {
    const cachedPw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : null;
    if (cachedPw) {
      fetch('/api/comms/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: cachedPw }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            _commsStoreUnlocked = true;
            if (_commsOpen) {
              _commsAudioSuppressed = true;
              _commsRender();
            }
          }
        })
        .catch(() => {});
    }
  }
});

// ═══════════════════════════════════════════════════════════
// ACTIVE COMMS STATE — Live interface
// ═══════════════════════════════════════════════════════════

function _commsRenderActive(container) {
  // Clear rendered msg tracking on full re-render
  _commsRenderedIds.clear();
  _commsLastMsgId = 0;
  _commsAllMessages = [];
  // Keep _commsUnread intact — restored from localStorage, represents
  // real unread state from before the refresh/re-render.
  // The _commsAudioSuppressed guard below prevents the initial batch
  // from adding phantom counts on top of the restored values.
  _commsActiveFilter = 'all';
  // Suppress audio for the first poll after re-render — prevents old messages
  // from firing RX audio when the feed is rebuilt from scratch.
  _commsAudioSuppressed = true;

  container.innerHTML = `
    <!-- Mesh Vitals Strip -->
    <div class="comms-vitals" id="commsVitals">
      <div class="comms-vitals-left">
        <div class="comms-vitals-indicator comms-vitals-indicator--online"></div>
        <span class="comms-vitals-metric" id="commsVitalsNodes"><strong>0</strong> NODES</span>
        <span class="comms-vitals-sep"></span>
        <span class="comms-vitals-metric" id="commsVitalsTxQ">Sent:<strong>0</strong></span>
        <span class="comms-vitals-sep"></span>
        <span class="comms-vitals-metric" id="commsVitalsRxCount">Received:<strong>0</strong></span>
        <span class="comms-vitals-sep"></span>
        <span class="comms-vitals-metric comms-vitals-metric--enc" id="commsVitalsEnc">🔒 Encrypted</span>
        <span class="comms-vitals-metric comms-vitals-metric--silence" id="commsVitalsSilence" style="display:none">🔇 SILENT</span>
        <span class="comms-vitals-sep"></span>
        <span class="comms-vitals-metric" id="commsVitalsDispatch">BEACON:<strong>Ready</strong></span>
      </div>
      <div class="comms-vitals-right">
        <button class="comms-drawer-toggle comms-drawer-toggle--nav" id="commsToggleNav" onclick="_commsToggleDrawer('nav')" title="Channels & Nodes">☰</button>
        <canvas class="comms-heartbeat" id="commsHeartbeat" width="300" height="28"></canvas>
        <button class="comms-audio-toggle" id="commsAudioToggle" onclick="_commsToggleAudio()">🔊 <span class="comms-audio-toggle-text">AUDIO ON</span></button>
        <button class="comms-drawer-toggle comms-drawer-toggle--intel" id="commsToggleIntel" onclick="_commsToggleDrawer('intel')" title="Settings & Provisioning">📡</button>
      </div>
    </div>

    <!-- Drawer Backdrop (for overlay panels at narrow widths) -->
    <div class="comms-drawer-backdrop" id="commsDrawerBackdrop" onclick="_commsCloseDrawers()"></div>

    <!-- Three-Column Layout -->
    <div class="comms-layout">

      <!-- LEFT: Channel Navigator -->
      <div class="comms-col-nav" id="commsColNav">
        <div class="comms-nav-section-title">CHANNELS</div>
        <div class="comms-nav-hint" style="padding:2px 12px 6px;font-size:0.75em;opacity:0.45;line-height:1.3">Channels are like group conversations. CH 0 is the public channel.</div>
        <div class="comms-nav-list" id="commsNavChannels">
          <div class="comms-nav-item comms-nav-item--active" data-filter="all" onclick="_commsSetFilter('all',this)">
            <span class="comms-nav-icon">◉</span> ALL MESSAGES
          </div>
          <div class="comms-nav-item" data-filter="ch0" onclick="_commsSetFilter('ch0',this)">
            <span class="comms-nav-icon">▸</span> CH 0 <span class="comms-nav-sub">Default</span> <span class="comms-nav-badge" id="commsBadgeCh0" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch1" onclick="_commsSetFilter('ch1',this)">
            <span class="comms-nav-icon">▸</span> CH 1 <span class="comms-nav-sub" id="commsCh1Label">Private</span> <span class="comms-nav-badge" id="commsBadgeCh1" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch2" onclick="_commsSetFilter('ch2',this)">
            <span class="comms-nav-icon">▸</span> CH 2 <span class="comms-nav-badge" id="commsBadgeCh2" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch3" onclick="_commsSetFilter('ch3',this)">
            <span class="comms-nav-icon">▸</span> CH 3 <span class="comms-nav-badge" id="commsBadgeCh3" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch4" onclick="_commsSetFilter('ch4',this)">
            <span class="comms-nav-icon">▸</span> CH 4 <span class="comms-nav-badge" id="commsBadgeCh4" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch5" onclick="_commsSetFilter('ch5',this)">
            <span class="comms-nav-icon">▸</span> CH 5 <span class="comms-nav-badge" id="commsBadgeCh5" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch6" onclick="_commsSetFilter('ch6',this)">
            <span class="comms-nav-icon">▸</span> CH 6 <span class="comms-nav-badge" id="commsBadgeCh6" style="display:none">0</span>
          </div>
          <div class="comms-nav-item" data-filter="ch7" onclick="_commsSetFilter('ch7',this)">
            <span class="comms-nav-icon">▸</span> CH 7 <span class="comms-nav-badge" id="commsBadgeCh7" style="display:none">0</span>
          </div>
        </div>
        <div class="comms-nav-section-title comms-nav-section-title--dm">NODES</div>
        <div class="comms-nav-list" id="commsNavNodes">
          <div class="comms-nav-placeholder" id="commsNavNodesEmpty">No nodes discovered</div>
        </div>
      </div>

      <!-- CENTER: Message Feed -->
      <div class="comms-col-feed" id="commsColFeed">
        <div class="comms-feed" id="commsFeed">
          <div class="comms-feed-empty" id="commsFeedEmpty">
            <div class="comms-feed-empty-icon">📡</div>
            <div class="comms-feed-empty-text">Waiting for messages…</div>
            <div class="comms-feed-empty-hint">Radio messages from other people will appear here.</div>
          </div>
        </div>
        <div class="comms-quick-replies" id="commsQuickReplies">
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('Got it, message received.')">GOT IT</button>
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('Will do.')">WILL DO</button>
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('Say again, message not understood.')">SAY AGAIN</button>
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('Stand by, working.')">STAND BY</button>
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('Negative, unable to comply.')">NEGATIVE</button>
          <button class="comms-qr-btn" onclick="_commsInsertQuickReply('What is your current status?')">STATUS?</button>
          <button class="comms-qr-btn comms-qr-btn--alert" onclick="_commsInsertQuickReply('EMERGENCY. Requesting immediate assistance.')">SOS</button>
          <button class="comms-qr-btn comms-qr-btn--beacon" onclick="_commsInsertQuickReply('@beacon ')">@BEACON</button>
        </div>
        <div class="comms-compose" id="commsCompose">
          <select class="comms-compose-channel" id="commsComposeChannel" title="Channel" onchange="_commsUpdateComposeHint()">
            <option value="0" selected>CH 0</option>
            <option value="1">CH 1</option>
            <option value="2">CH 2</option>
            <option value="3">CH 3</option>
            <option value="4">CH 4</option>
            <option value="5">CH 5</option>
            <option value="6">CH 6</option>
            <option value="7">CH 7</option>
          </select>
          <span class="comms-compose-hint" id="commsComposeHint" style="display:none"></span>
          <input type="text" class="comms-compose-input" id="commsComposeInput" placeholder="Type a message..." maxlength="200" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                 onkeydown="if(event.key==='Enter'){_commsSend();event.preventDefault()}"
                 oninput="_commsUpdateCharCounter()">
          <span class="comms-compose-counter" id="commsCharCounter">0/200</span>
          <button class="comms-compose-send" id="commsComposeSend" onclick="_commsSend()" title="Send">→</button>
        </div>
        <div class="comms-safety-disclaimer">⚠ AI can hallucinate and produce incorrect information. Not a certified life-safety or emergency communications device.</div>

        <!-- Classification Heat Ribbon -->
        <div class="comms-ribbon" id="commsRibbon">
          <div class="comms-ribbon-bar" id="commsRibbonBar"></div>
          <div class="comms-ribbon-legend" id="commsRibbonLegend">Waiting for traffic...</div>
        </div>
      </div>

      <!-- RIGHT: Intel Dashboard (no tabs — single scrollable view) -->
      <div class="comms-col-intel" id="commsColIntel">
        <div class="comms-intel-content" id="commsIntelContent"></div>
      </div>

    </div>
  `;

  // Render the active intel tab
  _commsRenderIntelTab();
  // Render node list in left nav
  _commsRenderNavNodes();
  // Load initial config values (messages come from _commsStartPolling — no duplicate call)
  _commsPollStatus();
  // Show compose hint for initial channel selection (CH 0)
  _commsUpdateComposeHint();
}

// ═══════════════════════════════════════════════════════════
// RESPONSIVE DRAWER TOGGLES
// ═══════════════════════════════════════════════════════════
// At narrow widths, nav and intel panels become slide-out drawers.
// These functions toggle the overlay state.

function _commsToggleDrawer(which) {
  const nav = document.getElementById('commsColNav');
  const intel = document.getElementById('commsColIntel');
  const backdrop = document.getElementById('commsDrawerBackdrop');

  if (which === 'nav') {
    const isOpen = nav && nav.classList.contains('comms-drawer--open');
    // Close any open drawer first
    if (intel) intel.classList.remove('comms-drawer--open');
    if (nav) nav.classList.toggle('comms-drawer--open', !isOpen);
    if (backdrop) backdrop.classList.toggle('comms-drawer-backdrop--visible', !isOpen);
  } else if (which === 'intel') {
    const isOpen = intel && intel.classList.contains('comms-drawer--open');
    if (nav) nav.classList.remove('comms-drawer--open');
    if (intel) intel.classList.toggle('comms-drawer--open', !isOpen);
    if (backdrop) backdrop.classList.toggle('comms-drawer-backdrop--visible', !isOpen);
  }
}

function _commsCloseDrawers() {
  const nav = document.getElementById('commsColNav');
  const intel = document.getElementById('commsColIntel');
  const backdrop = document.getElementById('commsDrawerBackdrop');
  if (nav) nav.classList.remove('comms-drawer--open');
  if (intel) intel.classList.remove('comms-drawer--open');
  if (backdrop) backdrop.classList.remove('comms-drawer-backdrop--visible');
}

// ═══════════════════════════════════════════════════════════
// INTEL DASHBOARD — Unified scrollable view (replaces tabs)
// ═══════════════════════════════════════════════════════════

function _commsSetIntelTab() { /* LEGACY no-op — tabs removed */ }

function _commsRenderIntelTab() {
  const content = document.getElementById('commsIntelContent');
  if (!content) return;

  // Guard: skip full re-render if user is editing basecamp position inputs
  const focused = document.activeElement;
  if (focused && focused.classList && focused.classList.contains('comms-bp-input')) {
    return;
  }

  let html = '';

  // ── Section 1: MESH OVERVIEW (node cards) ──
  // Auto-collapse when left column is in TACTICAL mode (avoids duplication)
  if (_commsNodeViewMode !== 'tactical') {
    html += _commsRenderMeshOverviewHTML();
  } else {
    html += `<div class="comms-dash-section">
      <div class="comms-dash-header">MESH OVERVIEW</div>
      <div class="comms-dash-collapsed-note">Node details shown in left panel (Tactical mode)</div>
    </div>`;
  }

  // ── Section 2: BEACON ENGINE ──
  html += _commsRenderBeaconEngineHTML();

  // ── Section 3: EMISSIONS CONTROL ──
  html += _commsRenderEmissionsHTML();

  // ── Section 4: MESH PROVISIONING ──
  html += _commsRenderProvisioningHTML();

  content.innerHTML = html;

  // Post-render: draw sparklines if mesh overview is visible
  if (_commsNodeViewMode !== 'tactical') {
    const sorted = [..._commsNodes].sort((a, b) => (b.last_heard || 0) - (a.last_heard || 0));
    requestAnimationFrame(() => _commsDrawAllSparklines(sorted, Math.min(COMMS_NODE_CARD_MAX, sorted.length)));
  }

  // Post-render: wire up emission toggle handlers
  _commsWireEmissionToggles();

  // Start elapsed timer for node cards
  _commsStartElapsedTimer();
}

// ═══════════════════════════════════════════════════════════
// NODE IDENTITY CARDS
// ═══════════════════════════════════════════════════════════
// Replaces the static roster table with stacked mini-dashboards.
// Each card shows: callsign, status, elapsed timer, sparkline, encryption.
// Auto-sorted by most recent activity. Capped at 5 visible.

let _commsNodeLastHeard = {};   // { nodeId: timestamp_ms }
let _commsNodeCardTimer = null; // setInterval for elapsed ticking
let _commsNodeCardsExpanded = false; // "Show All" state
const COMMS_NODE_CARD_MAX = 5;

function _commsTrackNodeActivity(nodeId) {
  _commsNodeLastHeard[nodeId] = Date.now();
}

function _commsGetNodeActivity(nodeId) {
  // Count messages from this node in the buffer for sparkline data
  const buckets = new Array(15).fill(0); // 15 × 2min = 30min window
  const now = Date.now();
  for (const msg of _commsAllMessages) {
    if (msg.from !== nodeId && msg.from_name !== nodeId) continue;
    const age = now - (msg._localTs || now);
    const bucket = Math.min(14, Math.floor(age / 120000));
    buckets[14 - bucket]++; // newest on right
  }
  return buckets;
}

function _commsFormatElapsed(ms) {
  if (ms < 0 || !isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function _commsFormatUptime(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Get last message text from a node (for roster preview)
function _commsGetLastNodeMessage(nodeId) {
  for (let i = _commsAllMessages.length - 1; i >= 0; i--) {
    const msg = _commsAllMessages[i];
    if (msg.type === 'system') continue;
    if (msg.from === nodeId || msg.to === nodeId) return msg.text || '';
  }
  return '';
}

function _commsRenderMeshOverviewHTML() {
  if (_commsNodes.length === 0) {
    return `<div class="comms-dash-section">
      <div class="comms-dash-header">MESH OVERVIEW</div>
      <div class="comms-intel-empty">
        <div class="comms-intel-empty-icon">👥</div>
        <div class="comms-intel-empty-text">No nodes discovered</div>
        <div class="comms-intel-empty-hint">Nodes will appear as they join the mesh.</div>
      </div>
    </div>`;
  }

  // Sync backend last_heard into frontend cache for accuracy
  for (const node of _commsNodes) {
    if (node.last_heard && node.user_id) {
      _commsNodeLastHeard[node.user_id] = node.last_heard * 1000;
    }
  }

  const sorted = [..._commsNodes].sort((a, b) => (b.last_heard || 0) - (a.last_heard || 0));
  const visibleCount = _commsNodeCardsExpanded ? sorted.length : Math.min(COMMS_NODE_CARD_MAX, sorted.length);
  const hiddenCount = sorted.length - COMMS_NODE_CARD_MAX;

  let cardsHtml = '';
  for (let i = 0; i < visibleCount; i++) {
    const node = sorted[i];
    const nodeId = node.user_id || '—';
    const name = _commsEscape(node.long_name || node.short_name || nodeId);
    const shortName = _commsEscape(node.short_name || '??');
    const canvasId = `commsSparkline_${nodeId.replace(/[^a-zA-Z0-9]/g, '')}`;

    let elapsed = 'No activity';
    if (node.last_heard_ago != null) {
      elapsed = _commsFormatElapsed(node.last_heard_ago * 1000);
    }

    let batteryHtml = '';
    if (node.telemetry && node.telemetry.battery != null) {
      const pct = Math.min(100, Math.max(0, node.telemetry.battery));
      const fillClass = pct > 50 ? 'good' : pct > 20 ? 'mid' : 'low';
      const voltStr = node.telemetry.voltage > 0 ? ` ${node.telemetry.voltage}V` : '';
      batteryHtml = `
        <div class="comms-node-battery" title="Battery: ${pct}%${voltStr}">
          <div class="comms-node-battery-bar">
            <div class="comms-node-battery-fill comms-node-battery-fill--${fillClass}" style="width:${pct}%"></div>
          </div>
          <span class="comms-node-battery-pct">${pct}%</span>
        </div>`;
    }

    let gpsHtml = '';
    if (node.position) {
      const lat = node.position.lat.toFixed(5);
      const lng = node.position.lng.toFixed(5);
      const alt = node.position.alt || 0;
      const isManual = node.position.source === 'manual';
      let isLive = false;
      if (isManual) {
        isLive = false;
      } else {
        const posTime = node.position.time && node.position.time > 0
          ? node.position.time
          : (node.position.updated && node.position.updated > 0 ? node.position.updated : 0);
        if (posTime > 0) {
          const posAgeSec = Math.floor(Date.now() / 1000) - posTime;
          isLive = posAgeSec < 300;
        }
      }
      const liveClass = isManual ? ' comms-node-gps--manual' : (isLive ? ' comms-node-gps--live' : '');
      const label = isManual ? 'MANUAL' : (isLive ? 'LIVE' : 'GPS');
      gpsHtml = `<div class="comms-node-gps${liveClass}" title="Alt: ${alt}m"><span class="comms-node-gps-icon">📍</span>${label} ${lat}, ${lng}</div>`;
    }

    let statusClass = 'comms-status-dot--offline';
    if (node.last_heard_ago != null) {
      if (node.last_heard_ago < 900) statusClass = 'comms-status-dot--online';
      else if (node.last_heard_ago < 3600) statusClass = 'comms-status-dot--stale';
    }

    let signalHtml = '';
    if (node.snr && node.snr !== 0) {
      const snr = node.snr;
      let signalLabel, signalClass;
      if (snr > 5) { signalLabel = 'EXCELLENT'; signalClass = 'good'; }
      else if (snr > 0) { signalLabel = 'GOOD'; signalClass = 'good'; }
      else if (snr > -5) { signalLabel = 'FAIR'; signalClass = 'mid'; }
      else { signalLabel = 'WEAK'; signalClass = 'low'; }
      signalHtml = `<span class="comms-node-signal comms-node-signal--${signalClass}" title="Signal strength: ${snr} dB (${signalLabel})">📶 ${signalLabel}</span>`;
    }

    let hopsHtml = '';
    if (node.hops && node.hops >= 1) {
      hopsHtml = `<span class="comms-node-hops" title="This radio's messages traveled through ${node.hops} other radio${node.hops > 1 ? 's' : ''} to reach you">↗${node.hops}</span>`;
    }

    let lastMsgHtml = '';
    const lastMsg = _commsGetLastNodeMessage(nodeId);
    if (lastMsg) {
      const preview = lastMsg.length > 40 ? lastMsg.slice(0, 40) + '…' : lastMsg;
      lastMsgHtml = `<div class="comms-node-card-lastmsg" title="${_commsEscape(lastMsg)}">"${_commsEscape(preview)}"</div>`;
    }

    cardsHtml += `
      <div class="comms-node-card" data-node-id="${_commsEscape(nodeId)}" onclick="_commsSetFilter('dm:${_commsEscape(nodeId)}',null)">
        <div class="comms-node-card-top">
          <span class="comms-status-dot ${statusClass}"></span>
          <span class="comms-node-card-name">${name}</span>
          ${batteryHtml}
          ${signalHtml}
          ${hopsHtml}
          <span class="comms-node-card-short">${shortName}</span>
          <span class="comms-node-card-enc">🔒</span>
        </div>
        <div class="comms-node-card-mid">
          <span class="comms-node-card-id">${_commsEscape(nodeId)}</span>
          <span class="comms-node-card-elapsed" data-node-ts="${node.last_heard ? node.last_heard * 1000 : ''}">${elapsed}</span>
        </div>
        ${gpsHtml}
        <div class="comms-node-card-bottom">
          <canvas class="comms-node-sparkline" id="${canvasId}" width="120" height="20"></canvas>
          <span class="comms-node-card-dm">Message →</span>
        </div>
        ${lastMsgHtml}
      </div>`;
  }

  let expanderHtml = '';
  if (!_commsNodeCardsExpanded && hiddenCount > 0) {
    expanderHtml = `<button class="comms-node-expander" onclick="_commsNodeCardsExpanded=true;_commsRenderIntelTab()">▾ SHOW ALL (${hiddenCount} more)</button>`;
  } else if (_commsNodeCardsExpanded && sorted.length > COMMS_NODE_CARD_MAX) {
    expanderHtml = `<button class="comms-node-expander" onclick="_commsNodeCardsExpanded=false;_commsRenderIntelTab()">▴ COLLAPSE</button>`;
  }

  return `<div class="comms-dash-section">
    <div class="comms-dash-header">MESH OVERVIEW</div>
    <div class="comms-node-cards-header">
      <span class="comms-node-cards-title">ACTIVE NODES</span>
      <span class="comms-node-cards-count">${sorted.length}</span>
    </div>
    <div class="comms-node-cards-list">${cardsHtml}</div>
    ${expanderHtml}
  </div>`;
}

// Keep legacy name as alias for backward compat
function _commsRenderRoster(container) {
  container.innerHTML = _commsRenderMeshOverviewHTML();
  const sorted = [..._commsNodes].sort((a, b) => (b.last_heard || 0) - (a.last_heard || 0));
  requestAnimationFrame(() => _commsDrawAllSparklines(sorted, Math.min(COMMS_NODE_CARD_MAX, sorted.length)));
  _commsStartElapsedTimer();
}

function _commsDrawAllSparklines(nodes, count) {
  for (let i = 0; i < count; i++) {
    const node = nodes[i];
    const nodeId = node.user_id || '—';
    const canvasId = `commsSparkline_${nodeId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) continue;

    const buckets = _commsGetNodeActivity(nodeId);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const barW = (w / buckets.length) - 1;
    const maxVal = Math.max(1, ...buckets);

    ctx.clearRect(0, 0, w, h);

    for (let b = 0; b < buckets.length; b++) {
      const val = buckets[b];
      const barH = (val / maxVal) * (h - 2);
      const x = b * (barW + 1);
      const y = h - barH;

      if (val === 0) {
        // Dim baseline bar
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, h - 2, barW, 2);
      } else {
        // Activity bar — brighter for more recent buckets
        const recency = b / buckets.length;
        const alpha = 0.2 + recency * 0.5;
        ctx.fillStyle = `rgba(74,222,128,${alpha})`;
        ctx.fillRect(x, y, barW, barH);
      }
    }
  }
}

function _commsStartElapsedTimer() {
  if (_commsNodeCardTimer) return;
  _commsNodeCardTimer = setInterval(() => {
    const elapsedEls = document.querySelectorAll('.comms-node-card-elapsed');
    for (const el of elapsedEls) {
      const ts = parseInt(el.dataset.nodeTs, 10);
      if (ts) {
        el.textContent = _commsFormatElapsed(Date.now() - ts);
      }
    }
  }, 1000);
}

function _commsStopElapsedTimer() {
  if (_commsNodeCardTimer) {
    clearInterval(_commsNodeCardTimer);
    _commsNodeCardTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════
// BEACON ENGINE — Human-readable AI dispatch status
// ═══════════════════════════════════════════════════════════

function _commsRenderBeaconEngineHTML() {
  const data = _commsLastStatus;
  const d = data ? (data.dispatch || {}) : {};
  const stats = d.stats || {};
  const enabled = d.enabled;
  const role = d.role || 'off';
  const active = d.active_job;
  const queueDepth = d.queue_depth || 0;

  // Engine status indicator
  let statusIcon, statusText, statusClass;
  const modelReady = d.model_ready !== false; // default true for backward compat
  if (!enabled || role === 'off') {
    statusIcon = '○'; statusText = 'DISABLED'; statusClass = 'comms-engine-status--off';
  } else if (active) {
    statusIcon = '⚡'; statusText = 'PROCESSING'; statusClass = 'comms-engine-status--active';
  } else if (!modelReady) {
    statusIcon = '◌'; statusText = 'WARMING'; statusClass = 'comms-engine-status--warming';
  } else {
    statusIcon = '●'; statusText = 'IDLE'; statusClass = 'comms-engine-status--idle';
  }

  // Role badge
  const roleColors = { primary: 'good', standby: 'warn', off: 'bad' };
  const roleClass = roleColors[role] || 'muted';

  // Collapsed stats (click to expand)
  const totalAnswered = stats.queries_processed || 0;
  const totalBlocked = (stats.queries_dropped_rate || 0) +
                       (stats.queries_dropped_dedup || 0) +
                       (stats.queries_dropped_circuit || 0) +
                       (stats.queries_dropped_queue || 0);

  // Saved dispatch config
  const savedRole = localStorage.getItem('bd-comms-dispatch-role') || role;
  const savedChannel = localStorage.getItem('bd-comms-dispatch-channel') || '1';

  return `<div class="comms-dash-section">
    <div class="comms-dash-header">BEACON AI</div>
    <div class="comms-engine-block">
      <div class="comms-engine-status ${statusClass}">
        <span class="comms-engine-status-icon">${statusIcon}</span>
        <span class="comms-engine-status-text">${statusText}</span>
      </div>
      <div class="comms-engine-controls">
        <div class="comms-engine-ctrl-row">
          <span class="comms-engine-ctrl-label" title="Primary = this drive answers @beacon queries. Standby = only answers if the primary doesn't respond.">ROLE</span>
          <select id="commsEngineRole" class="comms-engine-select" onchange="_commsSaveConfig()">
            <option value="primary"${savedRole === 'primary' ? ' selected' : ''}>Primary</option>
            <option value="standby"${savedRole === 'standby' ? ' selected' : ''}>Standby</option>
            <option value="off"${savedRole === 'off' ? ' selected' : ''}>Off</option>
          </select>
        </div>
        <div class="comms-engine-ctrl-row">
          <span class="comms-engine-ctrl-label" title="BEACON listens for @beacon messages on this channel number">CHANNEL</span>
          <input type="number" id="commsEngineChannel" class="comms-engine-input" min="0" max="7" value="${savedChannel}" onchange="_commsSaveConfig()">
        </div>
        <div class="comms-engine-ctrl-row">
          <span class="comms-engine-ctrl-label">QUEUE</span>
          <span class="comms-telem-value comms-telem-value--${queueDepth > 0 ? 'warn' : 'muted'}">${queueDepth} waiting</span>
        </div>
      </div>
      <div class="comms-engine-stats">
        <span class="comms-engine-stat">${totalAnswered} questions answered</span>
        ${(stats.continuations || 0) > 0 || (stats.standby_takeovers || 0) > 0 || totalBlocked > 0 ? `<span class="comms-engine-stat-sep">·</span><span class="comms-engine-stat" title="Follow-up answers">${stats.continuations || 0} follow-ups</span>` : ''}
        ${(stats.standby_takeovers || 0) > 0 ? `<span class="comms-engine-stat-sep">·</span><span class="comms-engine-stat" title="Times this drive answered because the primary didn't respond">${stats.standby_takeovers} takeovers</span>` : ''}
        ${totalBlocked > 0 ? `<span class="comms-engine-stat-sep">·</span><span class="comms-engine-stat comms-engine-stat--warn">${totalBlocked} blocked</span>` : ''}
      </div>
    </div>
  </div>`;
}

// Legacy wrapper — kept for any external callers
function _commsRenderDispatch(container) {
  container.innerHTML = _commsRenderBeaconEngineHTML();
}

// ═══════════════════════════════════════════════════════════
// EMISSIONS CONTROL — OPSEC toggles + connection info
// ═══════════════════════════════════════════════════════════

function _commsRenderEmissionsHTML() {
  const data = _commsLastStatus;
  const bpConfig = data ? data.basecamp_position : null;
  const s = data ? (data.serial || {}) : {};
  const port = s.port || '—';
  const nodeId = s.node_id || '—';
  const portDisplay = port.length > 20 ? '...' + port.slice(-18) : port;

  // Read localStorage state (source of truth for toggle position)
  const radioSilence = localStorage.getItem('bd-setting-radio-silence') === 'true';
  const telChecked = localStorage.getItem('bd-setting-radio-telemetry') === 'true';
  const gpsChecked = localStorage.getItem('bd-setting-gps-position') === 'true';
  const dispChecked = localStorage.getItem('bd-setting-dispatch');
  const dispatchOn = dispChecked === null ? true : dispChecked === 'true';
  const blackoutOn = typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn;

  return `<div class="comms-dash-section">
    <div class="comms-dash-header">
      <span>BROADCAST SETTINGS</span>
      ${blackoutOn ? '<span class="comms-emissions-bp-badge">BLACKOUT ACTIVE</span>' : ''}
    </div>
    <div class="comms-emissions-block">

      <div class="comms-emissions-row comms-emissions-row--silence${radioSilence ? ' comms-emissions-row--silence-active' : ''}">
        <div class="comms-emissions-info">
          <div class="comms-emissions-label comms-emissions-label--silence">⛔ Radio Silence</div>
          <div class="comms-emissions-desc">${radioSilence ? 'All outgoing radio messages are paused' : 'Pause all outgoing radio messages'}</div>
        </div>
        <label class="comms-emissions-toggle">
          <input type="checkbox" id="commsEmitRadioSilence" ${radioSilence ? 'checked' : ''}>
          <span class="comms-emissions-slider comms-emissions-slider--silence"></span>
        </label>
      </div>

      <div class="comms-emissions-divider"></div>

      ${blackoutOn ? `<div class="comms-emissions-bp-notice">
        🔒 Blackout Protocol forces all emissions off. To enable individual
        controls below, disable Blackout Protocol in <strong>Settings</strong>.
      </div>` : ''}

      <div class="comms-emissions-row${blackoutOn ? ' comms-emissions-row--forced' : ''}">
        <div class="comms-emissions-info">
          <div class="comms-emissions-label">Share Battery & Signal Info</div>
          <div class="comms-emissions-desc">${blackoutOn ? 'Forced off by Blackout Protocol' : 'Lets others on the mesh see your radio\'s battery level and signal strength'}</div>
        </div>
        <label class="comms-emissions-toggle">
          <input type="checkbox" id="commsEmitTelemetry" ${telChecked && !blackoutOn ? 'checked' : ''} ${blackoutOn ? 'disabled' : ''}>
          <span class="comms-emissions-slider"></span>
        </label>
      </div>

      <div class="comms-emissions-row${blackoutOn ? ' comms-emissions-row--forced' : ''}">
        <div class="comms-emissions-info">
          <div class="comms-emissions-label">Share Location</div>
          <div class="comms-emissions-desc">${blackoutOn ? 'Forced off by Blackout Protocol' : 'Shares your radio\'s GPS location with others on the mesh every 15 min'}</div>
        </div>
        <label class="comms-emissions-toggle">
          <input type="checkbox" id="commsEmitGPS" ${gpsChecked && !blackoutOn ? 'checked' : ''} ${blackoutOn ? 'disabled' : ''}>
          <span class="comms-emissions-slider"></span>
        </label>
      </div>

      <div class="comms-emissions-row${blackoutOn ? ' comms-emissions-row--forced' : ''}">
        <div class="comms-emissions-info">
          <div class="comms-emissions-label">AI Auto-Reply (@BEACON)</div>
          <div class="comms-emissions-desc">${blackoutOn ? 'Forced off by Blackout Protocol' : 'When someone types @beacon in a message, your AI automatically answers them'}</div>
        </div>
        <label class="comms-emissions-toggle">
          <input type="checkbox" id="commsEmitDispatch" ${dispatchOn && !blackoutOn ? 'checked' : ''} ${blackoutOn ? 'disabled' : ''}>
          <span class="comms-emissions-slider"></span>
        </label>
      </div>

      <div class="comms-emissions-divider"></div>

      <div class="comms-emissions-basecamp">
        <div class="comms-emissions-label">Manual Basecamp Position</div>
        <div class="comms-emissions-desc">${bpConfig ? '📍 Active — coordinates set' : 'Set your position if your radio has no GPS. If it does, this is ignored.'}</div>
        <div class="comms-emissions-bp-inputs">
          <input type="text" id="comms-bp-lat" class="comms-bp-input" placeholder="Latitude (e.g. 32.123)" value="${bpConfig ? bpConfig.lat : ''}">
          <input type="text" id="comms-bp-lng" class="comms-bp-input" placeholder="Longitude (e.g. -90.456)" value="${bpConfig ? bpConfig.lng : ''}">
          <input type="text" id="comms-bp-alt" class="comms-bp-input comms-bp-input--short" placeholder="Altitude (m)" value="${bpConfig ? bpConfig.alt : ''}">
        </div>
        <div class="comms-emissions-bp-actions">
          <button id="comms-bp-save" class="comms-emissions-btn comms-emissions-btn--save">Save</button>
          ${bpConfig ? '<button id="comms-bp-clear" class="comms-emissions-btn comms-emissions-btn--clear">Clear</button>' : ''}
        </div>
        <div id="comms-bp-msg" class="comms-emissions-bp-msg"></div>
      </div>

      <div class="comms-emissions-divider"></div>

      <div class="comms-emissions-conn">
        <div class="comms-emissions-conn-item">
          <span class="comms-emissions-conn-label">PORT</span>
          <span class="comms-emissions-conn-val" title="${_commsEscape(port)}">${_commsEscape(portDisplay)}</span>
        </div>
        <div class="comms-emissions-conn-item">
          <span class="comms-emissions-conn-label">NODE ID</span>
          <span class="comms-emissions-conn-val">${_commsEscape(nodeId)}</span>
        </div>
      </div>

    </div>
  </div>`;
}

// Wire emission toggle event handlers after DOM render
function _commsWireEmissionToggles() {
  // NOTE: Do NOT capture _blackoutProtocolOn here as a closure variable!
  // It must be read LIVE inside each handler so that toggling Blackout
  // Protocol off actually lets the user control emissions.

  // ── Radio Silence toggle (master kill — syncs with Settings panel) ──
  const rsToggle = document.getElementById('commsEmitRadioSilence');
  if (rsToggle && !rsToggle._commsWired) {
    rsToggle._commsWired = true;
    rsToggle.addEventListener('change', () => {
      localStorage.setItem('bd-setting-radio-silence', rsToggle.checked);
      fetch('/api/comms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_silence: rsToggle.checked }),
      }).catch(() => {});
      if (typeof showToast === 'function') {
        showToast(rsToggle.checked
          ? 'Radio Silence — all transmissions suspended'
          : 'Radio Silence off — communication resumed', 3000);
      }
      // Trigger full state-router re-render so the blocking overlay
      // appears/disappears immediately instead of waiting for the
      // next 3-second poll cycle.
      _commsRender();
    });
  }

  // ── Telemetry toggle ──
  const telToggle = document.getElementById('commsEmitTelemetry');
  if (telToggle && !telToggle._commsWired) {
    telToggle._commsWired = true;
    telToggle.addEventListener('change', () => {
      const bp = typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn;
      if (bp) { telToggle.checked = false; return; }
      localStorage.setItem('bd-setting-radio-telemetry', telToggle.checked);
      fetch('/api/comms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_telemetry: telToggle.checked }),
      }).catch(() => {});
      if (typeof showToast === 'function') {
        showToast(telToggle.checked
          ? 'Device metrics broadcast enabled'
          : 'Device metrics broadcast disabled', 3000);
      }
    });
  }

  // ── GPS toggle ──
  const gpsToggle = document.getElementById('commsEmitGPS');
  if (gpsToggle && !gpsToggle._commsWired) {
    gpsToggle._commsWired = true;
    gpsToggle.addEventListener('change', () => {
      const bp = typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn;
      if (bp) { gpsToggle.checked = false; return; }
      localStorage.setItem('bd-setting-gps-position', gpsToggle.checked);
      fetch('/api/comms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gps_position: gpsToggle.checked }),
      }).catch(() => {});
      if (typeof showToast === 'function') {
        showToast(gpsToggle.checked
          ? 'GPS enabled — broadcasting position'
          : 'GPS disabled — position hidden', 3000);
      }
    });
  }

  // ── @BEACON Dispatch toggle ──
  const dispToggle = document.getElementById('commsEmitDispatch');
  if (dispToggle && !dispToggle._commsWired) {
    dispToggle._commsWired = true;
    dispToggle.addEventListener('change', () => {
      const bp = typeof _blackoutProtocolOn !== 'undefined' && _blackoutProtocolOn;
      if (bp) { dispToggle.checked = false; return; }
      localStorage.setItem('bd-setting-dispatch', dispToggle.checked);
      _commsSaveConfig();
      if (typeof showToast === 'function') {
        showToast(dispToggle.checked
          ? '@BEACON dispatch enabled — AI answering mesh queries'
          : '@BEACON dispatch disabled', 3000);
      }
      // NOTE: Do NOT call _commsRenderIntelTab() here — it destroys and
      // recreates this toggle's DOM, causing re-render churn. The Beacon
      // Engine status updates naturally via _commsPollStatus() which is
      // called inside _commsSaveConfig().
    });
  }

  // ── Basecamp position Save/Clear ──
  const bpSave = document.getElementById('comms-bp-save');
  if (bpSave && !bpSave._commsWired) {
    bpSave._commsWired = true;
    bpSave.addEventListener('click', async () => {
      const latEl = document.getElementById('comms-bp-lat');
      const lngEl = document.getElementById('comms-bp-lng');
      const altEl = document.getElementById('comms-bp-alt');
      const msgEl = document.getElementById('comms-bp-msg');
      const lat = parseFloat(latEl.value);
      const lng = parseFloat(lngEl.value);
      const alt = parseInt(altEl.value) || 0;
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        if (msgEl) { msgEl.textContent = '⚠ Invalid coordinates'; msgEl.style.color = '#f44'; }
        return;
      }
      try {
        const resp = await fetch('/api/comms/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ basecamp_position: { lat, lng, alt } }),
        });
        if (resp.ok) {
          if (msgEl) { msgEl.textContent = '✓ Saved'; msgEl.style.color = '#4caf50'; }
        } else {
          const err = await resp.json().catch(() => ({}));
          if (msgEl) { msgEl.textContent = '⚠ ' + (err.error || 'Failed'); msgEl.style.color = '#f44'; }
        }
      } catch (e) {
        if (msgEl) { msgEl.textContent = '⚠ Network error'; msgEl.style.color = '#f44'; }
      }
    });
  }

  const bpClear = document.getElementById('comms-bp-clear');
  if (bpClear && !bpClear._commsWired) {
    bpClear._commsWired = true;
    bpClear.addEventListener('click', async () => {
      const msgEl = document.getElementById('comms-bp-msg');
      try {
        const resp = await fetch('/api/comms/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ basecamp_position: null }),
        });
        if (resp.ok) {
          const latEl = document.getElementById('comms-bp-lat');
          const lngEl = document.getElementById('comms-bp-lng');
          const altEl = document.getElementById('comms-bp-alt');
          if (latEl) latEl.value = '';
          if (lngEl) lngEl.value = '';
          if (altEl) altEl.value = '';
          if (msgEl) { msgEl.textContent = '✓ Cleared'; msgEl.style.color = '#4caf50'; }
        }
      } catch (e) {
        if (msgEl) { msgEl.textContent = '⚠ Network error'; msgEl.style.color = '#f44'; }
      }
    });
  }
}

// Legacy wrapper
function _commsRenderTelemetry(container) {
  container.innerHTML = _commsRenderEmissionsHTML();
  _commsWireEmissionToggles();
}






// ═══════════════════════════════════════════════════════════
// LEFT NAV — NODE LIST
// ═══════════════════════════════════════════════════════════

function _commsToggleNodeView() {
  _commsNodeViewMode = _commsNodeViewMode === 'compact' ? 'tactical' : 'compact';
  localStorage.setItem('bd-comms-node-view', _commsNodeViewMode);
  _commsRenderNavNodes();
  _commsRenderIntelTab(); // Re-render dashboard (mesh overview auto-collapses in tactical mode)
}

function _commsRenderNavNodes() {
  const container = document.getElementById('commsNavNodes');
  if (!container) return;

  // Build toggle button
  const isCompact = _commsNodeViewMode === 'compact';
  const toggleHtml = `
    <div class="comms-nav-view-toggle">
      <button class="comms-nav-view-btn${isCompact ? ' comms-nav-view-btn--active' : ''}" onclick="_commsToggleNodeView()" title="Switch to ${isCompact ? 'Tactical' : 'Compact'} view">
        ${isCompact ? '▤ COMPACT' : '◫ TACTICAL'}
      </button>
    </div>`;

  if (_commsNodes.length === 0) {
    container.innerHTML = toggleHtml + '<div class="comms-nav-placeholder">No nodes discovered</div>';
    return;
  }

  if (isCompact) {
    // ── COMPACT MODE: Original clean text list ──
    let html = toggleHtml;
    for (const node of _commsNodes) {
      const name = _commsEscape(node.long_name || node.short_name || node.user_id || '?');
      const nodeId = _commsEscape(node.user_id || '');
      const isActive = _commsActiveFilter === `dm:${nodeId}`;
      const badgeId = `commsBadgeDm_${nodeId.replace(/[^a-zA-Z0-9]/g, '')}`;
      let navStatusClass = 'comms-status-dot--offline';
      if (node.last_heard_ago != null) {
        if (node.last_heard_ago < 900) navStatusClass = 'comms-status-dot--online';
        else if (node.last_heard_ago < 3600) navStatusClass = 'comms-status-dot--stale';
      }
      html += `<div class="comms-nav-item comms-nav-item--node${isActive ? ' comms-nav-item--active' : ''}" onclick="_commsSetFilter('dm:${nodeId}',this)">
        <span class="comms-status-dot ${navStatusClass}"></span> ${name}
        <span class="comms-nav-badge" id="${badgeId}" style="display:none">0</span>
      </div>`;
    }
    container.innerHTML = html;
  } else {
    // ── TACTICAL MODE: Rich mini-cards in narrow left column ──
    let html = toggleHtml;
    const sorted = [..._commsNodes].sort((a, b) => (b.last_heard || 0) - (a.last_heard || 0));
    for (const node of sorted) {
      const name = _commsEscape(node.long_name || node.short_name || node.user_id || '?');
      const nodeId = _commsEscape(node.user_id || '');
      const isActive = _commsActiveFilter === `dm:${nodeId}`;
      const badgeId = `commsBadgeDm_${nodeId.replace(/[^a-zA-Z0-9]/g, '')}`;

      let navStatusClass = 'comms-status-dot--offline';
      if (node.last_heard_ago != null) {
        if (node.last_heard_ago < 900) navStatusClass = 'comms-status-dot--online';
        else if (node.last_heard_ago < 3600) navStatusClass = 'comms-status-dot--stale';
      }

      // Battery mini bar
      let batHtml = '';
      if (node.telemetry && node.telemetry.battery != null) {
        const pct = Math.min(100, Math.max(0, node.telemetry.battery));
        const fillClass = pct > 50 ? 'good' : pct > 20 ? 'mid' : 'low';
        batHtml = `<div class="comms-tac-bat"><div class="comms-tac-bat-fill comms-tac-bat-fill--${fillClass}" style="width:${pct}%"></div><span>${pct}%</span></div>`;
      }

      // Signal
      let sigHtml = '';
      if (node.snr && node.snr !== 0) {
        const snr = node.snr;
        let sigClass = snr > 0 ? 'good' : snr > -5 ? 'mid' : 'low';
        sigHtml = `<span class="comms-tac-sig comms-tac-sig--${sigClass}">📶</span>`;
      }

      // Elapsed
      let elapsedHtml = '';
      if (node.last_heard_ago != null) {
        elapsedHtml = `<span class="comms-tac-elapsed">${_commsFormatElapsed(node.last_heard_ago * 1000)}</span>`;
      }

      html += `<div class="comms-nav-tac-card${isActive ? ' comms-nav-tac-card--active' : ''}" onclick="_commsSetFilter('dm:${nodeId}',this)">
        <div class="comms-nav-tac-top">
          <span class="comms-status-dot ${navStatusClass}"></span>
          <span class="comms-nav-tac-name">${name}</span>
          ${sigHtml}
          <span class="comms-nav-badge" id="${badgeId}" style="display:none">0</span>
        </div>
        <div class="comms-nav-tac-bottom">
          ${batHtml}
          ${elapsedHtml}
        </div>
      </div>`;
    }
    container.innerHTML = html;
  }

  _commsUpdateUnreadBadges();
}

function _commsSetFilter(filter, el) {
  // Update active state in nav (both compact and tactical modes)
  document.querySelectorAll('.comms-nav-item').forEach(n => n.classList.remove('comms-nav-item--active'));
  document.querySelectorAll('.comms-nav-tac-card').forEach(n => n.classList.remove('comms-nav-tac-card--active'));
  if (el) {
    if (el.classList.contains('comms-nav-tac-card')) {
      el.classList.add('comms-nav-tac-card--active');
    } else {
      el.classList.add('comms-nav-item--active');
    }
  }

  // Also update active state in Node Cards (right panel)
  document.querySelectorAll('.comms-node-card').forEach(c => c.classList.remove('comms-node-card--active'));
  if (filter.startsWith('dm:')) {
    const nodeId = filter.slice(3);
    const card = document.querySelector(`.comms-node-card[data-node-id="${nodeId}"]`);
    if (card) card.classList.add('comms-node-card--active');
  }

  _commsActiveFilter = filter;

  // Clear unread for this filter
  _commsUnread[filter] = 0;
  _commsUnreadSave();
  _commsUpdateUnreadBadges();

  // Re-render the feed with the new filter applied
  _commsRebuildFeed();

  // ── Compose target sync ────────────────────────────────
  const sel = document.getElementById('commsComposeChannel');
  if (!sel) return;

  // Channel filter → sync dropdown to that channel (broadcast mode)
  const chMatch = filter.match(/^ch(\d+)$/);
  if (chMatch) {
    // Remove DM mode state
    delete sel.dataset.dmTarget;
    sel.value = chMatch[1];
    // Restore channel options if they were replaced
    if (sel.options.length === 1 && sel.options[0].dataset.dm) {
      sel.innerHTML = `
        <option value="0" selected>CH 0</option>
        <option value="1">CH 1</option>
        <option value="2">CH 2</option>
        <option value="3">CH 3</option>
        <option value="4">CH 4</option>
        <option value="5">CH 5</option>
        <option value="6">CH 6</option>
        <option value="7">CH 7</option>`;
    }
    _commsUpdateComposeHint();
    return;
  }

  // DM filter → switch compose to DM target mode
  const dmMatch = filter.match(/^dm:(.+)$/);
  if (dmMatch) {
    const nodeId = dmMatch[1];
    // Look up the node's short name for display
    let label = nodeId;
    const statusNodes = _commsNodes || [];
    const node = statusNodes.find(n => n.user_id === nodeId || ('!' + n.num.toString(16)) === nodeId);
    if (node && node.short_name) label = `DM → ${node.short_name}`;
    else label = `DM → ${nodeId}`;

    // Replace the channel dropdown with DM indicator
    sel.innerHTML = `<option value="dm" data-dm="${nodeId}" selected>${label}</option>`;
    sel.dataset.dmTarget = nodeId;
    return;
  }

  // 'all' or other → restore channel dropdown, keep current channel
  if (sel.options.length === 1 && sel.options[0].dataset.dm) {
    delete sel.dataset.dmTarget;
    sel.innerHTML = `
      <option value="0" selected>CH 0</option>
      <option value="1">CH 1</option>
      <option value="2">CH 2</option>
      <option value="3">CH 3</option>
      <option value="4">CH 4</option>
      <option value="5">CH 5</option>
      <option value="6">CH 6</option>
      <option value="7">CH 7</option>`;
  }
  _commsUpdateComposeHint();
}

function _commsRebuildFeed() {
  const feed = document.getElementById('commsFeed');
  if (!feed) return;

  // Clear feed
  feed.innerHTML = '';
  _commsRenderedIds.clear();

  const filtered = _commsFilterMessages(_commsAllMessages);
  if (filtered.length === 0) {
    let emptyIcon = '📡';
    let emptyText = 'Listening for mesh traffic...';
    let emptyHint = 'Messages on all channels will appear here.';

    if (_commsActiveFilter.startsWith('dm:')) {
      // ENH-6: Improved DM empty state
      const nodeId = _commsActiveFilter.slice(3);
      const node = (_commsNodes || []).find(n => n.user_id === nodeId);
      const nodeName = node ? (node.long_name || node.short_name || nodeId) : nodeId;
      emptyIcon = '💬';
      emptyText = `DM with ${_commsEscape(nodeName)}`;
      emptyHint = 'No messages yet — send the first one below.';
    } else if (_commsActiveFilter !== 'all') {
      emptyIcon = '📻';
      emptyText = `No traffic on ${_commsActiveFilter.toUpperCase()}`;
      emptyHint = 'Messages will appear when traffic is detected.';
    }

    feed.innerHTML = `
      <div class="comms-feed-empty" id="commsFeedEmpty">
        <div class="comms-feed-empty-icon">${emptyIcon}</div>
        <div class="comms-feed-empty-text">${emptyText}</div>
        <div class="comms-feed-empty-hint">${emptyHint}</div>
      </div>`;
    return;
  }

  // Append filtered messages without triggering unread logic
  for (const msg of filtered) {
    if (msg.msg_id) _commsRenderedIds.add(msg.msg_id);
    feed.appendChild(_commsBuildMsgElement(msg));
  }
  feed.scrollTop = feed.scrollHeight;
}

function _commsFilterMessages(messages) {
  if (_commsActiveFilter === 'all') {
    // ALL TRAFFIC: broadcasts only — DMs are private and shown only in DM views
    return messages.filter(m => m.type === 'system' || !m.is_dm);
  }

  const chMatch = _commsActiveFilter.match(/^ch(\d+)$/);
  if (chMatch) {
    const ch = parseInt(chMatch[1], 10);
    // Channel view: only broadcasts on this channel, never DMs
    return messages.filter(m => m.type === 'system' || (!m.is_dm && m.channel === ch));
  }

  // DM filter: dm:!nodeid — show ONLY actual DMs between us and that node.
  // Channel broadcasts from/to that node must NOT leak into the DM view.
  // Match by the OTHER PARTY in the conversation (consistent with _commsGetMsgFilterKey):
  //   RX DMs: other party = sender (m.from)
  //   TX DMs: other party = recipient (m.to)
  if (_commsActiveFilter.startsWith('dm:')) {
    const nodeId = _commsActiveFilter.slice(3);
    return messages.filter(m => {
      if (m.type === 'system') return true;
      if (!m.is_dm) return false;
      const otherParty = m.type === 'rx' ? m.from : m.to;
      return otherParty === nodeId;
    });
  }

  return messages;
}

function _commsGetMsgFilterKey(msg) {
  // Returns the filter key this message belongs to (for unread tracking)
  if (msg.type === 'system') return null; // system msgs don't count
  // DMs track unread per-node (the "other party" in the conversation)
  if (msg.is_dm) {
    // For RX DMs, the other party is the sender. For TX DMs, it's the recipient.
    const otherParty = msg.type === 'rx' ? msg.from : msg.to;
    return otherParty ? `dm:${otherParty}` : null;
  }
  if (msg.channel !== undefined) return `ch${msg.channel}`;
  return null;
}

function _commsUpdateUnreadBadges() {
  // Channel badges
  for (let i = 0; i <= 7; i++) {
    const badge = document.getElementById(`commsBadgeCh${i}`);
    if (!badge) continue;
    const count = _commsUnread[`ch${i}`] || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // DM badges — iterate tracked DM unread keys
  for (const key of Object.keys(_commsUnread)) {
    if (!key.startsWith('dm:')) continue;
    const nodeId = key.slice(3); // e.g. '!04332878'
    const safeId = nodeId.replace(/[^a-zA-Z0-9]/g, '');
    const badge = document.getElementById(`commsBadgeDm_${safeId}`);
    if (!badge) continue;
    const count = _commsUnread[key] || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

function _commsUnreadSave() {
  try { localStorage.setItem(COMMS_UNREAD_KEY, JSON.stringify(_commsUnread)); } catch {}
}

// ═══════════════════════════════════════════════════════════
// MESH VITALS STRIP UPDATE
// ═══════════════════════════════════════════════════════════

let _commsRxTotal = 0; // Running RX message counter

function _commsUpdateVitals(data) {
  const nodesEl = document.getElementById('commsVitalsNodes');
  const txqEl = document.getElementById('commsVitalsTxQ');
  const rxEl = document.getElementById('commsVitalsRxCount');
  const encEl = document.getElementById('commsVitalsEnc');
  const dispEl = document.getElementById('commsVitalsDispatch');

  if (nodesEl && data.serial) {
    nodesEl.innerHTML = `<strong>${data.serial.nodes_seen || 0}</strong> NODES`;
  }
  if (txqEl && data.serial) {
    const q = data.serial.tx_queue_depth || 0;
    txqEl.innerHTML = `Sent:<strong class="${q > 3 ? 'comms-vitals-warn' : ''}">${q}</strong>`;
  }
  if (rxEl) {
    rxEl.innerHTML = `Received:<strong>${_commsRxTotal}</strong>`;
  }
  if (encEl) {
    encEl.innerHTML = '🔒 Encrypted';
  }
  // Radio Silence indicator
  const silEl = document.getElementById('commsVitalsSilence');
  if (silEl) {
    const rs = localStorage.getItem('bd-setting-radio-silence') === 'true';
    silEl.style.display = rs ? '' : 'none';
  }
  if (dispEl && data.dispatch) {
    const role = data.dispatch.role || 'off';
    const enabled = data.dispatch.enabled;
    const active = data.dispatch.active_job;
    const mReady = data.dispatch.model_ready !== false;
    if (!enabled || role === 'off') {
      dispEl.innerHTML = 'BEACON:<strong class="comms-vitals-dim">Off</strong>';
      dispEl.title = 'AI auto-reply is off. Enable it in Broadcast Settings.';
    } else if (active) {
      dispEl.innerHTML = 'BEACON:<strong class="comms-vitals-active">Thinking…</strong>';
      dispEl.title = 'BEACON is answering a question right now.';
    } else if (!mReady) {
      dispEl.innerHTML = 'BEACON:<strong class="comms-vitals-warming">Loading AI…</strong>';
      dispEl.title = 'The AI model is still loading. Questions will be answered once it\'s ready.';
    } else {
      dispEl.innerHTML = 'BEACON:<strong>Ready</strong>';
      dispEl.title = 'AI auto-reply is on and ready to answer @beacon questions.';
    }
  }

  // Push heartbeat pulse (higher amplitude if TX queue has items)
  const txq = data.serial ? (data.serial.tx_queue_depth || 0) : 0;
  _commsHeartbeatPulse(txq > 0 ? 0.8 : 0.3);


  // Refresh left nav node list and intel panel on each status poll
  _commsRenderNavNodes();
  _commsRenderIntelTab();

  // ── Direct engine status DOM update ──
  // The intel tab re-render above rebuilds the entire right panel HTML,
  // which should cover the engine status. But as a belt-and-suspenders
  // safeguard, also do a targeted update of the status indicator element.
  const engineStatusEl = document.querySelector('.comms-engine-status');
  if (engineStatusEl && data.dispatch) {
    const eng = data.dispatch;
    if (!eng.enabled || (eng.role || 'off') === 'off') {
      engineStatusEl.className = 'comms-engine-status comms-engine-status--off';
      const icon = engineStatusEl.querySelector('.comms-engine-status-icon');
      const text = engineStatusEl.querySelector('.comms-engine-status-text');
      if (icon) icon.textContent = '○';
      if (text) text.textContent = 'DISABLED';
    } else if (eng.active_job) {
      engineStatusEl.className = 'comms-engine-status comms-engine-status--active';
      const icon = engineStatusEl.querySelector('.comms-engine-status-icon');
      const text = engineStatusEl.querySelector('.comms-engine-status-text');
      if (icon) icon.textContent = '⚡';
      if (text) text.textContent = 'PROCESSING';
    } else if (eng.model_ready === false) {
      engineStatusEl.className = 'comms-engine-status comms-engine-status--warming';
      const icon = engineStatusEl.querySelector('.comms-engine-status-icon');
      const text = engineStatusEl.querySelector('.comms-engine-status-text');
      if (icon) icon.textContent = '◌';
      if (text) text.textContent = 'WARMING';
    } else {
      engineStatusEl.className = 'comms-engine-status comms-engine-status--idle';
      const icon = engineStatusEl.querySelector('.comms-engine-status-icon');
      const text = engineStatusEl.querySelector('.comms-engine-status-text');
      if (icon) icon.textContent = '●';
      if (text) text.textContent = 'IDLE';
    }
  }

  // If dispatch was active and is now idle, stop fast-polling and clear thinking indicator
  if (_commsFastPollTimer && data.dispatch && !data.dispatch.active_job) {
    _commsStopFastPoll();
    _commsRemoveThinkingIndicator();
  }
}

// ═══════════════════════════════════════════════════════════
// MESH HEARTBEAT — Canvas EKG
// ═══════════════════════════════════════════════════════════
// Ring buffer of 120 samples. Each poll or message event pushes a pulse.
// requestAnimationFrame draws a continuous line, scrolling left.

const _commsHeartbeatBuf = new Float32Array(120);
let _commsHeartbeatHead = 0;
let _commsHeartbeatRAF = null;

function _commsHeartbeatPulse(amplitude) {
  // Push a spike into the ring buffer
  _commsHeartbeatBuf[_commsHeartbeatHead] = Math.min(1.0, amplitude);
  _commsHeartbeatHead = (_commsHeartbeatHead + 1) % _commsHeartbeatBuf.length;
}

function _commsHeartbeatMsgPulse() {
  // Smaller pulse for individual messages
  _commsHeartbeatPulse(0.5);
}

function _commsStartHeartbeat() {
  if (_commsHeartbeatRAF) return;
  let lastTick = 0;

  function draw(now) {
    _commsHeartbeatRAF = requestAnimationFrame(draw);

    // Advance baseline decay every ~100ms
    if (now - lastTick > 100) {
      lastTick = now;
      // Push a zero (baseline) to scroll the buffer
      _commsHeartbeatBuf[_commsHeartbeatHead] = 0;
      _commsHeartbeatHead = (_commsHeartbeatHead + 1) % _commsHeartbeatBuf.length;
    }

    const canvas = document.getElementById('commsHeartbeat');
    if (!canvas) { _commsStopHeartbeat(); return; }
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const len = _commsHeartbeatBuf.length;
    const stepX = w / (len - 1);

    ctx.clearRect(0, 0, w, h);

    // Draw baseline
    ctx.strokeStyle = 'rgba(74,222,128,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.7);
    ctx.lineTo(w, h * 0.7);
    ctx.stroke();

    // Draw the EKG line
    ctx.strokeStyle = 'rgba(74,222,128,0.6)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const idx = (_commsHeartbeatHead + i) % len;
      const val = _commsHeartbeatBuf[idx];
      const x = i * stepX;
      const y = h * 0.7 - val * h * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glow effect for active pulses
    ctx.strokeStyle = 'rgba(74,222,128,0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const idx = (_commsHeartbeatHead + i) % len;
      const val = _commsHeartbeatBuf[idx];
      if (val < 0.1) continue;
      const x = i * stepX;
      const y = h * 0.7 - val * h * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _commsHeartbeatRAF = requestAnimationFrame(draw);
}

function _commsStopHeartbeat() {
  if (_commsHeartbeatRAF) {
    cancelAnimationFrame(_commsHeartbeatRAF);
    _commsHeartbeatRAF = null;
  }
}

// ═══════════════════════════════════════════════════════════
// MESSAGE FEED
// ═══════════════════════════════════════════════════════════

function _commsAppendMessages(messages) {
  const feed = document.getElementById('commsFeed');
  if (!feed) return;

  let appended = false;
  let hasNewNotifiable = false;  // Track notifiable messages (RX + dispatch TX) for audio
  let lastNotifiableMsg = null;  // The last notifiable message (for alert classification)

  for (const msg of messages) {
    // Skip messages already in buffer (msg_id dedup)
    if (msg.msg_id && _commsRenderedIds.has(msg.msg_id)) continue;

    // ── Optimistic TX dedup ─────────────────────────
    // When we send a message, _commsSend() adds an optimistic copy
    // (with _tempId, no msg_id) to _commsAllMessages immediately.
    // The server assigns a msg_id and returns it in the send response.
    // BUT if the next poll returns the server's version BEFORE the
    // send response arrives, _commsRenderedIds won't have the msg_id
    // yet, so the poll version passes dedup — creating a duplicate.
    //
    // Fix: detect polled TX messages that match an existing optimistic
    // message (same text, within 30s) and merge them instead.
    if (msg.type === 'tx' && !msg.is_dispatch && msg.msg_id) {
      const existing = _commsAllMessages.find(m =>
        m._tempId && m.type === 'tx' && m.text === msg.text &&
        Math.abs((m.timestamp || 0) - (msg.timestamp || 0)) < 30
      );
      if (existing) {
        // Merge: give the optimistic message the real msg_id
        existing.msg_id = msg.msg_id;
        _commsRenderedIds.add(msg.msg_id);
        continue; // Skip — don't add a second copy
      }
    }

    // Tag with local timestamp for sparkline bucketing
    msg._localTs = Date.now();

    // Add to full message buffer
    _commsAllMessages.push(msg);
    // Cap buffer at 500 messages
    if (_commsAllMessages.length > 500) _commsAllMessages.shift();

    // Increment RX counter, push heartbeat pulse, track node activity
    if (msg.type === 'rx') {
      _commsRxTotal++;
      _commsHeartbeatMsgPulse();
      if (msg.from) _commsTrackNodeActivity(msg.from);
    }

    // Determine if this message is "notifiable" — should trigger
    // unread counting and audio alerts.
    // RX messages (from other nodes) + dispatch TX (BEACON AI responses).
    // Regular user TX messages are NOT notifiable.
    const isCountable = msg.type === 'rx' || (msg.type === 'tx' && msg.is_dispatch);

    // Track notifiable messages for audio alerts.
    if (isCountable) {
      hasNewNotifiable = true;
      lastNotifiableMsg = msg;
    }

    // Track unread for channels/DMs not currently viewed.
    // Count as unread:
    //   - RX messages (from other nodes)
    //   - Dispatch TX messages (BEACON AI responses — operator didn't type these)
    // Do NOT count:
    //   - Regular TX messages (what the user typed)
    // Special case: when viewing 'all', DMs are still hidden (filtered out),
    // so DM unread must still increment even while on 'all'.
    // CRITICAL: Skip during initial batch load (_commsAudioSuppressed).
    // Without this gate, every page refresh re-counts ALL historical DMs as unread.
    if (!_commsAudioSuppressed && isCountable) {
      const filterKey = _commsGetMsgFilterKey(msg);
      if (filterKey && filterKey !== _commsActiveFilter) {
        const isDmKey = filterKey.startsWith('dm:');
        const shouldCount = isDmKey || _commsActiveFilter !== 'all';
        if (shouldCount) {
          _commsUnread[filterKey] = (_commsUnread[filterKey] || 0) + 1;
          _commsUnreadSave();
        }
      }
    }

    // Check if this message passes the active filter
    // V-05 fix: always call _commsMsgMatchesFilter — no short-circuit for 'all'.
    // The old short-circuit let DMs flash in ALL TRAFFIC before the next full re-render.
    const visible = _commsMsgMatchesFilter(msg);
    if (!visible) {
      if (msg.msg_id) _commsRenderedIds.add(msg.msg_id);
      continue;
    }

    // Remove empty state
    const empty = document.getElementById('commsFeedEmpty');
    if (empty) empty.remove();

    if (msg.msg_id) _commsRenderedIds.add(msg.msg_id);
    // Remove thinking indicator when AI response arrives
    if (msg.is_dispatch) _commsRemoveThinkingIndicator();
    feed.appendChild(_commsBuildMsgElement(msg));
    appended = true;

    // ── @BEACON dispatch-off feedback ─────────────────────────
    // If an incoming RX message mentions @beacon but dispatch is disabled
    // or AI is disabled due to hardware, inject a local system message.
    if (msg.type === 'rx' && !_commsAudioSuppressed) {
      const text = (msg.text || '').toLowerCase();
      if (text.includes('@beacon')) {
        // Start fast-polling to catch dispatch PROCESSING state
        _commsStartFastPoll();
        // Check if AI is disabled due to hardware limitations
        const hwDisabled = typeof _hardwareInsufficient !== 'undefined' && _hardwareInsufficient;
        if (hwDisabled) {
          // Read the specific reason from the global cached by app.js at boot —
          // no async fetch needed, eliminates the race condition where the
          // generic message was shown before the fetch resolved.
          const reason = typeof _hardwareInsufficientReason !== 'undefined' ? _hardwareInsufficientReason : null;
          let hwReason;
          if (reason === 'no_gpu') {
            hwReason = '⚠ @BEACON is unavailable — this computer does not have a dedicated GPU (NVIDIA/AMD). Connect the drive to a computer with a dedicated graphics card to enable AI.';
          } else if (reason === 'insufficient_ram') {
            hwReason = '⚠ @BEACON is unavailable — this computer has less than 8 GB RAM. Connect the drive to a computer with 8 GB+ RAM to enable AI.';
          } else {
            hwReason = '⚠ @BEACON is unavailable — this computer does not meet the minimum hardware requirements to run the AI engine.';
          }
          const sysMsg = {
            type: 'system',
            text: hwReason,
            msg_id: `sys_hw_disabled_${Date.now()}`,
            _localTs: Date.now(),
          };
          _commsAllMessages.push(sysMsg);
          if (visible) {
            feed.appendChild(_commsBuildMsgElement(sysMsg));
          }
        } else {
          // Check if dispatch is currently off
          const dispData = _commsLastStatus && _commsLastStatus.dispatch;
          const dispOff = !dispData || !dispData.enabled || dispData.role === 'off';
          if (dispOff) {
            const sysMsg = {
              type: 'system',
              text: '⚠ @BEACON query received but dispatch is OFF. Enable it in ⚙ Dispatch Settings above.',
              msg_id: `sys_disp_off_${Date.now()}`,
              _localTs: Date.now(),
            };
            _commsAllMessages.push(sysMsg);
            if (visible) {
              feed.appendChild(_commsBuildMsgElement(sysMsg));
            }
          }
        }
      }
    }
  }

  // Update unread badges
  _commsUpdateUnreadBadges();

  // Audio alerts for notifiable messages — fires regardless of active filter
  // so DMs arriving while viewing a channel still chirp, and vice versa.
  // Audio is suppressed during re-render to prevent old messages from firing.
  // Notifiable = RX messages + BEACON dispatch TX responses.
  if (hasNewNotifiable && lastNotifiableMsg && !_commsAudioSuppressed) {
    if (lastNotifiableMsg.classification === 'ALERT') {
      _commsAudioAlert();
    } else {
      _commsAudioRxMsg();
    }
  }
  // Clear suppression after first batch is processed
  if (_commsAudioSuppressed) _commsAudioSuppressed = false;

  // Auto-scroll if we appended
  if (appended) feed.scrollTop = feed.scrollHeight;

  // Update classification ribbon
  _commsUpdateRibbon();
}

// ═══════════════════════════════════════════════════════════
// CLASSIFICATION HEAT RIBBON
// ═══════════════════════════════════════════════════════════
// Proportional color bar showing message type distribution.
// Pinned at the bottom of the center column, below compose.

const _COMMS_RIBBON_CLASSES = {
  general:   { label: 'GENERAL',   color: 'rgba(255,255,255,0.15)', textColor: 'rgba(255,255,255,0.4)' },
  beacon:    { label: 'BEACON',    color: 'rgba(212,168,67,0.35)',  textColor: '#d4a847' },
  alert:     { label: 'ALERT',     color: 'rgba(239,68,68,0.4)',    textColor: '#ef4444' },
  medical:   { label: 'MEDICAL',   color: 'rgba(244,63,94,0.35)',   textColor: '#f43f5e' },
  location:  { label: 'LOCATION',  color: 'rgba(59,130,246,0.35)',   textColor: '#3b82f6' },
  logistics: { label: 'LOGISTICS', color: 'rgba(20,184,166,0.35)',  textColor: '#14b8a6' },
};

function _commsUpdateRibbon() {
  const bar = document.getElementById('commsRibbonBar');
  const legend = document.getElementById('commsRibbonLegend');
  if (!bar || !legend) return;

  // Count classifications from message buffer (skip system messages)
  const counts = {};
  let total = 0;
  for (const msg of _commsAllMessages) {
    if (msg.type === 'system') continue;
    const cls = (msg.classification || 'GENERAL').toLowerCase();
    counts[cls] = (counts[cls] || 0) + 1;
    total++;
  }

  if (total === 0) {
    bar.innerHTML = '';
    legend.textContent = 'Waiting for messages…';
    return;
  }

  // Build segments ordered by count (largest first)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let segHtml = '';
  let legParts = [];

  for (const [cls, count] of sorted) {
    const pct = (count / total) * 100;
    const meta = _COMMS_RIBBON_CLASSES[cls] || _COMMS_RIBBON_CLASSES.general;
    const minWidth = pct > 2 ? '' : 'min-width: 3px;';
    const showLabel = pct > 12;
    segHtml += `<div class="comms-ribbon-seg" style="width:${pct.toFixed(1)}%;background:${meta.color};${minWidth}" title="${meta.label}: ${count} (${Math.round(pct)}%)">
      ${showLabel ? `<span class="comms-ribbon-seg-label" style="color:${meta.textColor}">${meta.label}</span>` : ''}
    </div>`;
    legParts.push(`<span style="color:${meta.textColor}">${meta.label}</span> ${Math.round(pct)}%`);
  }

  bar.innerHTML = segHtml;
  legend.innerHTML = legParts.join(' <span class="comms-ribbon-leg-sep">·</span> ');
}
function _commsMsgMatchesFilter(msg) {
  if (msg.type === 'system') return true;
  const chMatch = _commsActiveFilter.match(/^ch(\d+)$/);
  if (chMatch) return !msg.is_dm && msg.channel === parseInt(chMatch[1], 10);
  if (_commsActiveFilter.startsWith('dm:')) {
    const nodeId = _commsActiveFilter.slice(3);
    // BUG-2 fix: require is_dm to prevent channel broadcasts from leaking in
    return msg.is_dm && (msg.from === nodeId || msg.to === nodeId);
  }
  // 'all' filter: broadcasts only (DMs only visible in DM views)
  return !msg.is_dm;
}

function _commsBuildMsgElement(msg) {
  const el = document.createElement('div');
  el.className = 'comms-msg';

  if (msg.type === 'system') {
    el.className += ' comms-msg--system';
    el.innerHTML = `<span class="comms-msg-system-text">${_commsEscape(msg.text)}</span>`;
  } else {
    const time = _commsFormatTime(msg.timestamp);
    const isAI = msg.is_dispatch;
    const isTx = msg.type === 'tx';

    el.className += isTx ? ' comms-msg--tx' : ' comms-msg--rx';
    if (isAI) el.className += ' comms-msg--ai';

    // Tiered urgency class based on classification
    const cls = msg.classification || 'GENERAL';
    el.className += ` comms-msg--cls-${cls.toLowerCase()}`;

    // Classification tag
    const clsTag = `<span class="comms-tag comms-tag--${cls.toLowerCase()}">${cls}</span>`;

    // Encryption indicator
    let encIcon = '';
    if (msg.encryption) {
      const enc = msg.encryption;
      if (enc === 'pki') {
        encIcon = '<span class="comms-enc comms-enc--pki" title="Direct Message (Encrypted)">🔐</span>';
      } else if (enc === 'aes256') {
        encIcon = '<span class="comms-enc comms-enc--aes" title="Channel Encrypted (Private Key)">🔒</span>';
      } else if (enc === 'default') {
        encIcon = '<span class="comms-enc comms-enc--default" title="Default Channel — encrypted with standard key">🔒</span>';
      } else {
        encIcon = '<span class="comms-enc comms-enc--clear" title="Unencrypted">🔓</span>';
      }
    }

    // Data source indicator (only for AI responses)
    let dataSourceTag = '';
    if (msg.data_source && isAI) {
      const isLive = msg.data_source === 'Live Mesh';
      dataSourceTag = `
        <div class="comms-data-source">
          <span class="comms-data-source-label">SOURCE:</span>
          <span class="comms-data-source-value comms-data-source--${isLive ? 'live' : 'ai'}">${isLive ? 'Live radio data' : _commsEscape(msg.data_source)}</span>
        </div>`;
    }

    // Delivery state indicator (only for our outgoing messages)
    //
    // IMPORTANT DISTINCTION:
    //   Broadcasts: Meshtastic does NOT ACK broadcasts. We can only know
    //               "sent to local radio" — never "received by remote."
    //               Show ↗ SENT to be honest about this limitation.
    //   DMs:        Firmware sends ACK/NAK routing packets. We track them
    //               via pending_acks. Show spinner → ✓ DELIVERED / ✕ FAILED.
    let deliveryIndicator = '';
    const isDm = msg.is_dm;
    if (isTx && msg.delivery_failed) {
      // V-03: Backend reported ACK failure from firmware
      const errReason = msg.delivery_error || 'UNREACHABLE';
      deliveryIndicator = `<div class="comms-delivery comms-delivery--failed"><span title="${_commsEscape(errReason)}">✕ ${_commsEscape(errReason)}</span></div>`;
    } else if (isTx && isDm && msg._state) {
      // DMs get ACK tracking
      if (msg._state === 'pending') {
        deliveryIndicator = '<div class="comms-delivery comms-delivery--pending"><span class="comms-delivery-spinner"></span></div>';
      } else if (msg._state === 'sent') {
        deliveryIndicator = '<div class="comms-delivery comms-delivery--sent"><span title="Delivered">✓</span></div>';
      } else if (msg._state === 'failed') {
        deliveryIndicator = `<div class="comms-delivery comms-delivery--failed"><span>✕ FAILED</span></div>`;
      }
    } else if (isTx && !isDm) {
      // Broadcasts: no ACK possible — just show "sent to radio"
      deliveryIndicator = '<div class="comms-delivery comms-delivery--broadcast"><span title="Sent to radio — broadcasts are not acknowledged">↗</span></div>';
    }

    el.innerHTML = `
      <div class="comms-msg-header">
        <span class="comms-msg-time">${time}</span>
        <span class="comms-msg-sender">${_commsEscape(msg.from_name || msg.from || '?')}</span>
        ${isAI ? '<span class="comms-msg-badge">AI</span>' : ''}
        ${msg.channel !== undefined ? `<span class="comms-msg-channel">CH${msg.channel}</span>` : ''}
        ${clsTag}
        ${encIcon}
        ${deliveryIndicator}
      </div>
      <div class="comms-msg-body">${_commsEscape(msg.text)}</div>
      ${dataSourceTag}
    `;
  }

  return el;
}

// ═══════════════════════════════════════════════════════════
// QUICK-REPLY TEMPLATES
// ═══════════════════════════════════════════════════════════

const _COMMS_QUICK_REPLIES = [
  { label: 'GOT IT', text: 'Got it, message received.' },
  { label: 'WILL DO', text: 'Will do.' },
  { label: 'SAY AGAIN', text: 'Say again, message not understood.' },
  { label: 'STAND BY', text: 'Stand by, working.' },
  { label: 'NEGATIVE', text: 'Negative, unable to comply.' },
  { label: 'STATUS?', text: 'What is your current status?' },
  { label: 'SOS', text: 'EMERGENCY. Requesting immediate assistance.' },
  { label: '@BEACON', text: '@beacon ' },
];

function _commsInsertQuickReply(text) {
  const input = document.getElementById('commsComposeInput');
  if (!input) return;
  if (text.endsWith(' ')) {
    // Partial template (like @beacon ) — insert and focus for completion
    input.value = text;
    input.focus();
  } else {
    input.value = text;
    _commsSend();
  }
}

function _commsFormatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function _commsEscape(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ═══════════════════════════════════════════════════════════
// COMPOSE
// ═══════════════════════════════════════════════════════════

let _commsTempIdCounter = 0; // Local temp ID for optimistic messages

function _commsUpdateCharCounter() {
  const input = document.getElementById('commsComposeInput');
  const counter = document.getElementById('commsCharCounter');
  if (!input || !counter) return;
  const len = input.value.length;
  counter.textContent = `${len}/200`;
  counter.classList.toggle('comms-compose-counter--warn', len > 160);
  counter.classList.toggle('comms-compose-counter--full', len >= 200);
}

/** Show/hide a hint below the compose bar based on selected channel. */
function _commsUpdateComposeHint() {
  const sel = document.getElementById('commsComposeChannel');
  const hint = document.getElementById('commsComposeHint');
  if (!sel || !hint) return;
  const ch = parseInt(sel.value || '0', 10);
  const isDm = !!sel.dataset.dmTarget;
  const isProvisioned = _commsProvisioningStatus
    && _commsProvisioningStatus.state === 'provisioned';

  if (ch === 0 && !isDm) {
    hint.textContent = '⚠ CH 0 is the public channel — anyone with a radio in range can read these messages';
    hint.style.display = '';
  } else if (ch > 0 && !isDm && !isProvisioned) {
    hint.textContent = '⚠ No private channel set up — messages on this channel are not encrypted with your own key.';
    hint.style.display = '';
    hint.style.color = '#ffaa00';
  } else {
    hint.style.display = 'none';
    hint.style.color = '';
  }
}

function _commsSend() {
  const input = document.getElementById('commsComposeInput');
  const channelSel = document.getElementById('commsComposeChannel');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  // Detect DM mode from compose dropdown
  const dmTarget = channelSel?.dataset?.dmTarget || null;
  const channel = dmTarget ? 0 : parseInt(channelSel?.value || '0', 10);
  input.value = '';
  _commsUpdateCharCounter();

  // Generate a local temp ID for this optimistic message
  _commsTempIdCounter++;
  const tempId = `tmp_${_commsTempIdCounter}`;

  // Build optimistic message and insert immediately
  const optimisticMsg = {
    type: 'tx',
    from_name: 'You',
    channel: channel,
    text: text,
    to: dmTarget || null,
    is_dm: !!dmTarget,
    timestamp: Date.now() / 1000,
    is_dispatch: false,
    classification: _commsClassifyLocal(text),
    encryption: dmTarget ? 'pki' : (channel > 0 ? 'aes256' : 'default'),
    data_source: null,
    _tempId: tempId,
    _state: 'pending', // pending | sent | failed
  };

  // Add to buffer and render
  _commsAllMessages.push(optimisticMsg);
  const feed = document.getElementById('commsFeed');
  if (feed) {
    const empty = document.getElementById('commsFeedEmpty');
    if (empty) empty.remove();
    const el = _commsBuildMsgElement(optimisticMsg);
    el.id = `comms-msg-${tempId}`;
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
  }

  // Fire the API call — include dest for DM routing
  const payload = { text, channel };
  if (dmTarget) payload.dest = dmTarget;

  fetch('/api/comms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        _commsUpdateMsgState(tempId, 'failed', data.error);
      } else {
        // Register the real msg_id in dedup set so polling skips the echo
        if (data.msg_id) _commsRenderedIds.add(data.msg_id);
        _commsUpdateMsgState(tempId, 'sent');
      }
    })
    .catch(err => {
      _commsUpdateMsgState(tempId, 'failed', err.message);
    });

  // If this is a @beacon query, start fast-polling and show thinking indicator
  if (text.toLowerCase().startsWith('@beacon')) {
    _commsStartFastPoll();
    _commsShowThinkingIndicator();
  }

  input.focus();
}

function _commsUpdateMsgState(tempId, state, errorMsg) {
  const el = document.getElementById(`comms-msg-${tempId}`);
  if (!el) return;

  // Find and update the state indicator
  const indicator = el.querySelector('.comms-delivery');
  if (!indicator) return;

  if (state === 'sent') {
    indicator.className = 'comms-delivery comms-delivery--sent';
    indicator.innerHTML = '<span title="Transmitted">✓</span>';
    _commsAudioTxConfirm();
  } else if (state === 'failed') {
    indicator.className = 'comms-delivery comms-delivery--failed';
    indicator.innerHTML = `<span title="${_commsEscape(errorMsg || 'Send failed')}">✕ FAILED</span>
      <button class="comms-retry-btn" onclick="_commsRetry('${tempId}')">RETRY</button>`;
    _commsAudioError();
  }

  // Update the message in buffer too
  const msg = _commsAllMessages.find(m => m._tempId === tempId);
  if (msg) msg._state = state;
}

function _commsRetry(tempId) {
  const msg = _commsAllMessages.find(m => m._tempId === tempId);
  if (!msg) return;

  // Reset state to pending
  _commsUpdateMsgStatePending(tempId);

  // BUG-3 fix: include dest for DM retries so they don't send as broadcast
  const retryPayload = { text: msg.text, channel: msg.channel };
  if (msg.to && msg.is_dm) retryPayload.dest = msg.to;

  fetch('/api/comms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retryPayload),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        _commsUpdateMsgState(tempId, 'failed', data.error);
      } else {
        if (data.msg_id) _commsRenderedIds.add(data.msg_id);
        _commsUpdateMsgState(tempId, 'sent');
      }
    })
    .catch(err => {
      _commsUpdateMsgState(tempId, 'failed', err.message);
    });
}

function _commsUpdateMsgStatePending(tempId) {
  const el = document.getElementById(`comms-msg-${tempId}`);
  if (!el) return;
  const indicator = el.querySelector('.comms-delivery');
  if (indicator) {
    indicator.className = 'comms-delivery comms-delivery--pending';
    indicator.innerHTML = '<span class="comms-delivery-spinner"></span>';
  }
}

// Local classification for optimistic messages (mirrors backend logic)
function _commsClassifyLocal(text) {
  const low = text.toLowerCase();
  if (low.startsWith('@beacon')) return 'BEACON';
  // C8 fix: synced with backend _CLASSIFY_RULES in __init__.py
  if (/\b(emergency|danger|sos|mayday|warning|evacuate|threat|hostile|contact|under fire|casualty report|cas(?:evac)?|help|critical)\b/i.test(text)) return 'ALERT';
  if (/\b(medic|medical|wound|bleeding|tourniquet|casualty|cpr|fracture|trauma|triage|bandage|splint|airway|pulse|seizure|allergic|anaphyla|burn|heat stroke|hypotherm|poison|overdose|narcan)\b/i.test(text)) return 'MEDICAL';
  if (/\b(grid|coordinate|position|bearing|azimuth|recon|target|observation|movement|patrol|perimeter|sector|flank|\d{1,3}\.\d+°?\s*[NSEW])\b/i.test(text)) return 'LOCATION';
  if (/\b(supply|resupply|ammo|ammunition|water|fuel|ration|food|transport|eta|pickup|drop|extract|cache|inventory|battery)\b/i.test(text)) return 'LOGISTICS';
  return 'GENERAL';
}

// ═══════════════════════════════════════════════════════════
// DISPATCH CONFIG — now inline in BEACON Engine section
// ═══════════════════════════════════════════════════════════

function _commsSaveConfig() {
  // Read from inline BEACON Engine controls in the Intel Dashboard
  const role = document.getElementById('commsEngineRole')?.value || 'primary';
  const channel = parseInt(document.getElementById('commsEngineChannel')?.value || '1', 10);
  // Dispatch enabled comes from Emissions Control toggle
  const dispToggle = document.getElementById('commsEmitDispatch');
  const enabled = dispToggle ? dispToggle.checked : true;

  // Persist to localStorage
  localStorage.setItem('bd-setting-dispatch', String(enabled));
  localStorage.setItem('bd-comms-dispatch-role', role);
  localStorage.setItem('bd-comms-dispatch-channel', String(channel));

  fetch('/api/comms/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dispatch_enabled: enabled,
      dispatch_role: role,
      dispatch_channel: channel,
    }),
  })
    .then(r => r.json())
    .then(() => _commsPollStatus())
    .catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// MESH PROVISIONING UI
// ═══════════════════════════════════════════════════════════

let _commsProvisioningInFlight = false;

// BUG-02 fix: HTML-escape dynamic values before innerHTML interpolation.
// Named _commsEscHtml to avoid collision with _escHtml in prompts.js
// (both scripts share the global scope).
function _commsEscHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// BUG-11 fix: Fetch provisioning status on-demand (called when Intel
// tab renders, not on every 3s status poll cycle).
function _commsFetchProvisioningStatus() {
  fetch('/api/comms/provision/status')
    .then(r => r.json())
    .then(d => {
      _commsProvisioningStatus = d;
      // Re-render if the Intel tab is visible
      const block = document.querySelector('.comms-provision-block');
      if (block) {
        block.innerHTML = _commsRenderProvisioningContent();
      }
      // Update compose hint in case provisioning state affects it
      _commsUpdateComposeHint();
    })
    .catch(() => {});
}

function _commsRenderProvisioningHTML() {
  // Trigger an async fetch so the provisioning block updates once
  // data arrives. Render placeholder if we don't have data yet.
  if (!_commsProvisioningStatus) {
    _commsFetchProvisioningStatus();
    return `<div class="comms-dash-section">
      <div class="comms-dash-header">MESH PROVISIONING</div>
      <div class="comms-provision-block"><div class="comms-provision-note">Loading…</div></div>
    </div>`;
  }

  return `<div class="comms-dash-section">
    <div class="comms-dash-header">MESH PROVISIONING</div>
    <div class="comms-provision-block">${_commsRenderProvisioningContent()}</div>
  </div>`;
}

function _commsRenderProvisioningContent() {
  const ps = _commsProvisioningStatus;
  if (!ps) return '';

  let content = '';
  const state = ps.state || 'unprovisioned';

  if (state === 'unprovisioned') {
    content = `
      <div class="comms-provision-status comms-provision-status--unprovisioned">
        <div class="comms-provision-icon">📡</div>
        <div class="comms-provision-info">
          <div class="comms-provision-title">No Private Channel Configured</div>
          <div class="comms-provision-desc">
            Messages on CH 0 can be read by anyone with a Meshtastic radio.
            To create a private channel only your group can read, click below.
            This generates a unique encryption key and programs it onto
            your radio automatically.
          </div>
        </div>
      </div>
      ${ps.radio_connected
        ? `<button id="commsProvisionBtn" class="comms-provision-btn" onclick="_commsProvisionRadio()">
             <span class="comms-provision-btn-icon">🔐</span> Set Up Private Channel
           </button>`
        : `<div class="comms-provision-note">⚠ Connect radio to provision</div>`
      }`;
  } else if (state === 'provisioned') {
    // BUG-02 fix: escape channel_name before interpolation
    const chName = _commsEscHtml(ps.channel_name || 'BEACON');
    const dateStr = ps.provisioned_at
      ? ` on ${new Date(ps.provisioned_at).toLocaleDateString()}`
      : '';
    content = `
      <div class="comms-provision-status comms-provision-status--provisioned">
        <div class="comms-provision-icon">✅</div>
        <div class="comms-provision-info">
          <div class="comms-provision-title">${chName} Channel Active</div>
          <div class="comms-provision-desc">
            Encrypted channel provisioned${dateStr}.
            Scan the QR code to pair additional radios.
          </div>
        </div>
      </div>
      <button id="commsShowQRBtn" class="comms-provision-btn comms-provision-btn--qr" onclick="_commsShowQR()">
        <span class="comms-provision-btn-icon">📱</span> Show Pairing QR Code
      </button>
      <button id="commsReprovisionBtn" class="comms-provision-btn comms-provision-btn--reprovision" onclick="_commsProvisionRadio()">
        ↻ Reset Private Channel (new encryption key — all radios will need re-pairing)
      </button>`;
  } else if (state === 'radio_swap') {
    // BUG-02 fix: escape node IDs before interpolation
    const provNode = _commsEscHtml(ps.provisioned_node_id || '?');
    const connNode = _commsEscHtml(ps.connected_node_id || '?');
    content = `
      <div class="comms-provision-status comms-provision-status--warning">
        <div class="comms-provision-icon">⚠️</div>
        <div class="comms-provision-info">
          <div class="comms-provision-title">Different Radio Detected</div>
          <div class="comms-provision-desc">
            Your private channel was set up for radio <code>${provNode}</code>
            but the radio currently plugged in is <code>${connNode}</code>.
            This means you connected a different radio. Click below to set up this radio instead.
          </div>
        </div>
      </div>
      <button id="commsReprovisionBtn" class="comms-provision-btn" onclick="_commsProvisionRadio()">
        <span class="comms-provision-btn-icon">🔐</span> Provision This Radio
      </button>`;
  }

  return content;
}


async function _commsProvisionRadio() {
  if (_commsProvisioningInFlight) return;

  const pw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : null;
  if (!pw) {
    if (typeof showToast === 'function') showToast('Master password required. Please unlock your vault first.', 4000);
    return;
  }

  // Confirm if re-provisioning
  const ps = _commsProvisioningStatus;
  if (ps && ps.state === 'provisioned') {
    const confirmed = await _showThemedConfirm(
      'Re-provisioning will generate a NEW encryption key.',
      'All radios paired with the old key will need to be re-paired.'
    );
    if (!confirmed) return;
  }

  _commsProvisioningInFlight = true;
  const btn = document.getElementById('commsProvisionBtn') || document.getElementById('commsReprovisionBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Provisioning…';
  }

  // BUG-01 fix: POST returns immediately. The backend runs provisioning
  // in a background thread. We update _commsProvisioningStatus.job to
  // 'running' so the status poll cycle will start fast-polling for
  // completion.
  fetch('/api/comms/provision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Password': pw,
    },
  })
    .then(r => r.json())
    .then(data => {
      if (data.started) {
        // Set job status so the poll cycle starts tracking progress
        if (!_commsProvisioningStatus) _commsProvisioningStatus = {};
        _commsProvisioningStatus.job = { status: 'running', step: 'generating_key' };
        _commsRender();
      } else {
        _commsProvisioningInFlight = false;
        if (typeof showToast === 'function') showToast('Provisioning failed: ' + (data.error || 'Unknown error'), 5000);
        _commsRender();
      }
    })
    .catch(err => {
      _commsProvisioningInFlight = false;
      if (typeof showToast === 'function') showToast('Provisioning failed: ' + err.message, 5000);
      _commsRender();
    });
}


function _commsShowQR() {
  const pw = typeof _getSessionPassword === 'function' ? _getSessionPassword() : null;
  if (!pw) {
    if (typeof showToast === 'function') showToast('Master password required to decrypt pairing key.', 4000);
    return;
  }

  fetch('/api/comms/provision/qr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Password': pw,
    },
  })
    .then(r => r.json())
    .then(data => {
      if (data.qr_url) {
        _commsShowQRModal(data.qr_url);
      } else {
        if (typeof showToast === 'function') showToast('Failed to retrieve QR code: ' + (data.error || 'Unknown'), 5000);
      }
    })
    .catch(err => { if (typeof showToast === 'function') showToast('Error: ' + err.message, 5000); });
}


function _commsShowQRModal(qrUrl) {
  // Remove any existing modal
  const existing = document.getElementById('commsQRModal');
  if (existing) existing.remove();

  // BUG-03 fix: Build modal HTML without interpolating qrUrl into
  // attributes. The URL is set via DOM property after insertion.
  const overlay = document.createElement('div');
  overlay.id = 'commsQRModal';
  overlay.className = 'comms-qr-overlay';
  overlay.innerHTML = `
    <div class="comms-qr-modal">
      <div class="comms-qr-header">
        <span>📱 Pair Another Radio</span>
        <button class="comms-qr-close" onclick="document.getElementById('commsQRModal').remove()">✕</button>
      </div>
      <div class="comms-qr-body">
        <div class="comms-qr-instructions">
          <div class="comms-qr-prereq" style="margin-bottom:12px;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:6px;font-size:0.92em;line-height:1.5">
            <strong>Before you scan:</strong>
            <ol style="margin:6px 0 0 0;padding-left:18px;font-size:0.95em">
              <li>Install the free <a href="https://meshtastic.org/downloads" target="_blank" rel="noopener" style="color:var(--color-accent)">Meshtastic app</a></li>
              <li>Open the app and connect to the radio via Bluetooth<br>
                <span style="opacity:0.7;font-size:0.9em">(pair through the app, not iOS Bluetooth settings)</span></li>
            </ol>
          </div>
          <ol>
            <li>Point your phone's camera at the QR code below</li>
            <li>Tap the link — it opens the Meshtastic app automatically</li>
            <li>Tap <strong>Save</strong> when prompted to apply the channels</li>
            <li>Wait 30–60 seconds for the radio to reboot</li>
            <li>Done — this radio now shares your encrypted channel</li>
          </ol>
        </div>
        <div id="commsQRCode" class="comms-qr-code"></div>
        <div class="comms-qr-url-label">Or paste this URL in the Meshtastic app:</div>
        <input id="commsQRUrlInput" class="comms-qr-url-input" readonly>
        <div class="comms-qr-note">
          🔒 This QR code contains your encrypted channel key.
          Do not share it publicly.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);


  // BUG-03 fix: Set URL via DOM property, not HTML attribute interpolation.
  const urlInput = document.getElementById('commsQRUrlInput');
  if (urlInput) {
    urlInput.value = qrUrl;
    urlInput.addEventListener('click', () => {
      urlInput.select();
      // Modern clipboard API with deprecated fallback
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(qrUrl).catch(() => {
          try { document.execCommand('copy'); } catch (_e) { /* noop */ }
        });
      } else {
        try { document.execCommand('copy'); } catch (_e) { /* noop */ }
      }
    });
  }

  // Render QR code using vendored QRCode.js
  try {
    const container = document.getElementById('commsQRCode');
    if (container && typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: qrUrl,
        width: 256,
        height: 256,
        colorDark: '#0a0a0a',
        colorLight: '#e0e0e0',
        correctLevel: QRCode.CorrectLevel.M,
      });
    }
  } catch (e) {
    console.error('QR code generation failed:', e);
  }

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape key
  const _qrEscHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', _qrEscHandler);
    }
  };
  document.addEventListener('keydown', _qrEscHandler);
}


// ═══════════════════════════════════════════════════════════
// ANTI-FLICKER STATE RESTORE
// ═══════════════════════════════════════════════════════════

(function _commsRestoreState() {
  try {
    const raw = sessionStorage.getItem(COMMS_SS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (state && state.open) {
      // Defer to let other scripts load
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => openComms(), 10);
      });
    }
  } catch {}
})();
