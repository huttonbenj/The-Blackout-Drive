/**
 * The Blackout Drive — Offline Library Browser
 * Zero external dependencies — pure vanilla JS.
 * Reads from DDAPI (api.js) for all HTTP calls.
 */
'use strict';

// P0-2 FIX: showToast() is now defined only in app.js to avoid duplication.
// library.js uses the global showToast() from app.js (loaded after library.js,
// but all calls are async/event-driven, so it's always available when needed).

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
  try {
    const s = JSON.parse(sessionStorage.getItem(LIB_SS_KEY) || 'null');
    if (!s || !s.open) {
      // No library was open — remove guard and let init() reveal body
      document.documentElement.removeAttribute('data-restore');
      return;
    }
    // Library WAS open. libraryPanel is already flex via CSS (pre-paint).
    // Now load catalog and navigate to the saved view.
    openLibrary().then(() => {
      if (s.cat === '__getmore') {
        showGetMorePanel();
      } else if (s.cat === '__manage') {
        showManagePanel();
      } else if (s.cat === '__myfiles') {
        showMyFilesPanel();
      } else if (s.cat) {
        const stillValid = libCatalog && libCatalog.categories.find(c => c.id === s.cat);
        if (stillValid) {
          selectCategory(s.cat);
          if (s.mode === 'reader' && s.itemId && libRawCatalog) {
            const allItems = libRawCatalog.categories.flatMap(c => c.items);
            const item = allItems.find(i => i.id === s.itemId);
            if (item && libManifest && libManifest.has(item.file)) {
              openItem(item);
            }
          }
        } else {
          const firstCat = libCatalog && libCatalog.categories[0];
          if (firstCat) selectCategory(firstCat.id);
          else showCategorySelect();
        }
      }
      // ── ANTI-FLICKER: the key trick ──────────────────────────
      // Lock .main-content hidden via INLINE style BEFORE we remove
      // the CSS guard. This way it goes from CSS-hidden → JS-hidden
      // with zero visible gap. closeLibrary() clears this lock.
      const mc = document.querySelector('.main-content');
      if (mc) mc.style.display = 'none';
      // Now safe to remove CSS guards — main-content stays hidden
      document.documentElement.removeAttribute('data-restore');
      document.documentElement.removeAttribute('data-restore-chat');
      // Reveal instantly — no transition, no gap
      document.body.style.transition = 'none';
      document.body.style.opacity = '1';
      // Re-enable transition for future use (e.g. closing library)
      requestAnimationFrame(() => { document.body.style.transition = ''; });
    }).catch(() => {
      document.documentElement.removeAttribute('data-restore');
      document.documentElement.removeAttribute('data-restore-chat');
      document.body.style.transition = 'none';
      document.body.style.opacity = '1';
      requestAnimationFrame(() => { document.body.style.transition = ''; });
    });
  } catch {
    document.documentElement.removeAttribute('data-restore');
    document.documentElement.removeAttribute('data-restore-chat');
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
let _lastWorkerCatalog = null; // last fetched Worker catalog (for merging new packs)
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
let _downloadBusy = false;  // global flag: true while a pack download is in progress

// ── DOM refs ────────────────────────────────────────────────
const libraryPanel   = document.getElementById('libraryPanel');
const libSidebar     = document.getElementById('libSidebar');
const libMain        = document.getElementById('libMain');
const libBackBtn     = document.getElementById('libBackBtn');
const libHeaderTitle = document.getElementById('libHeaderTitle');

// ── Open / Close ────────────────────────────────────────────
function _setLibrarySidebarActive(active) {
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('sidebar-btn--active'));
  const id = active ? 'libraryNavBtn' : 'chatNavBtn';
  const el = document.getElementById(id);
  if (el) el.classList.add('sidebar-btn--active');
}

let _libraryOpening = false; // guard: prevents closeAllPanels re-entry during openLibrary

async function openLibrary() {
  // Close all other panels before opening library.
  // Guard prevents closeAllPanels from closing the library we're about to open.
  // Close side panels + workspace WITHOUT showing main-content (prevents chat flash).
  // Library overlays everything, so we just need to hide workspace directly.
  _libraryOpening = true;
  if (typeof _closeSidePanels === 'function') _closeSidePanels();
  // Close workspace directly without restoring main-content visibility
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
  _libraryOpening = false;

  _setLibrarySidebarActive(true);
  libraryPanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Hide warmup overlay when library is covering the chat
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();
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
  if (_libraryOpening) return; // don't close during open sequence
  // Clean up any temp session from locked file viewing
  if (typeof _cleanupTempSession === 'function') _cleanupTempSession();
  libraryPanel.style.display = 'none';
  document.body.style.overflow = '';
  // Unlock .main-content if it was locked hidden by _restoreLibState
  const mc = document.querySelector('.main-content');
  if (mc) mc.style.display = '';
  _setLibrarySidebarActive(false);
  try { sessionStorage.removeItem(LIB_SS_KEY); } catch {}
  // Re-show warmup overlay if still warming and returning to chat
  if (typeof _updateWarmupVisibility === 'function') _updateWarmupVisibility();
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
    libHeaderTitle.textContent = 'OFFLINE LIBRARY';
    libBackBtn.classList.add('hidden');
  } else if (libMode === 'files') {
    if (libActiveCat === '__getmore') {
      libHeaderTitle.innerHTML = ICONS.download + ' GET MORE CONTENT';
    } else if (libActiveCat === '__manage') {
      libHeaderTitle.innerHTML = ICONS.trash + ' MANAGE SPACE';
    } else if (libActiveCat === '__userlibrary') {
      libHeaderTitle.innerHTML = '📂 MY UPLOADS';
    } else {
      const cat = libCatalog && libCatalog.categories.find(c => c.id === libActiveCat);
      libHeaderTitle.innerHTML = cat ? `${cat.icon} ${cat.name.toUpperCase()}` : 'LIBRARY';
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

// Cloudflare Worker URL — sourced from config.json (content.remoteCatalogUrl).
// Falls back to local catalog.json cache when offline.
const WORKER_CATALOG_URL = (() => {
  try {
    return (window.BLACKOUT_CONFIG && window.BLACKOUT_CONFIG.content && window.BLACKOUT_CONFIG.content.remoteCatalogUrl)
      || 'https://blackout-catalog.hutton-benj.workers.dev';
  } catch { return 'https://blackout-catalog.hutton-benj.workers.dev'; }
})();

/**
 * Convert Worker catalog format → internal catalog format used by library.js.
 * Worker returns: { packs: [{ id, name, description, icon, files: [{ id, name, filename, type, url, size }] }] }
 * Internal format: { categories: [{ id, name, icon, items: [{ id, name, type, file, download_url, size_label, license, short }] }] }
 */
function _normalizeWorkerCatalog(workerData) {
  const categories = (workerData.packs || []).map(pack => ({
    id: pack.id,
    name: pack.name,
    icon: pack.icon || _packIcon(pack.id),
    description: pack.description || '',
    items: (pack.files || []).map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
      // Local path mirrors R2 bucket structure: content/books/{category}/{filename}
      file: 'content/books/' + pack.id + '/' + f.filename,
      download_url: f.url,
      size_label: f.size ? _fmtBytes(f.size) : '',
      license: f.type === 'epub' ? 'Public Domain' : 'Public Domain / Gov',
      short: f.description || '',
      _remote: true, // flag: sourced from R2
    }))
  }));
  return { categories, _source: 'worker', _generated: workerData.generated };
}

function _packIcon(id) {
  return getCategoryIcon(id);
}

function _fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadCatalog() {
  libMain.innerHTML = '<div class="lib-loading"><span>Loading library...</span></div>';
  try {
    // 1. Fetch manifest (what files are physically on this drive)
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

    // 3. Load catalog.json — cached Worker response, single source of truth.
    //    Generated by sync_content.sh from the R2 bucket.
    //    Falls back to live Worker if local cache is missing (online mode).
    let workerData = null;
    try {
      const res = await fetch('/_system/content/catalog.json');
      if (res.ok) workerData = await res.json();
    } catch (_) { /* local cache not found */ }

    // If no local cache, try Worker directly (online)
    if (!workerData && WORKER_CATALOG_URL) {
      try {
        const res = await fetch(WORKER_CATALOG_URL, { signal: AbortSignal.timeout(5000) });
        if (res.ok) workerData = await res.json();
      } catch (_) { /* offline */ }
    }

    if (!workerData) throw new Error('No catalog available (catalog.json missing and Worker unreachable)');

    // Normalize Worker format → internal format
    // File paths use category subfolders: content/books/{category}/{filename}
    libRawCatalog = _normalizeWorkerCatalog(workerData);
    _lastWorkerCatalog = workerData;

    // User-uploaded files are accessed exclusively via the MY FILES sidebar
    // panel (showMyFilesPanel). They are NOT injected into the catalog to avoid
    // duplication and confusion with the "ON THIS DRIVE" category grid.

    // 5. Apply manifest filter and render
    applyManifestFilter();
    renderSidebar(false);
    showCategorySelect();
  } catch (err) {
    libMain.innerHTML = `
      <div class="lib-missing-panel">
        <div class="lib-missing-title">LIBRARY CATALOG ERROR</div>
        <div class="lib-missing-desc">Could not load the content catalog.<br>${err && err.message ? err.message : 'Unknown error'}</div>
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

  // Merge any Worker pack categories for files that exist in the manifest
  // but don't belong to any existing catalog category.
  // This ensures packs like "Emergency Preparedness" appear in the sidebar after download.
  if (libRawCatalog && libManifest && _lastWorkerCatalog) {
    const existingFiles = new Set();
    (libRawCatalog.categories || []).forEach(cat =>
      cat.items.forEach(item => { if (item.file) existingFiles.add(item.file); })
    );

   (_lastWorkerCatalog.packs || []).forEach(pack => {
      const newItems = (pack.files || []).filter(f => {
        // Path must include pack.id subfolder to match _normalizeWorkerCatalog format
        const dest = f.dest || ('content/books/' + pack.id + '/' + (f.filename || f.id + '.epub'));
        return libManifest.has(dest) && !existingFiles.has(dest);
      });
      if (newItems.length > 0) {
        const catId = pack.id;
        let existing = libRawCatalog.categories.find(c => c.id === catId);
        if (!existing) {
          existing = {
            id: catId,
            name: pack.name,
            icon: pack.icon || _packIcon(catId),
            items: []
          };
          libRawCatalog.categories.push(existing);
        }
        newItems.forEach(f => {
          const dest = f.dest || ('content/books/' + pack.id + '/' + (f.filename || f.id + '.epub'));
          if (!existing.items.find(i => i.file === dest)) {
            existing.items.push({
              id: f.id || f.filename,
              name: f.name,
              type: f.type || (dest.endsWith('.pdf') ? 'pdf' : 'epub'),
              file: dest,
              license: 'Public Domain',
              short: pack.description || ''
            });
            existingFiles.add(dest);
          }
        });
      }
    });
  }

  applyManifestFilter();
  renderSidebar();

  // If the active category was removed (no files left), redirect to first available
  // category or the empty state. Prevents showing a stale pack page.
  if (libActiveCat && !libActiveCat.startsWith('__') && libCatalog) {
    const stillExists = libCatalog.categories.find(c => c.id === libActiveCat);
    if (!stillExists) {
      const firstCat = libCatalog.categories[0];
      if (firstCat) {
        selectCategory(firstCat.id);
      } else {
        // No categories with content — show empty state
        showCategorySelect();
      }
    }
  }
}

// ── Sidebar ─────────────────────────────────────────────────
function renderSidebar(fromOnline = false) {
  if (!libRawCatalog) return;
  libInBibleMode = false;
  libSidebar.innerHTML = '';

  // Section: ON THIS DRIVE
  const label = document.createElement('div');
  label.className = 'lib-sidebar-label';
  label.textContent = fromOnline ? 'CONTENT CATALOG' : 'ON THIS DRIVE';
  if (fromOnline) label.title = 'Catalog loaded from online source';
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

  // GET MORE — always visible (shows offline message when not online)
  const gm = document.createElement('div');
  gm.className = 'lib-action-item' + (libActiveCat === '__getmore' ? ' active' : '');
  gm.dataset.action = 'getmore';
  gm.onclick = () => showGetMorePanel();
  gm.innerHTML = `<span class="lib-cat-icon">${ICONS.download}</span><span class="lib-cat-name">GET MORE</span>`;
  libSidebar.appendChild(gm);

  // MANAGE SPACE — always
  const mg = document.createElement('div');
  mg.className = 'lib-action-item' + (libActiveCat === '__manage' ? ' active' : '');
  mg.dataset.action = 'manage';
  mg.onclick = () => showManagePanel();
  mg.innerHTML = `<span class="lib-cat-icon">${ICONS.trash}</span><span class="lib-cat-name">MANAGE SPACE</span>`;
  libSidebar.appendChild(mg);

  // MY UPLOADS — show if user has any files in USER_DATA/content/
  // Fetch count async to not block sidebar rendering
  fetch('/api/user-files', { cache: 'no-store' }).then(r => r.json()).then(data => {
    if (data.count > 0) {
      // Insert before the divider
      const myUploads = document.createElement('div');
      myUploads.className = 'lib-cat-item' + (libActiveCat === '__userlibrary' ? ' active' : '');
      myUploads.dataset.catId = '__userlibrary';
      myUploads.onclick = () => showUserLibraryPanel();
      myUploads.innerHTML = `<span class="lib-cat-icon">📂</span><span class="lib-cat-name">My Uploads</span><span class="lib-cat-count">${data.count}</span>`;
      // Insert before the divider (which is after the last category)
      const divider = libSidebar.querySelector('.lib-sidebar-divider');
      if (divider) libSidebar.insertBefore(myUploads, divider);
      else libSidebar.appendChild(myUploads);
    }
  }).catch(() => {});
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
  _saveLibState();

  const cats = libCatalog ? libCatalog.categories : [];
  const devBadge = libDevMode
    ? `<div class="lib-dev-badge">DEV MODE — no content manifest found. Start the drive launcher to populate content.</div>`
    : '';

  // ── Empty library state ──────────────────────────────────
  if (cats.length === 0 && !libDevMode) {
    const isOnline = DDAPI.isOnline();
    libMain.innerHTML = `
      <div class="lib-empty-state">
        <div class="lib-empty-icon">${ICONS.library}</div>
        <div class="lib-empty-title">NO CONTENT ON THIS DRIVE</div>
        <div class="lib-empty-desc">
          ${isOnline
            ? 'Use <strong>⬇ GET MORE</strong> in the sidebar to browse and download content packs — reference manuals, medical guides, engineering texts, and more.'
            : 'Connect to the internet to download content packs to your drive. Once downloaded, content is available offline forever.'}
        </div>
        ${isOnline
          ? `<button class="lib-empty-cta" onclick="showGetMorePanel()">⬇ BROWSE AVAILABLE CONTENT</button>`
          : `<div class="lib-empty-offline-hint">${ICONS.signal} No internet connection detected</div>`}
      </div>`;
    return;
  }

  // ── Normal category grid ─────────────────────────────────
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
      <div class="lib-cat-desc">Browse your downloaded content.${DDAPI.isOnline() ? ' Get more from the ⬇ GET MORE panel.' : ''}</div>
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

/**
 * Show the user's personal library files (from USER_DATA/content/).
 * These are files promoted from the Workspace via "Send to Library".
 */
async function showUserLibraryPanel() {
  libActiveCat = '__userlibrary';
  libMode = 'files';
  updateLibHeader();
  highlightSidebar('__userlibrary');
  _saveLibState();

  libMain.innerHTML = '<div class="lib-loading"><span>Loading your files...</span></div>';

  let files = [];
  try {
    const res = await fetch('/api/user-files', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      files = data.files || [];
    }
  } catch {}

  if (files.length === 0) {
    libMain.innerHTML = `
      <div class="lib-cat-header">
        <div class="lib-cat-title">📂 MY UPLOADS</div>
        <div class="lib-cat-desc">Files you've added from the Workspace appear here.</div>
      </div>
      <div class="lib-empty-state">
        <div class="lib-empty-icon">📂</div>
        <div class="lib-empty-title">NO PERSONAL FILES YET</div>
        <div class="lib-empty-desc">
          Upload files to the <strong>Workspace → Unlocked</strong> tab, then use the
          <strong>📚</strong> button to add them to your library.
        </div>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'lib-file-list';

  files.forEach(f => {
    const el = document.createElement('div');
    el.className = 'lib-file-item';
    el.style.cursor = f.readable ? 'pointer' : 'default';

    const typeBadge = (f.type || 'file').toUpperCase();
    const sizeLabel = f.size ? _fmtBytes(f.size) : '';
    const displayName = f.name || f.id;

    el.innerHTML = `
      <span class="lib-file-type-badge ${f.type}">${typeBadge}</span>
      <div class="lib-file-info">
        <div class="lib-file-name">${escapeHtml(displayName)}</div>
        <div class="lib-file-meta">${sizeLabel} · <span class="status-ok">✓ IN LIBRARY</span></div>
      </div>`;

    // Click to open (only for readable types)
    if (f.readable && f.file) {
      el.addEventListener('click', () => {
        const item = {
          name: displayName,
          type: f.type === 'text' ? 'txt' : f.type,
          file: f.file,
          always_available: true,  // bypass manifest check
        };
        openItem(item);
      });
    }

    // Remove from Library — subtle trash icon
    const removeBtn = document.createElement('button');
    removeBtn.className = 'manage-del-btn';
    removeBtn.title = 'Remove from Library (keeps original in Workspace)';
    removeBtn.style.cssText = 'flex-shrink:0;margin-left:auto';
    removeBtn.innerHTML = ICONS.trash;
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filename = f.file.split('/').pop();
      try {
        const res = await fetch('/api/files/user-content/' + encodeURIComponent(filename), { method: 'DELETE' });
        if (res.ok) {
          if (typeof showToast === 'function') showToast('Removed from Library (original kept in Workspace)');
          showUserLibraryPanel(); // refresh
          renderSidebar(); // update sidebar count
        } else {
          if (typeof showToast === 'function') showToast('⚠ Failed to remove');
        }
      } catch {
        if (typeof showToast === 'function') showToast('⚠ Error removing file');
      }
    });
    el.appendChild(removeBtn);

    list.appendChild(el);
  });

  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="lib-cat-title">📂 MY UPLOADS</div>
      <div class="lib-cat-desc">
        Your personal files added from the Workspace. Click to read.
      </div>
    </div>`;
  libMain.appendChild(list);
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
    // Only show when online AND item has a download URL.
    if (!inManifest && hasDirectUrl && DDAPI.isOnline()) {
      const btn = document.createElement('button');
      btn.className = 'lib-dl-corner-btn';
      btn.title = 'Download to drive';
      btn.setAttribute('aria-label', 'Download ' + item.name);
      btn.innerHTML = '<span class="lib-dl-icon" aria-hidden="true">&#8595;</span><span class="lib-dl-label">GET</span>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadLibItem(item, el, btn);
      });
      el.appendChild(btn);
    } else if (!inManifest && hasDirectUrl && !DDAPI.isOnline()) {
      // Offline: show disabled indicator
      const badge = document.createElement('div');
      badge.className = 'lib-file-note';
      badge.textContent = 'Connect to internet to download';
      el.querySelector('.lib-file-info').appendChild(badge);
    } else if (!inManifest && !hasDirectUrl && item.note) {
      // No direct URL but has a note (e.g., Hesperian medical PDFs)
      const note = document.createElement('div');
      note.className = 'lib-file-note';
      note.textContent = item.note;
      el.querySelector('.lib-file-info').appendChild(note);
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
  _readerOriginalHtml = null; // P0-1: reset search cache for new item
  if (item.type === 'pdf') {
    libMode = 'reader';
    updateLibHeader();
    // Check if file exists on drive
    const isInstalled = item.always_available || (libManifest && libManifest.has(item.file));
    if (!isInstalled) {
      showMissingPanel(item);
      return;
    }
    const pdfUrl = '/' + item.file;
    libMain.innerHTML = `<div class="utxt-layout">
      <div class="utxt-content-wrap" style="padding:0;height:100%">
        <div class="lib-reader-header" style="padding:12px 16px">
          <div class="lib-reader-title">${escapeHtml(item.name)}</div>
          <div style="display:flex;gap:8px">
            <a href="${pdfUrl}" target="_blank" class="lib-search-btn" style="text-decoration:none">Open in New Tab ↗</a>
            <a href="${pdfUrl}" download class="lib-search-btn" style="text-decoration:none">⬇ Download</a>
          </div>
        </div>
        <iframe src="${pdfUrl}" style="width:100%;height:calc(100% - 56px);border:none;background:#2a2a2a"></iframe>
      </div>
    </div>`;
    return;
  }
  if (item.type === 'ham-radio-tools') {
    libMode = 'reader'; updateLibHeader();
    libMain.innerHTML = '<div class="lib-zim-panel"><div style="font-size:40px"></div><div class="lib-zim-title">HAM RADIO TOOLS</div><div class="lib-zim-desc">Interactive ham radio tools are coming in V2.<br>Stay tuned for Morse code trainer, frequency charts, and quiz mode.</div></div>';
    return;
  }
  if (item.type === 'zim') { libMode = 'reader'; updateLibHeader(); showZimPanel(item); return; }
  // Bible detection: match by file path (format-agnostic, survives ID format changes)
  const _isBible = (item.file && /\/bible\/bible_/.test(item.file)) ||
                   (item.id && /^bible[-_]/.test(item.id));
  if (_isBible && item.type === 'txt') {
    libMode = 'reader';
    libMain.innerHTML = '<div class="lib-loading"><span>Loading Bible...</span></div>';
    try {
      const res = await fetch('/' + item.file);
      if (!res.ok) { showMissingPanel(item); return; }
      initBibleReader(item, await res.text());
    } catch { showMissingPanel(item); }
    return;
  }
  // ── EPUB files (epub.js renderer) ──
  if (item.type === 'epub') {
    libMode = 'reader';
    updateLibHeader();
    libMain.innerHTML = '<div class="lib-loading"><span>Loading book...</span></div>';
    renderEpubReader(item);
    return;
  }
  // ── Image files (user uploads) ──
  if (item.type === 'image') {
    libMode = 'reader';
    updateLibHeader();
    const imgUrl = '/' + item.file;
    libMain.innerHTML = `<div class="utxt-layout">
      <div class="utxt-content-wrap" style="padding:0;height:100%">
        <div class="lib-reader-header" style="padding:12px 16px">
          <div class="lib-reader-title">${escapeHtml(item.name)}</div>
          <div style="display:flex;gap:8px">
            <a href="${imgUrl}" target="_blank" class="lib-search-btn" style="text-decoration:none">Open in New Tab ↗</a>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;padding:24px;min-height:400px">
          <img src="${imgUrl}" style="max-width:100%;max-height:80vh;border-radius:4px" alt="${escapeHtml(item.name)}">
        </div>
      </div>
    </div>`;
    return;
  }
  // ── Plain text fallback (legacy .txt files that aren't Bible) ──
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
    // Verses can wrap across multiple lines. Pre-join continuation lines
    // before parsing so we capture full verse text.
    const marker = '*** START OF THE PROJECT GUTENBERG EBOOK';
    const rawText = strip.indexOf(marker) >= 0 ? strip.slice(strip.indexOf(marker)) : strip;
    const rawLines = rawText.split('\n');

    // Pre-join: merge continuation lines (non-verse, non-blank) into preceding verse line
    const joined = [];
    for (const rawLine of rawLines) {
      const trimmed = rawLine.replace(/\r$/, '').trimEnd();
      if (CHVERSE_RX.test(trimmed)) {
        joined.push(trimmed);
      } else if (trimmed.length > 0 && joined.length > 0 && CHVERSE_RX.test(joined[joined.length - 1])) {
        // Continuation line — append to the previous verse line
        joined[joined.length - 1] += ' ' + trimmed.trim();
      } else {
        joined.push(trimmed);
      }
    }

    let bookIdx = -1, curCh = 0;
    for (const line of joined) {
      const m = line.match(CHVERSE_RX);
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
  let bookFound = true;
  const fullRef = query.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (fullRef) {
    const bq = fullRef[1].toLowerCase().trim();
    const fi = bibleData.findIndex(b => b.name.toLowerCase().startsWith(bq));
    if (fi >= 0) { targetBook = fi; targetCh = parseInt(fullRef[2]); if (fullRef[3]) targetVs = parseInt(fullRef[3]); }
    else { bookFound = false; }
  } else {
    const cv = query.match(/^(\d+):(\d+)$/);
    if (cv) { targetCh = parseInt(cv[1]); targetVs = parseInt(cv[2]); }
    else { bookFound = false; }
  }
  // P2-6 FIX: Show feedback for unrecognized references
  if (!bookFound) {
    showToast('Book not found. Try "John 3:16" or "Genesis 1".', 3500);
    return;
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
  // Clean up any temp session from locked file viewing
  if (typeof _cleanupTempSession === 'function') _cleanupTempSession();
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
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // normalize line endings

  // Strip everything before *** START OF ... ***
  const startRx = /\*\*\* START OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const endRx   = /\*\*\* END OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const startM  = text.match(startRx);
  if (startM) text = text.slice(startM.index + startM[0].length);
  const endM = text.match(endRx);
  if (endM) text = text.slice(0, text.lastIndexOf(endM[0]));

  // Strip old Gutenberg preamble note blocks (*** ... ***)
  for (let i = 0; i < 3; i++) {
    const trimmed = text.replace(/^\s+/, '');
    if (/^\*{3}[^\n]*\n/.test(trimmed)) {
      const closeIdx = trimmed.indexOf('\n***', 3);
      if (closeIdx > 0) { text = trimmed.slice(closeIdx + 4); }
      else break;
    } else break;
  }

  // Strip "Produced by" / "Transcribed by" attribution (first few lines)
  text = text.replace(/^\s+/, '');
  const prodRx = /^(Produced|Transcribed|Prepared|Updated) by[^\n]*(?:\n(?!\n)[^\n]*)*/i;
  text = text.replace(prodRx, '').replace(/^\s+/, '');

  // Strip [Transcriber's Note: ...] blocks at the beginning
  while (/^\[Transcriber/.test(text)) {
    const endBracket = text.indexOf(']');
    if (endBracket > 0) { text = text.slice(endBracket + 1).replace(/^\s+/, ''); }
    else break;
  }

  // Strip [Illustration: ...] markers at the very beginning (before real content)
  while (/^\[Illustration/.test(text)) {
    const endBracket = text.indexOf(']');
    if (endBracket > 0) { text = text.slice(endBracket + 1).replace(/^\s+/, ''); }
    else break;
  }

  // Collapse 4+ consecutive blank lines to 2
  text = text.replace(/\n{4,}/g, '\n\n\n');

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
    /^([IVXLCDM]{1,6})\.?\s*$/,
    /^PLATE\s+\d+\.?$/i,
  ];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 100) return;

    // Skip lines that look like a printed TOC entry (heading + trailing page number)
    // e.g., "Chapter I.--City Experiences...  9" or "CHAPTER II 6"
    if (/\s{2,}\d{1,4}\s*$/.test(trimmed)) return;

    const isAtCol0 = line.length === 0 || line[0] !== ' ' || line.startsWith(trimmed);
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    const isIsolated = prevBlank || nextBlank;

    if (!isAtCol0 && !isIsolated) return;

    for (const rx of HEADING_RX) {
      if (rx.test(trimmed)) {
        sections.push({ title: trimmed, lineIndex: i });
        break;
      }
    }
  });

  // Deduplicate: canonical form ignores case, punctuation, trailing subtitle
  const canonical = (t) => t.toLowerCase()
    .replace(/[.:\-–—]+/g, ' ')  // strip punctuation
    .replace(/\s+/g, ' ')        // collapse whitespace
    .replace(/\bthe\b/g, '')     // strip articles
    .trim()
    .split(' ').slice(0, 3).join(' '); // first 3 words only for matching

  const seen = new Map();
  sections.forEach((s, idx) => {
    const key = canonical(s.title);
    if (seen.has(key)) {
      sections[seen.get(key)] = null;
    }
    seen.set(key, idx);
  });

  return sections.filter(Boolean);
}

function textToHtml(text, sections) {
  const headingLineSet = new Set(sections.map(s => s.lineIndex));
  const DIVIDER_RX = /^(\*\*\*|\* \* \*|[-\u2500\u2550]{4,}|={4,})$/;
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  // Helper: is this line a structural break (heading or divider)?
  const isBreak = (idx) =>
    headingLineSet.has(idx) || DIVIDER_RX.test(lines[idx]?.trim() || '');

  // Helper: is this line genuinely tabular? (has tab chars or right-aligned prices/numbers)
  const isTabular = (line) => /\t/.test(line) ||
    (/\$\s*\d/.test(line) && /^\s{4,}/.test(line)) ||
    (/\s{3,}\d+\.\d{2}\s*$/.test(line));

  // Helper: convert Gutenberg inline markup to HTML
  const formatInline = (html) => {
    // _text_ → <em>text</em> (but not __text__ or mid-word underscores)
    html = html.replace(/(?:^|(?<=\s))_([^_]+?)_(?=\s|[.,;:!?]|$)/g, '<em>$1</em>');
    // [Illustration: desc] → styled placeholder
    html = html.replace(/\[Illustration(?::([^\]]*))?\]/gi, (m, desc) =>
      `<span class="utxt-illus">[Illustration${desc ? ': ' + desc.trim() : ''}]</span>`);
    return html;
  };

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

    // Skip blank lines
    if (!trimmed) { i++; continue; }

    // Tabular block: lines with tabs or right-aligned dollar amounts
    if (isTabular(line)) {
      const preLines = [];
      while (i < lines.length) {
        if (isBreak(i)) break;
        const cur = lines[i];
        if (isTabular(cur) || (/^\s{4,}/.test(cur) && cur.trim())) {
          preLines.push(escapeHtml(cur));
          i++;
        } else if (!cur.trim() && i + 1 < lines.length && isTabular(lines[i + 1])) {
          preLines.push('');
          i++;
        } else break;
      }
      out.push(`<pre class="utxt-pre">${preLines.join('\n')}</pre>`);
      continue;
    }

    // Normal text — join contiguous non-blank lines into a paragraph
    const paraLines = [trimmed];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (isBreak(i)) break;
      if (isTabular(lines[i])) break;
      paraLines.push(t);
      i++;
    }
    const joined = paraLines.join(' ');
    out.push(`<p class="utxt-para">${formatInline(escapeHtml(joined))}</p>`);
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

// ── EPUB Reader (epub.js) ────────────────────────────────────
// Uses epub.js + JSZip to render EPUB files with:
//   - Scrolled continuous view (not paginated)
//   - Dark theme via CSS injection
//   - TOC from EPUB metadata
//   - Search support

// ── Custom EPUB Renderer ──────────────────────────────────────
// Replaces epub.js entirely. Uses JSZip (already loaded) to parse
// EPUBs and renders chapter HTML into a controlled iframe.
// Why: epub.js sets internal .epub-view containers to height:0 +
// overflow:hidden, making content invisible. This implementation
// owns the entire pipeline — no third-party rendering bugs.

let _currentEpubBook = null;   // kept for compatibility checks elsewhere
let _currentEpubRendition = null;
let _epubState = null;
let _epubFontPct = 105;

function renderEpubReader(item) {
  if (_epubState && _epubState.blobUrls) {
    _epubState.blobUrls.forEach(url => URL.revokeObjectURL(url));
  }
  _epubState = null;
  _currentEpubBook = null;
  _currentEpubRendition = null;

  libMain.innerHTML = `
    <div class="utxt-layout utxt-has-toc">
      <div class="utxt-toc-panel">
        <div class="utxt-toc-label">CONTENTS</div>
        <div class="utxt-toc-list" id="epubTocList">
          <div class="utxt-toc-item" style="opacity:0.5">Loading...</div>
        </div>
      </div>
      <div class="utxt-content-wrap">
        <div class="lib-reader-header">
          <div class="lib-reader-title">${escapeHtml(item.name)}</div>
          <div class="epub-controls">
            <button class="lib-search-btn" onclick="epubFontSize(-1)" title="Decrease font">A−</button>
            <button class="lib-search-btn" onclick="epubFontSize(1)" title="Increase font">A+</button>
          </div>
        </div>
        <div id="epubViewerArea" class="epub-viewer-area">
          <div style="padding:32px;text-align:center;opacity:0.5">Loading book...</div>
        </div>
      </div>
    </div>`;

  _loadEpub('/' + item.file).catch(err => {
    console.error('EPUB load error:', err);
    const v = document.getElementById('epubViewerArea');
    if (v) v.innerHTML = `<div class="lib-zim-panel"><div style="font-size:40px"></div>
      <div class="lib-zim-title">Error Loading Book</div>
      <div class="lib-zim-desc">${escapeHtml(String(err.message || err))}</div></div>`;
  });
}

async function _loadEpub(fileUrl) {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error('File not found: ' + fileUrl);
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());

  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const rootPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const basePath = rootPath.includes('/') ? rootPath.substring(0, rootPath.lastIndexOf('/')) : '';

  const opfXml = await zip.file(rootPath).async('string');
  const opf = new DOMParser().parseFromString(opfXml, 'application/xml');

  const manifest = {};
  opf.querySelectorAll('manifest item').forEach(el => {
    manifest[el.getAttribute('id')] = {
      href: el.getAttribute('href'),
      type: el.getAttribute('media-type')
    };
  });

  const spine = [];
  opf.querySelectorAll('spine itemref').forEach(ref => {
    const m = manifest[ref.getAttribute('idref')];
    if (m) spine.push(m.href);
  });

  const ncxEntry = Object.values(manifest).find(m => m.type === 'application/x-dtbncx+xml');
  let toc = [];
  if (ncxEntry) {
    const ncxPath = basePath ? basePath + '/' + ncxEntry.href : ncxEntry.href;
    const ncxXml = await zip.file(ncxPath).async('string');
    const ncx = new DOMParser().parseFromString(ncxXml, 'application/xml');
    toc = _parseNavMap(ncx.querySelector('navMap'));
  }

  const blobUrls = [];
  const images = {};
  for (const m of Object.values(manifest)) {
    if (m.type && m.type.startsWith('image/')) {
      const path = basePath ? basePath + '/' + m.href : m.href;
      const f = zip.file(path);
      if (f) {
        const url = URL.createObjectURL(await f.async('blob'));
        images[m.href] = url;
        blobUrls.push(url);
      }
    }
  }

  const styles = {};
  for (const m of Object.values(manifest)) {
    if (m.type === 'text/css') {
      const path = basePath ? basePath + '/' + m.href : m.href;
      const f = zip.file(path);
      if (f) styles[m.href] = await f.async('string');
    }
  }

  _epubState = { zip, basePath, manifest, spine, toc, images, styles, blobUrls };
  _buildEpubToc(toc);

  const firstHref = toc.length > 0 ? toc[0].href : spine[0];
  if (firstHref) _epubNavigate(firstHref);
}

function _parseNavMap(navMap) {
  if (!navMap) return [];
  const items = [];
  for (const np of navMap.children) {
    if (np.tagName !== 'navPoint') continue;
    const label = np.querySelector('navLabel text')?.textContent?.trim();
    const src = np.querySelector('content')?.getAttribute('src');
    if (label && src) items.push({ label, href: src, children: _parseNavMap(np) });
  }
  return items;
}

function _buildEpubToc(toc) {
  const tocList = document.getElementById('epubTocList');
  if (!tocList) return;
  const SKIP = /project\s+gutenberg|gutenberg\s+license|transcriber|full\s+project/i;

  function html(items, depth) {
    return items.filter(i => i.label && !SKIP.test(i.label)).map((item, idx) => {
      const active = depth === 0 && idx === 0 ? ' active' : '';
      const pad = 8 + depth * 12;
      let h = `<div class="utxt-toc-item${active}" data-href="${escapeHtml(item.href)}" style="padding-left:${pad}px">${escapeHtml(item.label)}</div>`;
      if (item.children?.length) h += html(item.children, depth + 1);
      return h;
    }).join('');
  }

  tocList.innerHTML = toc.length ? html(toc, 0) : '<div class="utxt-toc-item" style="opacity:0.5">No chapters</div>';
  tocList.addEventListener('click', e => {
    const ti = e.target.closest('.utxt-toc-item');
    if (!ti?.dataset.href) return;
    tocList.querySelectorAll('.utxt-toc-item').forEach(x => x.classList.remove('active'));
    ti.classList.add('active');
    _epubNavigate(ti.dataset.href);
  });
}

async function _epubNavigate(href) {
  if (!_epubState) return;
  const [filePart, fragment] = href.split('#');
  const fullPath = _epubState.basePath ? _epubState.basePath + '/' + filePart : filePart;
  const viewerEl = document.getElementById('epubViewerArea');
  if (!viewerEl) return;

  // ── Helper: walk offsetParent chain for true document offset ──
  function _getDocOffset(el) {
    let top = 0;
    let node = el;
    while (node) {
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return top;
  }

  // ── Helper: scroll to a fragment ID in the current iframe ──
  function _scrollToFrag(frag, doc) {
    if (!frag) { viewerEl.scrollTop = 0; return; }
    const t = doc.getElementById(frag) ||
              doc.querySelector(`[name="${frag}"]`);
    if (t) {
      viewerEl.scrollTop = _getDocOffset(t) - 20;
    }
  }

  // Same file already loaded? Just scroll to the fragment — don't reload.
  if (_epubState._currentFile === fullPath) {
    const iframe = viewerEl.querySelector('iframe');
    if (iframe?.contentDocument) {
      _scrollToFrag(fragment, iframe.contentDocument);
    }
    return;
  }

  let file = _epubState.zip.file(fullPath);
  if (!file) {
    // Try without basePath (some TOC hrefs are already absolute within the zip)
    file = _epubState.zip.file(filePart);
  }
  if (!file) {
    // Try case-insensitive search as a last resort
    const allFiles = Object.keys(_epubState.zip.files);
    const match = allFiles.find(f => f.toLowerCase() === fullPath.toLowerCase() ||
                                     f.toLowerCase() === filePart.toLowerCase());
    if (match) file = _epubState.zip.file(match);
  }
  if (!file) { console.warn('[EPUB] Not found:', fullPath); return; }

  let rawHtml = await file.async('string');
  _epubState._currentFile = fullPath; // track for same-file shortcut

  // Resolve image src to blob URLs
  for (const [imgHref, blobUrl] of Object.entries(_epubState.images)) {
    const esc = imgHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rawHtml = rawHtml.replace(new RegExp(`(src|href)=["']([^"']*?${esc})["']`, 'gi'), `$1="${blobUrl}"`);
  }

  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : rawHtml;

  // ── DOM-based Gutenberg boilerplate removal ──────────────────
  // Uses real DOM parsing instead of regex to properly handle nested divs.
  // Regex failed because <div class="pg-boilerplate"> contains inner <div>s,
  // and non-greedy [\s\S]*? matched the first </div> (inner), leaving the rest.
  {
    const _stripDOM = document.createElement('div');
    _stripDOM.innerHTML = body;

    // Remove by ID — Gutenberg generator inserts these predictable IDs
    ['pg-header', 'pg-footer', 'pg-machine-header', 'pg-start-separator',
     'pg-end-separator', 'pg-header-heading', 'pg-header-authlist',
     'title_page_publisher'].forEach(id => {
      const el = _stripDOM.querySelector('#' + id);
      if (el) el.remove();
    });

    // Remove by class — catches any remaining boilerplate wrappers
    _stripDOM.querySelectorAll(
      '.pg-boilerplate, .pgheader, .pgfooter, .pgmonospaced'
    ).forEach(el => el.remove());

    // Remove elements containing "*** START/END OF PROJECT GUTENBERG ***"
    _stripDOM.querySelectorAll('span, div, p, h2, section').forEach(el => {
      if (/\*{3}\s*(START|END)\s+OF\s+(THE\s+)?PROJECT\s+GUTENBERG/i.test(el.textContent)) {
        el.remove();
      }
    });

    // Remove "This eBook is for the use of anyone..." license paragraphs
    _stripDOM.querySelectorAll('div, p').forEach(el => {
      const txt = el.textContent.trim();
      if (txt.startsWith('This eBook is for the use of anyone') ||
          txt.startsWith('Produced by') && txt.length < 300 ||
          txt.startsWith('Most recently updated:')) {
        el.remove();
      }
    });

    const strippedBody = _stripDOM.innerHTML;
    // If stripping removed ALL visible content, keep the original body.
    // This prevents cover/title pages from rendering blank.
    const hasContent = _stripDOM.textContent.trim().length > 20;
    body = hasContent ? strippedBody : body;
  }

  // Strip ALL inline style attributes — our master CSS handles everything
  body = body.replace(/\s+style\s*=\s*"[^"]*"/gi, '');
  body = body.replace(/\s+style\s*=\s*'[^']*'/gi, '');

  // Strip class attributes that reference EPUB-specific styling
  body = body.replace(/\s+class\s*=\s*"[^"]*"/gi, '');
  body = body.replace(/\s+class\s*=\s*'[^']*'/gi, '');

  // Unwrap <pre> blocks to <div> so text reflows to full width
  body = body.replace(/<pre([^>]*)>/gi, '<div$1>');
  body = body.replace(/<\/pre>/gi, '</div>');

  // Collapse hard line breaks inside paragraphs (70-col Gutenberg formatting)
  body = body.replace(/([^\n>])\n(?=\S)/g, '$1 ');

  // We intentionally DO NOT include the EPUB's own CSS (pgepub.css, 0.css, etc.)
  // Those stylesheets set max-width: 40em on <p>, monospace fonts, centered margins,
  // and other ebook-reader rules that break our dark-theme viewer layout.
  // Our darkCSS below handles everything we need.

  const darkCSS = `
    /* === Blackout Drive EPUB Viewer — Master Stylesheet === */
    /* This is the ONLY stylesheet applied. EPUB source CSS is excluded. */

    * { box-sizing: border-box; }

    html, body {
      color: #d4c9a8 !important;
      background: transparent !important;
      font-family: Georgia, "Times New Roman", serif !important;
      font-size: ${_epubFontPct}% !important;
      line-height: 1.8 !important;
      padding: 0 24px !important;
      margin: 0 !important;
      overflow: hidden !important;
      text-align: left !important;
      max-width: 100% !important;
      width: auto !important;
    }

    /* Headings */
    h1, h2, h3, h4, h5, h6 {
      color: #c8a84e !important;
      text-align: center !important;
      max-width: 100% !important;
      width: auto !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    /* Body text */
    p, div, span, li, dd, dt, td, th, blockquote, figcaption, label, summary {
      color: #d4c9a8 !important;
      max-width: 100% !important;
      width: auto !important;
      font-family: inherit !important;
    }

    /* Links */
    a { color: #c8a84e !important; }

    /* Code / pre — render as normal prose, not monospace blocks */
    pre, code {
      color: #d4c9a8 !important;
      background: transparent !important;
      font-family: Georgia, "Times New Roman", serif !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      max-width: 100% !important;
      width: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Lists */
    ol, ul {
      max-width: 100% !important;
      width: auto !important;
      padding-left: 2em !important;
      color: #d4c9a8 !important;
    }

    /* Tables */
    table {
      max-width: 100% !important;
      width: auto !important;
      border-collapse: collapse !important;
    }
    td, th {
      border-color: rgba(200,168,78,0.3) !important;
      padding: 4px 8px !important;
    }

    /* Images */
    img {
      max-width: 100% !important;
      max-height: 70vh;
      height: auto !important;
      display: block !important;
      margin: 12px auto !important;
      opacity: 0.85;
      float: none !important;
      position: static !important;
    }

    /* Nuclear layout reset — kill ALL float/position/fixed-width from source */
    div, section, aside, figure, figcaption, article, main, nav,
    header, footer, p, span, blockquote, pre, ol, ul, li,
    table, tbody, thead, tr, form, fieldset, details {
      float: none !important;
      clear: both !important;
      position: static !important;
      max-width: 100% !important;
      width: auto !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    /* Horizontal rules */
    hr {
      border: none;
      border-top: 1px solid rgba(200,168,78,0.3);
      margin: 1.5em 0;
      width: 100% !important;
    }

    /* TOC / navigation boxes */
    .toc, .contents, [class*="toc"] {
      max-width: 100% !important;
      border-color: rgba(200,168,78,0.3) !important;
    }
  `;

  // viewerEl already declared above

  let iframe = viewerEl.querySelector('iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;border:none;background:transparent;display:block';
    viewerEl.innerHTML = '';
    viewerEl.appendChild(iframe);
  }

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>${darkCSS}</style></head><body>${body}</body></html>`);
  doc.close();

  // Forward wheel events from iframe to parent so scroll direction changes respond immediately
  doc.addEventListener('wheel', e => {
    viewerEl.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'instant' });
  }, { passive: true });

  // ── Resize iframe to full content height, then scroll to fragment ──
  // Uses progressive retry to ensure layout is stable before scrolling.
  // CRITICAL: preserve user scroll position across resizes to prevent flicker.
  let _lastIframeH = 0;
  const resize = () => {
    const newH = doc.documentElement.scrollHeight;
    if (newH !== _lastIframeH) {
      const savedScroll = viewerEl.scrollTop;
      iframe.style.height = newH + 'px';
      _lastIframeH = newH;
      // Restore scroll position after browser reflow
      if (savedScroll > 0) viewerEl.scrollTop = savedScroll;
    }
  };
  doc.querySelectorAll('img').forEach(img => img.addEventListener('load', resize));

  // Progressive resize + scroll: resize first, THEN scroll to fragment
  let _resizeAttempts = 0;
  let _userHasScrolled = false;
  viewerEl.addEventListener('scroll', () => { _userHasScrolled = true; }, { once: true });
  const _resizeAndScroll = () => {
    resize();
    _resizeAttempts++;
    if (_resizeAttempts < 5) {
      setTimeout(_resizeAndScroll, _resizeAttempts * 200);
    }
    // Only scroll to fragment if user hasn't manually scrolled yet
    if (fragment && !_userHasScrolled) {
      _scrollToFrag(fragment, doc);
    }
  };
  requestAnimationFrame(_resizeAndScroll);

  // If no fragment, scroll to top once — then never override user scroll
  if (!fragment) {
    viewerEl.scrollTop = 0;
  }

  doc.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const lh = a.getAttribute('href');
    if (!lh || lh.startsWith('http') || lh.startsWith('mailto:')) return;
    e.preventDefault();
    if (lh.startsWith('#')) {
      _scrollToFrag(lh.slice(1), doc);
      return;
    }
    _epubNavigate(lh);
    const tocList = document.getElementById('epubTocList');
    if (tocList) {
      const base = lh.split('#')[0];
      tocList.querySelectorAll('.utxt-toc-item').forEach(ti => {
        ti.classList.remove('active');
        if (ti.dataset.href?.split('#')[0]?.includes(base)) ti.classList.add('active');
      });
    }
  }, true);
}

function epubFontSize(delta) {
  _epubFontPct = Math.max(80, Math.min(200, _epubFontPct + delta * 10));
  const viewerEl = document.getElementById('epubViewerArea');
  if (viewerEl) {
    const iframe = viewerEl.querySelector('iframe');
    if (iframe && iframe.contentDocument) {
      let styleTag = iframe.contentDocument.getElementById('dynamic-font-size');
      if (!styleTag) {
        styleTag = iframe.contentDocument.createElement('style');
        styleTag.id = 'dynamic-font-size';
        iframe.contentDocument.head.appendChild(styleTag);
      }
      styleTag.textContent = `html, body { font-size: ${_epubFontPct}% !important; }`;
    }
  }
}

// P0-1 FIX: Cache original reader HTML to prevent search from destroying content.
let _readerOriginalHtml = null;

function doLibSearch() {
  const input = document.getElementById('libSearchInput');
  const content = document.getElementById('libReaderContent');
  const countEl = document.getElementById('libSearchCount');
  if (!input || !content) return;

  // Cache original HTML on first search so we can always restore
  if (_readerOriginalHtml === null) {
    _readerOriginalHtml = content.innerHTML;
  }

  const query = input.value.trim();
  if (!query) {
    // Restore original formatted HTML — NOT textContent
    content.innerHTML = _readerOriginalHtml;
    libSearchMatches = []; libSearchIdx = 0;
    if (countEl) countEl.textContent = '';
    return;
  }

  // Restore clean HTML first, then apply highlights
  content.innerHTML = _readerOriginalHtml;

  // Walk text nodes to inject <mark> without destroying HTML structure
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  _highlightTextNodes(content, regex);

  libSearchMatches = content.querySelectorAll('mark');
  libSearchIdx = 0;
  if (libSearchMatches.length > 0) {
    libSearchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (countEl) countEl.textContent = `1 / ${libSearchMatches.length}`;
  } else {
    if (countEl) countEl.textContent = 'Not found';
  }
}

/** Walk all text nodes under `root` and wrap regex matches in <mark> tags. */
function _highlightTextNodes(root, regex) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const text = node.nodeValue;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0; // reset after .test()

    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Text before match
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }
      // Highlighted match
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIdx = regex.lastIndex;
    }
    // Remaining text after last match
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
    node.parentNode.replaceChild(frag, node);
  }
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
  libMain.innerHTML = `<div class="lib-zim-panel"><div style="font-size:40px"></div><div class="lib-zim-title">${item.name.toUpperCase()}</div><div class="lib-zim-desc">This is a large offline knowledge pack (Wikipedia, etc.).<br>It requires additional setup and is available on the Pro Edition drive.</div></div>`;
}
function showMissingPanel(item) {
  libMain.innerHTML = `<div class="lib-missing-panel">
    <div class="lib-missing-title">FILE NOT DOWNLOADED</div>
    <div class="lib-missing-desc">${escapeHtml(item.name)}<br>This file is in the catalog but hasn't been downloaded to your drive yet.</div>
    <button class="lib-empty-cta" onclick="showGetMorePanel()" style="margin-top:16px">⬇ GET MORE CONTENT</button>
    <div class="lib-missing-sub" style="margin-top:12px;opacity:0.5;font-size:11px">Internet required for download.</div>
  </div>`;
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
      if (statusEl) statusEl.textContent = `Not enough space for ${file.name}. Use MANAGE SPACE to free up room.`;
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
      if (btn) { btn.textContent = '✓'; btn.style.color = 'var(--status-ok)'; btn.disabled = true; }
    } else if (status.error && status.error !== 'cancelled') {
      clearInterval(poll);
      if (btn) { btn.disabled = false; btn.textContent = '⬇'; }
    }
  }, 800);
}

// ── MY UPLOADS tab state ────────────────────────────────────
let _libMyFilesTab = 'unlocked'; // 'unlocked' | 'locked'
let _libMyFilesPath = '';         // current subfolder path

async function showMyFilesPanel(tab) {
  if (tab && tab !== _libMyFilesTab) {
    _libMyFilesTab = tab;
    _libMyFilesPath = ''; // reset when switching tabs
  }
  libActiveCat = '__myfiles'; libMode = 'files';
  highlightSidebar('__myfiles'); updateLibHeader();
  _saveLibState();

  libMain.innerHTML = '<div class="lib-loading"><span>Scanning your files...</span></div>';

  // Fetch files for the active tab + path
  const endpoint = _libMyFilesTab === 'unlocked' ? '/api/files/unlocked' : '/api/files/locked';
  const fullUrl = `${endpoint}?path=${encodeURIComponent(_libMyFilesPath)}`;
  let files = [];
  try {
    const res = await fetch(fullUrl);
    if (res.ok) {
      const data = await res.json();
      files = data.files || [];
    }
  } catch (_) {}

  // ── Build breadcrumb trail ──
  const pathParts = _libMyFilesPath ? _libMyFilesPath.split('/').filter(Boolean) : [];
  let breadcrumbHtml = `<span class="hub-breadcrumb-link" onclick="_libMyFilesPath='';showMyFilesPanel()">HUB</span>`;
  let buildPath = '';
  pathParts.forEach((part, i) => {
    buildPath += (buildPath ? '/' : '') + part;
    breadcrumbHtml += ` <span class="hub-breadcrumb-sep">/</span> `;
    if (i === pathParts.length - 1) {
      breadcrumbHtml += `<span class="hub-breadcrumb-current">${escapeHtml(part)}</span>`;
    } else {
      const p = buildPath;
      breadcrumbHtml += `<span class="hub-breadcrumb-link" onclick="_libMyFilesPath='${p}';showMyFilesPanel()">${escapeHtml(part)}</span>`;
    }
  });

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'lib-cat-header';
  header.innerHTML = `
    <div class="lib-cat-title hub-header-row">
      <div class="hub-breadcrumbs">${breadcrumbHtml}</div>
      <div class="hub-header-actions">
        <button onclick="_showUploadModal()" class="hub-action-btn hub-upload-btn" title="Upload files or folders">+ UPLOAD</button>
        <button onclick="showMyFilesPanel()" class="hub-action-btn hub-refresh-btn" title="Refresh">↻</button>
      </div>
    </div>
    <div class="lib-cat-desc">Upload files or folders. View code with syntax highlighting.</div>`;

  // ── Unlocked / Locked tabs ──
  const tabBar = document.createElement('div');
  tabBar.className = 'ws-tabs';
  tabBar.innerHTML = `
    <button class="ws-tab ${_libMyFilesTab === 'unlocked' ? 'ws-tab--active' : ''}" onclick="showMyFilesPanel('unlocked')">UNLOCKED</button>
    <button class="ws-tab ${_libMyFilesTab === 'locked' ? 'ws-tab--active' : ''}" onclick="showMyFilesPanel('locked')">LOCKED 🔒</button>`;

  // ── Info box ──
  const info = document.createElement('div');
  info.className = 'myfiles-instructions';
  info.innerHTML = `
    <div class="myfiles-howto">
      <div class="myfiles-howto-steps">
        <p style="margin-top:0"><strong>Viewable:</strong> Text, Books, PDFs, Images, and Code (.js, .py, .go, .rs, .c, .java, .html, .css, .json, .yml, .sql, ...)</p>
        <p style="opacity:0.6;margin-top:4px">Any file type can be stored — unsupported formats are kept safe but can't be previewed.</p>
      </div>
    </div>`;

  libMain.innerHTML = '';
  libMain.appendChild(header);
  libMain.appendChild(tabBar);
  libMain.appendChild(info);

  // ── File list ──
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'myfiles-empty';
    empty.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;opacity:0.5">${_libMyFilesTab === 'locked' ? '🔒' : '📁'}</div>
      <div style="font-family:var(--font-mono);letter-spacing:1px;margin-bottom:8px">${_libMyFilesPath ? 'EMPTY FOLDER' : 'NO ' + _libMyFilesTab.toUpperCase() + ' FILES'}</div>
      <div style="opacity:0.5;font-size:0.9em;max-width:320px;margin:0 auto">Click <strong>+ UPLOAD</strong> to add files or folders.</div>`;
    libMain.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'myfiles-list';

    // ── "Up" item when inside a subfolder ──
    if (_libMyFilesPath) {
      const upItem = document.createElement('div');
      upItem.className = 'myfile-item myfile-item--up';
      upItem.innerHTML = `
        <span class="myfile-icon" style="font-size:20px;opacity:0.5">⬆️</span>
        <div class="myfile-info"><div class="myfile-name" style="opacity:0.6">.. (Up)</div></div>`;
      upItem.addEventListener('click', () => {
        const parts = _libMyFilesPath.split('/');
        parts.pop();
        _libMyFilesPath = parts.join('/');
        showMyFilesPanel();
      });
      list.appendChild(upItem);
    }

    files.forEach(f => {
      const name = f.name;
      const fullPath = _libMyFilesPath ? _libMyFilesPath + '/' + name : name;
      const isDir = f.type === 'directory';
      const sizeStr = !isDir && f.size ? _fmtBytes(f.size) : '';
      const dateStr = f.modified ? new Date(f.modified).toLocaleDateString() : '';
      const icon = _libMyFilesTab === 'locked' ? '🔒' : (isDir ? '📁' : _myUploadFileIcon(name));
      const canView = isDir ? false : (_libMyFilesTab === 'unlocked' ? _canViewInApp(name) : true);

      const item = document.createElement('div');
      item.className = 'myfile-item' + (isDir ? ' myfile-item--dir' : '');

      item.innerHTML = `
        <span class="myfile-icon" style="font-size:20px">${icon}</span>
        <div class="myfile-info">
          <div class="myfile-name" style="${isDir ? 'font-weight:bold;color:var(--text-bright)' : ''}">${escapeHtml(name)}</div>
          <div class="myfile-meta">${isDir ? 'Folder' : sizeStr}${!isDir && dateStr ? ' · ' + dateStr : ''}</div>
        </div>
        <div class="myfile-actions">
          ${isDir ? '<button class="myfile-open-btn" data-action="enter">ENTER →</button>' : ''}
          ${canView ? `<button class="myfile-open-btn" data-action="view" title="${_libMyFilesTab === 'locked' ? 'Decrypt & View' : 'View'}">${_libMyFilesTab === 'locked' ? '🔓 OPEN' : 'OPEN'}</button>` : ''}
          <button class="myfile-open-btn myfile-delete-btn" data-action="delete" title="Delete">✕</button>
        </div>`;

      // ── Enter directory ──
      if (isDir) {
        const enterBtn = item.querySelector('[data-action="enter"]');
        if (enterBtn) enterBtn.addEventListener('click', (e) => { e.stopPropagation(); _libMyFilesPath = fullPath; showMyFilesPanel(); });
        item.addEventListener('dblclick', () => { _libMyFilesPath = fullPath; showMyFilesPanel(); });
      }

      // ── View/decrypt ──
      const viewBtn = item.querySelector('[data-action="view"]');
      if (viewBtn) {
        viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (_libMyFilesTab === 'locked') _decryptAndView(fullPath);
          else _viewUnlockedFile(fullPath);
        });
      }

      // ── Delete ──
      const delBtn = item.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _deleteMyUploadFile(fullPath);
        });
      }

      list.appendChild(item);
    });
    libMain.appendChild(list);
  }
}

// ── Helper: can this file type be viewed in-app? ──
function _canViewInApp(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const docExts = ['txt','md','epub','pdf','jpg','jpeg','png','gif','webp','svg'];
  const codeExts = ['js','ts','tsx','jsx','py','go','rs','c','cpp','h','hpp','java',
    'html','css','json','sh','bat','yml','yaml','xml','sql','rb','php','swift','kt',
    'cs','lua','r','scala','mdx','toml','ini','cfg','env'];
  return docExts.concat(codeExts).includes(ext);
}

// ── Helper: file icon for unlocked files ──
function _myUploadFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const codeExts = ['js','ts','tsx','jsx','py','go','rs','c','cpp','h','hpp','java',
    'html','css','json','sh','bat','yml','yaml','xml','sql','rb','php','swift','kt',
    'cs','lua','r','scala','mdx','toml','ini','cfg'];
  if (codeExts.includes(ext)) return '💻';
  const icons = {
    pdf: '📄', txt: '📝', md: '📝',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
    epub: '📚', doc: '📄', docx: '📄',
    mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬',
    zip: '📦', '7z': '📦', tar: '📦', gz: '📦',
  };
  return icons[ext] || '📎';
}

// ── Delete file or folder (from Library context) ──
async function _deleteMyUploadFile(filepath) {
  const displayName = filepath.split('/').pop();
  // Use themed modal (promise-based); fall back to native confirm if unavailable
  if (typeof _showThemedConfirm === 'function') {
    const ok = await _showThemedConfirm(`Delete "${displayName}"?`, 'This cannot be undone.');
    if (!ok) return;
  } else if (!confirm(`Delete "${displayName}"? This cannot be undone.`)) return;
  try {
    const endpoint = _libMyFilesTab === 'unlocked'
      ? '/api/files/unlocked/' + filepath.split('/').map(encodeURIComponent).join('/')
      : '/api/files/locked/' + filepath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(endpoint, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      showMyFilesPanel(); // refresh
      if (typeof showToast === 'function') showToast('Deleted', 2000);
    } else {
      if (typeof showToast === 'function') showToast('Could not delete', 3000);
    }
  } catch {
    if (typeof showToast === 'function') showToast('Delete failed', 3000);
  }
}

// ── Open Library directly to MY UPLOADS (called from sidebar) ──
function openLibraryMyUploads() {
  openLibrary();
  // Small delay to let Library mount, then navigate to MY UPLOADS
  setTimeout(() => showMyFilesPanel(), 50);
}

function openUserFile(filePath, fileType, fileName) {
  const ext = filePath.split('.').pop().toLowerCase();
  const type = fileType || (ext === 'pdf' ? 'pdf' : ext === 'epub' ? 'epub' : ext === 'txt' ? 'text' : 'file');
  const name = fileName || filePath.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

  if (type === 'epub') {
    // Use the existing in-app EPUB renderer
    const item = { type: 'epub', file: filePath, name: name, always_available: true };
    libActiveItem = item;
    libMode = 'reader';
    updateLibHeader();
    libMain.innerHTML = '<div class="lib-loading"><span>Loading book...</span></div>';
    renderEpubReader(item);
    _saveLibState();
    return;
  }

  if (type === 'pdf') {
    // Use the existing in-app PDF iframe viewer
    libMode = 'reader';
    updateLibHeader();
    const pdfUrl = '/' + filePath;
    libMain.innerHTML = `<div class="utxt-layout">
      <div class="utxt-content-wrap" style="padding:0;height:100%">
        <div class="lib-reader-header" style="padding:12px 16px">
          <div class="lib-reader-title">${escapeHtml(name)}</div>
          <div style="display:flex;gap:8px">
            <a href="${pdfUrl}" target="_blank" class="lib-search-btn" style="text-decoration:none">Open in New Tab ↗</a>
            <a href="${pdfUrl}" download class="lib-search-btn" style="text-decoration:none">⬇ Download</a>
          </div>
        </div>
        <iframe src="${pdfUrl}" style="width:100%;height:calc(100% - 56px);border:none;background:#2a2a2a"></iframe>
      </div>
    </div>`;
    _saveLibState();
    return;
  }

  if (type === 'image') {
    // In-app image viewer with zoom + pan
    libMode = 'reader';
    updateLibHeader();
    const imgUrl = '/' + filePath;
    libMain.innerHTML = `
      <div class="imgviewer-wrap">
        <div class="imgviewer-toolbar">
          <button class="lib-back-btn" onclick="closeLibrary()">← BACK</button>
          <div class="imgviewer-title">${escapeHtml(name)}</div>
          <div class="imgviewer-controls">
            <button class="imgviewer-btn" onclick="_imgViewerFit()" title="Fit to screen">⊡ Fit</button>
            <button class="imgviewer-btn" onclick="_imgViewerZoom(1.25)" title="Zoom in">＋</button>
            <button class="imgviewer-btn" onclick="_imgViewerZoom(0.8)" title="Zoom out">−</button>
            <button class="imgviewer-btn" onclick="_imgViewerZoom(1, true)" title="Actual size">1:1</button>
            <a href="${imgUrl}" download class="imgviewer-btn" style="text-decoration:none" title="Download">⬇</a>
          </div>
        </div>
        <div class="imgviewer-stage" id="imgViewerStage">
          <img src="${imgUrl}" id="imgViewerImg" class="imgviewer-img" alt="${escapeHtml(name)}" draggable="false" onload="_imgViewerFit()">
        </div>
      </div>`;
    _initImgViewerDrag();
    _saveLibState();
    return;
  }

  if (type === 'text' || ext === 'txt') {
    openInlineReader(filePath);
    return;
  }

  if (type === 'code') {
    openMonacoEditor(filePath, ext, name);
    return;
  }

  // Fallback: try OS open for unknown types
  fetch(`/api/open-file?path=${encodeURIComponent(filePath)}`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) showToast('Opening file...');
      else showToast('⚠ Could not open: ' + (data.error || 'unknown'));
    })
    .catch(() => showToast('⚠ Could not open file'));
}

// ── Image Viewer helpers ──────────────────────────────────────
let _imgScale = 1, _imgTransX = 0, _imgTransY = 0;

function _imgViewerFit() {
  const img = document.getElementById('imgViewerImg');
  const stage = document.getElementById('imgViewerStage');
  if (!img || !stage) return;
  const sw = stage.clientWidth - 48, sh = stage.clientHeight - 48;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return;
  _imgScale = Math.min(sw / nw, sh / nh, 1);
  _imgTransX = 0; _imgTransY = 0;
  _imgViewerApply();
}

function _imgViewerZoom(factor, reset) {
  if (reset) { _imgScale = 1; _imgTransX = 0; _imgTransY = 0; }
  else { _imgScale = Math.max(0.1, Math.min(10, _imgScale * factor)); }
  _imgViewerApply();
}

function _imgViewerApply() {
  const img = document.getElementById('imgViewerImg');
  if (!img) return;
  img.style.transform = `translate(${_imgTransX}px, ${_imgTransY}px) scale(${_imgScale})`;
}

function _initImgViewerDrag() {
  _imgScale = 1; _imgTransX = 0; _imgTransY = 0;
  const stage = document.getElementById('imgViewerStage');
  if (!stage) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  stage.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    ox = _imgTransX; oy = _imgTransY;
    stage.style.cursor = 'grabbing';
  });
  stage.addEventListener('mousemove', e => {
    if (!dragging) return;
    _imgTransX = ox + (e.clientX - sx);
    _imgTransY = oy + (e.clientY - sy);
    _imgViewerApply();
  });
  stage.addEventListener('mouseup', () => { dragging = false; stage.style.cursor = 'grab'; });
  stage.addEventListener('mouseleave', () => { dragging = false; stage.style.cursor = 'grab'; });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    _imgViewerZoom(e.deltaY < 0 ? 1.1 : 0.9);
  }, { passive: false });
}

async function openInlineReader(filePath) {
  try {
    const res = await fetch('/' + filePath);
    if (!res.ok) { showToast('⚠ File not found'); return; }
    const text = await res.text();
    const fname = filePath.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
    libMain.innerHTML = `
      <div class="lib-cat-header">
        <button class="lib-back-btn" onclick="showMyFilesPanel()">← BACK</button>
        <div class="lib-cat-title">${fname}</div>
      </div>
      <div class="bible-reader" style="padding:24px;max-width:800px;margin:0 auto">
        <pre style="white-space:pre-wrap;font-family:var(--font-body);line-height:1.8;color:var(--text-primary);font-size:15px">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
      </div>`;
  } catch (e) {
    showToast('⚠ Error reading file');
  }
}

// ── Monaco Code Editor ────────────────────────────────────────
// Maps file extensions to Monaco language IDs
const _monacoLangMap = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  java: 'java', html: 'html', css: 'css', json: 'json', sh: 'shell',
  bat: 'bat', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', cs: 'csharp',
  lua: 'lua', r: 'r', scala: 'scala', md: 'markdown', mdx: 'markdown',
  toml: 'ini', ini: 'ini', cfg: 'ini', env: 'shell',
  dockerfile: 'dockerfile', makefile: 'shell', command: 'shell',
};

let _monacoReady = false;
let _monacoEditorInstance = null;
let _monacoOriginalContent = '';
let _monacoCurrentFile = null; // { path, saveUrl, source: 'unlocked'|'system', category }
let _monacoHasChanges = false;

function _ensureMonaco() {
  return new Promise((resolve, reject) => {
    if (_monacoReady && window.monaco) { resolve(window.monaco); return; }

    // Configure worker paths BEFORE loading Monaco.
    // Monaco creates blob-workers that internally use importScripts() with paths
    // derived from MonacoEnvironment.baseUrl. Setting this to the absolute URL
    // ensures workers load from local files — critical for air-gapped mode.
    if (!window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        baseUrl: '/_system/ui/lib/monaco/',
        getWorkerUrl: function (_moduleId, _label) {
          return '/_system/ui/lib/monaco/vs/base/worker/workerMain.js';
        }
      };
    }

    if (typeof require !== 'undefined' && require.config) {
      require.config({ paths: { vs: 'lib/monaco/vs' } });
      require(['vs/editor/editor.main'], () => {
        _monacoReady = true;
        resolve(window.monaco);
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'lib/monaco/vs/loader.js';
    script.onload = () => {
      require.config({ paths: { vs: 'lib/monaco/vs' } });
      require(['vs/editor/editor.main'], () => {
        _monacoReady = true;
        resolve(window.monaco);
      });
    };
    script.onerror = () => reject(new Error('Failed to load Monaco'));
    document.head.appendChild(script);
  });
}

function _monacoUpdateDirtyState() {
  if (!_monacoEditorInstance) return;
  const current = _monacoEditorInstance.getValue();
  _monacoHasChanges = current !== _monacoOriginalContent;
  const dot = document.getElementById('monacoModifiedDot');
  const saveBtn = document.getElementById('monacoSaveBtn');
  if (dot) dot.style.display = _monacoHasChanges ? 'inline-block' : 'none';
  if (saveBtn) {
    saveBtn.classList.toggle('monaco-save-btn--disabled', !_monacoHasChanges);
    saveBtn.textContent = _monacoHasChanges ? '💾 SAVE' : '✓ SAVED';
  }
}

async function _monacoSave() {
  if (!_monacoEditorInstance || !_monacoCurrentFile || !_monacoHasChanges) return;
  const content = _monacoEditorInstance.getValue();
  const saveBtn = document.getElementById('monacoSaveBtn');
  if (saveBtn) { saveBtn.textContent = '⏳ SAVING...'; saveBtn.classList.add('monaco-save-btn--disabled'); }
  try {
    const res = await fetch(_monacoCurrentFile.saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
    const data = await res.json();
    if (data.ok) {
      _monacoOriginalContent = content;
      _monacoHasChanges = false;
      _monacoUpdateDirtyState();
      const extra = data.backup ? ` (backup: ${data.backup})` : '';
      showToast(`✓ Saved${extra}`);
    } else {
      showToast('⚠ Save failed: ' + (data.error || 'unknown'));
      if (saveBtn) { saveBtn.textContent = '💾 SAVE'; saveBtn.classList.remove('monaco-save-btn--disabled'); }
    }
  } catch (e) {
    showToast('⚠ Save failed: network error');
    if (saveBtn) { saveBtn.textContent = '💾 SAVE'; saveBtn.classList.remove('monaco-save-btn--disabled'); }
  }
}

// Intercept Ctrl+S / Cmd+S globally when Monaco is active
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && _monacoEditorInstance) {
    e.preventDefault();
    _monacoSave();
  }
});

async function openMonacoEditor(filePath, ext, displayName, opts = {}) {
  // opts: { source: 'unlocked'|'system', category: 'safe'|'core', backFn, fetchUrl, saveUrl }
  const source = opts.source || 'unlocked';
  const category = opts.category || 'safe';
  const backFn = opts.backFn || 'showMyFilesPanel()';
  const backLabel = opts.backLabel || '← BACK';
  const fetchUrl = opts.fetchUrl || ('/' + filePath);
  const saveUrl = opts.saveUrl || ('/api/files/unlocked/' + filePath);
  const lang = _monacoLangMap[ext] || 'plaintext';

  libMode = 'reader';
  updateLibHeader();

  // Category badge
  const catBadge = source === 'system'
    ? (category === 'core'
        ? '<div class="monaco-viewer-lang monaco-cat-core">CORE ⚠️</div>'
        : '<div class="monaco-viewer-lang monaco-cat-safe">SAFE</div>')
    : '';

  libMain.innerHTML = `
    <div class="monaco-viewer-wrap">
      <div class="monaco-viewer-toolbar">
        <button class="lib-back-btn" onclick="${backFn}">${backLabel}</button>
        <div class="monaco-viewer-title">${escapeHtml(displayName)}</div>
        <div class="monaco-viewer-lang">${lang.toUpperCase()}</div>
        ${catBadge}
        <span id="monacoModifiedDot" class="monaco-modified-dot" style="display:none">●</span>
        <div style="flex:1"></div>
        <button id="monacoSaveBtn" class="monaco-save-btn monaco-save-btn--disabled" onclick="_monacoSave()">✓ SAVED</button>
        <a href="${fetchUrl}" target="_blank" class="monaco-viewer-action">↗ New Tab</a>
        <a href="${fetchUrl}" download class="monaco-viewer-action">⬇ Download</a>
      </div>
      <div id="monacoEditorContainer" class="monaco-editor-container">
        <div class="lib-loading"><span>Loading editor...</span></div>
      </div>
    </div>`;

  _monacoCurrentFile = { path: filePath, saveUrl, source, category };

  try {
    let contentPromise;
    if (source === 'system') {
      // System files are fetched via JSON API
      contentPromise = fetch(fetchUrl).then(r => r.json()).then(d => d.content || '');
    } else {
      contentPromise = fetch(fetchUrl).then(r => {
        if (!r.ok) throw new Error('File not found');
        return r.text();
      });
    }

    const [content, monaco] = await Promise.all([
      contentPromise,
      _ensureMonaco(),
    ]);

    const container = document.getElementById('monacoEditorContainer');
    if (!container) return;
    container.innerHTML = '';

    // Define tactical theme (shared with workspace.js)
    _defineBlackoutTheme(monaco);

    _monacoOriginalContent = content;
    _monacoHasChanges = false;

    _monacoEditorInstance = monaco.editor.create(container, {
      value: content,
      language: lang,
      theme: 'blackout-tactical',
      readOnly: false,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      wordWrap: 'on',
      automaticLayout: true,
      padding: { top: 12 },
    });

    // Track changes
    _monacoEditorInstance.onDidChangeModelContent(() => _monacoUpdateDirtyState());

    // Add Ctrl+S binding inside Monaco too
    _monacoEditorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => _monacoSave()
    );

  } catch (err) {
    console.warn('Monaco load failed, falling back to basic viewer:', err);
    try {
      const res = await fetch(fetchUrl);
      const text = source === 'system' ? (await res.json()).content : await res.text();
      const container = document.getElementById('monacoEditorContainer');
      if (container) {
        container.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--font-mono);line-height:1.6;color:var(--text-primary);font-size:13px;padding:16px;margin:0">${(text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
      }
    } catch { showToast('⚠ Error reading file'); }
  }
}

// ── System Files Panel ────────────────────────────────────────

async function showSystemFilesPanel() {
  libActiveCat = '__sysfiles'; libMode = 'files';
  highlightSidebar('sysfiles'); updateLibHeader();
  _saveLibState();

  libMain.innerHTML = `
    <div class="lib-cat-header">
      <div class="hub-header-row">
        <div>
          <div class="lib-cat-title" style="margin-bottom:4px">SYSTEM FILES</div>
          <div style="font-size:12px;color:var(--text-secondary);font-family:var(--font-body)">
            Edit the drive's own code, themes, and configuration. Changes take effect on reload/restart.
          </div>
        </div>
      </div>
    </div>
    <div class="sysfiles-warning">
      ⚠ If you break something, run <strong>EMERGENCY_RESTORE</strong> from the drive root to reset to factory defaults. Your data is never touched.
    </div>
    <div class="myfiles-list" id="sysfilesList">
      <div class="lib-loading"><span>Loading system files...</span></div>
    </div>`;

  try {
    const res = await fetch('/api/system/files');
    const data = await res.json();
    const list = document.getElementById('sysfilesList');
    if (!list) return;

    if (!data.files || data.files.length === 0) {
      list.innerHTML = '<div class="myfiles-empty">No editable system files found.</div>';
      return;
    }

    // Group by category
    const safeFiles = data.files.filter(f => f.category === 'safe');
    const coreFiles = data.files.filter(f => f.category === 'core');

    let html = '';

    if (safeFiles.length) {
      html += '<div class="sysfiles-group-label">🎨 THEMES & CONFIG — safe to edit</div>';
      for (const f of safeFiles) {
        const ext = f.name.split('.').pop().toLowerCase();
        const size = f.size < 1024 ? f.size + ' B' : Math.round(f.size / 1024) + ' KB';
        html += `
          <div class="myfile-item myfile-item--sysfile" onclick="openSystemFile('${f.path}')">
            <div class="myfile-icon">🎨</div>
            <div class="myfile-info">
              <div class="myfile-name">${escapeHtml(f.name)}</div>
              <div class="myfile-meta">${size} · ${f.path}</div>
            </div>
            <div class="myfile-actions">
              <span class="sysfile-cat-badge sysfile-cat-safe">SAFE</span>
              <button class="myfile-open-btn" onclick="event.stopPropagation(); openSystemFile('${f.path}')">EDIT</button>
            </div>
          </div>`;
      }
    }

    if (coreFiles.length) {
      html += '<div class="sysfiles-group-label" style="margin-top:16px">⚙️ CORE ENGINE — edit with caution</div>';
      for (const f of coreFiles) {
        const size = f.size < 1024 ? f.size + ' B' : Math.round(f.size / 1024) + ' KB';
        html += `
          <div class="myfile-item myfile-item--sysfile myfile-item--core" onclick="openSystemFile('${f.path}')">
            <div class="myfile-icon">⚙️</div>
            <div class="myfile-info">
              <div class="myfile-name">${escapeHtml(f.name)}</div>
              <div class="myfile-meta">${size} · ${f.path}</div>
            </div>
            <div class="myfile-actions">
              <span class="sysfile-cat-badge sysfile-cat-core">CORE ⚠️</span>
              <button class="myfile-open-btn" onclick="event.stopPropagation(); openSystemFile('${f.path}')">EDIT</button>
            </div>
          </div>`;
      }
    }

    list.innerHTML = html;
  } catch (e) {
    const list = document.getElementById('sysfilesList');
    if (list) list.innerHTML = '<div class="myfiles-empty">⚠ Error loading system files</div>';
  }
}

async function openSystemFile(relPath) {
  const ext = relPath.split('.').pop().toLowerCase();
  const name = relPath.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

  // Determine category
  const safeSet = new Set([
    'ui/style.css', 'ui/index.html', 'ui/config.js', 'ui/prompts.js',
    'ui/help.js', 'ui/icons.js', 'config.json', 'content/prompts.json',
  ]);
  const category = safeSet.has(relPath) ? 'safe' : 'core';

  if (category === 'core') {
    const confirmed = await _showCoreWarningModal(relPath);
    if (!confirmed) return;
  }

  openMonacoEditor(relPath, ext, name, {
    source: 'system',
    category,
    backFn: 'showSystemFilesPanel()',
    backLabel: '← SYSTEM FILES',
    fetchUrl: '/api/system/files/' + relPath,
    saveUrl: '/api/system/files/' + relPath,
  });
}

function _showCoreWarningModal(filePath) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'core-warning-overlay';
    overlay.innerHTML = `
      <div class="core-warning-modal">
        <div class="core-warning-icon">⚠️</div>
        <div class="core-warning-title">SYSTEM FILE — PROCEED WITH CAUTION</div>
        <div class="core-warning-file">${escapeHtml(filePath)}</div>
        <div class="core-warning-body">
          <p>Editing this file can <strong>break the drive</strong>. Changes take effect on server restart.</p>
          <p>If the drive stops working, run <strong>EMERGENCY_RESTORE</strong> from the drive root to reset to factory defaults.</p>
          <p>An automatic backup of the current version will be created before any save.</p>
        </div>
        <div class="core-warning-actions">
          <button class="core-warning-cancel" id="coreWarnCancel">CANCEL</button>
          <button class="core-warning-proceed" id="coreWarnProceed">I UNDERSTAND — EDIT FILE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('core-warning-visible'));

    const close = (result) => {
      overlay.classList.remove('core-warning-visible');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    document.getElementById('coreWarnCancel').onclick = () => close(false);
    document.getElementById('coreWarnProceed').onclick = () => close(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

async function showGetMorePanel() {
  libActiveCat = '__getmore'; libMode = 'files';
  highlightSidebar('getmore'); updateLibHeader();
  _saveLibState();

  if (!DDAPI.isOnline()) {
    libMain.innerHTML = `<div class="lib-zim-panel">
      <div style="font-size:48px;margin-bottom:12px"></div>
      <div class="lib-zim-title">OFFLINE MODE</div>
      <div class="lib-zim-desc" style="max-width:420px;margin:0 auto">
        Downloading new content and checking for updates requires an internet connection.
        <br><br>
        <strong>To enable online access:</strong>
        <ol style="text-align:left;margin:12px auto;max-width:320px;line-height:1.8">
          <li>Close the library</li>
          <li>Disable <strong>BLACKOUT PROTOCOL</strong> via the header switch</li>
          <li>Open <strong>Settings</strong> and turn off <strong>Network Lock</strong></li>
          <li>Come back here to browse and download content</li>
        </ol>
        <span style="opacity:0.6;font-size:0.85em">Your privacy is protected — unlocking the network only connects to our content servers. No personal data is ever sent.</span>
      </div>
    </div>`;
    return;
  }

  libMain.innerHTML = '<div class="lib-loading"><span>Loading available packs...</span></div>';

  // Fetch remote catalog, fall back to local extended catalog
  let remoteCatalog = await DDAPI.fetchRemoteCatalog();
  if (!remoteCatalog) {
    try {
      const res = await fetch('/_system/content/catalog_extended.json');
      if (res.ok) remoteCatalog = await res.json();
    } catch {}
  }

  if (!remoteCatalog || !remoteCatalog.packs || !remoteCatalog.packs.length) {
    libMain.innerHTML = `<div class="lib-zim-panel"><div class="lib-zim-title">NO PACKS AVAILABLE</div><div class="lib-zim-desc">Could not load the pack catalog.<br>Check your internet connection or try again later.</div></div>`;
    return;
  }

  // Store for refreshAfterManifestChange to merge new categories into sidebar
  _lastWorkerCatalog = remoteCatalog;

  // Determine which files are already installed
  const installed = libManifest || new Set();

  const header = document.createElement('div');
  header.className = 'lib-cat-header';
  header.innerHTML = `<div class="lib-cat-title">⬇ GET MORE CONTENT</div><div class="lib-cat-desc">Internet connected. Download additional content packs to your drive.</div>`;

  const packList = document.createElement('div');
  packList.className = 'getmore-list';
  packList.id = 'getmoreList';

  // Normalize raw Worker catalog fields before rendering
  remoteCatalog.packs.forEach(pack => {
    // Derive missing fields from what Worker actually returns
    pack.files = (pack.files || []).map(f => ({
      ...f,
      // dest: where the file lives on disk after download
      // MUST include pack.id subfolder to match _normalizeWorkerCatalog paths
      dest: f.dest || ('content/books/' + pack.id + '/' + (f.filename || f.id + '.epub')),
      // size_mb: Worker returns size in bytes
      size_mb: f.size_mb != null ? f.size_mb : ((f.size || 0) / 1024 / 1024).toFixed(1)
    }));
    // pack.size_mb: sum of all file sizes
    if (!pack.size_mb) {
      const totalBytes = pack.files.reduce((sum, f) => sum + (parseFloat(f.size) || 0), 0);
      pack.size_mb = (totalBytes / 1024 / 1024).toFixed(1);
    }
    // pack.icon: use emoji map if missing
    if (!pack.icon) pack.icon = _packIcon(pack.id);
  });

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
          : (f.url && !isLocked ? `<button class="pack-file-dl-btn" onclick="downloadPackFile(${JSON.stringify(pack).replace(/"/g,'&quot;')}, ${JSON.stringify(f).replace(/"/g,'&quot;')})" title="Download this file only">⬇</button>` : (!f.url ? `<span class="pack-file-size" style="opacity:0.5">preloaded</span>` : `<span class="pack-file-locked"></span>`))}
      </div>`;
    }).join('');

    // Price badge
    const priceBadge = isPaid
      ? `<span class="pack-price-badge">${hasLicense ? 'UNLOCKED' : '$' + pack.price.toFixed(2)}</span>`
      : `<span class="pack-price-badge free">FREE</span>`;

    // Primary CTA
    let primaryCTA = '';
    if (allInstalled) {
      primaryCTA = `<div class="pack-installed">✓ INSTALLED</div>`;
    } else if (isLocked) {
      primaryCTA = `<div class="pack-cta-stack">
          <a class="pack-dl-btn pack-purchase-btn" href="${pack.purchase_url || '#'}" target="_blank" rel="noopener"> PURCHASE — &#36;${pack.price.toFixed(2)}</a>
          <button class="pack-unlock-btn" onclick="showLicenseInput('${pack.id}')">HAVE A KEY</button>
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

// Disable/enable all DOWNLOAD PACK buttons to prevent concurrent downloads
function _setAllPackButtonsDisabled(disabled, exceptPackId) {
  document.querySelectorAll('.pack-dl-btn').forEach(btn => {
    // Don't touch the active pack's cancel button
    const card = btn.closest('.pack-card');
    if (card && card.id === `pack-${exceptPackId}`) return;
    btn.disabled = disabled;
    if (disabled) {
      btn.title = 'Wait for current download to finish';
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    } else {
      btn.title = '';
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  });
  // Also disable per-file download buttons
  document.querySelectorAll('.pack-file-dl-btn').forEach(btn => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.4' : '';
    btn.style.pointerEvents = disabled ? 'none' : '';
  });
}

async function startPackDownload(pack) {
  // Guard: only one pack download at a time to prevent race conditions
  if (_downloadBusy) {
    showToast('⏳ Another download is in progress. Please wait.');
    return;
  }
  _downloadBusy = true;
  _setAllPackButtonsDisabled(true, pack.id);
  try {
  const actionsEl = document.getElementById(`pa-${pack.id}`);
  const progressBar = document.getElementById(`pp-${pack.id}`);
  const statusEl = document.getElementById(`ps-${pack.id}`);

  if (statusEl) statusEl.textContent = 'Checking installed files...';

  // ALWAYS fetch a fresh manifest from disk before deciding what to download.
  // This prevents re-downloading files that were installed by a previous pack
  // download in the same session (the in-memory libManifest may be stale).
  try {
    const freshManifest = await DDAPI.getManifest();
    if (freshManifest && freshManifest.files) {
      libManifest = new Set(Object.keys(freshManifest.files));
      libManifestData = freshManifest;
    }
  } catch { /* fall back to in-memory manifest */ }
  const installed = libManifest || new Set();

  // Pre-check: enough disk space?
  if (libStatusData && libStatusData.free_bytes) {
    const needBytes = pack.size_mb * 1024 * 1024;
    if (libStatusData.free_bytes < needBytes * 1.1) { // 10% buffer
      if (statusEl) statusEl.textContent = `Not enough space (need ~${pack.size_mb} MB free). Use MANAGE SPACE to free up room.`;
      _downloadBusy = false;
      _setAllPackButtonsDisabled(false);
      return;
    }
  }

  if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn pack-cancel-btn" onclick="cancelPackDownload('${pack.id}')">✕ CANCEL</button>`;
  if (progressBar) progressBar.style.display = 'block';
  if (statusEl) statusEl.textContent = 'Starting download...';

  // Resume support: skip files already present in manifest AND files without URLs (preloaded)
  const filesToDownload = pack.files.filter(f => !installed.has(f.dest) && f.url);
  if (!filesToDownload.length) {
    if (statusEl) statusEl.textContent = 'All files already installed.';
    if (actionsEl) actionsEl.innerHTML = `<div class="pack-installed">✓ INSTALLED</div>`;
    if (progressBar) progressBar.style.display = 'none';
    _downloadBusy = false;
    _setAllPackButtonsDisabled(false);
    return;
  }

  const jobs = {}; // fileId → jobId
  let skippedCount = 0;
  for (const file of filesToDownload) {
    if (!file.url) continue; // safety: skip preloaded files with no URL
    const result = await DDAPI.startDownload(file.url, file.dest);
    if (result && result.skipped) {
      // Server confirmed file already exists on disk — no download needed
      skippedCount++;
      continue;
    }
    if (result && result.jobId) jobs[file.id] = result.jobId;
    else if (result && result.error) {
      if (statusEl) statusEl.textContent = `Error: ${result.error}`;
      _downloadBusy = false;
      _setAllPackButtonsDisabled(false);
      return;
    }
  }

  // If every file was already on disk, we're done
  const actualDownloads = filesToDownload.filter(f => jobs[f.id]);
  if (!actualDownloads.length) {
    if (statusEl) statusEl.textContent = 'All files already installed.';
    if (actionsEl) actionsEl.innerHTML = `<div class="pack-installed">✓ INSTALLED</div>`;
    if (progressBar) progressBar.style.display = 'none';
    _downloadBusy = false;
    _setAllPackButtonsDisabled(false);
    await refreshAfterManifestChange();
    return;
  }

  if (skippedCount > 0 && statusEl) {
    statusEl.textContent = `Downloading ${actualDownloads.length} file${actualDownloads.length !== 1 ? 's' : ''} (${skippedCount} already installed)...`;
  }

  packDownloads[pack.id] = { jobs, cancelled: false };
  pollPackDownload(pack, actualDownloads, jobs);
  // NOTE: _downloadBusy is released in pollPackDownload when all jobs complete
  } catch (err) {
    // Safety net: always release the download lock on unexpected errors
    console.error('startPackDownload error:', err);
    _downloadBusy = false;
    _setAllPackButtonsDisabled(false);
    const statusEl = document.getElementById(`ps-${pack.id}`);
    if (statusEl) statusEl.textContent = 'Unexpected error. Please try again.';
  }
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
    let totalBytes = 0, doneBytes = 0, allDone = true, errorMessages = [];
    let completedCount = 0;
    for (const file of files) {
      const jobId = jobs[file.id];
      if (!jobId) continue;
      const status = await DDAPI.getDownloadStatus(jobId);
      doneBytes += status.progress || 0;
      totalBytes += status.total || (file.size_mb * 1024 * 1024);
      if (!status.done) allDone = false;
      else completedCount++;
      if (status.error && status.error !== 'cancelled') errorMessages.push(status.error);
    }
    const pct = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;
    if (progressFill) progressFill.style.width = pct + '%';
    if (statusEl) {
      if (errorMessages.length > 0 && !allDone) {
        statusEl.textContent = `${errorMessages.length} error(s), ${totalFiles - completedCount} remaining...`;
      } else if (allDone && errorMessages.length > 0) {
        const succeeded = totalFiles - errorMessages.length;
        statusEl.textContent = `${succeeded} of ${totalFiles} files installed. ${errorMessages.length} failed.`;
      } else if (allDone) {
        statusEl.textContent = 'Installed ✓';
      } else {
        statusEl.textContent = `Downloading... ${pct}%  (${(doneBytes/1024/1024).toFixed(1)} MB)`;
      }
    }
    // Only stop polling when ALL jobs are done (success or error)
    if (allDone) {
      clearInterval(poll);
      delete packDownloads[pack.id];
      if (errorMessages.length === 0) {
        if (actionsEl) actionsEl.innerHTML = `<div class="pack-installed">✓ INSTALLED</div>`;
        if (progressBar) progressBar.style.display = 'none';
      } else {
        if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn" onclick="startPackDownload(${JSON.stringify(pack).replace(/"/g,'&quot;')})">⬇ RETRY</button>`;
      }
      await refreshAfterManifestChange();
      _downloadBusy = false;
      _setAllPackButtonsDisabled(false);
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
  _downloadBusy = false;
  _setAllPackButtonsDisabled(false);
  const actionsEl = document.getElementById(`pa-${packId}`);
  const progressBar = document.getElementById(`pp-${packId}`);
  const statusEl = document.getElementById(`ps-${packId}`);
  // Re-render the GET MORE panel to rebuild pack cards with correct onclick bindings
  if (actionsEl) actionsEl.innerHTML = `<button class="pack-dl-btn" onclick="showGetMorePanel()">⬇ RELOAD PACKS</button>`;
  if (progressBar) progressBar.style.display = 'none';
  if (statusEl) statusEl.textContent = 'Cancelled.';
}

// ── MANAGE SPACE panel ───────────────────────────────────────
async function showManagePanel() {
  libActiveCat = '__manage'; libMode = 'files';
  highlightSidebar('manage'); updateLibHeader();
  _saveLibState();
  libMain.innerHTML = '<div class="lib-loading"><span>Loading drive info...</span></div>';

  const [manifest, status] = await Promise.all([DDAPI.getManifest(), DDAPI.getStatus()]);
  if (!manifest) {
    libMain.innerHTML = `<div class="lib-zim-panel">
      <div class="lib-zim-icon"></div>
      <div class="lib-zim-title">NO CONTENT YET</div>
      <div class="lib-zim-desc">No content has been downloaded to this drive yet.<br><br>
        Use <strong style="color:var(--amber)">⬇ GET MORE</strong> to download reference manuals,
        medical guides, and more. Internet required for first download.
      </div>
      <button class="lib-empty-cta" onclick="showGetMorePanel()" style="margin-top:16px">⬇ GET MORE CONTENT</button>
    </div>`;
    return;
  }

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
      </div>
      <div class="manage-recovery-note">
        All content is <strong>public domain</strong> and can be re-downloaded for free at any time.
        Deleting files frees up space on your drive — use ⬇ GET MORE to restore them.
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
          <button class="manage-del-btn" onclick="confirmDeleteFile('${item.file}','${escapeHtml(item.name)}','${item.id}')">${ICONS.trash}</button>
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
    html += `<div class="manage-category"><div class="manage-cat-header"><span>${ICONS.folder} Other Content</span><span class="manage-cat-size">${fmtSize(uncatSize)}</span></div>`;
    contentUncatFiles.forEach(([path, info]) => {
      const fname = path.split('/').pop();
      html += `<div class="manage-file-row"><span class="manage-file-name">${escapeHtml(fname)}</span><span class="manage-file-size">${fmtSize(info.size)}</span><button class="manage-del-btn" onclick="confirmDeleteFile('${path}','${escapeHtml(fname)}','')">${ICONS.trash}</button></div>`;
    });
    html += `</div>`;
  }
  // ── Available to restore ─────────────────────────────────────────────────
  const allCatalogItems = [];
  if (catalog.categories) {
    catalog.categories.forEach(cat => {
      cat.items.forEach(item => {
        if (!files[item.file]) {
          allCatalogItems.push({ ...item, catName: cat.name, catIcon: cat.icon });
        }
      });
    });
  }
  if (allCatalogItems.length > 0) {
    html += `<div class="manage-category manage-restore-section">
      <div class="manage-cat-header">
        <span>Available to Re-download (${allCatalogItems.length} files)</span>
        <span class="manage-cat-size" style="opacity:0.5">not on this drive</span>
      </div>
      <div class="manage-restore-note">These files are in the catalog but not yet downloaded. Connect to the internet and use GET MORE to add them.</div>`;
    allCatalogItems.forEach(item => {
      html += `<div class="manage-file-row manage-restore-row">
        <span class="manage-file-name" style="opacity:0.65">${item.catIcon} ${escapeHtml(item.name)}</span>
        <span class="manage-file-size" style="opacity:0.4">${item.size_label || '?'}</span>
        ${item.download_url ? `<button class="manage-restore-btn" onclick="restoreFile(${JSON.stringify({file:item.file,name:item.name,url:item.download_url}).replace(/"/g,'&quot;')})">⬇ Restore</button>` : `<span class="manage-file-size" style="opacity:0.3">offline only</span>`}
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  libMain.innerHTML = html;
}

async function deleteCategory(catId) {
  const cat = libRawCatalog && libRawCatalog.categories.find(c => c.id === catId);
  if (!cat) return;
  _showConfirmModal(`Remove all ${cat.items.length} file(s) in "${cat.name}"? This frees up disk space. You can re-download later.`, async () => {
    for (const item of cat.items) {
      if (libManifest && libManifest.has(item.file)) await DDAPI.deleteFile(item.file);
    }
    await refreshAfterManifestChange();
    showManagePanel();
  });
}

async function confirmDeleteFile(filePath, displayName, itemId, downloadUrl) {
  const restoreHint = downloadUrl ? ' It will appear in the "Available to Re-download" section below.' : '';
  _showConfirmModal(`Remove "${displayName}"? This frees up space on your drive.${restoreHint}`, async () => {
    const row = document.getElementById(`mfr-${itemId}`);
    if (row) row.style.opacity = '0.4';
    const result = await DDAPI.deleteFile(filePath);
    if (result && result.ok) {
      await refreshAfterManifestChange();
      showManagePanel();
    } else {
      if (row) row.style.opacity = '1';
      showToast('Could not delete file. ' + (result ? result.error : ''));
    }
  });
}

async function restoreFile(item) {
  if (!item || !item.url) { showToast('No download URL available.'); return; }
  if (!DDAPI.isOnline()) { showToast('Internet required to restore files. Go online and try again.'); return; }
  showToast('⬇ Restoring ' + item.name + '...');
  try {
    const result = await DDAPI.startDownload(item.url, item.file);
    if (result && result.skipped) {
      // File already exists on disk — just refresh
      await refreshAfterManifestChange();
      showManagePanel();
      showToast('✓ ' + item.name + ' already on drive.');
      return;
    }
    if (result && result.jobId) {
      // Poll for completion
      const pollId = setInterval(async () => {
        const status = await DDAPI.getDownloadStatus(result.jobId);
        if (!status || status.done) {
          clearInterval(pollId);
          if (status && status.error) {
            showToast('⚠ Restore failed: ' + status.error);
          } else {
            await refreshAfterManifestChange();
            showManagePanel();
            showToast('✓ Restored ' + item.name);
          }
        }
      }, 1500);
    } else {
      showToast('⚠ Could not start restore: ' + (result ? result.error : 'No response'));
    }
  } catch (e) {
    showToast('⚠ Restore error: ' + e.message);
  }
}

// ── Utilities ────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Monaco theme — defined once, shared across library.js and workspace.js
let _monacoThemeDefined = false;
function _defineBlackoutTheme(monaco) {
  if (_monacoThemeDefined) return;
  monaco.editor.defineTheme('blackout-tactical', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6a6a6a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c8a04a' },
      { token: 'string', foreground: '7ac87a' },
      { token: 'number', foreground: 'c87a4a' },
      { token: 'type', foreground: '4a9ac8' },
    ],
    colors: {
      'editor.background': '#0d0d0d',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#1a1a2e',
      'editorLineNumber.foreground': '#3a3a3a',
      'editorLineNumber.activeForeground': '#c8a04a',
      'editor.selectionBackground': '#c8a04a33',
      'editorCursor.foreground': '#c8a04a',
      'minimap.background': '#0a0a0a',
    },
  });
  _monacoThemeDefined = true;
}
