/**
 * The Blackout Drive — Tactical Navigator
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: GPS coordinate converter (Decimal ↔ DMS ↔ MGRS ↔ UTM)
 *           and a Distance & Bearing calculator between two points.
 *
 * This module registers itself via registerTool() at load time.
 * No modifications to tools.js or index.html structure are needed.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const _NAV_MGRS_LETTERS_E = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // omit I, O
const _NAV_MGRS_LETTERS_N = 'ABCDEFGHJKLMNPQRSTUV';     // omit I, O

// ═══════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════
let _navActiveTab = 'converter'; // converter | distance

// ═══════════════════════════════════════════════════════════
// COORDINATE CONVERSION — Decimal Degrees ↔ DMS
// ═══════════════════════════════════════════════════════════

function _navDecToDMS(dec, isLat) {
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  const m = Math.floor(mFull);
  const s = ((mFull - m) * 60).toFixed(2);
  const dir = isLat ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'E' : 'W');
  return { d, m, s: parseFloat(s), dir, str: `${d}° ${m}' ${s}" ${dir}` };
}

function _navDMSToDec(d, m, s, dir) {
  let dec = Math.abs(d) + (m / 60) + (s / 3600);
  if (dir === 'S' || dir === 'W') dec = -dec;
  return parseFloat(dec.toFixed(8));
}

// ═══════════════════════════════════════════════════════════
// COORDINATE CONVERSION — Decimal Degrees ↔ UTM
// ═══════════════════════════════════════════════════════════

function _navDecToUTM(lat, lng) {
  if (lat < -80 || lat > 84) return { zone: '-', letter: '-', easting: 0, northing: 0, str: 'Out of UTM range' };

  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e = Math.sqrt(2 * f - f * f);
  const e2 = e * e / (1 - e * e);

  let zone = Math.floor((lng + 180) / 6) + 1;
  // Norway/Svalbard exceptions
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zone = 31;
    else if (lng >= 9 && lng < 21) zone = 33;
    else if (lng >= 21 && lng < 33) zone = 35;
    else if (lng >= 33 && lng < 42) zone = 37;
  }

  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const lonOrigRad = lonOrigin * Math.PI / 180;

  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = e2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lngRad - lonOrigRad);

  const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * Math.pow(e, 6) / 256) * latRad
    - (3 * e * e / 8 + 3 * e * e * e * e / 32 + 45 * Math.pow(e, 6) / 1024) * Math.sin(2 * latRad)
    + (15 * e * e * e * e / 256 + 45 * Math.pow(e, 6) / 1024) * Math.sin(4 * latRad)
    - (35 * Math.pow(e, 6) / 3072) * Math.sin(6 * latRad));

  let easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2) * Math.pow(A, 5) / 120) + 500000;

  let northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e2) * Math.pow(A, 6) / 720));

  if (lat < 0) northing += 10000000;

  // UTM latitude band letter
  const letters = 'CDEFGHJKLMNPQRSTUVWX';
  let letterIdx = Math.floor((lat + 80) / 8);
  if (letterIdx > 19) letterIdx = 19;
  const letter = letters[letterIdx];

  return {
    zone, letter,
    easting: Math.round(easting),
    northing: Math.round(northing),
    str: `${zone}${letter} ${Math.round(easting)}E ${Math.round(northing)}N`
  };
}

// ═══════════════════════════════════════════════════════════
// COORDINATE CONVERSION — Decimal Degrees ↔ MGRS
// ═══════════════════════════════════════════════════════════

function _navDecToMGRS(lat, lng) {
  const utm = _navDecToUTM(lat, lng);
  if (utm.str === 'Out of UTM range') return 'Out of MGRS range';

  const setNum = ((utm.zone - 1) % 6);
  const colIdx = (setNum * 8 + Math.floor(utm.easting / 100000) - 1) % 24;
  const colLetter = _NAV_MGRS_LETTERS_E[colIdx];

  const rowBase = (setNum % 2 === 0) ? 0 : 5;
  const rowIdx = (rowBase + Math.floor(utm.northing / 100000)) % 20;
  const rowLetter = _NAV_MGRS_LETTERS_N[rowIdx];

  const e5 = String(Math.round(utm.easting % 100000)).padStart(5, '0');
  const n5 = String(Math.round(utm.northing % 100000)).padStart(5, '0');

  return `${utm.zone}${utm.letter} ${colLetter}${rowLetter} ${e5} ${n5}`;
}

// ═══════════════════════════════════════════════════════════
// DISTANCE & BEARING — Haversine + Forward Azimuth
// ═══════════════════════════════════════════════════════════

function _navHaversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // meters
}

function _navBearing(lat1, lng1, lat2, lng2) {
  const toRad = x => x * Math.PI / 180;
  const toDeg = x => x * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function _navCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function _navFormatDist(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const mi = meters / 1609.344;
  return `${km.toFixed(2)} km (${mi.toFixed(2)} mi)`;
}

// ═══════════════════════════════════════════════════════════
// RENDER ENTRY POINT
// ═══════════════════════════════════════════════════════════

function _navRender(container) {
  container.innerHTML = '';

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'hr-tabs';
  const tabDefs = [
    { id: 'converter', label: 'CONVERTER', icon: ICONS.compass },
    { id: 'distance', label: 'DISTANCE & BEARING', icon: ICONS.calculator },
  ];
  tabDefs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'hr-tab' + (_navActiveTab === t.id ? ' hr-tab--active' : '');
    btn.innerHTML = `<span class="hr-tab-icon">${t.icon}</span><span class="hr-tab-label">${t.label}</span>`;
    btn.onclick = () => { _navActiveTab = t.id; _navRender(container); };
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  if (_navActiveTab === 'converter') _navRenderConverter(content);
  else _navRenderDistance(content);
}

// ═══════════════════════════════════════════════════════════
// CONVERTER TAB
// ═══════════════════════════════════════════════════════════

function _navRenderConverter(container) {
  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">COORDINATE CONVERTER</div>
      <div class="nav-converter-grid">
        <div class="nav-input-block">
          <label class="hr-label">DECIMAL DEGREES (Google Maps format)</label>
          <div class="nav-row">
            <input class="hr-input nav-input-sm" id="navDecLat" type="number" step="any" placeholder="Latitude (e.g. 38.8977)">
            <input class="hr-input nav-input-sm" id="navDecLng" type="number" step="any" placeholder="Longitude (e.g. -77.0365)">
          </div>
          <button class="hr-btn nav-convert-btn" onclick="_navConvertFromDec()">CONVERT ↓</button>
        </div>
      </div>
      <div class="nav-results" id="navResults" style="display:none">
        <div class="nav-result-card">
          <div class="nav-result-label">DEGREES / MINUTES / SECONDS</div>
          <div class="nav-result-value" id="navDmsResult">—</div>
        </div>
        <div class="nav-result-card">
          <div class="nav-result-label">UTM (Universal Transverse Mercator)</div>
          <div class="nav-result-value" id="navUtmResult">—</div>
        </div>
        <div class="nav-result-card">
          <div class="nav-result-label">MGRS (Military Grid Reference System)</div>
          <div class="nav-result-value" id="navMgrsResult">—</div>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">REVERSE — DMS TO DECIMAL</div>
      <div class="nav-dms-input">
        <div class="nav-row">
          <label class="hr-label nav-label-sm">Lat:</label>
          <input class="hr-input nav-input-xs" id="navDmsLatD" type="number" placeholder="D">
          <span class="nav-sep">°</span>
          <input class="hr-input nav-input-xs" id="navDmsLatM" type="number" placeholder="M">
          <span class="nav-sep">'</span>
          <input class="hr-input nav-input-xs" id="navDmsLatS" type="number" step="any" placeholder="S">
          <span class="nav-sep">"</span>
          <select class="hr-input nav-input-xs" id="navDmsLatDir"><option>N</option><option>S</option></select>
        </div>
        <div class="nav-row">
          <label class="hr-label nav-label-sm">Lng:</label>
          <input class="hr-input nav-input-xs" id="navDmsLngD" type="number" placeholder="D">
          <span class="nav-sep">°</span>
          <input class="hr-input nav-input-xs" id="navDmsLngM" type="number" placeholder="M">
          <span class="nav-sep">'</span>
          <input class="hr-input nav-input-xs" id="navDmsLngS" type="number" step="any" placeholder="S">
          <span class="nav-sep">"</span>
          <select class="hr-input nav-input-xs" id="navDmsLngDir"><option>E</option><option>W</option></select>
        </div>
        <button class="hr-btn nav-convert-btn" onclick="_navConvertFromDMS()">CONVERT ↑</button>
      </div>
    </div>`;
}

function _navConvertFromDec() {
  const lat = parseFloat(document.getElementById('navDecLat').value);
  const lng = parseFloat(document.getElementById('navDecLng').value);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    if (typeof showToast === 'function') showToast('Enter valid coordinates: Lat (-90 to 90), Lng (-180 to 180)', 3000);
    return;
  }

  const dmsLat = _navDecToDMS(lat, true);
  const dmsLng = _navDecToDMS(lng, false);
  const utm = _navDecToUTM(lat, lng);
  const mgrs = _navDecToMGRS(lat, lng);

  const results = document.getElementById('navResults');
  results.style.display = '';
  document.getElementById('navDmsResult').textContent = `${dmsLat.str}  ${dmsLng.str}`;
  document.getElementById('navUtmResult').textContent = utm.str;
  document.getElementById('navMgrsResult').textContent = mgrs;
}

function _navConvertFromDMS() {
  const latD = parseInt(document.getElementById('navDmsLatD').value) || 0;
  const latM = parseInt(document.getElementById('navDmsLatM').value) || 0;
  const latS = parseFloat(document.getElementById('navDmsLatS').value) || 0;
  const latDir = document.getElementById('navDmsLatDir').value;
  const lngD = parseInt(document.getElementById('navDmsLngD').value) || 0;
  const lngM = parseInt(document.getElementById('navDmsLngM').value) || 0;
  const lngS = parseFloat(document.getElementById('navDmsLngS').value) || 0;
  const lngDir = document.getElementById('navDmsLngDir').value;

  const lat = _navDMSToDec(latD, latM, latS, latDir);
  const lng = _navDMSToDec(lngD, lngM, lngS, lngDir);

  document.getElementById('navDecLat').value = lat;
  document.getElementById('navDecLng').value = lng;
  _navConvertFromDec();
}

// ═══════════════════════════════════════════════════════════
// DISTANCE & BEARING TAB
// ═══════════════════════════════════════════════════════════

function _navRenderDistance(container) {
  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">DISTANCE & BEARING CALCULATOR</div>
      <div class="nav-dist-grid">
        <div class="nav-point-block">
          <div class="nav-point-label">📍 POINT A — Your Position</div>
          <div class="nav-row">
            <input class="hr-input nav-input-sm" id="navDistLat1" type="number" step="any" placeholder="Latitude">
            <input class="hr-input nav-input-sm" id="navDistLng1" type="number" step="any" placeholder="Longitude">
          </div>
        </div>
        <div class="nav-point-block">
          <div class="nav-point-label">🎯 POINT B — Target</div>
          <div class="nav-row">
            <input class="hr-input nav-input-sm" id="navDistLat2" type="number" step="any" placeholder="Latitude">
            <input class="hr-input nav-input-sm" id="navDistLng2" type="number" step="any" placeholder="Longitude">
          </div>
        </div>
        <button class="hr-btn nav-convert-btn" onclick="_navCalcDistance()">CALCULATE</button>
      </div>
      <div class="nav-dist-results" id="navDistResults" style="display:none">
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">DISTANCE</div>
          <div class="nav-result-value nav-result-lg" id="navDistValue">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">BEARING (A → B)</div>
          <div class="nav-result-value nav-result-lg" id="navBearValue">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">REVERSE BEARING (B → A)</div>
          <div class="nav-result-value" id="navRevBearValue">—</div>
        </div>
      </div>
    </div>`;
}

function _navCalcDistance() {
  const lat1 = parseFloat(document.getElementById('navDistLat1').value);
  const lng1 = parseFloat(document.getElementById('navDistLng1').value);
  const lat2 = parseFloat(document.getElementById('navDistLat2').value);
  const lng2 = parseFloat(document.getElementById('navDistLng2').value);

  if ([lat1, lng1, lat2, lng2].some(v => isNaN(v))) {
    if (typeof showToast === 'function') showToast('Enter valid decimal coordinates for both points.', 3000);
    return;
  }

  const dist = _navHaversine(lat1, lng1, lat2, lng2);
  const bear = _navBearing(lat1, lng1, lat2, lng2);
  const revBear = _navBearing(lat2, lng2, lat1, lng1);

  document.getElementById('navDistResults').style.display = '';
  document.getElementById('navDistValue').textContent = _navFormatDist(dist);
  document.getElementById('navBearValue').textContent = `${bear.toFixed(1)}° ${_navCardinal(bear)}`;
  document.getElementById('navRevBearValue').textContent = `${revBear.toFixed(1)}° ${_navCardinal(revBear)}`;
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'tactical-navigator',
    name: 'TACTICAL NAVIGATOR',
    icon: ICONS.compass,
    description: 'GPS coordinate converter (Decimal, DMS, MGRS, UTM) and distance & bearing calculator',
    render: _navRender,
    cleanup: function() { _navActiveTab = 'converter'; },
  });
}
