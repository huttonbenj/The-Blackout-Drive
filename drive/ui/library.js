/**
 * The Blackout Drive — Offline Library Browser
 * Zero external dependencies — pure vanilla JS.
 * Reads from DDAPI (api.js) for all HTTP calls.
 */
'use strict';

// ── Toast notification (replaces dead-end showGetMoreHint) ──
function showToast(msg, duration = 3500) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(18,22,16,0.95);border:1px solid rgba(200,160,74,0.4);color:var(--amber);padding:10px 20px;border-radius:8px;font-size:13px;letter-spacing:1px;z-index:9999;pointer-events:none;max-width:480px;text-align:center;backdrop-filter:blur(8px);box-shadow:0 4px 24px rgba(0,0,0,0.5);';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── sessionStorage state: persist library open/view across reloads ──
const LIB_SS_KEY = 'dd_lib';
function _saveLibState() {
  try {
    sessionStorage.setItem(LIB_SS_KEY, JSON.stringify({
      open: libraryPanel && libraryPanel.style.display !== 'none',
      cat: libActiveCat,
      mode: libMode,
      itemId: libActiveItem ? libActiveItem.id : null,
    }));
  } catch {}
}

/**
 * Restore library state on page reload — called from app.js init().
 *
 * Anti-flicker contract:
 *   • index.html inline <script> already added html[data-restore="lib"]
 *     if library was open, making libraryPanel display:flex BEFORE paint.
 *   • We just need to load catalog content, navigate to the right view,
 *     then remove [data-restore] so the rest of the UI is revealed.
 *   • body.opacity is set to 1 by app.js immediately after this returns
 *     (synchronously) — content loading is async in the background.
 */
function _restoreLibState() {
  const cleanup = () => document.documentElement.removeAttribute('data-restore');
  try {
    const s = JSON.parse(sessionStorage.getItem(LIB_SS_KEY) || 'null');
    if (!s || !s.open) {
      // No library was open — hide any data-restore artifact and show chat
      cleanup();
      document.body.style.opacity = '1';
      return;
    }
    // Library WAS open. libraryPanel is already flex via CSS (pre-paint).
    // Now load catalog and navigate to the saved view.
    const revealBody = () => { document.body.style.opacity = '1'; };
    openLibrary().then(() => {
      if (s.cat === '__getmore') {
        showGetMorePanel();
      } else if (s.cat === '__manage') {
        showManageSpace();
      } else if (s.cat) {
        selectCategory(s.cat);
        // If was in reader mode, restore that item too
        if (s.mode === 'reader' && s.itemId && libRawCatalog) {
          const allItems = libRawCatalog.categories.flatMap(c => c.items);
          const item = allItems.find(i => i.id === s.itemId);
          if (item && libManifest && libManifest.has(item.file)) {
            openItem(item);
          }
        }
      }
      cleanup();
      revealBody();
    }).catch(() => { cleanup(); revealBody(); });
  } catch {
    cleanup();
    document.body.style.opacity = '1';
  }
}
// _restoreLibState is called by app.js init() — see anti-flicker comment there


// ── Bible Book Names ────────────────────────────────────────
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

// ── State ───────────────────────────────────────────────────
let libRawCatalog    = null;  // unfiltered full catalog
let libCatalog       = null;  // filtered by manifest
let libManifest      = null;  // Set of file paths present on drive
let libManifestData  = null;  // full manifest object
let libStatusData    = null;  // disk usage from /api/status
let libDevMode       = false; // true when no manifest.json
let libActiveCat     = null;  // active category id OR '__getmore' / '__manage'
let libActiveItem    = null;
let libMode          = 'cats'; // 'cats' | 'files' | 'reader'
let libSearchMatches = [];
let libSearchIdx     = 0;
let libInBibleMode   = false;
let bibleData        = null;
let bibleBookIdx     = 0;
let bibleChapter     = 1;

// Download tracking: packId → { jobs:{fileId→jobId}, total, done, errors, pollerRef }
let packDownloads = {};

// ── DOM refs ────────────────────────────────────────────────
const libraryPanel   = document.getElementById('libraryPanel');
const libSidebar     = document.getElementById('libSidebar');
const libMain        = document.getElementById('libMain');
const libBackBtn     = document.getElementById('libBackBtn');
const libHeaderTitle = document.getElementById('libHeaderTitle');

// ── Open / Close ────────────────────────────────────────────
async function openLibrary() {
  libraryPanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (!libRawCatalog) {
    await loadCatalog();
  } else {
    _saveLibState();
    renderSidebar();
    if (libActiveCat && libActiveCat !== '__getmore' && libActiveCat !== '__manage') {
      renderFileList(libActiveCat);
    } else {
      showCategorySelect();
    }
  }
}

function closeLibrary() {
  libraryPanel.style.display = 'none';
  document.body.style.overflow = '';
  try { sessionStorage.removeItem(LIB_SS_KEY); } catch {}
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && libraryPanel.style.display !== 'none') {
    if (libMode === 'reader') closeReader();
    else closeLibrary();
  }
});

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
    if (libActiveCat === '__getmore') {
      libHeaderTitle.textContent = '⬇ GET MORE CONTENT';
    } else if (libActiveCat === '__manage') {
      libHeaderTitle.textContent = '🗑 MANAGE SPACE';
    } else {
      const cat = libCatalog && libCatalog.categories.find(c => c.id === libActiveCat);
      libHeaderTitle.textContent = cat ? `${cat.icon} ${cat.name.toUpperCase()}` : '📚 LIBRARY';
    }
    libBackBtn.classList.remove('hidden');
    libBackBtn.textContent = '← LIBRARY';
  } else if (libMode === 'reader') {
    const title = libInBibleMode
      ? `${BIBLE_BOOK_NAMES[bibleBookIdx].toUpperCase()} — CH. ${bibleChapter}`
      : (libActiveItem ? libActiveItem.name.toUpperCase() : 'READER');
    libHeaderTitle.textContent = title;
    libBackBtn.classList.remove('hidden');
    libBackBtn.textContent = '← FILE LIST';
  }
}

// ── Catalog loading ─────────────────────────────────────────
async function loadCatalog() {
  libMain.innerHTML = '<div class="lib-loading"><span>Loading library...</span></div>';
  try {
    // 1. Fetch manifest via API (tells us what files are on this drive)
    const manifest = await DDAPI.getManifest();
    if (manifest && manifest.files) {
      libManifest = new Set(Object.keys(manifest.files));
      libManifestData = manifest;
      libDevMode = false;
    } else {
      libManifest = null;
      libManifestData = null;
      libDevMode = true;
    }

    // 2. Fetch disk status
    libStatusData = await DDAPI.getStatus();

    // 3. Fetch local catalog
    const res = await fetch('/content/library.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    libRawCatalog = await res.json();

    // 4. Filter catalog by manifest (production) or show all (dev)
    applyManifestFilter();
    renderSidebar();
    showCategorySelect();
  } catch {
    libMain.innerHTML = `
      <div class="lib-missing-panel">
        <div class="lib-missing-title">⚠ CATALOG NOT FOUND</div>
        <div class="lib-missing-desc">Library catalog could not be loaded.<br>Run the assembly script:</div>
        <div class="lib-missing-cmd">bash scripts/setup_drive.sh</div>
      </div>`;
  }
}

function applyManifestFilter() {
  if (!libRawCatalog) return;
  if (libManifest) {
    libCatalog = {
      ...libRawCatalog,
      categories: libRawCatalog.categories.map(cat => ({
        ...cat,
        // Include item if: file is in manifest OR item is always_available (tools/interactive)
        items: cat.items.filter(item =>
          item.always_available ||
          (!item.file && item.type === 'ham-radio-tools') ||
          libManifest.has(item.file)
        )
      })).filter(cat => cat.items.length > 0)
    };
  } else {
    libCatalog = libRawCatalog;
  }
}

async function refreshAfterManifestChange() {
  const manifest = await DDAPI.getManifest();
  if (manifest && manifest.files) {
    libManifest = new Set(Object.keys(manifest.files));
    libManifestData = manifest;
    libDevMode = false;
  }
  libStatusData = await DDAPI.getStatus();
  applyManifestFilter();
  renderSidebar();
}

// ── Sidebar ─────────────────────────────────────────────────
function renderSidebar() {
  if (!libRawCatalog) return;
  libInBibleMode = false;
  libSidebar.innerHTML = '';

  // Section: ON THIS DRIVE
  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = 'ON THIS DRIVE';
  libSidebar.appendChild(label);

  const cats = libCatalog ? libCatalog.categories : [];
  if (cats.length === 0 && !libDevMode) {
    const empty = document.createElement('div');
    empty.className = 'lib-sidebar-empty';
    empty.textContent = 'No content downloaded yet';
    libSidebar.appendChild(empty);
  } else {
    cats.forEach(cat => {
      const el = document.createElement('div');
      el.className = 'lib-cat-item' + (libActiveCat === cat.id ? ' active' : '');
      el.dataset.catId = cat.id;
      el.onclick = () => selectCategory(cat.id);
      const totalInCat = libDevMode ? cat.items.length : (libRawCatalog.categories.find(r=>r.id===cat.id)||cat).items.filter(item=>libManifest?libManifest.has(item.file):true).length;
      el.innerHTML = `<span class="lib-cat-icon">${cat.icon}</span><span class="lib-cat-name">${cat.name}</span><span class="lib-cat-count">${totalInCat}</span>`;
      libSidebar.appendChild(el);
    });
    // Dev mode: show all categories from raw catalog
    if (libDevMode && libRawCatalog) {
      libRawCatalog.categories.forEach(cat => {
        if (cats.find(c => c.id === cat.id)) return; // already shown
        const el = document.createElement('div');
        el.className = 'lib-cat-item' + (libActiveCat === cat.id ? ' active' : '');
        el.dataset.catId = cat.id;
        el.onclick = () => selectCategory(cat.id);
        el.innerHTML = `<span class="lib-cat-icon">${cat.icon}</span><span class="lib-cat-name">${cat.name}</span><span class="lib-cat-count" style="opacity:0.4">0</span>`;
        libSidebar.appendChild(el);
      });
    }
  }

  // Divider
  const div = document.createElement('div');
  div.className = 'lib-sidebar-divider';
  libSidebar.appendChild(div);

  // GET MORE — only when online
  if (DDAPI.isOnline()) {
    const gm = document.createElement('div');
    gm.className = 'lib-action-item' + (libActiveCat === '__getmore' ? ' active' : '');
    gm.dataset.action = 'getmore';
    gm.onclick = () => showGetMorePanel();
    gm.innerHTML = `<span class="lib-cat-icon">⬇</span><span class="lib-cat-name">GET MORE</span>`;
    libSidebar.appendChild(gm);
  }

  // MANAGE SPACE — always
  const mg = document.createElement('div');
  mg.className = 'lib-action-item' + (libActiveCat === '__manage' ? ' active' : '');
  mg.dataset.action = 'manage';
  mg.onclick = () => showManagePanel();
  mg.innerHTML = `<span class="lib-cat-icon">🗑</span><span class="lib-cat-name">MANAGE SPACE</span>`;
  libSidebar.appendChild(mg);
}

function highlightSidebar(catId) {
  libSidebar.querySelectorAll('.lib-cat-item').forEach(el =>
    el.classList.toggle('active', el.dataset.catId === catId));
  libSidebar.querySelectorAll('.lib-action-item').forEach(el =>
    el.classList.toggle('active', el.dataset.action === catId));
}

function renderBibleSidebar() {
  libInBibleMode = true;
  libSidebar.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = 'BOOKS';
  libSidebar.appendChild(label);

  BIBLE_BOOK_NAMES.forEach((name, idx) => {
    if (idx === 39) {
      const ntLabel = document.createElement('div');
      ntLabel.className = 'lib-sidebar-section';
      ntLabel.textContent = 'NEW TESTAMENT';
      libSidebar.appendChild(ntLabel);
    } else if (idx === 0) {
      const otLabel = document.createElement('div');
      otLabel.className = 'lib-sidebar-section';
      otLabel.textContent = 'OLD TESTAMENT';
      libSidebar.appendChild(otLabel);
    }
    const el = document.createElement('div');
    el.className = 'lib-cat-item' + (idx === bibleBookIdx ? ' active' : '');
    el.dataset.bookIdx = idx;
    el.onclick = () => selectBibleBook(idx);
    el.innerHTML = `<span class="lib-cat-name" style="font-size:clamp(10px,0.72vw,13px)">${name}</span>`;
    libSidebar.appendChild(el);
  });
}

function highlightBibleSidebar(idx) {
  libSidebar.querySelectorAll('.lib-cat-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.bookIdx) === idx));
  const activeEl = libSidebar.querySelector('.lib-cat-item.active');
  if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showCategorySelect() {
  libMode = 'cats';
  libActiveCat = null;
  updateLibHeader();
  highlightSidebar(null);

  const cats = libCatalog ? libCatalog.categories : [];
  const devBadge = libDevMode
    ? `<div class="lib-dev-badge">⚥ DEV MODE — run <code>bash scripts/setup_drive.sh</code> then <code>bash scripts/build_manifest.sh</code></div>`
    : '';

  const grid = document.createElement('div');
  grid.className = 'lib-cat-grid';
  cats.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'lib-file-item';
    card.onclick = () => selectCategory(cat.id);
    const installedCount = cat.items.filter(i => !libManifest || libManifest.has(i.file)).length;
    const totalCount = cat.items.length;
    const countLabel = installedCount === totalCount
      ? `${totalCount} item${totalCount !== 1 ? 's' : ''}`
      : `${installedCount} / ${totalCount} downloaded`;
    card.innerHTML = `
      <div class="lib-cat-icon">${cat.icon}</div>
      <div class="lib-file-name">${escapeHtml(cat.name)}</div>
      <div class="lib-file-meta">${countLabel}</div>`;
    grid.appendChild(card);
  });

  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">OFFLINE LIBRARY</div>
      <div class="lib-cat-desc">Browse your downloaded content. Get more from the ↓ GET MORE panel.</div>
      ${devBadge}
    </div>`;
  libMain.appendChild(grid);
}

function selectCategory(catId) {
  libActiveCat = catId;
  libMode = 'files';
  updateLibHeader();
  highlightSidebar(catId);
  renderFileList(catId);
  _saveLibState();
}

function renderFileList(catId) {
  // Use raw catalog so ALL items show (downloaded + not downloaded)
  const rawCat = libRawCatalog && libRawCatalog.categories.find(c => c.id === catId);
  if (!rawCat) return;
  const downloadedCount = rawCat.items.filter(i => i.always_available || !libManifest || libManifest.has(i.file)).length;
  const list = document.createElement('div');
  list.className = 'lib-file-list';

  rawCat.items.forEach(item => {
    const inManifest = item.always_available || !libManifest || libManifest.has(item.file);
    const hasDirectUrl = !!(item.download_url) && item.type !== 'zim';
    const isZim = item.type === 'zim';

    const el = document.createElement('div');
    el.className = 'lib-file-item' + (inManifest ? '' : ' lib-file-not-downloaded');

    // Downloaded items: clicking the row opens the file
    // Not-downloaded items: row click does nothing; only the DOWNLOAD button acts
    if (inManifest) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => openItem(item));
    } else {
      el.style.cursor = 'default';
    }

    const statusBadge = inManifest
      ? `<span class="status-ok">✓ ON DRIVE</span>`
      : (isZim
        ? `<span class="status-miss">⬇ LARGE FILE</span>`
        : `<span class="status-miss">⬇ NOT DOWNLOADED</span>`);

    el.innerHTML = `
      <span class="lib-file-type-badge ${item.type}">${item.type.toUpperCase()}</span>
      <div class="lib-file-info">
        <div class="lib-file-name">${escapeHtml(item.name)}</div>
        <div class="lib-file-desc">${escapeHtml(item.short || '')}</div>
        <div class="lib-file-meta">${item.size_label || ''} &middot; ${item.license || ''} &middot; ${statusBadge}</div>
      </div>`;

    // Download button: corner icon positioned top-right on the card.
    // Small, unobtrusive — cards stay uniform height.
    if (!inManifest && hasDirectUrl) {
      const btn = document.createElement('button');
      btn.className = 'lib-dl-corner-btn';
      btn.title = 'Download to drive';
      btn.setAttribute('aria-label', 'Download ' + item.name);
      btn.innerHTML = '<span class="lib-dl-icon" aria-hidden="true">&#8595;</span><span class="lib-dl-label">GET</span>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadLibItem(item, el, btn);
      });
      el.appendChild(btn); // append to card, not lib-file-info
    } else if (!inManifest && isZim) {
      const note = document.createElement('div');
      note.className = 'lib-file-note';
      note.textContent = item.note || 'Large file — use the setup script when online.';
      el.querySelector('.lib-file-info').appendChild(note);
    }

    list.appendChild(el);
  });

  const descSuffix = downloadedCount < rawCat.items.length
    ? ` <span style="color:var(--amber-dim);font-size:0.85em">(${downloadedCount} of ${rawCat.items.length} downloaded)</span>`
    : '';
  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">${rawCat.icon} ${rawCat.name.toUpperCase()}</div>
      <div class="lib-cat-desc">Click any item to read it. Use ↓ DOWNLOAD to get items not yet on your drive.${descSuffix}</div>
    </div>`;
  libMain.appendChild(list);
}

function showGetMoreHint(item) {
  const hint = document.createElement('div');
  hint.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.4);color:var(--amber);padding:10px 18px;border-radius:8px;font-size:13px;letter-spacing:1px;z-index:9999;pointer-events:none;';
  hint.innerHTML = `"${item.name}" requires a large download. Use the ↓ GET MORE panel or run the setup script when online.`;
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 3500);
}

async function downloadLibItem(item, el, btn) {
  if (!item.download_url) return;
  if (!DDAPI.isOnline()) {
    showToast('⚠ No internet. Connect to download ' + item.name + '.');
    return;
  }
  btn.disabled = true;
  btn.title = 'Downloading…';
  const iconSpan = btn.querySelector('.lib-dl-icon') || btn;
  iconSpan.textContent = '↻';
  btn.classList.add('lib-dl-corner-btn--loading');

  try {
    const result = await DDAPI.startDownload(item.download_url, item.file);
    const jobId = result && result.jobId;
    if (!jobId) throw new Error('No job ID returned');

    const poll = setInterval(async () => {
      const status = await DDAPI.getDownloadStatus(jobId);
      if (!status) return;
      if (status.done && !status.error) {
        clearInterval(poll);
        // Update row to show ✓ ON DRIVE
        el.classList.remove('lib-file-not-downloaded');
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => openItem(item));
        const meta = el.querySelector('.lib-file-meta');
        if (meta) meta.innerHTML = `${item.size_label || ''} &middot; ${item.license || ''} &middot; <span class="status-ok">✓ ON DRIVE</span>`;
        btn.remove();
        showToast('✓ ' + item.name + ' downloaded successfully.');
        await refreshAfterManifestChange();
        return;
      }
      if (status.error) {
        clearInterval(poll);
        btn.disabled = false;
        btn.classList.remove('lib-dl-corner-btn--loading');
        btn.title = 'Download failed — click to retry';
        const _iconSpan3 = btn.querySelector('.lib-dl-icon') || btn;
        _iconSpan3.textContent = '!';
        btn.classList.add('lib-dl-corner-btn--error');
        btn.addEventListener('click', (e) => { e.stopPropagation(); downloadLibItem(item, el, btn); }, { once: true });
        showToast('⚠ Download failed: ' + (status.error || 'Unknown error'));
        return;
      }
      const pct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : '…';
      const _iconSpan2 = btn.querySelector('.lib-dl-icon') || btn;
      btn.title = `Downloading ${pct}%`;
      _iconSpan2.textContent = '↻';
      const _dlLabel = btn.querySelector('.lib-dl-label');
      if (_dlLabel) _dlLabel.textContent = pct === '…' ? '…' : pct + '%';
    }, 600);
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove('lib-dl-corner-btn--loading');
    btn.title = 'Download failed — click to retry';
    const _iconSpan4 = btn.querySelector('.lib-dl-icon') || btn;
    _iconSpan4.textContent = '!';
    btn.classList.add('lib-dl-corner-btn--error');
    showToast('⚠ Could not start download: ' + err.message);
  }
}

// ── Open item ───────────────────────────────────────────────
async function openItem(item) {
  libActiveItem = item;
  if (item.type === 'pdf') {
    libMode = 'reader';
    updateLibHeader();
    libMain.innerHTML = '<div class="lib-loading"><span>Opening PDF...</span></div>';
    try {
      const res = await fetch(`/api/open-file?path=${encodeURIComponent(item.file)}`);
      if (!res.ok) { showMissingPanel(item); return; }
    } catch { showMissingPanel(item); return; }
    libMain.innerHTML = `<div class="lib-zim-panel">
      <div style="font-size:48px;margin-bottom:16px">📄</div>
      <div class="lib-zim-title">${item.name.toUpperCase()}</div>
      <div class="lib-zim-desc">Opened in your system PDF viewer.<br>It may take a moment to appear.</div>
      <button class="lib-search-btn" style="margin-top:16px" onclick="DDAPI.openFile('${item.file}')">Open Again</button>
    </div>`;
    return;
  }
  if (item.type === 'ham-radio-tools') {
    libMode = 'reader'; updateLibHeader();
    if (typeof window.renderHamRadioTools === 'function') {
      libMain.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'generic-reader ham-radio-wrapper';
      libMain.appendChild(wrapper);
      window.renderHamRadioTools(wrapper);
    } else {
      libMain.innerHTML = '<div class="lib-missing-panel"><div class="lib-missing-title">⚠ Ham Radio Tools Not Loaded</div></div>';
    }
    return;
  }
  if (item.type === 'zim') { libMode = 'reader'; updateLibHeader(); showZimPanel(item); return; }
  if (item.id && item.id.startsWith('bible_')) {
    libMode = 'reader';
    libMain.innerHTML = '<div class="lib-loading"><span>Loading Bible...</span></div>';
    try {
      const res = await fetch('/' + item.file);
      if (!res.ok) { showMissingPanel(item); return; }
      initBibleReader(item, await res.text());
    } catch { showMissingPanel(item); }
    return;
  }
  libMode = 'reader';
  updateLibHeader();
  libMain.innerHTML = '<div class="lib-loading"><span>Loading...</span></div>';
  try {
    const res = await fetch('/' + item.file);
    if (!res.ok) { showMissingPanel(item); return; }
    renderGenericReader(item, await res.text());
  } catch { showMissingPanel(item); }
}

// ── Bible Reader ─────────────────────────────────────────────
// Auto-detects format:
//   KJV/WEB: "1:1 text" or "001:001 text"  (chapter:verse at line start)
//   ASV/YLT: "Genesis 1:1\ttext"           (Book chapter:verse TAB text)
function parseBibleText(raw) {
  const strip = raw.replace(/^\uFEFF/, '');
  const lines = strip.split('\n');

  // Detect format by looking at first verse-like line
  const BOOK_TAB_RX = /^([1-9]?\s*[A-Za-z][A-Za-z\s]+?)\s+(\d+):(\d+)\t(.+)/;
  const CHVERSE_RX  = /^0*(\d+):0*(\d+)\s+(.+)/;
  let isBookTabFormat = false;
  for (const ln of lines.slice(0, 20)) {
    if (BOOK_TAB_RX.test(ln.trim())) { isBookTabFormat = true; break; }
  }

  const books = BIBLE_BOOK_NAMES.map(name => ({ name, chapters: [null] }));

  if (isBookTabFormat) {
    // ASV / YLT format: "Genesis 1:1\ttext"
    const bookMap = {};
    BIBLE_BOOK_NAMES.forEach((name, idx) => {
      // Index by first 3 chars lowercase for fuzzy matching
      bookMap[name.toLowerCase().slice(0, 4)] = idx;
      bookMap[name.toLowerCase()] = idx;
    });
    let curBookIdx = -1, curCh = 0;
    for (const rawLine of lines) {
      const m = rawLine.trim().match(BOOK_TAB_RX);
      if (!m) continue;
      const bookRaw = m[1].trim().toLowerCase();
      const ch = parseInt(m[2]), vs = parseInt(m[3]), verseText = m[4].trim();
      // Resolve book index
      let bIdx = bookMap[bookRaw] ?? bookMap[bookRaw.slice(0, 4)] ?? -1;
      if (bIdx === -1) {
        // Try prefix match
        for (const [k, v] of Object.entries(bookMap)) {
          if (bookRaw.startsWith(k.slice(0, 3)) || k.startsWith(bookRaw.slice(0, 3))) { bIdx = v; break; }
        }
      }
      if (bIdx === -1) continue;
      curBookIdx = bIdx;
      if (ch !== curCh) { curCh = ch; if (!books[bIdx].chapters[ch]) books[bIdx].chapters[ch] = []; }
      if (books[bIdx].chapters[ch]) books[bIdx].chapters[ch].push({ vs, text: verseText });
    }
  } else {
    // KJV / WEB format: "1:1 text" or "001:001 text"
    const marker = '*** START OF THE PROJECT GUTENBERG EBOOK';
    const text = strip.indexOf(marker) >= 0 ? strip.slice(strip.indexOf(marker)) : strip;
    let bookIdx = -1, curCh = 0;
    for (const rawLine of text.split('\n')) {
      const m = rawLine.trim().match(CHVERSE_RX);
      if (!m) continue;
      const ch = parseInt(m[1]), vs = parseInt(m[2]), verseText = m[3].trim();
      if (ch === 1 && vs === 1) { bookIdx++; if (bookIdx >= BIBLE_BOOK_NAMES.length) break; curCh = 1; books[bookIdx].chapters[1] = []; }
      if (bookIdx < 0) continue;
      if (ch !== curCh) { curCh = ch; if (!books[bookIdx].chapters[ch]) books[bookIdx].chapters[ch] = []; }
      if (books[bookIdx].chapters[ch]) books[bookIdx].chapters[ch].push({ vs, text: verseText });
    }
  }

  return books.filter(b => b.chapters.length > 1);
}

function initBibleReader(item, rawText) {
  libMain.innerHTML = '<div class="lib-loading"><span>Parsing Bible text...</span></div>';
  setTimeout(() => {
    bibleData = parseBibleText(rawText);
    if (!bibleData.length) { showMissingPanel(item); return; }
    bibleBookIdx = 0; bibleChapter = 1;
    renderBibleSidebar(); updateLibHeader(); renderBibleChapterView();
  }, 20);
}

function renderBibleChapterView() {
  updateLibHeader();
  if (!bibleData || !bibleData[bibleBookIdx]) return;
  const book = bibleData[bibleBookIdx];
  const totalCh = book.chapters.length - 1;
  const verses = book.chapters[bibleChapter] || [];
  let bookOpts = (bibleData || []).map((b,i) => `<option value="${i}" ${i===bibleBookIdx?'selected':''}>${b.name}</option>`).join('');
  let chOpts = '';
  for (let c = 1; c <= totalCh; c++) chOpts += `<option value="${c}" ${c===bibleChapter?'selected':''}>Chapter ${c}</option>`;
  const hasPrev = bibleChapter > 1 || bibleBookIdx > 0;
  const hasNext = bibleChapter < totalCh || bibleBookIdx < bibleData.length - 1;
  libMain.innerHTML = `
    <div class="bible-nav">
      <select class="bible-select" onchange="selectBibleBook(parseInt(this.value))">${bookOpts}</select>
      <select class="bible-select" onchange="selectBibleChapter(parseInt(this.value))">${chOpts}</select>
      <div class="bible-jump-bar">
        <input type="text" class="lib-search-input" id="bibleJumpInput" placeholder="e.g. John 3:16" style="width:clamp(120px,12vw,180px)" onkeydown="if(event.key==='Enter')doBibleJump()">
        <button class="lib-search-btn" onclick="doBibleJump()">GO</button>
      </div>
    </div>
    <div class="bible-chapter-title">${book.name.toUpperCase()} — CHAPTER ${bibleChapter}</div>
    <div class="bible-verses" id="bibleVerses">
      ${verses.map(v=>`<div class="bible-verse" id="bv-${v.vs}"><span class="bible-verse-num">${v.vs}</span><span class="bible-verse-text">${escapeHtml(v.text)}</span></div>`).join('')}
    </div>
    <div class="bible-bottom-nav">
      <button class="lib-search-btn" onclick="prevBibleChapter()" ${hasPrev?'':'disabled style="opacity:0.3"'}>← PREVIOUS</button>
      <span style="color:var(--text-dim);font-size:clamp(10px,0.7vw,12px);letter-spacing:2px">${book.name} ${bibleChapter} / ${totalCh}</span>
      <button class="lib-search-btn" onclick="nextBibleChapter()" ${hasNext?'':'disabled style="opacity:0.3"'}>NEXT →</button>
    </div>`;
}

function selectBibleBook(idx) {
  if (!bibleData || idx < 0 || idx >= bibleData.length) return;
  bibleBookIdx = idx; bibleChapter = 1;
  highlightBibleSidebar(idx); renderBibleChapterView();
  const active = libSidebar.querySelector('.lib-cat-item.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function selectBibleChapter(ch) { bibleChapter = ch; renderBibleChapterView(); }
function prevBibleChapter() {
  if (bibleChapter > 1) { bibleChapter--; renderBibleChapterView(); }
  else if (bibleBookIdx > 0) { bibleBookIdx--; bibleChapter = bibleData[bibleBookIdx].chapters.length - 1; highlightBibleSidebar(bibleBookIdx); renderBibleChapterView(); }
}
function nextBibleChapter() {
  if (!bibleData) return;
  const total = bibleData[bibleBookIdx].chapters.length - 1;
  if (bibleChapter < total) { bibleChapter++; renderBibleChapterView(); }
  else if (bibleBookIdx < bibleData.length - 1) { bibleBookIdx++; bibleChapter = 1; highlightBibleSidebar(bibleBookIdx); renderBibleChapterView(); }
}
function doBibleJump() {
  const input = document.getElementById('bibleJumpInput');
  if (!input || !bibleData) return;
  const query = input.value.trim(); if (!query) return;
  let targetBook = bibleBookIdx, targetCh = bibleChapter, targetVs = null;
  const fullRef = query.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (fullRef) {
    const bq = fullRef[1].toLowerCase().trim();
    const fi = bibleData.findIndex(b => b.name.toLowerCase().startsWith(bq));
    if (fi >= 0) { targetBook = fi; targetCh = parseInt(fullRef[2]); if (fullRef[3]) targetVs = parseInt(fullRef[3]); }
  } else {
    const cv = query.match(/^(\d+):(\d+)$/);
    if (cv) { targetCh = parseInt(cv[1]); targetVs = parseInt(cv[2]); }
  }
  bibleBookIdx = targetBook;
  bibleChapter = Math.max(1, Math.min(targetCh, bibleData[targetBook].chapters.length - 1));
  highlightBibleSidebar(bibleBookIdx); renderBibleChapterView();
  if (targetVs) requestAnimationFrame(() => {
    const el = document.getElementById(`bv-${targetVs}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('bible-verse-highlight'); setTimeout(() => el.classList.remove('bible-verse-highlight'), 2500); }
  });
  if (input) input.value = '';
}

// ── Close reader ─────────────────────────────────────────────
function closeReader() {
  libActiveItem = null; libInBibleMode = false; libMode = 'files';
  renderSidebar(); updateLibHeader();
  if (libActiveCat && libActiveCat !== '__getmore' && libActiveCat !== '__manage') {
    highlightSidebar(libActiveCat); renderFileList(libActiveCat);
  } else { showCategorySelect(); }
}

// ── Universal Smart Text Reader ────────────────────────────────
// One reader for ALL text content types. No per-pack viewer needed.
// Strips Gutenberg boilerplate, detects chapters/sections/amendments,
// builds interactive TOC sidebar, renders clean formatted prose.

function stripGutenbergBoilerplate(raw) {
  let text = raw.replace(/^\uFEFF/, ''); // strip BOM

  // Strip everything before *** START OF ... ***
  const startRx = /\*\*\* START OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const endRx   = /\*\*\* END OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const startM  = text.match(startRx);
  if (startM) text = text.slice(startM.index + startM[0].length);
  const endM = text.match(endRx);
  if (endM) text = text.slice(0, text.lastIndexOf(endM[0]));

  // Strip old Gutenberg preamble note blocks that appear right after START marker.
  // Pattern: a *** divider followed by a note block then another *** divider.
  // These are NOT content — they are archival/production notes.
  // Repeat up to 3 times to clear multiple note blocks.
  const preambleBlock = /^[\s\S]*?\*{3}[\s\S]+?\*{3}\s*\n/;
  for (let i = 0; i < 3; i++) {
    const trimmed = text.replace(/^\s+/, '');
    // If the file starts with a *** line (after stripping whitespace), it's a note block
    if (/^\*{3}[^\n]*\n/.test(trimmed)) {
      // Find the closing *** and strip past it
      const closeIdx = trimmed.indexOf('\n***', 3);
      if (closeIdx > 0) {
        text = trimmed.slice(closeIdx + 4); // past \n***
      } else break;
    } else break;
  }

  return text.replace(/^\s+/, '').trimEnd();
}

/**
 * Detect structural headings in plain text, building the TOC.
 * Guards against false-positives in "Contents" / index blocks by requiring
 * that a heading line is EITHER:
 *   a) Not indented (starts at column 0 / trimmed === line minus leading whitespace)
 *   b) OR surrounded by blank lines (true standalone heading)
 * Then deduplicates headings with near-identical titles (from contents + body).
 *
 * @returns {{ title: string, lineIndex: number, firstContentIdx: number }[]}
 */
function detectTextSections(text) {
  const lines = text.split('\n');
  const sections = [];
  const HEADING_RX = [
    /^(CHAPTER|Chapter)\s+(\d+|[IVXLCDM]+)\.?(?:[:\s]+(.+))?$/,
    /^(BOOK|Book|PART|Part)\s+(\d+|[IVXLCDM]+)\.?(?:[:\s]+(.+))?$/,
    /^(ARTICLE|Article|SECTION|Section)\s+(\d+|[IVXLCDM]+)\.?(?:[:\s]+(.+))?$/,
    /^(AMENDMENT|Amendment)\s+(\d+|[IVXLCDM]+)\.?(?:[:\s]+(.+))?$/,
    /^([IVXLCDM]{2,6})\.?\s*$/,
  ];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 100) return;

    // A line is a candidate heading if it is not indented (col 0 or only spaces, not tab-indent)
    const isAtCol0 = line.length === 0 || line[0] !== ' ' || line.startsWith(trimmed);
    // Also: line must be surrounded by blank-ish context (not mid-paragraph)
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    const isIsolated = prevBlank || nextBlank;

    // Must be at col 0 OR isolated to count as a structural heading
    if (!isAtCol0 && !isIsolated) return;

    for (const rx of HEADING_RX) {
      if (rx.test(trimmed)) {
        sections.push({ title: trimmed, lineIndex: i });
        break;
      }
    }
  });

  // Deduplicate: if two entries share the same canonical form (same structural
  // keyword + number), keep only the LAST one (body occurrence beats contents block)
  const canonical = (t) => t.toLowerCase()
    .replace(/[.:\s]+/g, ' ')
    .replace(/\bthe\b/g, '')
    .trim()
    .slice(0, 30);

  const seen = new Map(); // canonical → index in sections[]
  sections.forEach((s, idx) => {
    const key = canonical(s.title);
    if (seen.has(key)) {
      // Keep the later one (actual body text) — remove the earlier (contents index)
      sections[seen.get(key)] = null; // mark for removal
    }
    seen.set(key, idx);
  });

  const deduped = sections.filter(Boolean);

  return deduped;
}

function textToHtml(text, sections) {
  const headingLineSet = new Set(sections.map(s => s.lineIndex));
  const DIVIDER_RX = /^(\*\*\*|\* \* \*|[-\u2500\u2550]{4,}|={4,})$/;
  const isSpecial = (ln) => DIVIDER_RX.test(ln.trim()) || headingLineSet.has(-1); // placeholder
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  // Helper: is this line a structural break (heading or divider)?
  const isBreak = (idx) =>
    headingLineSet.has(idx) || DIVIDER_RX.test(lines[idx]?.trim() || '');

  while (i < lines.length) {
    const line  = lines[i];
    const trimmed = line.trim();

    // Heading line
    if (headingLineSet.has(i)) {
      const secIdx = sections.findIndex(s => s.lineIndex === i);
      out.push(`<h2 class="utxt-heading" id="utxt-sec-${secIdx}">${escapeHtml(trimmed)}</h2>`);
      i++; continue;
    }

    // Divider line (standalone *** or ----)
    if (DIVIDER_RX.test(trimmed)) {
      out.push('<hr class="utxt-divider">'); i++; continue;
    }

    // Skip blank lines silently (paragraph breaks happen naturally)
    if (!trimmed) { i++; continue; }

    // Normal text line — collect contiguous non-blank, non-special lines into one <p>
    const paraLines = [escapeHtml(trimmed)];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;              // blank line = paragraph break
      if (isBreak(i)) break;     // heading or divider = break
      paraLines.push(escapeHtml(t));
      i++;
    }
    out.push(`<p class="utxt-para">${paraLines.join(' ')}</p>`);
  }
  return out.join('\n');
}

function renderGenericReader(item, rawText) {
  const cleaned  = stripGutenbergBoilerplate(rawText);
  const sections = detectTextSections(cleaned);
  const bodyHtml = textToHtml(cleaned, sections);
  const hasTOC   = sections.length > 1;

  const tocHtml = hasTOC ? sections.map((s, idx) =>
    `<div class="utxt-toc-item" data-sec="${idx}">${escapeHtml(s.title)}</div>`
  ).join('') : '';

  libMain.innerHTML = `
    <div class="utxt-layout${hasTOC ? ' utxt-has-toc' : ''}">
      ${hasTOC ? `<div class="utxt-toc-panel"><div class="utxt-toc-label">CONTENTS</div><div class="utxt-toc-list" id="utxtTocList">${tocHtml}</div></div>` : ''}
      <div class="utxt-content-wrap">
        <div class="lib-reader-header">
          <div class="lib-reader-title">${escapeHtml(item.name)}</div>
          <div class="lib-search-bar">
            <input type="text" class="lib-search-input" id="libSearchInput" placeholder="Search in text..." onkeydown="if(event.key==='Enter')doLibSearch()">
            <button class="lib-search-btn" onclick="doLibSearch()">FIND</button>
            <button class="lib-search-btn" onclick="libSearchNext()">NEXT</button>
            <span class="lib-search-count" id="libSearchCount"></span>
          </div>
        </div>
        <div class="lib-reader-content utxt-body" id="libReaderContent">${bodyHtml}</div>
      </div>
    </div>`;

  // TOC click: scroll to section
  if (hasTOC) {
    document.getElementById('utxtTocList').addEventListener('click', e => {
      const item = e.target.closest('.utxt-toc-item');
      if (!item) return;
      const idx = item.dataset.sec;
      const target = document.getElementById('utxt-sec-' + idx);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.utxt-toc-item').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
    });
  }
}
function doLibSearch() {
  const input = document.getElementById('libSearchInput');
  const content = document.getElementById('libReaderContent');
  const countEl = document.getElementById('libSearchCount');
  if (!input || !content) return;
  const query = input.value.trim();
  if (!query) { content.innerHTML = content.textContent; if (countEl) countEl.textContent = ''; return; }
  const raw = content.textContent;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  content.innerHTML = raw.replace(regex, m => `<mark>${escapeHtml(m)}</mark>`);
  libSearchMatches = content.querySelectorAll('mark'); libSearchIdx = 0;
  if (libSearchMatches.length > 0) { libSearchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); if (countEl) countEl.textContent = `1 / ${libSearchMatches.length}`; }
  else if (countEl) countEl.textContent = 'Not found';
}
function libSearchNext() {
  if (!libSearchMatches.length) return;
  libSearchIdx = (libSearchIdx + 1) % libSearchMatches.length;
  libSearchMatches[libSearchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const countEl = document.getElementById('libSearchCount');
  if (countEl) countEl.textContent = `${libSearchIdx + 1} / ${libSearchMatches.length}`;
}

// ── ZIM / Missing panels ─────────────────────────────────────
function showZimPanel(item) {
  libMain.innerHTML = `<div class="lib-zim-panel"><div style="font-size:40px">W</div><div class="lib-zim-title">${item.name.toUpperCase()}</div><div class="lib-zim-desc">This content requires the Kiwix reader.<br>Run the setup script on a machine with internet access to install Kiwix and download the offline database.</div><div class="lib-missing-cmd">bash scripts/setup_drive.sh</div></div>`;
}
function showMissingPanel(item) {
  libMain.innerHTML = `<div class="lib-missing-panel"><div class="lib-missing-title">⚠ FILE NOT DOWNLOADED</div><div class="lib-missing-desc">${escapeHtml(item.name)}<br>This file is in the catalog but not yet on this drive.</div><div class="lib-missing-cmd">bash scripts/setup_drive.sh</div><div class="lib-missing-sub">Or use ⬇ GET MORE in the sidebar (internet required).</div></div>`;
}

// ── License Management ───────────────────────────────────────────
function licenseExists(packId) {
  // Checks localStorage for stored license key (stored by server after validation)
  return !!localStorage.getItem(`dd_license_${packId}`);
}

function showLicenseInput(packId) {
  const row = document.getElementById(`plr-${packId}`);
  if (row) { row.style.display = 'flex'; row.style.gap = '8px'; document.getElementById(`pli-${packId}`)?.focus(); }
}
function hideLicenseInput(packId) {
  const row = document.getElementById(`plr-${packId}`);
  if (row) row.style.display = 'none';
}
async function submitLicenseKey(packId, pack) {
  const input = document.getElementById(`pli-${packId}`);
  const statusEl = document.getElementById(`ps-${packId}`);
  if (!input) return;
  const key = input.value.trim();
  if (!key) { if (statusEl) statusEl.textContent = 'Please enter a license key.'; return; }
  if (statusEl) statusEl.textContent = 'Validating key…';
  // Store key locally and attempt download
  // In production, server validates key against CDN before revealing URLs
  // For now: store key and unlock optimistically (CDN will reject if invalid)
  localStorage.setItem(`dd_license_${packId}`, key);
  hideLicenseInput(packId);
  if (statusEl) statusEl.textContent = 'Key accepted — starting download…';
  // Re-render to show download button, then start download
  await startPackDownload(pack);
}

async function downloadPackFile(pack, file) {
  const installed = libManifest || new Set();
  if (installed.has(file.dest)) return;
  // Disk check
  if (libStatusData && libStatusData.free_bytes) {
    const needBytes = file.size_mb * 1024 * 1024;
    if (libStatusData.free_bytes < needBytes * 1.1) {
      const statusEl = document.getElementById(`ps-${pack.id}`);
      if (statusEl) statusEl.textContent = `⚠ Not enough space for ${file.name}. Use MANAGE SPACE to free up room.`;
      return;
    }
  }
  const btn = document.querySelector(`button[onclick*="${file.id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const result = await DDAPI.startDownload(file.url, file.dest);
  if (result && result.jobId) {
    pollSingleFile(pack.id, file, result.jobId, btn);
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '⬇'; }
    const statusEl = document.getElementById(`ps-${pack.id}`);
    if (statusEl) statusEl.textContent = 'Error starting download.';
  }
}

async function pollSingleFile(packId, file, jobId, btn) {
  const poll = setInterval(async () => {
    const status = await DDAPI.getDownloadStatus(jobId);
    if (status.done) {
      clearInterval(poll);
      await refreshAfterManifestChange();
      if (btn) { btn.textContent = '✓'; btn.style.color = 'var(--green-bright)'; btn.disabled = true; }
    } else if (status.error && status.error !== 'cancelled') {
      clearInterval(poll);
      if (btn) { btn.disabled = false; btn.textContent = '⬇'; }
    }
  }, 800);
}

// ── GET MORE panel ───────────────────────────────────────────
async function showGetMorePanel() {
  libActiveCat = '__getmore'; libMode = 'files';
  highlightSidebar('getmore'); updateLibHeader();

  if (!DDAPI.isOnline()) {
    libMain.innerHTML = `<div class="lib-zim-panel"><div style="font-size:36px">📡</div><div class="lib-zim-title">NO INTERNET CONNECTION</div><div class="lib-zim-desc">GET MORE requires internet access.<br>Connect to a network and try again.</div></div>`;
    return;
  }

  libMain.innerHTML = '<div class="lib-loading"><span>Loading available packs...</span></div>';

  // Fetch remote catalog, fall back to local extended catalog
  let remoteCatalog = await DDAPI.fetchRemoteCatalog();
  if (!remoteCatalog) {
    try {
      const res = await fetch('/content/catalog_extended.json');
      if (res.ok) remoteCatalog = await res.json();
    } catch {}
  }

  if (!remoteCatalog || !remoteCatalog.packs || !remoteCatalog.packs.length) {
    libMain.innerHTML = `<div class="lib-zim-panel"><div class="lib-zim-title">NO PACKS AVAILABLE</div><div class="lib-zim-desc">Could not load the pack catalog.<br>Check your internet connection or try again later.</div></div>`;
    return;
  }

  // Determine which files are already installed
  const installed = libManifest || new Set();

  const header = document.createElement('div');
  header.className = 'lib-cat-header';
  header.innerHTML = `<div class="lib-cat-title">⬇ GET MORE CONTENT</div><div class="lib-cat-desc">Internet connected. Download additional content packs to your drive.</div>`;

  const packList = document.createElement('div');
  packList.className = 'getmore-list';
  packList.id = 'getmoreList';

  remoteCatalog.packs.forEach(pack => {
    const allInstalled = pack.files.every(f => installed.has(f.dest));
    const someInstalled = pack.files.some(f => installed.has(f.dest));
    const isPaid = (pack.price || 0) > 0;
    const hasLicense = isPaid && licenseExists(pack.id);
    const isLocked = isPaid && !hasLicense && !allInstalled;

    const packEl = document.createElement('div');
    packEl.className = 'pack-card pack-tile' + (isLocked ? ' pack-locked' : '');
    packEl.dataset.paid = isPaid ? '1' : '0';
    packEl.id = `pack-${pack.id}`;

    // Individual file rows with per-file download
    const fileSummary = pack.files.map(f => {
      const fileInstalled = installed.has(f.dest);
      return `<div class="pack-file-item">
        <span class="pack-file-name">${f.name}</span>
        <span class="pack-file-size">~${f.size_mb} MB</span>
        ${fileInstalled
          ? `<span class="pack-file-done">✓</span>`
          : (!isLocked ? `<button class="pack-file-dl-btn" onclick="downloadPackFile(${JSON.stringify(pack).replace(/"/g,'&quot;')}, ${JSON.stringify(f).replace(/"/g,'&quot;')})" title="Download this file only">⬇</button>` : `<span class="pack-file-locked">🔒</span>`)}
      </div>`;
    }).join('');

    // Price badge
    const priceBadge = isPaid
      ? `<span class="pack-price-badge">${hasLicense ? '🔓 UNLOCKED' : '$' + pack.price.toFixed(2)}</span>`
      : `<span class="pack-price-badge free">FREE</span>`;

    // Primary CTA
    let primaryCTA = '';
    if (allInstalled) {
      primaryCTA = `<div class="pack-installed">✓ INSTALLED</div>`;
    } else if (isLocked) {
      primaryCTA = `<div class="pack-cta-stack">
          <a class="pack-dl-btn pack-purchase-btn" href="${pack.purchase_url || '#'}" target="_blank" rel="noopener">🛒 PURCHASE — &#36;${pack.price.toFixed(2)}</a>
          <button class="pack-unlock-btn" onclick="showLicenseInput('${pack.id}')">🔑 HAVE A KEY</button>
        </div>`;
    } else {
      const label = someInstalled ? 'UPDATE PACK' : 'DOWNLOAD PACK';
      primaryCTA = `<button class="pack-dl-btn" onclick="startPackDownload(${JSON.stringify(pack).replace(/"/g,'&quot;')})" ${someInstalled?'title="Some files already installed"':''}>⬇ ${label}</button>`;
    }

    packEl.innerHTML = `
      <div class="pack-tile-left">
        <span class="pack-icon">${pack.icon}</span>
        <div class="pack-meta">
          <div class="pack-name-row"><span class="pack-name">${pack.name}</span>${priceBadge}</div>
          <div class="pack-desc">${pack.description}</div>
          <div class="pack-files-row">
            <button class="pack-files-toggle" onclick="togglePackFiles('${pack.id}')">▾ ${pack.files.length} file${pack.files.length!==1?'s':''}</button>
            <span class="pack-size-label">~${pack.size_mb} MB</span>
          </div>
          <div class="pack-files-list" id="pfl-${pack.id}" style="display:none">${fileSummary}</div>
        </div>
      </div>
      <div class="pack-tile-right">
        <div class="pack-actions" id="pa-${pack.id}">${primaryCTA}</div>
        <div class="pack-status" id="ps-${pack.id}"></div>
        <div class="pack-progress-bar" id="pp-${pack.id}" style="display:none">
          <div class="pack-progress-fill" id="ppf-${pack.id}" style="width:0%"></div>
        </div>
      </div>
      <div class="pack-license-row" id="plr-${pack.id}" style="display:none;flex-basis:100%;margin-top:8px;">
        <input type="text" class="lib-search-input" id="pli-${pack.id}" placeholder="Enter license key…" style="flex:1;margin:0">
        <button class="pack-dl-btn" onclick="submitLicenseKey('${pack.id}', ${JSON.stringify(pack).replace(/"/g,'&quot;')})">UNLOCK</button>
        <button class="pack-files-toggle" onclick="hideLicenseInput('${pack.id}')">✕</button>
      </div>`;
    packList.appendChild(packEl);
  });

  // Build search + filter toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'packs-toolbar';
  toolbar.id = 'packsToolbar';
  toolbar.innerHTML = `
    <input type="text" class="packs-search-input" id="packsSearchInput"
      placeholder="Search packs…" oninput="filterPacks()">
    <div class="packs-filter-btns">
      <button class="pack-filter-btn active" data-filter="all" onclick="setPackFilter(this,'all')">ALL</button>
      <button class="pack-filter-btn" data-filter="free" onclick="setPackFilter(this,'free')">FREE</button>
      <button class="pack-filter-btn" data-filter="paid" onclick="setPackFilter(this,'paid')">PAID</button>
    </div>`;

  libMain.innerHTML = '';
  libMain.appendChild(header);
  libMain.appendChild(toolbar);
  libMain.appendChild(packList);
}

// ── Pack search + filter ─────────────────────────────────────────
window._packFilter = 'all';
function setPackFilter(btn, filter) {
  window._packFilter = filter;
  document.querySelectorAll('.pack-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterPacks();
}
function filterPacks() {
  const query = (document.getElementById('packsSearchInput')?.value || '').toLowerCase().trim();
  const filter = window._packFilter || 'all';
  document.querySelectorAll('#getmoreList .pack-card').forEach(card => {
    const name = (card.querySelector('.pack-name')?.textContent || '').toLowerCase();
    const desc = (card.querySelector('.pack-desc')?.textContent || '').toLowerCase();
    const isFree = card.dataset.paid !== '1';
    const matchesText = !query || name.includes(query) || desc.includes(query);
    const matchesFilter = filter === 'all'
      || (filter === 'free' && isFree)
      || (filter === 'paid' && !isFree);
    card.style.display = matchesText && matchesFilter ? '' : 'none';
  });
  // Show "no results" if all hidden
  const visible = [...document.querySelectorAll('#getmoreList .pack-card')].filter(c => c.style.display !== 'none');
  let noRes = document.getElementById('packsNoResults');
  if (!visible.length) {
    if (!noRes) {
      noRes = document.createElement('div');
      noRes.id = 'packsNoResults';
      noRes.className = 'lib-zim-desc';
      noRes.style.cssText = 'text-align:center;padding:32px;grid-column:1/-1;opacity:0.6;';
      noRes.textContent = 'No packs match your search.';
      document.getElementById('getmoreList')?.appendChild(noRes);
    }
  } else if (noRes) noRes.remove();
}

function togglePackFiles(packId) {
  const el = document.getElementById(`pfl-${packId}`);
  if (!el) return;
  const btn = el.previousElementSibling;
  if (el.style.display === 'none') { el.style.display = 'block'; if (btn) btn.textContent = btn.textContent.replace('▾','▴'); }
  else { el.style.display = 'none'; if (btn) btn.textContent = btn.textContent.replace('▴','▾'); }
}

async function startPackDownload(pack) {
  const installed = libManifest || new Set();
  const actionsEl = document.getElementById(`pa-${pack.id}`);
  const progressBar = document.getElementById(`pp-${pack.id}`);
  const statusEl = document.getElementById(`ps-${pack.id}`);

  // Pre-check: enough disk space?
  if (libStatusData && libStatusData.free_bytes) {
    const needBytes = pack.size_mb * 1024 * 1024;
    if (libStatusData.free_bytes < needBytes * 1.1) { // 10% buffer
      if (statusEl) statusEl.textContent = `⚠ Not enough space (need ~${pack.size_mb} MB free). Use MANAGE SPACE to free up room.`;
      return;
    }
  }

  if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn pack-cancel-btn" onclick="cancelPackDownload('${pack.id}')">✕ CANCEL</button>`;
  if (progressBar) progressBar.style.display = 'block';
  if (statusEl) statusEl.textContent = 'Starting download...';

  // Resume support: skip files already fully present in manifest
  const filesToDownload = pack.files.filter(f => !installed.has(f.dest));
  if (!filesToDownload.length) {
    if (statusEl) statusEl.textContent = 'All files already installed.';
    if (actionsEl) actionsEl.innerHTML = `<div class="pack-installed">✓ INSTALLED</div>`;
    if (progressBar) progressBar.style.display = 'none';
    return;
  }

  const jobs = {}; // fileId → jobId
  for (const file of filesToDownload) {
    const result = await DDAPI.startDownload(file.url, file.dest);
    if (result && result.jobId) jobs[file.id] = result.jobId;
    else if (result && result.error) { if (statusEl) statusEl.textContent = `Error: ${result.error}`; return; }
  }

  packDownloads[pack.id] = { jobs, cancelled: false };
  pollPackDownload(pack, filesToDownload, jobs);
}

function pollPackDownload(pack, files, jobs) {
  const progressFill = document.getElementById(`ppf-${pack.id}`);
  const statusEl = document.getElementById(`ps-${pack.id}`);
  const actionsEl = document.getElementById(`pa-${pack.id}`);
  const progressBar = document.getElementById(`pp-${pack.id}`);
  const totalFiles = files.length;
  let done = false;

  const poll = setInterval(async () => {
    if (packDownloads[pack.id] && packDownloads[pack.id].cancelled) {
      clearInterval(poll); return;
    }
    let totalBytes = 0, doneBytes = 0, allDone = true, anyError = null;
    for (const file of files) {
      const jobId = jobs[file.id];
      if (!jobId) continue;
      const status = await DDAPI.getDownloadStatus(jobId);
      doneBytes += status.progress || 0;
      totalBytes += status.total || (file.size_mb * 1024 * 1024);
      if (!status.done) allDone = false;
      if (status.error && status.error !== 'cancelled') anyError = status.error;
    }
    const pct = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;
    if (progressFill) progressFill.style.width = pct + '%';
    if (statusEl) {
      if (anyError) statusEl.textContent = `Error: ${anyError}`;
      else if (allDone) statusEl.textContent = 'Installed ✓';
      else statusEl.textContent = `Downloading... ${pct}%  (${(doneBytes/1024/1024).toFixed(1)} MB)`;
    }
    if (allDone || anyError) {
      clearInterval(poll);
      delete packDownloads[pack.id];
      if (!anyError) {
        if (actionsEl) actionsEl.innerHTML = `<div class="pack-installed">✓ INSTALLED</div>`;
        if (progressBar) progressBar.style.display = 'none';
        await refreshAfterManifestChange();
      } else {
        if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn" onclick="startPackDownload(${JSON.stringify(pack).replace(/"/g,'&quot;')})">⬇ RETRY</button>`;
      }
    }
  }, 600);
  if (packDownloads[pack.id]) packDownloads[pack.id].pollRef = poll;
}

async function cancelPackDownload(packId) {
  const dl = packDownloads[packId];
  if (dl) {
    dl.cancelled = true;
    if (dl.pollRef) clearInterval(dl.pollRef);
    for (const jobId of Object.values(dl.jobs)) await DDAPI.cancelDownload(jobId);
    delete packDownloads[packId];
  }
  const actionsEl = document.getElementById(`pa-${packId}`);
  const progressBar = document.getElementById(`pp-${packId}`);
  const statusEl = document.getElementById(`ps-${packId}`);
  if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn" onclick="startPackDownload(this)">⬇ DOWNLOAD PACK</button>`;
  if (progressBar) progressBar.style.display = 'none';
  if (statusEl) statusEl.textContent = 'Cancelled.';
}

// ── MANAGE SPACE panel ───────────────────────────────────────
async function showManagePanel() {
  libActiveCat = '__manage'; libMode = 'files';
  highlightSidebar('manage'); updateLibHeader();
  libMain.innerHTML = '<div class="lib-loading"><span>Loading drive info...</span></div>';

  const [manifest, status] = await Promise.all([DDAPI.getManifest(), DDAPI.getStatus()]);
  if (!manifest) { libMain.innerHTML = `<div class="lib-missing-panel"><div class="lib-missing-title">⚠ NO MANIFEST</div><div class="lib-missing-desc">Run setup_drive.sh to build the manifest.</div></div>`; return; }

  const files = manifest.files || {};
  const totalContent = manifest.total_bytes || 0;
  const freeDisk = (status && status.free_bytes) || 0;
  const totalDisk = totalContent + freeDisk;
  const usedPct = totalDisk > 0 ? Math.min(100, Math.round((totalContent / totalDisk) * 100)) : 0;

  function fmtSize(bytes) {
    if (bytes >= 1073741824) return (bytes/1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes/1048576).toFixed(1) + ' MB';
    return (bytes/1024).toFixed(0) + ' KB';
  }

  // Group files by category from catalog
  const catalog = libRawCatalog || {};
  const categoryGroups = [];
  if (catalog.categories) {
    catalog.categories.forEach(cat => {
      const catFiles = cat.items.filter(item => files[item.file]);
      if (!catFiles.length) return;
      categoryGroups.push({ cat, files: catFiles });
    });
  }
  // Uncategorized files
  const categorizedPaths = new Set(categoryGroups.flatMap(g => g.files.map(f => f.file)));
  const uncatFiles = Object.entries(files).filter(([p]) => !categorizedPaths.has(p));

  let html = `
    <div class="manage-panel">
      <div class="manage-header">
        <div class="manage-usage-label">Content usage: ${fmtSize(totalContent)} of ${fmtSize(totalDisk)} total</div>
        <div class="manage-bar"><div class="manage-bar-fill" style="width:${usedPct}%"></div></div>
      </div>`;

  categoryGroups.forEach(({ cat, files: catFiles }) => {
    const catSize = catFiles.reduce((s, f) => s + (files[f.file] ? files[f.file].size : 0), 0);
    html += `
      <div class="manage-category">
        <div class="manage-cat-header">
          <span>${cat.icon} ${cat.name}</span>
          <span class="manage-cat-size">${fmtSize(catSize)}</span>
          <button class="manage-del-btn" onclick="deleteCategory('${cat.id}')" title="Remove all ${cat.name} files">Remove All</button>
        </div>`;
    catFiles.forEach(item => {
      const fileInfo = files[item.file];
      html += `
        <div class="manage-file-row" id="mfr-${item.id}">
          <span class="manage-file-name">${item.name}</span>
          <span class="manage-file-size">${fmtSize(fileInfo ? fileInfo.size : 0)}</span>
          <button class="manage-del-btn" onclick="confirmDeleteFile('${item.file}','${escapeHtml(item.name)}','${item.id}')">🗑</button>
        </div>`;
    });
    html += `</div>`;
  });

  // Only show uncategorized CONTENT files — exclude system/UI files
  const CONTENT_DIRS = ['content/books/', 'content/zim/', 'content/maps/', 'content/audio/'];
  const contentUncatFiles = uncatFiles.filter(([p]) =>
    CONTENT_DIRS.some(d => p.startsWith(d))
  );
  if (contentUncatFiles.length) {
    const uncatSize = contentUncatFiles.reduce((s, [, i]) => s + i.size, 0);
    html += `<div class="manage-category"><div class="manage-cat-header"><span>\u{1F4C1} Other Content</span><span class="manage-cat-size">${fmtSize(uncatSize)}</span></div>`;
    contentUncatFiles.forEach(([path, info]) => {
      const fname = path.split('/').pop();
      html += `<div class="manage-file-row"><span class="manage-file-name">${escapeHtml(fname)}</span><span class="manage-file-size">${fmtSize(info.size)}</span><button class="manage-del-btn" onclick="confirmDeleteFile('${path}','${escapeHtml(fname)}','')">\u{1F5D1}</button></div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  libMain.innerHTML = html;
}

async function deleteCategory(catId) {
  const cat = libRawCatalog && libRawCatalog.categories.find(c => c.id === catId);
  if (!cat) return;
  if (!confirm(`Remove all ${cat.items.length} file(s) in "${cat.name}"? This frees up disk space. You can re-download later.`)) return;
  for (const item of cat.items) {
    if (libManifest && libManifest.has(item.file)) await DDAPI.deleteFile(item.file);
  }
  await refreshAfterManifestChange();
  showManagePanel();
}

async function confirmDeleteFile(filePath, displayName, itemId) {
  if (!confirm(`Remove "${displayName}"?\nThis deletes the file from your drive. You can re-download it later.`)) return;
  const row = document.getElementById(`mfr-${itemId}`);
  if (row) row.style.opacity = '0.4';
  const result = await DDAPI.deleteFile(filePath);
  if (result && result.ok) {
    await refreshAfterManifestChange();
    showManagePanel();
  } else {
    if (row) row.style.opacity = '1';
    alert('Could not delete file. ' + (result ? result.error : ''));
  }
}

// ── Utilities ────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
