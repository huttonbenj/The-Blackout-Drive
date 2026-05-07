/**
 * The Blackout Drive — Ham Radio Interactive Reference
 * =====================================================
 * Renders the interactive ham radio tools inside the library reader.
 * Called by library.js when a ham-radio-tools item is opened.
 * Zero external dependencies.
 */

'use strict';

// ── Data ─────────────────────────────────────────────────────

const NATO_ALPHABET = [
  { letter:'A', word:'Alpha',   phonetic:'AL-fah' },
  { letter:'B', word:'Bravo',   phonetic:'BRAH-voh' },
  { letter:'C', word:'Charlie', phonetic:'CHAR-lee' },
  { letter:'D', word:'Delta',   phonetic:'DEL-tah' },
  { letter:'E', word:'Echo',    phonetic:'EK-oh' },
  { letter:'F', word:'Foxtrot', phonetic:'FOKS-trot' },
  { letter:'G', word:'Golf',    phonetic:'GOLF' },
  { letter:'H', word:'Hotel',   phonetic:'hoh-TEL' },
  { letter:'I', word:'India',   phonetic:'IN-dee-ah' },
  { letter:'J', word:'Juliet',  phonetic:'JEW-lee-et' },
  { letter:'K', word:'Kilo',    phonetic:'KEY-loh' },
  { letter:'L', word:'Lima',    phonetic:'LEE-mah' },
  { letter:'M', word:'Mike',    phonetic:'MIKE' },
  { letter:'N', word:'November',phonetic:'no-VEM-ber' },
  { letter:'O', word:'Oscar',   phonetic:'OSS-kar' },
  { letter:'P', word:'Papa',    phonetic:'PAH-pah' },
  { letter:'Q', word:'Quebec',  phonetic:'keh-BEK' },
  { letter:'R', word:'Romeo',   phonetic:'ROH-mee-oh' },
  { letter:'S', word:'Sierra',  phonetic:'see-AIR-ah' },
  { letter:'T', word:'Tango',   phonetic:'TANG-go' },
  { letter:'U', word:'Uniform', phonetic:'YOU-nee-form' },
  { letter:'V', word:'Victor',  phonetic:'VIK-tah' },
  { letter:'W', word:'Whiskey', phonetic:'WISS-key' },
  { letter:'X', word:'X-ray',   phonetic:'EKS-ray' },
  { letter:'Y', word:'Yankee',  phonetic:'YANG-kee' },
  { letter:'Z', word:'Zulu',    phonetic:'ZOO-loo' },
  // Digits
  { letter:'0', word:'Zero',    phonetic:'ZEE-row' },
  { letter:'1', word:'One',     phonetic:'WUN' },
  { letter:'2', word:'Two',     phonetic:'TOO' },
  { letter:'3', word:'Three',   phonetic:'TREE' },
  { letter:'4', word:'Four',    phonetic:'FOW-er' },
  { letter:'5', word:'Five',    phonetic:'FIFE' },
  { letter:'6', word:'Six',     phonetic:'SIX' },
  { letter:'7', word:'Seven',   phonetic:'SEV-en' },
  { letter:'8', word:'Eight',   phonetic:'AIT' },
  { letter:'9', word:'Nine',    phonetic:'NIN-er' },
];

const MORSE_CODE = {
  A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.', G:'--.', H:'....',
  I:'..', J:'.---', K:'-.-', L:'.-..', M:'--', N:'-.',  O:'---', P:'.--.',
  Q:'--.-',R:'.-.', S:'...', T:'-',   U:'..-', V:'...-', W:'.--', X:'-..-',
  Y:'-.--',Z:'--..', '0':'-----','1':'.----','2':'..---','3':'...--',
  '4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',
  '.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','=':'-...-',
  '+':'.-.-.','@':'.--.-.','&':'.-...',':':'---...','(':'-.--.',')':'-.--.-',
};

const FREQ_BANDS = [
  { category: 'EMERGENCY', color: '#e07777', rows: [
    { name: 'NOAA Weather Radio', freq: '162.400 – 162.550 MHz', note: 'All-hazards alerts (7 channels)' },
    { name: 'FEMA/FCC Emergency', freq: '156.800 MHz (Ch 16)', note: 'Marine VHF emergency calling channel' },
    { name: 'FRS Emergency Call', freq: '462.675 MHz (Ch 1)', note: 'Family Radio Service — no license' },
    { name: 'MURS Emergency', freq: '151.820 MHz (Ch 3)', note: 'No license required' },
    { name: 'CB Radio Emergency', freq: '27.065 MHz (Ch 9)', note: 'Citizens Band emergency channel' },
  ]},
  { category: 'AMATEUR RADIO (HAM)', color: '#c8a04a', rows: [
    { name: '2 Meter Band', freq: '144 – 148 MHz', note: 'Most popular local VHF. 146.520 calling' },
    { name: '70 cm Band', freq: '420 – 450 MHz', note: 'UHF. 446.000 national simplex calling' },
    { name: '40 Meter Band', freq: '7.000 – 7.300 MHz', note: 'HF. Excellent for 500–2,000 mi range' },
    { name: '80 Meter Band', freq: '3.500 – 4.000 MHz', note: 'HF. Night-time regional communication' },
    { name: '20 Meter Band', freq: '14.000 – 14.350 MHz', note: 'HF. DX / worldwide communication' },
    { name: 'SSTV (20m)', freq: '14.230 MHz', note: 'Slow-scan TV image transmission' },
    { name: 'WSPR / Digital', freq: '14.0956 MHz', note: 'Weak signal propagation reporter' },
  ]},
  { category: 'FRS / GMRS (No License)', color: '#7ab88a', rows: [
    { name: 'FRS Channels 1–14', freq: '462.5625 – 467.7125 MHz', note: 'Max 2W. Ch 1–7 shared with GMRS' },
    { name: 'GMRS Repeater Input', freq: '467.5500 – 467.7125 MHz', note: 'License required ($35, 10 yrs)' },
    { name: 'GMRS Simplex', freq: '462.5500 – 462.7250 MHz', note: 'Up to 5W handheld, 50W mobile' },
  ]},
  { category: 'PUBLIC SAFETY (LISTEN ONLY)', color: '#7ab8b8', rows: [
    { name: 'Aviation Guard', freq: '121.500 MHz', note: 'International aviation emergency' },
    { name: 'Military Aviation', freq: '243.000 MHz', note: 'UHF aviation guard (military)' },
    { name: 'EMS/Fire (varies)', freq: '154 – 158 MHz', note: 'Varies by county — scan this range' },
    { name: 'Police (varies)', freq: '460 – 470 MHz', note: 'Most modern police (P25 digital)' },
  ]},
];

// ── Morse Audio Engine ────────────────────────────────────

let _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

function _playMorseString(morseStr, wpm = 18) {
  const ctx = _getAudioCtx();
  const dotMs = 1200 / wpm;
  const freq = 700; // Hz

  let t = ctx.currentTime + 0.05;
  for (const ch of morseStr) {
    const dur = ch === '.' ? dotMs / 1000 : (ch === '-' ? dotMs * 3 / 1000 : 0);
    if (ch === ' ') { t += dotMs * 3 / 1000; continue; }
    if (ch === '/') { t += dotMs * 7 / 1000; continue; }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.005);
    gain.gain.setValueAtTime(0.3, t + dur - 0.005);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.01);
    t += dur + dotMs / 1000;
  }
  return t - ctx.currentTime;
}

function textToMorse(text) {
  return text.toUpperCase().split('').map(ch => {
    if (ch === ' ') return '/';
    return MORSE_CODE[ch] || '?';
  }).join(' ');
}

// ── Main Renderer ─────────────────────────────────────────

window.renderHamRadioTools = function(containerEl) {
  containerEl.innerHTML = '';
  containerEl.className = 'ham-radio-tools';

  // Tab header
  const tabs = [
    { id:'phonetic', label:'📻 NATO ALPHABET' },
    { id:'encode',   label:'⚡ MORSE ENCODER' },
    { id:'freq',     label:'📡 FREQUENCIES' },
    { id:'quiz',     label:'🎯 QUIZ' },
  ];

  const tabBar = document.createElement('div');
  tabBar.className = 'ham-tab-bar';
  tabs.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'ham-tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = t.label;
    btn.dataset.tab = t.id;
    btn.onclick = () => switchTab(t.id, containerEl);
    tabBar.appendChild(btn);
  });
  containerEl.appendChild(tabBar);

  const content = document.createElement('div');
  content.id = 'hamContent';
  containerEl.appendChild(content);

  renderPhonetic(content);
};

function switchTab(tabId, containerEl) {
  containerEl.querySelectorAll('.ham-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId));
  const content = containerEl.querySelector('#hamContent');
  if (tabId === 'phonetic') renderPhonetic(content);
  else if (tabId === 'encode')   renderMorseEncoder(content);
  else if (tabId === 'freq')     renderFrequencies(content);
  else if (tabId === 'quiz')     renderQuiz(content);
}

// ── Tab: NATO Phonetic Alphabet ───────────────────────────

function renderPhonetic(el) {
  const letters = NATO_ALPHABET.filter(n => isNaN(n.letter));
  const digits  = NATO_ALPHABET.filter(n => !isNaN(n.letter));

  el.innerHTML = `
    <div class="ham-section-title">NATO Phonetic Alphabet — International Standard</div>
    <div class="ham-phonetic-grid">
      ${letters.map(n => `
        <div class="ham-phonetic-card" onclick="window._playMorseChar('${n.letter}')">
          <div class="ham-ph-letter">${n.letter}</div>
          <div class="ham-ph-word">${n.word}</div>
          <div class="ham-ph-pron">${n.phonetic}</div>
          <div class="ham-ph-morse">${MORSE_CODE[n.letter] || ''}</div>
        </div>
      `).join('')}
    </div>
    <div class="ham-section-title" style="margin-top:24px">Digits</div>
    <div class="ham-phonetic-grid ham-phonetic-grid--digits">
      ${digits.map(n => `
        <div class="ham-phonetic-card" onclick="window._playMorseChar('${n.letter}')">
          <div class="ham-ph-letter">${n.letter}</div>
          <div class="ham-ph-word">${n.word}</div>
          <div class="ham-ph-pron">${n.phonetic}</div>
          <div class="ham-ph-morse">${MORSE_CODE[n.letter] || ''}</div>
        </div>
      `).join('')}
    </div>
    <div class="ham-tip">💡 Click any card to hear its Morse code</div>
  `;
}

window._playMorseChar = function(ch) {
  const morse = MORSE_CODE[ch.toUpperCase()];
  if (morse) _playMorseString(morse, 12);
};

// ── Tab: Morse Encoder ───────────────────────────────────

function renderMorseEncoder(el) {
  el.innerHTML = `
    <div class="ham-section-title">Morse Code Encoder & Player</div>
    <div class="ham-encode-area">
      <textarea id="morseInput" class="ham-textarea" placeholder="Type text to encode into Morse code..." rows="3" maxlength="200"></textarea>
      <div class="ham-encode-controls">
        <button class="ham-btn ham-btn--primary" onclick="window._doEncode()">⚡ ENCODE</button>
        <label class="ham-wpm-label">Speed:
          <input type="range" id="morseWpm" min="8" max="30" value="16" oninput="document.getElementById('morseWpmVal').textContent=this.value">
          <span id="morseWpmVal">16</span> WPM
        </label>
      </div>
      <div id="morseOutput" class="ham-morse-output"></div>
      <div id="morsePlayControls" style="display:none;" class="ham-play-controls">
        <button class="ham-btn ham-btn--primary" id="morsePlayBtn" onclick="window._playMorse()">▶ PLAY</button>
        <button class="ham-btn" onclick="window._stopMorse()">⏹ STOP</button>
      </div>
    </div>

    <div class="ham-section-title" style="margin-top:28px">Morse Code Reference Table</div>
    <div class="ham-morse-table">
      ${Object.entries(MORSE_CODE).filter(([k]) => /^[A-Z]$/.test(k)).map(([letter, code]) => `
        <div class="ham-morse-row" onclick="window._playMorseChar('${letter}')">
          <span class="ham-morse-letter">${letter}</span>
          <span class="ham-morse-dots">${code}</span>
          <span class="ham-morse-visual">${code.split('').map(c => c === '.' ? '·' : '—').join(' ')}</span>
        </div>
      `).join('')}
    </div>
  `;
}

let _currentMorse = '';
let _morsePlayTimer = null;

window._doEncode = function() {
  const text = document.getElementById('morseInput')?.value?.trim() || '';
  if (!text) return;
  _currentMorse = textToMorse(text);
  const out = document.getElementById('morseOutput');
  if (out) {
    out.textContent = _currentMorse;
    out.style.display = 'block';
  }
  const controls = document.getElementById('morsePlayControls');
  if (controls) controls.style.display = 'flex';
};

window._playMorse = function() {
  if (!_currentMorse) return;
  const wpm = parseInt(document.getElementById('morseWpm')?.value || '16');
  const dur = _playMorseString(_currentMorse, wpm);
  const btn = document.getElementById('morsePlayBtn');
  if (btn) { btn.textContent = '▶ PLAYING...'; btn.disabled = true; }
  clearTimeout(_morsePlayTimer);
  _morsePlayTimer = setTimeout(() => {
    if (btn) { btn.textContent = '▶ PLAY'; btn.disabled = false; }
  }, dur * 1000 + 200);
};

window._stopMorse = function() {
  if (_audioCtx) _audioCtx.close().then(() => { _audioCtx = null; });
  clearTimeout(_morsePlayTimer);
  const btn = document.getElementById('morsePlayBtn');
  if (btn) { btn.textContent = '▶ PLAY'; btn.disabled = false; }
};

// ── Tab: Frequency Reference ─────────────────────────────

function renderFrequencies(el) {
  el.innerHTML = `
    <div class="ham-section-title">Emergency & Amateur Radio Frequency Reference</div>
    ${FREQ_BANDS.map(band => `
      <div class="ham-freq-band">
        <div class="ham-freq-band-title" style="color:${band.color}">${band.category}</div>
        <table class="ham-freq-table">
          <thead>
            <tr><th>Channel / Band</th><th>Frequency</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${band.rows.map(r => `
              <tr>
                <td class="ham-freq-name">${r.name}</td>
                <td class="ham-freq-hz">${r.freq}</td>
                <td class="ham-freq-note">${r.note}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('')}
    <div class="ham-tip">💡 Frequencies vary by region. Verify with local repeater directories.</div>
  `;
}

// ── Tab: Quiz Mode ───────────────────────────────────────

let _quizItems = [];
let _quizIdx = 0;
let _quizScore = 0;
let _quizTotal = 0;
let _quizAnswered = false;

function renderQuiz(el) {
  _quizItems = [...NATO_ALPHABET].sort(() => Math.random() - 0.5);
  _quizIdx = 0; _quizScore = 0; _quizTotal = 0;
  el.innerHTML = `
    <div class="ham-section-title">NATO Phonetic Alphabet Quiz</div>
    <div class="ham-quiz-area" id="quizArea"></div>
  `;
  _nextQuestion();
}

function _nextQuestion() {
  if (_quizIdx >= _quizItems.length) {
    _showQuizResult();
    return;
  }
  const item = _quizItems[_quizIdx];
  const isLetterToWord = Math.random() > 0.5;

  // Generate 4 options
  const correct = isLetterToWord ? item.word : item.letter;
  const wrongPool = NATO_ALPHABET.filter(n => n.letter !== item.letter);
  const wrongs = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3)
    .map(n => isLetterToWord ? n.word : n.letter);
  const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);

  const prompt = isLetterToWord
    ? `What is the NATO word for <strong>${item.letter}</strong>?`
    : `<strong>${item.word}</strong> — what letter does this represent?`;

  const quizArea = document.getElementById('quizArea');
  if (!quizArea) return;
  _quizAnswered = false;
  quizArea.innerHTML = `
    <div class="ham-quiz-progress">Question ${_quizIdx + 1} / ${_quizItems.length} &nbsp;·&nbsp; Score: ${_quizScore} / ${_quizTotal}</div>
    <div class="ham-quiz-prompt">${prompt}</div>
    <div class="ham-quiz-options">
      ${options.map(opt => `
        <button class="ham-quiz-opt" onclick="window._checkAnswer(this, '${opt}', '${correct}')">${opt}</button>
      `).join('')}
    </div>
    <div class="ham-quiz-feedback" id="quizFeedback"></div>
    <div class="ham-quiz-morse">Morse: <span class="ham-morse-dots">${MORSE_CODE[item.letter] || ''}</span></div>
  `;
}

window._checkAnswer = function(btn, chosen, correct) {
  if (_quizAnswered) return;
  _quizAnswered = true;
  _quizTotal++;
  const isCorrect = chosen === correct;
  if (isCorrect) _quizScore++;

  document.querySelectorAll('.ham-quiz-opt').forEach(b => {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add('quiz-correct');
    else if (b === btn && !isCorrect) b.classList.add('quiz-wrong');
  });

  const fb = document.getElementById('quizFeedback');
  if (fb) {
    const item = _quizItems[_quizIdx];
    fb.innerHTML = isCorrect
      ? `✅ Correct! <span style="opacity:0.7">${item.letter} — ${item.word} (${item.phonetic})</span>`
      : `❌ <strong>${correct}</strong> was correct. ${item.letter} — ${item.word} (${item.phonetic})`;
    fb.className = 'ham-quiz-feedback ' + (isCorrect ? 'quiz-correct-fb' : 'quiz-wrong-fb');
  }

  // Auto-advance after 1.8s
  setTimeout(() => { _quizIdx++; _nextQuestion(); }, 1800);
};

function _showQuizResult() {
  const pct = Math.round((_quizScore / _quizTotal) * 100);
  const grade = pct >= 90 ? '🏆 EXPERT' : pct >= 70 ? '✅ SOLID' : pct >= 50 ? '📚 LEARNING' : '🔁 KEEP PRACTICING';
  const quizArea = document.getElementById('quizArea');
  if (!quizArea) return;
  quizArea.innerHTML = `
    <div class="ham-quiz-result">
      <div class="ham-result-grade">${grade}</div>
      <div class="ham-result-score">${_quizScore} / ${_quizTotal} correct (${pct}%)</div>
      <button class="ham-btn ham-btn--primary" style="margin-top:20px" onclick="renderQuiz(document.getElementById('quizArea').parentElement.parentElement)">🔁 RETRY QUIZ</button>
    </div>
  `;
}
