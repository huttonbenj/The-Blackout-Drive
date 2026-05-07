/**
 * DOOMSDAY.AI — Offline Library Browser
 * Reads library.json catalog, renders categories + file list,
 * provides in-browser TXT reader with search, and a dedicated
 * Bible reader with Book/Chapter navigation.
 * Zero external dependencies — pure vanilla JS.
 */

'use strict';

// ── Bible Book Names (66 canonical books in order) ────────
const BIBLE_BOOK_NAMES = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy',
  'Joshua','Judges','Ruth','1 Samuel','2 Samuel',
  '1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs',
  'Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations',
  'Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk',
  'Zephaniah','Haggai','Zechariah','Malachi',
  'Matthew','Mark','Luke','John','Acts',
  'Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians',
  'Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy',
  '2 Timothy','Titus','Philemon','Hebrews','James',
  '1 Peter','2 Peter','1 John','2 John','3 John',
  'Jude','Revelation'
];

// ── State ─────────────────────────────────────────────────
let libCatalog      = null;
let libActiveCat    = null;
let libActiveItem   = null;
let libMode         = 'cats';    // 'cats' | 'files' | 'reader'
let libSearchMatches = [];
let libSearchIdx    = 0;

// Bible state
let bibleData       = null;      // parsed [{name, chapters:[null,[{vs,text},...],...]}]
let bibleBookIdx    = 0;
let bibleChapter    = 1;
let libInBibleMode  = false;

// ── DOM refs ──────────────────────────────────────────────
const libraryPanel   = document.getElementById('libraryPanel');
const libSidebar     = document.getElementById('libSidebar');
const libMain        = document.getElementById('libMain');
const libBackBtn     = document.getElementById('libBackBtn');
const libHeaderTitle = document.getElementById('libHeaderTitle');

// ── Open / Close ──────────────────────────────────────────
async function openLibrary() {
  libraryPanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (!libCatalog) {
    await loadCatalog();
  } else {
    renderSidebar();
    if (libActiveCat) renderFileList(libActiveCat);
    else showCategorySelect();
  }
}

function closeLibrary() {
  libraryPanel.style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && libraryPanel.style.display !== 'none') {
    if (libMode === 'reader') closeReader();
    else closeLibrary();
  }
});

// ── Back button ────────────────────────────────────────────
function handleLibBack() {
  if (libMode === 'reader') {
    closeReader();
  } else if (libMode === 'files') {
    libActiveCat = null;
    libMode = 'cats';
    showCategorySelect();
    updateLibHeader();
  }
}

function updateLibHeader() {
  if (libMode === 'cats') {
    libHeaderTitle.textContent = '📚 OFFLINE LIBRARY';
    libBackBtn.classList.add('hidden');
  } else if (libMode === 'files') {
    const cat = libCatalog.categories.find(c => c.id === libActiveCat);
    libHeaderTitle.textContent = cat ? `${cat.icon} ${cat.name.toUpperCase()}` : '📚 LIBRARY';
    libBackBtn.classList.remove('hidden');
    libBackBtn.textContent = '← CATEGORIES';
  } else if (libMode === 'reader') {
    const title = libInBibleMode
      ? `${BIBLE_BOOK_NAMES[bibleBookIdx].toUpperCase()} — CH. ${bibleChapter}`
      : (libActiveItem ? libActiveItem.name.toUpperCase() : 'READER');
    libHeaderTitle.textContent = title;
    libBackBtn.classList.remove('hidden');
    libBackBtn.textContent = '← FILE LIST';
  }
}

// ── Catalog loading ────────────────────────────────────────
async function loadCatalog() {
  libMain.innerHTML = '<div class="lib-loading"><span>Loading library catalog...</span></div>';
  try {
    const res = await fetch('/content/library.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    libCatalog = await res.json();
    renderSidebar();
    showCategorySelect();
  } catch {
    libMain.innerHTML = `
      <div class="lib-missing-panel">
        <div class="lib-missing-title">⚠ CATALOG NOT FOUND</div>
        <div class="lib-missing-desc">Library catalog could not be loaded.<br>Run setup_drive.sh to assemble the drive.</div>
        <div class="lib-missing-cmd">bash scripts/setup_drive.sh</div>
      </div>`;
  }
}

// ── Sidebar ────────────────────────────────────────────────
function renderSidebar() {
  if (!libCatalog) return;
  libInBibleMode = false;
  libSidebar.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = 'CATEGORIES';
  libSidebar.appendChild(label);
  libCatalog.categories.forEach(cat => {
    const el = document.createElement('div');
    el.className = 'lib-cat-item' + (libActiveCat === cat.id ? ' active' : '');
    el.dataset.catId = cat.id;
    el.onclick = () => selectCategory(cat.id);
    el.innerHTML = `<span class="lib-cat-icon">${cat.icon}</span><span class="lib-cat-name">${cat.name}</span>`;
    libSidebar.appendChild(el);
  });
}

function highlightSidebar(catId) {
  libSidebar.querySelectorAll('.lib-cat-item').forEach(el =>
    el.classList.toggle('active', el.dataset.catId === catId));
}

// ── Bible sidebar ──────────────────────────────────────────
function renderBibleSidebar() {
  libInBibleMode = true;
  libSidebar.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = 'BOOKS';
  libSidebar.appendChild(label);

  const otLabel = document.createElement('div');
  otLabel.className = 'lib-sidebar-section';
  otLabel.textContent = 'OLD TESTAMENT';
  libSidebar.appendChild(otLabel);

  BIBLE_BOOK_NAMES.forEach((name, idx) => {
    if (idx === 39) {
      const ntLabel = document.createElement('div');
      ntLabel.className = 'lib-sidebar-section';
      ntLabel.textContent = 'NEW TESTAMENT';
      libSidebar.appendChild(ntLabel);
    }
    const el = document.createElement('div');
    el.className = 'lib-cat-item' + (idx === bibleBookIdx ? ' active' : '');
    el.dataset.bookIdx = idx;
    el.onclick = () => selectBibleBook(idx);
    el.innerHTML = `<span class="lib-cat-name" style="font-size:clamp(10px,0.72vw,13px)">${name}</span>`;
    libSidebar.appendChild(el);
  });

  // Scroll active book into view
  requestAnimationFrame(() => {
    const active = libSidebar.querySelector('.lib-cat-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  });
}

function highlightBibleSidebar(idx) {
  libSidebar.querySelectorAll('.lib-cat-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.bookIdx) === idx));
}

// ── Category select view ───────────────────────────────────
function showCategorySelect() {
  libMode = 'cats';
  libActiveCat = null;
  updateLibHeader();
  highlightSidebar(null);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(clamp(200px,18vw,280px),1fr));gap:16px;';
  libCatalog.categories.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'lib-file-item';
    card.style.flexDirection = 'column';
    card.onclick = () => selectCategory(cat.id);
    card.innerHTML = `
      <div style="font-size:clamp(28px,2.5vw,40px);margin-bottom:8px;">${cat.icon}</div>
      <div class="lib-file-name">${cat.name}</div>
      <div class="lib-file-desc">${cat.description}</div>
      <div class="lib-file-meta">${cat.items.length} item${cat.items.length !== 1 ? 's' : ''}</div>`;
    grid.appendChild(card);
  });
  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">OFFLINE LIBRARY</div>
      <div class="lib-cat-desc">Everything preloaded on this drive. Browse and read without internet.</div>
    </div>`;
  libMain.appendChild(grid);
}

// ── Category → file list ───────────────────────────────────
function selectCategory(catId) {
  libActiveCat = catId;
  libMode = 'files';
  updateLibHeader();
  highlightSidebar(catId);
  renderFileList(catId);
}

function renderFileList(catId) {
  const cat = libCatalog.categories.find(c => c.id === catId);
  if (!cat) return;
  const listEl = document.createElement('div');
  listEl.className = 'lib-file-list';
  cat.items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'lib-file-item';
    el.onclick = () => openItem(item);
    const typeClass = item.type === 'pdf' ? 'pdf' : item.type === 'zim' ? 'zim' : 'txt';
    const sizeStr = item.size_mb >= 1000 ? `${(item.size_mb/1024).toFixed(1)} GB` : `~${item.size_mb} MB`;
    el.innerHTML = `
      <span class="lib-file-type-badge ${typeClass}">${item.type.toUpperCase()}</span>
      <div class="lib-file-info">
        <div class="lib-file-name">${item.name}</div>
        <div class="lib-file-desc">${item.description}</div>
        <div class="lib-file-meta">${sizeStr} · ${item.license}</div>
      </div>`;
    listEl.appendChild(el);
  });
  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">${cat.icon} ${cat.name.toUpperCase()}</div>
      <div class="lib-cat-desc">${cat.description}</div>
    </div>`;
  libMain.appendChild(listEl);
}

// ── Open a file item ───────────────────────────────────────
async function openItem(item) {
  libActiveItem = item;

  if (item.type === 'pdf') {
    // Check existence first — show graceful message if not downloaded
    libMode = 'reader';
    updateLibHeader();
    libMain.innerHTML = '<div class="lib-loading"><span>Checking file...</span></div>';
    try {
      const check = await fetch('/' + item.file, { method: 'HEAD' });
      if (!check.ok) { showMissingPanel(item); return; }
    } catch { showMissingPanel(item); return; }
    // File exists — open in browser native PDF viewer
    const a = document.createElement('a');
    a.href = '/' + item.file;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Show a "opened in new tab" confirmation
    libMain.innerHTML = `
      <div class="lib-zim-panel">
        <div style="font-size:40px;opacity:0.7">📄</div>
        <div class="lib-zim-title">${item.name.toUpperCase()}</div>
        <div class="lib-zim-desc">Opened in a new browser tab.<br>Use your browser's built-in PDF viewer to read it.</div>
      </div>`;
    return;
  }

  if (item.type === 'zim') {
    libMode = 'reader';
    updateLibHeader();
    showZimPanel(item);
    return;
  }

  // TXT file — check if it's a Bible file
  if (item.id && item.id.startsWith('bible_')) {
    libMode = 'reader';
    libMain.innerHTML = '<div class="lib-loading"><span>Loading Bible... (may take a moment)</span></div>';
    try {
      const res = await fetch('/' + item.file);
      if (!res.ok) { showMissingPanel(item); return; }
      const text = await res.text();
      initBibleReader(item, text);
    } catch { showMissingPanel(item); }
    return;
  }

  // Generic TXT reader
  libMode = 'reader';
  updateLibHeader();
  libMain.innerHTML = '<div class="lib-loading"><span>Loading file...</span></div>';
  try {
    const res = await fetch('/' + item.file);
    if (!res.ok) { showMissingPanel(item); return; }
    const text = await res.text();
    renderGenericReader(item, text);
  } catch { showMissingPanel(item); }
}

// ── Bible Reader ───────────────────────────────────────────
function parseBibleText(rawText) {
  // Skip Project Gutenberg preamble
  const startMarker = '*** START OF THE PROJECT GUTENBERG EBOOK';
  const startIdx = rawText.indexOf(startMarker);
  const text = startIdx >= 0 ? rawText.slice(startIdx) : rawText;
  const lines = text.split('\n');

  const books = BIBLE_BOOK_NAMES.map(name => ({ name, chapters: [null] }));
  let bookIdx = -1;
  let curCh = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const m = line.match(/^(\d+):(\d+)\s+(.+)/);
    if (!m) continue;
    const ch = parseInt(m[1]);
    const vs = parseInt(m[2]);
    const verseText = m[3].trim();

    if (ch === 1 && vs === 1) {
      bookIdx++;
      if (bookIdx >= BIBLE_BOOK_NAMES.length) break;
      curCh = 1;
      books[bookIdx].chapters[1] = [];
    }
    if (bookIdx < 0) continue;
    if (ch !== curCh) {
      curCh = ch;
      if (!books[bookIdx].chapters[ch]) books[bookIdx].chapters[ch] = [];
    }
    if (books[bookIdx].chapters[ch]) {
      books[bookIdx].chapters[ch].push({ vs, text: verseText });
    }
  }
  return books.filter(b => b.chapters.length > 1);
}

function initBibleReader(item, rawText) {
  libMain.innerHTML = '<div class="lib-loading"><span>Parsing Bible text...</span></div>';
  // Defer parsing so the loading message renders first
  setTimeout(() => {
    bibleData = parseBibleText(rawText);
    if (!bibleData.length) { showMissingPanel(item); return; }
    bibleBookIdx = 0;
    bibleChapter = 1;
    renderBibleSidebar();
    updateLibHeader();
    renderBibleChapterView();
  }, 20);
}

function renderBibleChapterView() {
  updateLibHeader();
  if (!bibleData || !bibleData[bibleBookIdx]) return;
  const book = bibleData[bibleBookIdx];
  const totalChapters = book.chapters.length - 1;
  const verses = book.chapters[bibleChapter] || [];
  const bookName = book.name;

  // Build chapter options
  let chOptions = '';
  for (let c = 1; c <= totalChapters; c++) {
    chOptions += `<option value="${c}" ${c === bibleChapter ? 'selected' : ''}>Chapter ${c}</option>`;
  }

  // Build book options
  let bookOptions = '';
  (bibleData || []).forEach((b, i) => {
    bookOptions += `<option value="${i}" ${i === bibleBookIdx ? 'selected' : ''}>${b.name}</option>`;
  });

  const hasPrev = bibleChapter > 1 || bibleBookIdx > 0;
  const hasNext = bibleChapter < totalChapters || bibleBookIdx < bibleData.length - 1;

  libMain.innerHTML = `
    <div class="bible-nav">
      <select class="bible-select" id="bibleBookSel" onchange="selectBibleBook(parseInt(this.value))">
        ${bookOptions}
      </select>
      <select class="bible-select" id="bibleChSel" onchange="selectBibleChapter(parseInt(this.value))">
        ${chOptions}
      </select>
      <div class="bible-jump-bar">
        <input type="text" class="lib-search-input" id="bibleJumpInput"
          placeholder="e.g. John 3:16" style="width:clamp(120px,12vw,180px)"
          onkeydown="if(event.key==='Enter')doBibleJump()">
        <button class="lib-search-btn" onclick="doBibleJump()">GO</button>
      </div>
    </div>
    <div class="bible-chapter-title">${bookName.toUpperCase()} — CHAPTER ${bibleChapter}</div>
    <div class="bible-verses" id="bibleVerses">
      ${verses.map(v => `
        <div class="bible-verse" id="bv-${v.vs}">
          <span class="bible-verse-num">${v.vs}</span>
          <span class="bible-verse-text">${escapeHtml(v.text)}</span>
        </div>`).join('')}
    </div>
    <div class="bible-bottom-nav">
      <button class="lib-search-btn" onclick="prevBibleChapter()" ${hasPrev ? '' : 'disabled style="opacity:0.3"'}>← PREVIOUS</button>
      <span style="color:var(--text-dim);font-size:clamp(10px,0.7vw,12px);letter-spacing:2px">${bookName} ${bibleChapter} / ${totalChapters}</span>
      <button class="lib-search-btn" onclick="nextBibleChapter()" ${hasNext ? '' : 'disabled style="opacity:0.3"'}>NEXT →</button>
    </div>`;
  libMain.scrollTop = 0;
}

function selectBibleBook(idx) {
  if (!bibleData || idx < 0 || idx >= bibleData.length) return;
  bibleBookIdx = idx;
  bibleChapter = 1;
  highlightBibleSidebar(idx);
  renderBibleChapterView();
  // Scroll active book into view in sidebar
  const active = libSidebar.querySelector('.lib-cat-item.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectBibleChapter(ch) {
  bibleChapter = ch;
  renderBibleChapterView();
}

function prevBibleChapter() {
  if (bibleChapter > 1) {
    bibleChapter--;
    renderBibleChapterView();
  } else if (bibleBookIdx > 0) {
    bibleBookIdx--;
    const book = bibleData[bibleBookIdx];
    bibleChapter = book.chapters.length - 1;
    highlightBibleSidebar(bibleBookIdx);
    renderBibleChapterView();
  }
}

function nextBibleChapter() {
  if (!bibleData) return;
  const book = bibleData[bibleBookIdx];
  const total = book.chapters.length - 1;
  if (bibleChapter < total) {
    bibleChapter++;
    renderBibleChapterView();
  } else if (bibleBookIdx < bibleData.length - 1) {
    bibleBookIdx++;
    bibleChapter = 1;
    highlightBibleSidebar(bibleBookIdx);
    renderBibleChapterView();
  }
}

function doBibleJump() {
  const input = document.getElementById('bibleJumpInput');
  if (!input || !bibleData) return;
  const query = input.value.trim();
  if (!query) return;

  // Try to parse "Book Chapter:Verse" or "Book Chapter" or "Chapter:Verse"
  // Patterns: "John 3:16", "Genesis 1", "3:16" (stay in book), "Psalm 23"
  let targetBook = bibleBookIdx;
  let targetCh = bibleChapter;
  let targetVs = null;

  const fullRef = query.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (fullRef) {
    const bookQuery = fullRef[1].toLowerCase().trim();
    const foundIdx = bibleData.findIndex(b => b.name.toLowerCase().startsWith(bookQuery));
    if (foundIdx >= 0) {
      targetBook = foundIdx;
      targetCh = parseInt(fullRef[2]);
      if (fullRef[3]) targetVs = parseInt(fullRef[3]);
    }
  } else {
    const chVs = query.match(/^(\d+):(\d+)$/);
    if (chVs) {
      targetCh = parseInt(chVs[1]);
      targetVs = parseInt(chVs[2]);
    }
  }

  bibleBookIdx = targetBook;
  bibleChapter = Math.max(1, Math.min(targetCh, bibleData[targetBook].chapters.length - 1));
  highlightBibleSidebar(bibleBookIdx);
  renderBibleChapterView();

  if (targetVs) {
    requestAnimationFrame(() => {
      const el = document.getElementById(`bv-${targetVs}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bible-verse-highlight');
        setTimeout(() => el.classList.remove('bible-verse-highlight'), 2500);
      }
    });
  }
  if (input) input.value = '';
}

// ── Close reader ───────────────────────────────────────────
function closeReader() {
  libActiveItem = null;
  libInBibleMode = false;
  libMode = 'files';
  renderSidebar();
  updateLibHeader();
  if (libActiveCat) {
    highlightSidebar(libActiveCat);
    renderFileList(libActiveCat);
  } else {
    showCategorySelect();
  }
}

// ── Generic TXT reader ─────────────────────────────────────
function renderGenericReader(item, rawText) {
  const headerEl = document.createElement('div');
  headerEl.className = 'lib-reader-header';
  headerEl.innerHTML = `
    <div class="lib-reader-title">${item.name}</div>
    <div class="lib-search-bar">
      <input type="text" class="lib-search-input" id="libSearchInput"
        placeholder="Search in text..." onkeydown="if(event.key==='Enter')doLibSearch()">
      <button class="lib-search-btn" onclick="doLibSearch()">FIND</button>
      <button class="lib-search-btn" onclick="libSearchNext()">NEXT</button>
      <span class="lib-search-count" id="libSearchCount"></span>
    </div>`;
  const contentEl = document.createElement('div');
  contentEl.className = 'lib-reader-content';
  contentEl.id = 'libReaderContent';
  contentEl.textContent = rawText;
  libMain.innerHTML = '';
  libMain.appendChild(headerEl);
  libMain.appendChild(contentEl);
  libMain.scrollTop = 0;
}

// ── Search (generic reader) ────────────────────────────────
function doLibSearch() {
  const input   = document.getElementById('libSearchInput');
  const content = document.getElementById('libReaderContent');
  const countEl = document.getElementById('libSearchCount');
  if (!input || !content) return;
  const query = input.value.trim();
  if (!query) {
    content.innerHTML = content.textContent;
    if (countEl) countEl.textContent = '';
    return;
  }
  const raw = content.textContent;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  content.innerHTML = raw.replace(regex, m => `<mark>${escapeHtml(m)}</mark>`);
  libSearchMatches = content.querySelectorAll('mark');
  libSearchIdx = 0;
  if (libSearchMatches.length > 0) {
    libSearchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (countEl) countEl.textContent = `1 / ${libSearchMatches.length}`;
  } else {
    if (countEl) countEl.textContent = 'Not found';
  }
}

function libSearchNext() {
  if (!libSearchMatches.length) return;
  libSearchIdx = (libSearchIdx + 1) % libSearchMatches.length;
  libSearchMatches[libSearchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const countEl = document.getElementById('libSearchCount');
  if (countEl) countEl.textContent = `${libSearchIdx + 1} / ${libSearchMatches.length}`;
}

// ── ZIM panel ──────────────────────────────────────────────
function showZimPanel(item) {
  libMode = 'reader';
  updateLibHeader();
  libMain.innerHTML = `
    <div class="lib-zim-panel">
      <div class="lib-zim-icon">W</div>
      <div class="lib-zim-title">${item.name.toUpperCase()}</div>
      <div class="lib-zim-desc">
        ${item.description}<br><br>
        This content is stored as a <strong style="color:var(--amber)">.zim</strong> archive
        and requires the <strong style="color:var(--amber)">Kiwix</strong> reader app.<br><br>
        Point Kiwix at:
      </div>
      <div class="lib-missing-cmd">${item.file}</div>
      <div class="lib-zim-desc" style="margin-top:8px;font-size:clamp(10px,0.7vw,13px);color:var(--text-dim)">
        ${item.size_mb >= 1000 ? (item.size_mb/1024).toFixed(1)+' GB' : '~'+item.size_mb+' MB'} · ${item.license}
      </div>
    </div>`;
}

// ── Missing file panel ─────────────────────────────────────
function showMissingPanel(item) {
  libMode = 'reader';
  updateLibHeader();
  libMain.innerHTML = `
    <div class="lib-missing-panel">
      <div class="lib-missing-title">⚠ FILE NOT DOWNLOADED</div>
      <div class="lib-missing-desc">
        <strong style="color:var(--text-primary)">${item.name}</strong> is in the library catalog
        but hasn't been downloaded to this drive yet.<br><br>
        Run the drive assembly script to download all content:
      </div>
      <div class="lib-missing-cmd">bash scripts/setup_drive.sh</div>
      <div class="lib-missing-desc" style="margin-top:8px;font-size:clamp(10px,0.7vw,12px);color:var(--text-dim)">
        Expected: ${item.file}<br>Source: ${item.source}
      </div>
    </div>`;
}

// ── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
