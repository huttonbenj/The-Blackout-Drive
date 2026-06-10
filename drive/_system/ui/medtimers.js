/**
 * The Blackout Drive — Medical Timers
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: Tourniquet application tracker (timestamp logger)
 *           and CPR metronome (visual/audio pulse at 110 BPM).
 *
 * This module registers itself via registerTool() at load time.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════
let _medActiveTab = 'tourniquet';  // tourniquet | cpr
let _medTqLogs = [];                // [{ id, label, time, elapsed }]
let _medCprRunning = false;
let _medCprInterval = null;
let _medCprAudioCtx = null;
let _medCprBeatCount = 0;

// ═══════════════════════════════════════════════════════════
// RENDER ENTRY POINT
// ═══════════════════════════════════════════════════════════

function _medRender(container) {
  container.innerHTML = '';

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'hr-tabs';
  const tabDefs = [
    { id: 'tourniquet', label: 'TOURNIQUET TRACKER', icon: ICONS.bandage },
    { id: 'cpr', label: 'CPR METRONOME', icon: ICONS.heart },
  ];
  tabDefs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'hr-tab' + (_medActiveTab === t.id ? ' hr-tab--active' : '');
    btn.innerHTML = `<span class="hr-tab-icon">${t.icon}</span><span class="hr-tab-label">${t.label}</span>`;
    btn.onclick = () => { _medActiveTab = t.id; _medRender(container); };
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  if (_medActiveTab === 'tourniquet') _medRenderTQ(content);
  else _medRenderCPR(content);
}

// ═══════════════════════════════════════════════════════════
// TOURNIQUET TRACKER
// ═══════════════════════════════════════════════════════════

function _medRenderTQ(container) {
  let logsHtml = '';
  if (_medTqLogs.length > 0) {
    logsHtml = `<div class="med-tq-logs">
      <div class="hr-section-title">ACTIVE TOURNIQUETS</div>`;
    _medTqLogs.forEach((log, i) => {
      const elapsed = _medTqElapsed(log.time);
      const isWarning = (Date.now() - log.time) > 2 * 60 * 60 * 1000; // >2 hours
      logsHtml += `
        <div class="med-tq-entry ${isWarning ? 'med-tq-entry--warning' : ''}">
          <div class="med-tq-entry-header">
            <span class="med-tq-entry-label">${log.label}</span>
            <button class="med-tq-remove" onclick="_medRemoveTQ(${i})" title="Remove">✕</button>
          </div>
          <div class="med-tq-entry-time">Applied: <strong>${new Date(log.time).toLocaleTimeString()}</strong></div>
          <div class="med-tq-entry-elapsed ${isWarning ? 'med-tq-elapsed--warning' : ''}">
            Elapsed: <span id="medTqElapsed${i}">${elapsed}</span>
            ${isWarning ? ' ⚠ EXCEEDS 2 HOURS' : ''}
          </div>
        </div>`;
    });
    logsHtml += '</div>';
  }

  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">TOURNIQUET APPLICATION TRACKER</div>
      <div class="cipher-desc">
        Log the exact time a tourniquet is applied. In trauma scenarios, medical responders
        need to know precisely how long a tourniquet has been in place.
        <strong>Mark "TQ" and the time on the patient's skin with a marker if possible.</strong>
      </div>
      <div class="med-tq-apply">
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">LOCATION</label>
            <select class="hr-input" id="medTqLocation">
              <option>Left Arm — Upper</option>
              <option>Left Arm — Lower</option>
              <option>Right Arm — Upper</option>
              <option>Right Arm — Lower</option>
              <option>Left Leg — Upper</option>
              <option>Left Leg — Lower</option>
              <option>Right Leg — Upper</option>
              <option>Right Leg — Lower</option>
            </select>
          </div>
        </div>
        <button class="hr-btn med-tq-btn" onclick="_medApplyTQ()">
          🩹 LOG TOURNIQUET APPLICATION — NOW
        </button>
      </div>
      ${logsHtml}
    </div>
    <div class="hr-section">
      <div class="hr-section-title">CRITICAL GUIDELINES</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>GUIDELINE</th><th>DETAILS</th></tr></thead>
          <tbody>
            <tr><td class="hr-td-band">Placement</td><td>2-3 inches above the wound, NEVER on a joint</td></tr>
            <tr><td class="hr-td-band">Tightness</td><td>Tight enough to stop distal pulse — bleeding must stop</td></tr>
            <tr><td class="hr-td-band">Time limit</td><td>Safe up to 2 hours. After 2 hours, risk of tissue damage increases</td></tr>
            <tr><td class="hr-td-band">Do NOT remove</td><td>Once applied, do NOT loosen or remove in the field</td></tr>
            <tr><td class="hr-td-band">Mark the time</td><td>Write "TQ" and the application time on the patient's forehead or the tourniquet</td></tr>
            <tr><td class="hr-td-band">Second TQ</td><td>If bleeding continues, apply a second tourniquet above the first</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  // Start elapsed time updater
  if (_medTqLogs.length > 0) {
    _medStartTQTimer();
  }
}

function _medApplyTQ() {
  const loc = document.getElementById('medTqLocation').value;
  _medTqLogs.push({
    id: Date.now(),
    label: loc,
    time: Date.now(),
  });
  const container = document.querySelector('.hr-content');
  if (container) _medRenderTQ(container);
}

function _medRemoveTQ(idx) {
  _medTqLogs.splice(idx, 1);
  const container = document.querySelector('.hr-content');
  if (container) _medRenderTQ(container);
}

function _medTqElapsed(startTime) {
  const diff = Date.now() - startTime;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

let _medTqTimerInterval = null;

function _medStartTQTimer() {
  if (_medTqTimerInterval) clearInterval(_medTqTimerInterval);
  _medTqTimerInterval = setInterval(() => {
    _medTqLogs.forEach((log, i) => {
      const el = document.getElementById(`medTqElapsed${i}`);
      if (el) el.textContent = _medTqElapsed(log.time);
    });
  }, 1000);
}

// ═══════════════════════════════════════════════════════════
// CPR METRONOME
// ═══════════════════════════════════════════════════════════

function _medRenderCPR(container) {
  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">CPR COMPRESSION METRONOME</div>
      <div class="cipher-desc">
        AHA (American Heart Association) guidelines recommend chest compressions at a rate of
        <strong>100-120 compressions per minute</strong> with a depth of at least 2 inches (5 cm).
        This metronome provides a visual and audio pulse at 110 BPM to keep you on pace.
      </div>
      <div class="med-cpr-display">
        <div class="med-cpr-indicator" id="medCprIndicator">
          <div class="med-cpr-pulse" id="medCprPulse">❤️</div>
          <div class="med-cpr-label" id="medCprLabel">READY</div>
        </div>
        <div class="med-cpr-counter" id="medCprCounter">0</div>
        <div class="med-cpr-rate">110 BPM</div>
        <div class="med-cpr-actions">
          <button class="hr-btn med-cpr-start-btn" id="medCprStartBtn" onclick="_medToggleCPR()">
            ▶ START METRONOME
          </button>
          <button class="hr-btn hr-btn--secondary" onclick="_medResetCPR()">RESET</button>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">CPR QUICK REFERENCE</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>STEP</th><th>ACTION</th></tr></thead>
          <tbody>
            <tr><td class="hr-td-band">1. CHECK</td><td>Tap and shout — "Are you OK?" Check for breathing (10 sec max)</td></tr>
            <tr><td class="hr-td-band">2. CALL</td><td>Call 911 or direct someone to call. Get an AED if available.</td></tr>
            <tr><td class="hr-td-band">3. COMPRESS</td><td>Center of chest, 2+ inches deep, 100-120/min. Allow full recoil.</td></tr>
            <tr><td class="hr-td-band">4. BREATHE</td><td>After 30 compressions: 2 rescue breaths (1 second each). Tilt head, lift chin.</td></tr>
            <tr><td class="hr-td-band">5. REPEAT</td><td>30:2 ratio. Don't stop until help arrives or patient responds.</td></tr>
            <tr><td class="hr-td-band">AED</td><td>Turn on, follow voice prompts. Resume CPR immediately after shock.</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function _medToggleCPR() {
  if (_medCprRunning) {
    _medStopCPR();
  } else {
    _medStartCPR();
  }
}

function _medStartCPR() {
  _medCprRunning = true;
  const btn = document.getElementById('medCprStartBtn');
  if (btn) btn.textContent = '⏸ PAUSE METRONOME';

  const bpm = 110;
  const intervalMs = 60000 / bpm; // ~545ms

  if (!_medCprAudioCtx) {
    try { _medCprAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }

  _medCprInterval = setInterval(() => {
    _medCprBeatCount++;

    // Visual pulse
    const pulse = document.getElementById('medCprPulse');
    const label = document.getElementById('medCprLabel');
    const counter = document.getElementById('medCprCounter');
    if (pulse) {
      pulse.classList.add('med-cpr-pulse--active');
      setTimeout(() => pulse.classList.remove('med-cpr-pulse--active'), 200);
    }
    if (label) label.textContent = 'PUSH';
    if (counter) counter.textContent = _medCprBeatCount;

    // After 30 compressions, prompt for breaths
    if (_medCprBeatCount % 30 === 0 && label) {
      label.textContent = '2 BREATHS';
      label.classList.add('med-cpr-label--breathe');
      setTimeout(() => {
        if (label) { label.textContent = 'PUSH'; label.classList.remove('med-cpr-label--breathe'); }
      }, 3000);
    }

    // Audio click
    if (_medCprAudioCtx) {
      const osc = _medCprAudioCtx.createOscillator();
      const gain = _medCprAudioCtx.createGain();
      osc.connect(gain);
      gain.connect(_medCprAudioCtx.destination);

      // Different sound for breath prompt
      const isBreath = (_medCprBeatCount % 30 === 0);
      osc.frequency.value = isBreath ? 880 : 440;
      gain.gain.setValueAtTime(isBreath ? 0.4 : 0.2, _medCprAudioCtx.currentTime);
      osc.start(_medCprAudioCtx.currentTime);
      osc.stop(_medCprAudioCtx.currentTime + 0.08);
    }
  }, intervalMs);
}

function _medStopCPR() {
  _medCprRunning = false;
  if (_medCprInterval) { clearInterval(_medCprInterval); _medCprInterval = null; }
  const btn = document.getElementById('medCprStartBtn');
  if (btn) btn.textContent = '▶ START METRONOME';
  const label = document.getElementById('medCprLabel');
  if (label) { label.textContent = 'PAUSED'; label.classList.remove('med-cpr-label--breathe'); }
}

function _medResetCPR() {
  _medStopCPR();
  _medCprBeatCount = 0;
  const counter = document.getElementById('medCprCounter');
  if (counter) counter.textContent = '0';
  const label = document.getElementById('medCprLabel');
  if (label) label.textContent = 'READY';
}

// ═══════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════

function _medCleanup() {
  _medStopCPR();
  if (_medTqTimerInterval) { clearInterval(_medTqTimerInterval); _medTqTimerInterval = null; }
  if (_medCprAudioCtx) {
    try { _medCprAudioCtx.close(); } catch {}
    _medCprAudioCtx = null;
  }
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'medical-timers',
    name: 'MEDICAL TIMERS',
    icon: ICONS.timer,
    description: 'Tourniquet application tracker and CPR compression metronome',
    render: _medRender,
    cleanup: _medCleanup,
  });
}
