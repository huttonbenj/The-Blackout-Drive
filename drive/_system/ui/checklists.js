/**
 * The Blackout Drive — Emergency Prep Checklists
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: Pre-loaded tactical checklists with localStorage persistence,
 *           readiness scoring, and a custom checklist builder.
 *
 * This module registers itself via registerTool() at load time.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════
const _CL_STORAGE_KEY = 'blackout_checklists_v1';

// ═══════════════════════════════════════════════════════════
// PRE-LOADED CHECKLIST DATA
// ═══════════════════════════════════════════════════════════
const _CL_PRELOADED = [
  {
    id: 'bugout',
    name: 'BUG-OUT BAG',
    icon: ICONS.preparedness,
    description: '72-hour grab-and-go survival bag',
    items: [
      // Water & Food
      { text: 'Water — 1 gallon per person per day (3 days)', category: 'Water & Food' },
      { text: 'Water purification tablets or filter', category: 'Water & Food' },
      { text: 'Non-perishable food (3 days)', category: 'Water & Food' },
      { text: 'Can opener (manual)', category: 'Water & Food' },
      { text: 'Eating utensils / mess kit', category: 'Water & Food' },
      // Shelter & Warmth
      { text: 'Emergency bivvy / space blanket (x2)', category: 'Shelter & Warmth' },
      { text: 'Lightweight tarp or poncho', category: 'Shelter & Warmth' },
      { text: '550 paracord (50 ft minimum)', category: 'Shelter & Warmth' },
      { text: 'Extra clothing layer (wool or synthetic)', category: 'Shelter & Warmth' },
      { text: 'Sturdy boots / extra socks', category: 'Shelter & Warmth' },
      // Fire & Light
      { text: 'Waterproof matches / lighter', category: 'Fire & Light' },
      { text: 'Ferro rod / fire starter', category: 'Fire & Light' },
      { text: 'Flashlight + extra batteries', category: 'Fire & Light' },
      { text: 'Headlamp', category: 'Fire & Light' },
      { text: 'Candles (x2)', category: 'Fire & Light' },
      // Tools & Navigation
      { text: 'Fixed-blade knife', category: 'Tools & Navigation' },
      { text: 'Multi-tool', category: 'Tools & Navigation' },
      { text: 'Compass', category: 'Tools & Navigation' },
      { text: 'Physical maps of your area', category: 'Tools & Navigation' },
      { text: 'Duct tape (small roll or wrapped)', category: 'Tools & Navigation' },
      // Medical
      { text: 'First aid kit (IFAK)', category: 'Medical' },
      { text: 'Prescription medications (7-day supply)', category: 'Medical' },
      { text: 'Tourniquet (CAT or SOF-T)', category: 'Medical' },
      { text: 'N95 masks (x5)', category: 'Medical' },
      // Communication & Documents
      { text: 'Battery-powered or hand-crank radio', category: 'Comms & Docs' },
      { text: 'Whistle (signal)', category: 'Comms & Docs' },
      { text: 'Copies of important documents in waterproof bag', category: 'Comms & Docs' },
      { text: 'Cash in small bills', category: 'Comms & Docs' },
      { text: 'Portable battery bank + cables', category: 'Comms & Docs' },
      { text: 'The Blackout Drive', category: 'Comms & Docs' },
    ]
  },
  {
    id: 'vehicle',
    name: 'VEHICLE KIT',
    icon: ICONS.compass,
    description: 'Emergency gear for your vehicle',
    items: [
      { text: 'Jumper cables / jump starter', category: 'Essentials' },
      { text: 'Spare tire + jack + lug wrench', category: 'Essentials' },
      { text: 'Tire pressure gauge', category: 'Essentials' },
      { text: 'Tire repair kit / Fix-a-Flat', category: 'Essentials' },
      { text: 'Tow strap / recovery rope', category: 'Essentials' },
      { text: 'First aid kit', category: 'Safety' },
      { text: 'Fire extinguisher (ABC-rated)', category: 'Safety' },
      { text: 'Reflective triangles / road flares', category: 'Safety' },
      { text: 'High-visibility vest', category: 'Safety' },
      { text: 'Flashlight + extra batteries', category: 'Safety' },
      { text: 'Blanket / sleeping bag', category: 'Survival' },
      { text: 'Water bottles (2 liters minimum)', category: 'Survival' },
      { text: 'Non-perishable snacks', category: 'Survival' },
      { text: 'Rain poncho', category: 'Survival' },
      { text: 'Multi-tool / basic toolkit', category: 'Tools' },
      { text: 'Duct tape', category: 'Tools' },
      { text: 'Zip ties (assorted)', category: 'Tools' },
      { text: 'Paper maps / atlas', category: 'Tools' },
      { text: 'Phone charger (12V adapter)', category: 'Tools' },
      { text: 'Window breaker / seatbelt cutter', category: 'Tools' },
    ]
  },
  {
    id: 'home',
    name: 'HOME EMERGENCY',
    icon: ICONS.shelter,
    description: 'Essential supplies for sheltering in place',
    items: [
      { text: 'Water — 1 gallon per person per day (14 days)', category: 'Water & Food' },
      { text: 'Non-perishable food (14-day supply)', category: 'Water & Food' },
      { text: 'Manual can opener', category: 'Water & Food' },
      { text: 'Portable stove + fuel (butane/propane)', category: 'Water & Food' },
      { text: 'Water purification (bleach or filter)', category: 'Water & Food' },
      { text: 'Flashlights + batteries (multiple)', category: 'Power & Light' },
      { text: 'Battery-powered / hand-crank radio', category: 'Power & Light' },
      { text: 'Candles + matches / lighters', category: 'Power & Light' },
      { text: 'Portable power station or generator', category: 'Power & Light' },
      { text: 'Solar panel (portable)', category: 'Power & Light' },
      { text: 'First aid kit (comprehensive)', category: 'Medical & Hygiene' },
      { text: 'Prescription medications (30-day supply)', category: 'Medical & Hygiene' },
      { text: 'Toilet paper / hygiene supplies', category: 'Medical & Hygiene' },
      { text: 'Trash bags (heavy duty)', category: 'Medical & Hygiene' },
      { text: 'Bleach (unscented, for sanitation)', category: 'Medical & Hygiene' },
      { text: 'Important documents in fireproof safe', category: 'Security' },
      { text: 'Cash in small denominations', category: 'Security' },
      { text: 'Home defense plan established', category: 'Security' },
      { text: 'Smoke / CO detectors tested', category: 'Security' },
      { text: 'Fire extinguisher(s) accessible', category: 'Security' },
    ]
  },
  {
    id: 'firstaid',
    name: 'FIRST AID KIT',
    icon: ICONS.medicalCross,
    description: 'Medical supplies inventory',
    items: [
      { text: 'Adhesive bandages (assorted sizes)', category: 'Wound Care' },
      { text: 'Gauze pads (4x4 sterile)', category: 'Wound Care' },
      { text: 'Gauze roll / wrap', category: 'Wound Care' },
      { text: 'Medical tape', category: 'Wound Care' },
      { text: 'Butterfly closures / Steri-Strips', category: 'Wound Care' },
      { text: 'Hemostatic gauze (QuikClot or equivalent)', category: 'Wound Care' },
      { text: 'Tourniquet (CAT Gen 7 or SOF-T)', category: 'Trauma' },
      { text: 'Israeli bandage / pressure dressing', category: 'Trauma' },
      { text: 'Chest seals (vented, x2)', category: 'Trauma' },
      { text: 'SAM splint', category: 'Trauma' },
      { text: 'ACE bandage / elastic wrap', category: 'Trauma' },
      { text: 'Nitrile gloves (multiple pairs)', category: 'PPE & Tools' },
      { text: 'Trauma shears', category: 'PPE & Tools' },
      { text: 'Tweezers', category: 'PPE & Tools' },
      { text: 'CPR mask / pocket mask', category: 'PPE & Tools' },
      { text: 'Ibuprofen / Acetaminophen', category: 'Medications' },
      { text: 'Antihistamine (Benadryl)', category: 'Medications' },
      { text: 'Antibiotic ointment', category: 'Medications' },
      { text: 'Hydrocortisone cream', category: 'Medications' },
      { text: 'Electrolyte packets', category: 'Medications' },
    ]
  },
  {
    id: 'commsplan',
    name: 'COMMS PLAN',
    icon: ICONS.radioWave,
    description: 'Communication readiness checklist',
    items: [
      { text: 'Primary rally point established', category: 'Rally Points' },
      { text: 'Secondary rally point established', category: 'Rally Points' },
      { text: 'Out-of-area contact designated', category: 'Rally Points' },
      { text: 'All household members know the plan', category: 'Rally Points' },
      { text: 'Ham radio license obtained (or studied)', category: 'Equipment' },
      { text: 'Handheld radio (Baofeng / Yaesu / Heltec)', category: 'Equipment' },
      { text: 'Spare batteries for all radios', category: 'Equipment' },
      { text: 'GMRS / FRS radios for family', category: 'Equipment' },
      { text: 'Antenna (portable / roll-up)', category: 'Equipment' },
      { text: 'Frequency list printed (local repeaters)', category: 'References' },
      { text: 'NOAA Weather frequencies memorized', category: 'References' },
      { text: 'Local emergency frequencies noted', category: 'References' },
      { text: 'Callsign / channel assignments documented', category: 'References' },
      { text: 'Signal mirror in kit', category: 'Backup Signals' },
      { text: 'Whistle in kit', category: 'Backup Signals' },
      { text: 'Flare gun / flares (if applicable)', category: 'Backup Signals' },
    ]
  }
];

// ═══════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════

let _clActiveList = 'bugout'; // which checklist is active
let _clData = null;           // runtime state { bugout: { items: [{ checked }] }, custom: [...] }

function _clLoad() {
  try {
    const raw = localStorage.getItem(_CL_STORAGE_KEY);
    if (raw) {
      _clData = JSON.parse(raw);
      // Merge any new items from preloaded that don't exist yet
      _CL_PRELOADED.forEach(list => {
        if (!_clData[list.id]) {
          _clData[list.id] = { items: list.items.map(() => false) };
        } else {
          // If preloaded list has more items than saved state, extend
          while (_clData[list.id].items.length < list.items.length) {
            _clData[list.id].items.push(false);
          }
        }
      });
      if (!_clData._custom) _clData._custom = [];
      return;
    }
  } catch {}
  // Fresh state
  _clData = {};
  _CL_PRELOADED.forEach(list => {
    _clData[list.id] = { items: list.items.map(() => false) };
  });
  _clData._custom = []; // user-created checklists
}

function _clSave() {
  try { localStorage.setItem(_CL_STORAGE_KEY, JSON.stringify(_clData)); } catch {}
}

// ═══════════════════════════════════════════════════════════
// READINESS SCORING
// ═══════════════════════════════════════════════════════════

function _clGetReadiness() {
  if (!_clData) _clLoad();
  let total = 0;
  let checked = 0;
  _CL_PRELOADED.forEach(list => {
    const state = _clData[list.id];
    if (state) {
      total += list.items.length;
      checked += state.items.filter(Boolean).length;
    }
  });
  // Include custom lists
  (_clData._custom || []).forEach(cl => {
    total += cl.items.length;
    checked += cl.checked.filter(Boolean).length;
  });
  return total > 0 ? Math.round((checked / total) * 100) : 0;
}

function _clGetListProgress(listId) {
  if (!_clData) _clLoad();
  const preloaded = _CL_PRELOADED.find(l => l.id === listId);
  if (preloaded) {
    const state = _clData[listId];
    if (!state) return 0;
    const total = preloaded.items.length;
    const checked = state.items.filter(Boolean).length;
    return total > 0 ? Math.round((checked / total) * 100) : 0;
  }
  // Custom list
  const custom = (_clData._custom || []).find(c => c.id === listId);
  if (custom) {
    const total = custom.items.length;
    const checked = custom.checked.filter(Boolean).length;
    return total > 0 ? Math.round((checked / total) * 100) : 0;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
// RENDER ENTRY POINT
// ═══════════════════════════════════════════════════════════

function _clRender(container) {
  if (!_clData) _clLoad();
  container.innerHTML = '';

  // Readiness banner
  const readiness = _clGetReadiness();
  const banner = document.createElement('div');
  banner.className = 'cl-readiness-banner';
  const barColor = readiness < 33 ? '#f87171' : readiness < 66 ? '#fbbf24' : '#4ade80';
  banner.innerHTML = `
    <div class="cl-readiness-header">
      <span class="cl-readiness-label">OVERALL READINESS</span>
      <span class="cl-readiness-pct" style="color:${barColor}">${readiness}%</span>
    </div>
    <div class="cl-readiness-bar">
      <div class="cl-readiness-fill" style="width:${readiness}%;background:${barColor}"></div>
    </div>`;
  container.appendChild(banner);

  // Tab bar — one tab per checklist
  const tabs = document.createElement('div');
  tabs.className = 'cl-tabs';
  const allLists = [..._CL_PRELOADED.map(l => ({ id: l.id, name: l.name, icon: l.icon }))];
  (_clData._custom || []).forEach(c => allLists.push({ id: c.id, name: c.name, icon: ICONS.clipboard }));
  allLists.push({ id: '_add', name: '+ NEW', icon: '' });

  allLists.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'cl-tab' + (_clActiveList === t.id ? ' cl-tab--active' : '');
    if (t.id === '_add') {
      btn.className = 'cl-tab cl-tab--add';
      btn.textContent = '+ NEW';
      btn.onclick = () => _clCreateCustom(container);
    } else {
      const pct = _clGetListProgress(t.id);
      btn.innerHTML = `<span class="cl-tab-icon">${t.icon}</span><span class="cl-tab-name">${t.name}</span><span class="cl-tab-pct">${pct}%</span>`;
      btn.onclick = () => { _clActiveList = t.id; _clRender(container); };
    }
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  // Content area
  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  // Render the active checklist
  const preloaded = _CL_PRELOADED.find(l => l.id === _clActiveList);
  if (preloaded) {
    _clRenderPreloaded(content, preloaded);
  } else {
    const custom = (_clData._custom || []).find(c => c.id === _clActiveList);
    if (custom) _clRenderCustom(content, custom);
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER PRELOADED CHECKLIST
// ═══════════════════════════════════════════════════════════

function _clRenderPreloaded(container, list) {
  const state = _clData[list.id];
  const pct = _clGetListProgress(list.id);
  const checked = state.items.filter(Boolean).length;
  const total = list.items.length;

  // Header
  let html = `
    <div class="cl-list-header">
      <div class="cl-list-title">${list.icon} ${list.name}</div>
      <div class="cl-list-desc">${list.description}</div>
      <div class="cl-list-stats">
        <span class="cl-stat">${checked} / ${total} items</span>
        <span class="cl-stat cl-stat--pct">${pct}% complete</span>
      </div>
      <div class="cl-list-actions">
        <button class="hr-btn hr-btn--secondary cl-check-all-btn" onclick="_clCheckAll('${list.id}')">CHECK ALL</button>
        <button class="hr-btn hr-btn--secondary cl-reset-btn" onclick="_clResetList('${list.id}')">RESET</button>
      </div>
    </div>`;

  // Group items by category
  const categories = {};
  list.items.forEach((item, i) => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push({ ...item, index: i, checked: state.items[i] });
  });

  Object.entries(categories).forEach(([cat, items]) => {
    const catChecked = items.filter(i => i.checked).length;
    html += `<div class="cl-category">
      <div class="cl-category-title">${cat} <span class="cl-category-count">${catChecked}/${items.length}</span></div>`;
    items.forEach(item => {
      html += `
        <label class="cl-item ${item.checked ? 'cl-item--checked' : ''}" id="clItem${list.id}${item.index}">
          <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="_clToggle('${list.id}', ${item.index}, this.checked)">
          <span class="cl-item-check">${item.checked ? '☑' : '☐'}</span>
          <span class="cl-item-text">${item.text}</span>
        </label>`;
    });
    html += '</div>';
  });

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// RENDER CUSTOM CHECKLIST
// ═══════════════════════════════════════════════════════════

function _clRenderCustom(container, list) {
  const pct = _clGetListProgress(list.id);
  const checked = list.checked.filter(Boolean).length;
  const total = list.items.length;

  let html = `
    <div class="cl-list-header">
      <div class="cl-list-title">${ICONS.clipboard} ${list.name}</div>
      <div class="cl-list-stats">
        <span class="cl-stat">${checked} / ${total} items</span>
        <span class="cl-stat cl-stat--pct">${pct}% complete</span>
      </div>
      <div class="cl-list-actions">
        <button class="hr-btn hr-btn--secondary" onclick="_clCheckAll('${list.id}')">CHECK ALL</button>
        <button class="hr-btn hr-btn--secondary cl-reset-btn" onclick="_clResetList('${list.id}')">RESET</button>
        <button class="hr-btn hr-btn--secondary cl-delete-list-btn" onclick="_clDeleteCustom('${list.id}')">DELETE LIST</button>
      </div>
    </div>
    <div class="cl-custom-add">
      <input class="hr-input cl-custom-input" id="clCustomNewItem" type="text" placeholder="Add new item..." autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" onkeydown="if(event.key==='Enter')_clAddCustomItem('${list.id}')">
      <button class="hr-btn cl-custom-add-btn" onclick="_clAddCustomItem('${list.id}')">+ ADD</button>
    </div>`;

  list.items.forEach((item, i) => {
    html += `
      <label class="cl-item ${list.checked[i] ? 'cl-item--checked' : ''}">
        <input type="checkbox" ${list.checked[i] ? 'checked' : ''} onchange="_clToggleCustom('${list.id}', ${i}, this.checked)">
        <span class="cl-item-check">${list.checked[i] ? '☑' : '☐'}</span>
        <span class="cl-item-text">${item}</span>
        <button class="cl-item-remove" onclick="_clRemoveCustomItem('${list.id}', ${i})" title="Remove">✕</button>
      </label>`;
  });

  if (total === 0) {
    html += '<div class="cl-empty">No items yet. Add items above to get started.</div>';
  }

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// TOGGLE / CHECK / RESET
// ═══════════════════════════════════════════════════════════

function _clToggle(listId, index, checked) {
  _clData[listId].items[index] = checked;
  _clSave();
  // Update UI inline without full re-render
  const container = document.querySelector('.hr-content');
  if (container) {
    const preloaded = _CL_PRELOADED.find(l => l.id === listId);
    if (preloaded) _clRenderPreloaded(container, preloaded);
  }
  // Update readiness banner + tab percentages
  _clUpdateBannerAndTabs();
}

function _clToggleCustom(listId, index, checked) {
  const custom = (_clData._custom || []).find(c => c.id === listId);
  if (custom) { custom.checked[index] = checked; _clSave(); }
  const container = document.querySelector('.hr-content');
  if (container && custom) _clRenderCustom(container, custom);
  _clUpdateBannerAndTabs();
}

function _clCheckAll(listId) {
  const preloaded = _CL_PRELOADED.find(l => l.id === listId);
  if (preloaded) {
    _clData[listId].items = _clData[listId].items.map(() => true);
  } else {
    const custom = (_clData._custom || []).find(c => c.id === listId);
    if (custom) custom.checked = custom.checked.map(() => true);
  }
  _clSave();
  const toolContainer = document.querySelector('#toolsMain');
  if (toolContainer) _clRender(toolContainer);
}

function _clResetList(listId) {
  const preloaded = _CL_PRELOADED.find(l => l.id === listId);
  if (preloaded) {
    _clData[listId].items = _clData[listId].items.map(() => false);
  } else {
    const custom = (_clData._custom || []).find(c => c.id === listId);
    if (custom) custom.checked = custom.checked.map(() => false);
  }
  _clSave();
  const toolContainer = document.querySelector('#toolsMain');
  if (toolContainer) _clRender(toolContainer);
}

function _clUpdateBannerAndTabs() {
  const readiness = _clGetReadiness();
  const pctEl = document.querySelector('.cl-readiness-pct');
  const fillEl = document.querySelector('.cl-readiness-fill');
  const barColor = readiness < 33 ? '#f87171' : readiness < 66 ? '#fbbf24' : '#4ade80';
  if (pctEl) { pctEl.textContent = readiness + '%'; pctEl.style.color = barColor; }
  if (fillEl) { fillEl.style.width = readiness + '%'; fillEl.style.background = barColor; }
  // Update tab percentages
  document.querySelectorAll('.cl-tab').forEach(tab => {
    const nameEl = tab.querySelector('.cl-tab-name');
    const pctTab = tab.querySelector('.cl-tab-pct');
    if (!nameEl || !pctTab) return;
    const allLists = [..._CL_PRELOADED.map(l => ({ id: l.id, name: l.name }))];
    (_clData._custom || []).forEach(c => allLists.push({ id: c.id, name: c.name }));
    const match = allLists.find(l => l.name === nameEl.textContent);
    if (match) pctTab.textContent = _clGetListProgress(match.id) + '%';
  });
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CHECKLIST MANAGEMENT
// ═══════════════════════════════════════════════════════════

function _clCreateCustom(container) {
  // Show custom styled modal instead of native prompt()
  const overlay = document.createElement('div');
  overlay.className = 'export-modal-overlay';
  overlay.id = 'clNewListModal';
  overlay.innerHTML = `
    <div class="export-modal-dialog">
      <div class="export-modal-icon">${ICONS.clipboard}</div>
      <div class="export-modal-title">NEW CHECKLIST</div>
      <div class="export-modal-body">Enter a name for your custom checklist.</div>
      <div class="export-modal-fields">
        <input type="text" class="export-modal-input" id="clNewListNameInput" placeholder="CHECKLIST NAME" maxlength="40" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other">
      </div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="clNewListCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-confirm" id="clNewListConfirm">CREATE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('clNewListNameInput');
  const confirmBtn = document.getElementById('clNewListConfirm');
  const cancelBtn = document.getElementById('clNewListCancel');

  // Focus the input
  setTimeout(() => input.focus(), 50);

  function doCreate() {
    const name = input.value.trim();
    if (!name) { input.style.borderColor = '#f87171'; return; }
    overlay.remove();
    const id = 'custom_' + Date.now();
    if (!_clData._custom) _clData._custom = [];
    _clData._custom.push({ id, name: name.toUpperCase(), items: [], checked: [] });
    _clSave();
    _clActiveList = id;
    _clRender(container);
  }

  function doCancel() { overlay.remove(); }

  confirmBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', doCancel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) doCancel(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') doCancel();
  });
}

function _clDeleteCustom(listId) {
  // Show custom styled confirmation modal instead of native confirm()
  const overlay = document.createElement('div');
  overlay.className = 'export-modal-overlay';
  overlay.id = 'clDeleteListModal';
  overlay.innerHTML = `
    <div class="export-modal-dialog">
      <div class="export-modal-icon">⚠️</div>
      <div class="export-modal-title">DELETE CHECKLIST</div>
      <div class="export-modal-body">Delete this entire checklist? <strong>This cannot be undone.</strong></div>
      <div class="export-modal-actions">
        <button class="export-modal-btn export-modal-cancel" id="clDeleteCancel">CANCEL</button>
        <button class="export-modal-btn export-modal-destructive" id="clDeleteConfirm">DELETE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const confirmBtn = document.getElementById('clDeleteConfirm');
  const cancelBtn = document.getElementById('clDeleteCancel');

  function doDelete() {
    overlay.remove();
    _clData._custom = (_clData._custom || []).filter(c => c.id !== listId);
    _clSave();
    _clActiveList = 'bugout';
    const toolContainer = document.querySelector('#toolsMain');
    if (toolContainer) _clRender(toolContainer);
  }

  function doCancel() { overlay.remove(); }

  confirmBtn.addEventListener('click', doDelete);
  cancelBtn.addEventListener('click', doCancel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) doCancel(); });
  // Escape key
  const keyHandler = (e) => {
    if (e.key === 'Escape') { doCancel(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);
}

function _clAddCustomItem(listId) {
  const input = document.getElementById('clCustomNewItem');
  if (!input || !input.value.trim()) return;
  const custom = (_clData._custom || []).find(c => c.id === listId);
  if (!custom) return;
  custom.items.push(input.value.trim());
  custom.checked.push(false);
  _clSave();
  input.value = '';
  const container = document.querySelector('.hr-content');
  if (container) _clRenderCustom(container, custom);
  _clUpdateBannerAndTabs();
}

function _clRemoveCustomItem(listId, index) {
  const custom = (_clData._custom || []).find(c => c.id === listId);
  if (!custom) return;
  custom.items.splice(index, 1);
  custom.checked.splice(index, 1);
  _clSave();
  const container = document.querySelector('.hr-content');
  if (container) _clRenderCustom(container, custom);
  _clUpdateBannerAndTabs();
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'prep-checklists',
    name: 'PREP CHECKLISTS',
    icon: ICONS.clipboard,
    description: 'Emergency preparedness checklists with readiness scoring and custom list builder',
    render: _clRender,
    cleanup: function() { _clActiveList = 'bugout'; },
  });
}
