/**
 * The Blackout Drive — Survival Calculators
 * Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
 *
 * Self-registering tool module for the TOOLS panel.
 * Provides: Water purification calculator and battery/power runtime estimator.
 *
 * This module registers itself via registerTool() at load time.
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════
let _calcActiveTab = 'water';  // water | power

// ═══════════════════════════════════════════════════════════
// WATER PURIFICATION CONSTANTS
// ═══════════════════════════════════════════════════════════
// EPA/Red Cross guidelines: 8 drops per gallon for clear water (5-6% bleach)
// Double for cloudy water. 1 gallon = 3.785 liters
// 1 drop ≈ 0.05 mL
const _CALC_BLEACH_PROFILES = [
  { label: '1% Sodium Hypochlorite', pct: 1, dropsPerGalClear: 40, dropsPerGalCloudy: 80 },
  { label: '4-6% (Standard Household)', pct: 5, dropsPerGalClear: 8, dropsPerGalCloudy: 16 },
  { label: '8.25% (Concentrated)', pct: 8.25, dropsPerGalClear: 6, dropsPerGalCloudy: 12 },
];

// ═══════════════════════════════════════════════════════════
// RENDER ENTRY POINT
// ═══════════════════════════════════════════════════════════

function _calcRender(container) {
  container.innerHTML = '';

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'hr-tabs';
  const tabDefs = [
    { id: 'water', label: 'WATER PURIFICATION', icon: ICONS.droplet },
    { id: 'power', label: 'POWER & BATTERY', icon: ICONS.battery },
  ];
  tabDefs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'hr-tab' + (_calcActiveTab === t.id ? ' hr-tab--active' : '');
    btn.innerHTML = `<span class="hr-tab-icon">${t.icon}</span><span class="hr-tab-label">${t.label}</span>`;
    btn.onclick = () => { _calcActiveTab = t.id; _calcRender(container); };
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const content = document.createElement('div');
  content.className = 'hr-content';
  container.appendChild(content);

  if (_calcActiveTab === 'water') _calcRenderWater(content);
  else _calcRenderPower(content);
}

// ═══════════════════════════════════════════════════════════
// WATER PURIFICATION TAB
// ═══════════════════════════════════════════════════════════

function _calcRenderWater(container) {
  let bleachOptions = _CALC_BLEACH_PROFILES.map((b, i) =>
    `<option value="${i}">${b.label}</option>`
  ).join('');

  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">WATER PURIFICATION CALCULATOR</div>
      <div class="cipher-desc">
        Calculate the exact amount of unscented liquid chlorine bleach needed to
        disinfect water for drinking. Based on EPA and Red Cross guidelines.
        <strong>Wait 30 minutes after treatment before drinking.</strong>
      </div>
      <div class="calc-form">
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">WATER VOLUME</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcWaterAmt" type="number" step="any" min="0.1" placeholder="Amount" value="1">
              <select class="hr-input nav-input-xs" id="calcWaterUnit" style="width:90px">
                <option value="gal">Gallons</option>
                <option value="L">Liters</option>
                <option value="qt">Quarts</option>
              </select>
            </div>
          </div>
          <div class="calc-field">
            <label class="hr-label">BLEACH STRENGTH</label>
            <select class="hr-input" id="calcBleachType">${bleachOptions}</select>
          </div>
        </div>
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">WATER CLARITY</label>
            <div class="calc-clarity-btns">
              <button class="hr-btn calc-clarity-btn calc-clarity-btn--active" id="calcClarityClear" onclick="_calcSetClarity('clear')">☀ CLEAR</button>
              <button class="hr-btn hr-btn--secondary calc-clarity-btn" id="calcClarityCloudy" onclick="_calcSetClarity('cloudy')">☁ CLOUDY / TURBID</button>
            </div>
          </div>
        </div>
        <button class="hr-btn nav-convert-btn" onclick="_calcWaterCalc()">CALCULATE</button>
      </div>
      <div class="calc-results" id="calcWaterResults" style="display:none">
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">BLEACH REQUIRED</div>
          <div class="nav-result-value nav-result-lg" id="calcWaterDrops">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">MILLILITERS</div>
          <div class="nav-result-value" id="calcWaterMl">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide calc-warning">
          <div class="nav-result-label">⚠ INSTRUCTIONS</div>
          <div class="calc-instructions" id="calcWaterInstructions">—</div>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">QUICK REFERENCE — STANDARD HOUSEHOLD BLEACH (4-6%)</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>VOLUME</th><th>CLEAR WATER</th><th>CLOUDY WATER</th></tr></thead>
          <tbody>
            <tr><td>1 Quart (1 L)</td><td>2 drops</td><td>4 drops</td></tr>
            <tr><td>1 Gallon (4 L)</td><td>8 drops (⅛ tsp)</td><td>16 drops (¼ tsp)</td></tr>
            <tr><td>5 Gallons (19 L)</td><td>40 drops (½ tsp)</td><td>80 drops (1 tsp)</td></tr>
            <tr><td>55 Gallons (208 L)</td><td>1 tablespoon</td><td>2 tablespoons</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

let _calcWaterClarity = 'clear';

function _calcSetClarity(val) {
  _calcWaterClarity = val;
  const clearBtn = document.getElementById('calcClarityClear');
  const cloudyBtn = document.getElementById('calcClarityCloudy');
  if (val === 'clear') {
    clearBtn.className = 'hr-btn calc-clarity-btn calc-clarity-btn--active';
    cloudyBtn.className = 'hr-btn hr-btn--secondary calc-clarity-btn';
  } else {
    clearBtn.className = 'hr-btn hr-btn--secondary calc-clarity-btn';
    cloudyBtn.className = 'hr-btn calc-clarity-btn calc-clarity-btn--active';
  }
}

function _calcWaterCalc() {
  const amt = parseFloat(document.getElementById('calcWaterAmt').value);
  const unit = document.getElementById('calcWaterUnit').value;
  const profileIdx = parseInt(document.getElementById('calcBleachType').value);
  const isCloudy = _calcWaterClarity === 'cloudy';

  if (isNaN(amt) || amt <= 0) { if (typeof showToast === 'function') showToast('Enter a valid water volume.', 3000); return; }

  // Convert everything to gallons
  let gallons;
  if (unit === 'gal') gallons = amt;
  else if (unit === 'L') gallons = amt / 3.785;
  else if (unit === 'qt') gallons = amt / 4;

  const profile = _CALC_BLEACH_PROFILES[profileIdx];
  const dropsPerGal = isCloudy ? profile.dropsPerGalCloudy : profile.dropsPerGalClear;
  const totalDrops = Math.ceil(gallons * dropsPerGal);
  const totalMl = (totalDrops * 0.05).toFixed(2);

  // Measurement conversions
  let measurement = `${totalDrops} drops`;
  if (totalDrops >= 480) measurement += ` (${(totalDrops / 480).toFixed(1)} tablespoons)`;
  else if (totalDrops >= 60) measurement += ` (${(totalDrops / 60).toFixed(1)} teaspoons)`;
  else if (totalDrops >= 15) measurement += ` (≈ ${Math.round(totalDrops / 15) * 0.25} teaspoon)`;

  document.getElementById('calcWaterResults').style.display = '';
  document.getElementById('calcWaterDrops').textContent = measurement;
  document.getElementById('calcWaterMl').textContent = `${totalMl} mL of bleach`;
  document.getElementById('calcWaterInstructions').innerHTML =
    `1. Add ${measurement} of <strong>${profile.label}</strong> bleach to ${amt} ${unit === 'gal' ? 'gallon(s)' : unit === 'L' ? 'liter(s)' : 'quart(s)'} of ${isCloudy ? 'cloudy' : 'clear'} water.<br>
     2. Stir or shake thoroughly.<br>
     3. Let stand for <strong>30 minutes</strong> minimum.<br>
     4. Water should have a slight chlorine smell after 30 minutes. If not, repeat the dose and wait 15 more minutes.<br>
     5. ${isCloudy ? '<strong>Note:</strong> For cloudy water, filter through a clean cloth or coffee filter first if possible.' : 'Water is ready to drink.'}`;
}

// ═══════════════════════════════════════════════════════════
// POWER & BATTERY TAB
// ═══════════════════════════════════════════════════════════

function _calcRenderPower(container) {
  container.innerHTML = `
    <div class="hr-section">
      <div class="hr-section-title">BATTERY RUNTIME CALCULATOR</div>
      <div class="cipher-desc">
        Calculate how long a battery or power station will run your devices.
        Enter the battery capacity and the total power draw of your equipment.
      </div>
      <div class="calc-form">
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">BATTERY CAPACITY</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcBattCap" type="number" step="any" min="1" placeholder="Capacity" value="500">
              <select class="hr-input nav-input-xs" id="calcBattUnit" style="width:80px">
                <option value="Wh">Wh</option>
                <option value="Ah">Ah</option>
                <option value="mAh">mAh</option>
              </select>
            </div>
          </div>
          <div class="calc-field" id="calcVoltGroup">
            <label class="hr-label">BATTERY VOLTAGE (for Ah/mAh)</label>
            <input class="hr-input" id="calcBattVolt" type="number" step="any" min="1" placeholder="Voltage" value="12">
          </div>
        </div>
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">TOTAL POWER DRAW</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcLoadWatts" type="number" step="any" min="0.1" placeholder="Watts" value="65">
              <span class="nav-sep" style="font-size:12px">Watts</span>
            </div>
          </div>
          <div class="calc-field">
            <label class="hr-label">INVERTER EFFICIENCY</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcEfficiency" type="number" step="1" min="50" max="100" placeholder="%" value="85">
              <span class="nav-sep" style="font-size:12px">%</span>
            </div>
          </div>
        </div>
        <button class="hr-btn nav-convert-btn" onclick="_calcPowerCalc()">CALCULATE RUNTIME</button>
      </div>
      <div class="calc-results" id="calcPowerResults" style="display:none">
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">ESTIMATED RUNTIME</div>
          <div class="nav-result-value nav-result-lg" id="calcPowerRuntime">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">USABLE ENERGY</div>
          <div class="nav-result-value" id="calcPowerUsable">—</div>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">SOLAR CHARGE TIME ESTIMATOR</div>
      <div class="cipher-desc">
        Estimate how long a solar panel will take to charge your battery.
      </div>
      <div class="calc-form">
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">SOLAR PANEL WATTAGE</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcSolarWatts" type="number" step="any" min="1" placeholder="Watts" value="100">
              <span class="nav-sep" style="font-size:12px">Watts</span>
            </div>
          </div>
          <div class="calc-field">
            <label class="hr-label">BATTERY TO CHARGE (Wh)</label>
            <input class="hr-input" id="calcSolarBatt" type="number" step="any" min="1" placeholder="Wh" value="500">
          </div>
        </div>
        <div class="calc-row">
          <div class="calc-field">
            <label class="hr-label">PEAK SUN HOURS (avg per day)</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcSunHours" type="number" step="0.5" min="1" max="12" placeholder="Hours" value="5">
              <span class="nav-sep" style="font-size:12px">hrs/day</span>
            </div>
          </div>
          <div class="calc-field">
            <label class="hr-label">CHARGE EFFICIENCY</label>
            <div class="nav-row">
              <input class="hr-input nav-input-sm" id="calcSolarEff" type="number" step="1" min="50" max="100" value="80">
              <span class="nav-sep" style="font-size:12px">%</span>
            </div>
          </div>
        </div>
        <button class="hr-btn nav-convert-btn" onclick="_calcSolarCalc()">CALCULATE CHARGE TIME</button>
      </div>
      <div class="calc-results" id="calcSolarResults" style="display:none">
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">ESTIMATED CHARGE TIME</div>
          <div class="nav-result-value nav-result-lg" id="calcSolarTime">—</div>
        </div>
        <div class="nav-result-card nav-result-card--wide">
          <div class="nav-result-label">EFFECTIVE SOLAR OUTPUT</div>
          <div class="nav-result-value" id="calcSolarOutput">—</div>
        </div>
      </div>
    </div>
    <div class="hr-section">
      <div class="hr-section-title">COMMON DEVICE POWER DRAW</div>
      <div class="hr-table-wrap">
        <table class="hr-table">
          <thead><tr><th>DEVICE</th><th>TYPICAL WATTS</th><th>NOTES</th></tr></thead>
          <tbody>
            <tr><td>Laptop</td><td>30–65 W</td><td>Running The Blackout Drive</td></tr>
            <tr><td>Phone charger</td><td>5–20 W</td><td>USB-C fast charging</td></tr>
            <tr><td>Meshtastic radio</td><td>0.5–2 W</td><td>Heltec V3 (transmit peak)</td></tr>
            <tr><td>LED light strip</td><td>5–20 W</td><td>Per meter, 12V</td></tr>
            <tr><td>CPAP machine</td><td>30–60 W</td><td>Without humidifier</td></tr>
            <tr><td>Mini fridge</td><td>40–80 W</td><td>12V / thermoelectric</td></tr>
            <tr><td>Ham radio (HF)</td><td>100–200 W</td><td>Transmit at 100W output</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function _calcPowerCalc() {
  const cap = parseFloat(document.getElementById('calcBattCap').value);
  const unit = document.getElementById('calcBattUnit').value;
  const volt = parseFloat(document.getElementById('calcBattVolt').value) || 12;
  const load = parseFloat(document.getElementById('calcLoadWatts').value);
  const eff = parseFloat(document.getElementById('calcEfficiency').value) / 100;

  if (isNaN(cap) || cap <= 0 || isNaN(load) || load <= 0) { if (typeof showToast === 'function') showToast('Enter valid capacity and load values.', 3000); return; }

  // Convert to Wh
  let wh;
  if (unit === 'Wh') wh = cap;
  else if (unit === 'Ah') wh = cap * volt;
  else if (unit === 'mAh') wh = (cap / 1000) * volt;

  const usableWh = wh * eff;
  const hours = usableWh / load;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);

  document.getElementById('calcPowerResults').style.display = '';
  document.getElementById('calcPowerRuntime').textContent = `${h}h ${m}m`;
  document.getElementById('calcPowerUsable').textContent = `${usableWh.toFixed(0)} Wh usable (from ${wh.toFixed(0)} Wh total at ${(eff * 100).toFixed(0)}% efficiency)`;
}

function _calcSolarCalc() {
  const panelW = parseFloat(document.getElementById('calcSolarWatts').value);
  const battWh = parseFloat(document.getElementById('calcSolarBatt').value);
  const sunHrs = parseFloat(document.getElementById('calcSunHours').value);
  const eff = parseFloat(document.getElementById('calcSolarEff').value) / 100;

  if (isNaN(panelW) || panelW <= 0 || isNaN(battWh) || battWh <= 0) { if (typeof showToast === 'function') showToast('Enter valid panel and battery values.', 3000); return; }

  const effectiveW = panelW * eff;
  const dailyWh = effectiveW * sunHrs;
  const days = battWh / dailyWh;
  const totalHours = battWh / effectiveW;

  let timeStr;
  if (days < 1) {
    const h = Math.floor(totalHours);
    const m = Math.round((totalHours - h) * 60);
    timeStr = `${h}h ${m}m of direct sun`;
  } else {
    timeStr = `${days.toFixed(1)} days (${sunHrs}h peak sun/day)`;
  }

  document.getElementById('calcSolarResults').style.display = '';
  document.getElementById('calcSolarTime').textContent = timeStr;
  document.getElementById('calcSolarOutput').textContent = `${effectiveW.toFixed(0)}W effective (${panelW}W panel × ${(eff * 100).toFixed(0)}% efficiency) = ${dailyWh.toFixed(0)} Wh/day`;
}

// ═══════════════════════════════════════════════════════════
// REGISTER WITH TOOLS PANEL
// ═══════════════════════════════════════════════════════════
if (typeof registerTool === 'function') {
  registerTool({
    id: 'survival-calculators',
    name: 'SURVIVAL CALCULATORS',
    icon: ICONS.calculator,
    description: 'Water purification ratios, battery runtime, and solar charge time estimators',
    render: _calcRender,
    cleanup: function() { _calcActiveTab = 'water'; },
  });
}
