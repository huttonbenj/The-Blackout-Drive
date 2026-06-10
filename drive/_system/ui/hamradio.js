/**
 * The Blackout Drive — Ham Radio Toolkit
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: Morse code trainer, frequency band charts,
 *           NATO phonetic alphabet, and a practice quiz.
 *
 * This module registers itself via registerTool() at load time.
 * No modifications to tools.js or index.html are needed.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// MORSE CODE DATA
// ═══════════════════════════════════════════════════════════
const MORSE_MAP = {
  'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....',
  'I':'..','J':'.---','K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.',
  'Q':'--.-','R':'.-.','S':'...','T':'-','U':'..-','V':'...-','W':'.--','X':'-..-',
  'Y':'-.--','Z':'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-',
  '5':'.....','6':'-....','7':'--...','8':'---..','9':'----.', ' ':' '
};

const REVERSE_MORSE = {};
Object.entries(MORSE_MAP).forEach(([k, v]) => { if (v !== ' ') REVERSE_MORSE[v] = k; });

// ═══════════════════════════════════════════════════════════
// NATO PHONETIC ALPHABET
// ═══════════════════════════════════════════════════════════
const NATO = {
  'A':'Alpha','B':'Bravo','C':'Charlie','D':'Delta','E':'Echo','F':'Foxtrot',
  'G':'Golf','H':'Hotel','I':'India','J':'Juliet','K':'Kilo','L':'Lima',
  'M':'Mike','N':'November','O':'Oscar','P':'Papa','Q':'Quebec','R':'Romeo',
  'S':'Sierra','T':'Tango','U':'Uniform','V':'Victor','W':'Whiskey','X':'X-ray',
  'Y':'Yankee','Z':'Zulu','0':'Zero','1':'One','2':'Two','3':'Three',
  '4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Niner'
};

// ═══════════════════════════════════════════════════════════
// FREQUENCY BAND CHART DATA
// ═══════════════════════════════════════════════════════════
const FREQ_BANDS = [
  { band: 'VLF', range: '3–30 kHz', use: 'Submarine comms, time signals', notes: 'Penetrates seawater' },
  { band: 'LF', range: '30–300 kHz', use: 'Navigation (LORAN), AM broadcast', notes: 'Ground wave propagation' },
  { band: 'MF', range: '300 kHz–3 MHz', use: 'AM radio, maritime, amateur (160m)', notes: 'Moderate range, ground wave' },
  { band: 'HF', range: '3–30 MHz', use: 'Shortwave, amateur, military, aviation', notes: 'Skywave — global range via ionosphere bounce' },
  { band: 'VHF', range: '30–300 MHz', use: 'FM radio, TV, amateur (2m), aviation, marine', notes: 'Line of sight, reliable' },
  { band: 'UHF', range: '300 MHz–3 GHz', use: 'TV, amateur (70cm), cell, GPS, Wi-Fi', notes: 'Line of sight, shorter range' },
  { band: 'SHF', range: '3–30 GHz', use: 'Radar, satellite, microwave links', notes: 'Highly directional' },
  { band: 'EHF', range: '30–300 GHz', use: 'Military satellite, 5G mmWave, radio astronomy', notes: 'Very short range, high bandwidth' },
];

const HAM_BANDS = [
  { band: '160m', freq: '1.8–2.0 MHz', mode: 'CW, SSB', class: 'General+', notes: 'Nighttime propagation, long-range' },
  { band: '80m', freq: '3.5–4.0 MHz', mode: 'CW, SSB, Digital', class: 'General+', notes: 'Regional, evening/night' },
  { band: '40m', freq: '7.0–7.3 MHz', mode: 'CW, SSB, Digital', class: 'General+', notes: 'Day: regional. Night: worldwide' },
  { band: '20m', freq: '14.0–14.35 MHz', mode: 'CW, SSB, Digital', class: 'General+', notes: 'Best DX band, daytime worldwide' },
  { band: '15m', freq: '21.0–21.45 MHz', mode: 'CW, SSB, Digital', class: 'General+', notes: 'Excellent daytime propagation' },
  { band: '10m', freq: '28.0–29.7 MHz', mode: 'CW, SSB, FM, Digital', class: 'Technician+', notes: 'Solar cycle dependent, long range' },
  { band: '6m', freq: '50–54 MHz', mode: 'CW, SSB, FM, Digital', class: 'Technician+', notes: '"Magic band" — sporadic skip' },
  { band: '2m', freq: '144–148 MHz', mode: 'FM, SSB, Digital', class: 'Technician+', notes: 'Most popular VHF — repeaters, local' },
  { band: '70cm', freq: '420–450 MHz', mode: 'FM, Digital, ATV', class: 'Technician+', notes: 'UHF — urban repeaters, satellite' },
];

const EMERGENCY_FREQS = [
  { freq: '121.5 MHz', use: 'International aviation distress (Guard)', protocol: 'MAYDAY calls' },
  { freq: '156.8 MHz (Ch 16)', use: 'International maritime distress', protocol: 'Pan-Pan / MAYDAY' },
  { freq: '243.0 MHz', use: 'Military aviation distress', protocol: 'Military MAYDAY' },
  { freq: '146.520 MHz', use: 'Amateur 2m national calling', protocol: 'FM simplex, emergency net' },
  { freq: '446.000 MHz', use: 'Amateur 70cm national calling', protocol: 'FM simplex' },
  { freq: '462.5625 MHz (FRS Ch 1)', use: 'FRS/GMRS common channel', protocol: 'License-free family radio' },
  { freq: '27.065 MHz (CB Ch 9)', use: 'CB emergency channel', protocol: 'No license required' },
  { freq: '7.030 MHz', use: 'QRP CW calling', protocol: 'Low-power Morse code' },
];

// ═══════════════════════════════════════════════════════════
// QUIZ DATA (questions on all topics)
// ═══════════════════════════════════════════════════════════
const QUIZ_QUESTIONS = [
  { q: 'What is the Morse code for SOS?', a: '... --- ...', choices: ['... --- ...', '-.- --- -.-', '... ... ...', '--- --- ---'] },
  { q: 'What does the NATO word "Lima" represent?', a: 'L', choices: ['L', 'M', 'I', 'N'] },
  { q: 'Which frequency band is best for worldwide HF communication during the day?', a: '20m (14 MHz)', choices: ['2m (144 MHz)', '20m (14 MHz)', '70cm (440 MHz)', '80m (3.5 MHz)'] },
  { q: 'What is the international maritime distress frequency?', a: '156.8 MHz (Ch 16)', choices: ['121.5 MHz', '156.8 MHz (Ch 16)', '146.52 MHz', '462.5625 MHz'] },
  { q: 'What is the Morse code for the letter "E"?', a: '.', choices: ['.', '-', '..', '-.'] },
  { q: 'In NATO phonetic, what letter is "Whiskey"?', a: 'W', choices: ['V', 'W', 'X', 'Y'] },
  { q: 'What amateur band is called the "Magic Band"?', a: '6m (50 MHz)', choices: ['2m (144 MHz)', '10m (28 MHz)', '6m (50 MHz)', '160m (1.8 MHz)'] },
  { q: 'What is the CB emergency channel?', a: 'Channel 9 (27.065 MHz)', choices: ['Channel 1', 'Channel 9 (27.065 MHz)', 'Channel 19', 'Channel 40'] },
  { q: 'Morse code: What letter is "-.-.?"', a: 'C', choices: ['K', 'C', 'N', 'D'] },
  { q: 'Which propagation method lets HF signals reach globally?', a: 'Skywave (ionosphere bounce)', choices: ['Ground wave', 'Skywave (ionosphere bounce)', 'Line of sight', 'Troposcatter'] },
  { q: 'What is the NATO word for the number 9?', a: 'Niner', choices: ['Nine', 'Niner', 'Nein', 'Nano'] },
  { q: 'What license class is needed for the 2m amateur band?', a: 'Technician', choices: ['General', 'Extra', 'Technician', 'No license'] },
  { q: 'The international aviation distress frequency is:', a: '121.5 MHz', choices: ['121.5 MHz', '156.8 MHz', '243.0 MHz', '146.52 MHz'] },
  { q: 'Morse code: What does ".- .-.. .--. ...." spell?', a: 'ALPH', choices: ['HELP', 'ALPH', 'ECHO', 'ALFA'] },
  { q: 'What does QRP mean?', a: 'Low power operation (typically ≤5W)', choices: ['Emergency call', 'Low power operation (typically ≤5W)', 'Frequency change request', 'Station closing'] },
];

// ═══════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════
let _hrActiveTab = 'morse';  // morse | phonetic | frequency | quiz
let _hrMorseAudioCtx = null;
let _hrQuizState = { index: 0, score: 0, answered: false, shuffled: [] };

// ═══════════════════════════════════════════════════════════
// RENDER ENTRY POINT
// ═══════════════════════════════════════════════════════════
function _hrRender(container) {
  container.innerHTML = '';

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'hr-tabs';
  const tabDefs = [
    { id: 'morse', label: '· − · MORSE', icon: ICONS.radioWave },
    { id: 'phonetic', label: 'PHONETIC', icon: ICONS.text },
    { id: 'frequency', label: 'FREQUENCIES', icon: ICONS.radio },
    { id: 'quiz', label: 'QUIZ', icon: ICONS.crosshair },
  ];
  tabDefs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'hr-tab' + (_hrActiveTab === t.id ? ' hr-tab--active' : '');
    btn.innerHTML = `<span class="hr-tab-icon">${t.icon}</span><span class="hr-tab-label">${t.label}</span>`;
    btn.onclick = () => { _hrActiveTab = t.id; _hrRender(container); };
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  // Content
  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  switch (_hrActiveTab) {
    case 'morse': _hrRenderMorse(content); break;
    case 'phonetic': _hrRenderPhonetic(content); break;
    case 'frequency': _hrRenderFrequency(content); break;
    case 'quiz': _hrRenderQuiz(content); break;
  }
}

// ═══════════════════════════════════════════════════════════
// MORSE CODE TRAINER
// ═══════════════════════════════════════════════════════════
function _hrRenderMorse(container) {
  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">MORSE CODE TRANSLATOR</div>
      <div class="hr-translator">
        <div class="hr-input-group">
          <label class="hr-label">TEXT</label>
          <textarea class="hr-input" id="hrMorseText" placeholder="Type text here..." rows="3" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"></textarea>
        </div>
        <div class="hr-arrow">⇅</div>
        <div class="hr-input-group">
          <label class="hr-label">MORSE CODE</label>
          <textarea class="hr-input hr-input-morse" id="hrMorseCode" placeholder="Type morse here (use . and -)" rows="3" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"></textarea>
        </div>
        <div class="hr-morse-actions">
          <button class="hr-btn" onclick="_hrPlayMorse()">▶ PLAY AUDIO</button>
          <button class="hr-btn hr-btn--secondary" onclick="_hrClearMorse()">CLEAR</button>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">REFERENCE CHART</div>
      <div class="hr-morse-grid" id="hrMorseGrid"></div>
    </div>`;

  // Wire bidirectional translation
  const textEl = document.getElementById('hrMorseText');
  const codeEl = document.getElementById('hrMorseCode');

  textEl.addEventListener('input', () => {
    codeEl.value = textEl.value.toUpperCase().split('').map(c => MORSE_MAP[c] || '').join(' ');
  });

  codeEl.addEventListener('input', () => {
    textEl.value = codeEl.value.split('   ').map(word =>
      word.split(' ').map(c => REVERSE_MORSE[c] || '').join('')
    ).join(' ');
  });

  // Build reference grid
  const grid = document.getElementById('hrMorseGrid');
  Object.entries(MORSE_MAP).forEach(([char, code]) => {
    if (char === ' ') return;
    const cell = document.createElement('div');
    cell.className = 'hr-morse-cell';
    cell.innerHTML = `<span class="hr-morse-char">${char}</span><span class="hr-morse-code">${code}</span>`;
    cell.onclick = () => {
      textEl.value += char;
      textEl.dispatchEvent(new Event('input'));
    };
    grid.appendChild(cell);
  });
}

function _hrPlayMorse() {
  const text = (document.getElementById('hrMorseText')?.value || '').toUpperCase();
  if (!text) return;

  if (!_hrMorseAudioCtx) {
    try { _hrMorseAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }

  const ctx = _hrMorseAudioCtx;
  const dotLen = 0.08; // seconds
  let time = ctx.currentTime + 0.1;

  text.split('').forEach(char => {
    const code = MORSE_MAP[char];
    if (!code) return;
    if (char === ' ') { time += dotLen * 7; return; }

    code.split('').forEach(symbol => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 650;
      gain.gain.setValueAtTime(0.3, time);
      osc.start(time);
      const dur = symbol === '.' ? dotLen : dotLen * 3;
      osc.stop(time + dur);
      time += dur + dotLen; // inter-element gap
    });
    time += dotLen * 2; // inter-character gap (total 3 dots)
  });
}

function _hrClearMorse() {
  const t = document.getElementById('hrMorseText');
  const c = document.getElementById('hrMorseCode');
  if (t) t.value = '';
  if (c) c.value = '';
}

// ═══════════════════════════════════════════════════════════
// NATO PHONETIC ALPHABET
// ═══════════════════════════════════════════════════════════
function _hrRenderPhonetic(container) {
  let html = `
    <div class="hr-section">
      <div class="hr-section-title">NATO PHONETIC ALPHABET</div>
      <div class="hr-phonetic-translator">
        <div class="hr-input-group">
          <label class="hr-label">TYPE TO TRANSLATE</label>
          <input class="hr-input" id="hrPhoneticInput" placeholder="Type text to convert..." maxlength="100" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other">
        </div>
        <div class="hr-phonetic-output" id="hrPhoneticOutput"></div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">REFERENCE</div>
      <div class="hr-phonetic-grid">`;

  Object.entries(NATO).forEach(([char, word]) => {
    html += `<div class="hr-phonetic-cell">
      <span class="hr-phonetic-char">${char}</span>
      <span class="hr-phonetic-word">${word}</span>
    </div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  document.getElementById('hrPhoneticInput').addEventListener('input', e => {
    const out = document.getElementById('hrPhoneticOutput');
    const text = e.target.value.toUpperCase();
    out.innerHTML = text.split('').map(c => {
      const word = NATO[c];
      return word ? `<span class="hr-phonetic-token">${word}</span>` : (c === ' ' ? '<span class="hr-phonetic-space">—</span>' : '');
    }).join('');
  });
}

// ═══════════════════════════════════════════════════════════
// FREQUENCY BAND CHARTS
// ═══════════════════════════════════════════════════════════
function _hrRenderFrequency(container) {
  let html = `
    <div class="hr-section">
      <div class="hr-section-title">RADIO FREQUENCY SPECTRUM</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>BAND</th><th>RANGE</th><th>COMMON USE</th><th>NOTES</th></tr></thead>
          <tbody>`;
  FREQ_BANDS.forEach(b => {
    html += `<tr><td class="hr-td-band">${b.band}</td><td>${b.range}</td><td>${b.use}</td><td class="hr-td-notes">${b.notes}</td></tr>`;
  });
  html += `</tbody></table></div></div>`;

  html += `
    <div class="hr-section">
      <div class="hr-section-title">AMATEUR (HAM) RADIO BANDS</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>BAND</th><th>FREQUENCY</th><th>MODES</th><th>LICENSE</th><th>NOTES</th></tr></thead>
          <tbody>`;
  HAM_BANDS.forEach(b => {
    html += `<tr><td class="hr-td-band">${b.band}</td><td>${b.freq}</td><td>${b.mode}</td><td>${b.class}</td><td class="hr-td-notes">${b.notes}</td></tr>`;
  });
  html += `</tbody></table></div></div>`;

  html += `
    <div class="hr-section">
      <div class="hr-section-title">EMERGENCY FREQUENCIES</div>
      <div class="hr-table-wrap">
        <table class="hr-table hr-table--emergency">
          <thead><tr><th>FREQUENCY</th><th>USE</th><th>PROTOCOL</th></tr></thead>
          <tbody>`;
  EMERGENCY_FREQS.forEach(f => {
    html += `<tr><td class="hr-td-freq">${f.freq}</td><td>${f.use}</td><td>${f.protocol}</td></tr>`;
  });
  html += `</tbody></table></div></div>`;

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// QUIZ MODE
// ═══════════════════════════════════════════════════════════
function _hrRenderQuiz(container) {
  // Shuffle on first render or restart
  if (!_hrQuizState.shuffled.length) {
    _hrQuizState.shuffled = [...QUIZ_QUESTIONS].sort(() => Math.random() - 0.5);
    _hrQuizState.index = 0;
    _hrQuizState.score = 0;
    _hrQuizState.answered = false;
  }

  const qs = _hrQuizState.shuffled;
  const i = _hrQuizState.index;

  // Quiz complete
  if (i >= qs.length) {
    const pct = Math.round((_hrQuizState.score / qs.length) * 100);
    container.innerHTML = `
      <div class="hr-quiz-complete">
        <div class="hr-quiz-score-icon">${pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '📚'}</div>
        <div class="hr-quiz-score-title">QUIZ COMPLETE</div>
        <div class="hr-quiz-score-value">${_hrQuizState.score} / ${qs.length}</div>
        <div class="hr-quiz-score-pct">${pct}%</div>
        <div class="hr-quiz-score-msg">${pct >= 80 ? 'Outstanding! Solid radio knowledge.' : pct >= 50 ? 'Good effort. Keep studying!' : 'Review the reference materials and try again.'}</div>
        <button class="hr-btn" onclick="_hrRestartQuiz()">RESTART QUIZ</button>
      </div>`;
    return;
  }

  const q = qs[i];
  // Shuffle choices for this question
  const shuffledChoices = [...q.choices].sort(() => Math.random() - 0.5);

  container.innerHTML = `
    <div class="hr-quiz-wrap">
      <div class="hr-quiz-progress">
        <div class="hr-quiz-progress-bar" style="width:${((i) / qs.length) * 100}%"></div>
      </div>
      <div class="hr-quiz-counter">QUESTION ${i + 1} / ${qs.length}</div>
      <div class="hr-quiz-question">${q.q}</div>
      <div class="hr-quiz-choices" id="hrQuizChoices">
        ${shuffledChoices.map((c, ci) => `
          <button class="hr-quiz-choice" data-answer="${c}" onclick="_hrAnswerQuiz(this, '${c.replace(/'/g, "\\'")}', '${q.a.replace(/'/g, "\\'")}')">${c}</button>
        `).join('')}
      </div>
      <div class="hr-quiz-feedback" id="hrQuizFeedback"></div>
      <button class="hr-btn hr-quiz-next" id="hrQuizNext" style="display:none" onclick="_hrNextQuestion()">NEXT →</button>
    </div>`;
}

function _hrAnswerQuiz(btn, selected, correct) {
  if (_hrQuizState.answered) return;
  _hrQuizState.answered = true;

  const isCorrect = selected === correct;
  if (isCorrect) _hrQuizState.score++;

  // Highlight all buttons
  document.querySelectorAll('.hr-quiz-choice').forEach(b => {
    b.disabled = true;
    if (b.dataset.answer === correct) {
      b.classList.add('hr-quiz-choice--correct');
    } else if (b === btn && !isCorrect) {
      b.classList.add('hr-quiz-choice--wrong');
    }
  });

  const feedback = document.getElementById('hrQuizFeedback');
  feedback.innerHTML = isCorrect
    ? '<span class="hr-quiz-correct">✓ Correct!</span>'
    : `<span class="hr-quiz-wrong">✗ Incorrect. The answer is: ${correct}</span>`;

  document.getElementById('hrQuizNext').style.display = '';
}

function _hrNextQuestion() {
  _hrQuizState.index++;
  _hrQuizState.answered = false;
  const container = document.querySelector('.hr-content');
  if (container) _hrRenderQuiz(container);
}

function _hrRestartQuiz() {
  _hrQuizState = { index: 0, score: 0, answered: false, shuffled: [] };
  const container = document.querySelector('.hr-content');
  if (container) _hrRenderQuiz(container);
}

// ═══════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════
function _hrCleanup() {
  if (_hrMorseAudioCtx) {
    try { _hrMorseAudioCtx.close(); } catch {}
    _hrMorseAudioCtx = null;
  }
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'ham-radio',
    name: 'HAM RADIO',
    icon: ICONS.radio,
    description: 'Morse code trainer, frequency charts, NATO phonetic alphabet, and practice quiz',
    render: _hrRender,
    cleanup: _hrCleanup,
  });
}
