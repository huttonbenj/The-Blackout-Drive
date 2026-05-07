/**
 * DOOMSDAY.AI — Offline Library Browser
 * Reads library.json catalog, renders categories + file list,
 * provides in-browser TXT reader with search.
 * Zero external dependencies — pure vanilla JS.
 */

'use strict';

// ── State ─────────────────────────────────────────────────
let libCatalog     = null;      // parsed library.json
let libActiveCat   = null;      // currently selected category id
let libActiveItem  = null;      // currently open file item
let libMode        = 'cats';    // 'cats' | 'files' | 'reader'
let libSearchQuery = '';
let libSearchMatches = [];
let libSearchIdx   = 0;

// ── DOM refs ──────────────────────────────────────────────
const libraryPanel  = document.getElementById('libraryPanel');
const libSidebar    = document.getElementById('libSidebar');
const libMain       = document.getElementById('libMain');
const libBackBtn    = document.getElementById('libBackBtn');
const libHeaderTitle = document.getElementById('libHeaderTitle');

// ── Open / Close ──────────────────────────────────────────
async function openLibrary() {
  libraryPanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  if (!libCatalog) {
    await loadCatalog();
  } else {
    renderSidebar();
    if (libActiveCat) {
      renderFileList(libActiveCat);
    } else {
      showCategorySelect();
    }
  }
}

function closeLibrary() {
  libraryPanel.style.display = 'none';
  document.body.style.overflow = '';
}

// ESC key closes library
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && libraryPanel.style.display !== 'none') {
    if (libMode === 'reader') {
      closeReader();
    } else {
      closeLibrary();
    }
  }
});

// ── Back button handler ────────────────────────────────────
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
    libHeaderTitle.textContent = libActiveItem ? libActiveItem.name.toUpperCase() : 'READER';
    libBackBtn.classList.remove('hidden');
    libBackBtn.textContent = '← FILE LIST';
  }
}

// ── Catalog loading ────────────────────────────────────────
async function loadCatalog() {
  libMain.innerHTML = '<div class="lib-loading"><span>Loading library catalog...</span></div>';

  try {
    // Path relative to server root (drive/)
    const res = await fetch('/content/library.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    libCatalog = await res.json();
    renderSidebar();
    showCategorySelect();
  } catch (err) {
    libMain.innerHTML = `
      <div class="lib-missing-panel">
        <div class="lib-missing-title">⚠ CATALOG NOT FOUND</div>
        <div class="lib-missing-desc">
          The library catalog could not be loaded.<br>
          Make sure the drive was assembled with setup_drive.sh.
        </div>
        <div class="lib-missing-cmd">bash scripts/setup_drive.sh</div>
      </div>`;
  }
}

// ── Sidebar ────────────────────────────────────────────────
function renderSidebar() {
  if (!libCatalog) return;

  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = 'CATEGORIES';

  const items = libCatalog.categories.map(cat => {
    const el = document.createElement('div');
    el.className = 'lib-cat-item' + (libActiveCat === cat.id ? ' active' : '');
    el.dataset.catId = cat.id;
    el.onclick = () => selectCategory(cat.id);
    el.innerHTML = `
      <span class="lib-cat-icon">${cat.icon}</span>
      <span class="lib-cat-name">${cat.name}</span>`;
    return el;
  });

  libSidebar.innerHTML = '';
  libSidebar.appendChild(label);
  items.forEach(el => libSidebar.appendChild(el));
}

function highlightSidebar(catId) {
  libSidebar.querySelectorAll('.lib-cat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.catId === catId);
  });
}

// ── Category select view (initial state) ──────────────────
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

  const header = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">${cat.icon} ${cat.name.toUpperCase()}</div>
      <div class="lib-cat-desc">${cat.description}</div>
    </div>`;

  const listEl = document.createElement('div');
  listEl.className = 'lib-file-list';

  cat.items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'lib-file-item';
    el.onclick = () => openItem(item);

    const typeClass = item.type === 'pdf' ? 'pdf' : item.type === 'zim' ? 'zim' : 'txt';
    const typeLabel = item.type.toUpperCase();
    const sizeStr = item.size_mb >= 1000
      ? `${(item.size_mb / 1024).toFixed(1)} GB`
      : `~${item.size_mb} MB`;

    el.innerHTML = `
      <span class="lib-file-type-badge ${typeClass}">${typeLabel}</span>
      <div class="lib-file-info">
        <div class="lib-file-name">${item.name}</div>
        <div class="lib-file-desc">${item.description}</div>
        <div class="lib-file-meta">${sizeStr} · ${item.license}</div>
      </div>`;
    listEl.appendChild(el);
  });

  libMain.innerHTML = header;
  libMain.appendChild(listEl);
}

// ── Open a file item ───────────────────────────────────────
async function openItem(item) {
  libActiveItem = item;

  if (item.type === 'pdf') {
    // Browser native PDF viewer
    window.open('/' + item.file, '_blank');
    return;
  }

  if (item.type === 'zim') {
    showZimPanel(item);
    return;
  }

  // TXT — load and render in reader
  libMode = 'reader';
  updateLibHeader();
  libMain.innerHTML = '<div class="lib-loading"><span>Loading file...</span></div>';

  try {
    const res = await fetch('/' + item.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    renderReader(item, text);
  } catch (err) {
    showMissingPanel(item);
  }
}

// ── Reader ─────────────────────────────────────────────────
function renderReader(item, rawText) {
  libSearchQuery = '';
  libSearchMatches = [];
  libSearchIdx = 0;

  const headerEl = document.createElement('div');
  headerEl.className = 'lib-reader-header';
  headerEl.innerHTML = `
    <div class="lib-reader-title">${item.name}</div>
    <div class="lib-search-bar">
      <input
        type="text"
        class="lib-search-input"
        id="libSearchInput"
        placeholder="Search in text..."
        onkeydown="if(event.key==='Enter') doLibSearch()"
      >
      <button class="lib-search-btn" onclick="doLibSearch()">FIND</button>
      <button class="lib-search-btn" onclick="libSearchNext()">NEXT</button>
      <span class="lib-search-count" id="libSearchCount"></span>
    </div>`;

  const contentEl = document.createElement('div');
  contentEl.className = 'lib-reader-content';
  contentEl.id = 'libReaderContent';

  // Escape HTML entities in the raw text, then set
  contentEl.textContent = rawText;

  libMain.innerHTML = '';
  libMain.appendChild(headerEl);
  libMain.appendChild(contentEl);
  libMain.scrollTop = 0;
}

function closeReader() {
  libActiveItem = null;
  libMode = 'files';
  updateLibHeader();
  if (libActiveCat) {
    renderFileList(libActiveCat);
  } else {
    showCategorySelect();
  }
}

// ── Search within reader ───────────────────────────────────
function doLibSearch() {
  const input = document.getElementById('libSearchInput');
  const contentEl = document.getElementById('libReaderContent');
  const countEl = document.getElementById('libSearchCount');
  if (!input || !contentEl) return;

  const query = input.value.trim();
  if (!query) {
    contentEl.innerHTML = contentEl.textContent;
    if (countEl) countEl.textContent = '';
    return;
  }

  const raw = contentEl.textContent;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const highlighted = raw.replace(regex, match => `<mark>${escapeHtml(match)}</mark>`);
  contentEl.innerHTML = highlighted;

  libSearchMatches = contentEl.querySelectorAll('mark');
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

// ── ZIM info panel ─────────────────────────────────────────
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
        Open the <code style="color:var(--green-bright);font-size:inherit">kiwix-serve</code>
        application included with this drive, then point it at:<br>
      </div>
      <div class="lib-missing-cmd">${item.file}</div>
      <div class="lib-zim-desc" style="margin-top:8px;font-size:clamp(10px,0.7vw,13px);color:var(--text-dim);">
        ${item.size_mb >= 1000 ? (item.size_mb/1024).toFixed(1)+' GB' : '~'+item.size_mb+' MB'} · ${item.license}
      </div>
    </div>`;
}

// ── Missing file panel ─────────────────────────────────────
function showMissingPanel(item) {
  libMode = 'reader';
  libMain.innerHTML = `
    <div class="lib-missing-panel">
      <div class="lib-missing-title">⚠ FILE NOT DOWNLOADED</div>
      <div class="lib-missing-desc">
        <strong style="color:var(--text-primary)">${item.name}</strong> is in the library catalog
        but hasn't been downloaded to this drive yet.<br><br>
        Run the drive assembly script to download all content:
      </div>
      <div class="lib-missing-cmd">bash scripts/setup_drive.sh</div>
      <div class="lib-missing-desc" style="margin-top:8px;font-size:clamp(10px,0.7vw,12px);color:var(--text-dim);">
        Expected: ${item.file}<br>
        Source: ${item.source}
      </div>
    </div>`;
}

// ── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
