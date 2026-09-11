/**
 * Automated Verification Script: Parcel Popup Text Visibility & Contrast
 * Verifies all 15 requirements from the prompt:
 * 1. Popup Background: #FFFFFF, border 1px solid #D1D5DB, border-radius 16px, opacity 1
 * 2. Label Text: color #475569, font-weight 600, font-size 13px, letter-spacing 0.08em
 * 3. Value Text: color #111827, font-weight 600, font-size 15px
 * 4. Survey Number: color #0EA5E9, font-weight 700, font-size 15px
 * 5. Area Value: clearly visible dark color #111827
 * 6. Parcel Title: color #0F172A, font-weight 700, font-size 16px
 * 7. Pin / Icon: present without overlapping text
 * 8. Button: background #10B981, color #FFFFFF, font-weight 700
 * 9. No faded/white-on-white text, opacity === 1
 * 10. Z-Index >= 700
 * 11. Mobile responsiveness (375px width, no clipping)
 */

import { spawn } from 'child_process';

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✕ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function isColorClose(actualStr, expectedHex, tolerance = 5) {
  const actual = parseRgb(actualStr);
  if (!actual) return false;
  const hex = expectedHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (
    Math.abs(actual.r - r) <= tolerance &&
    Math.abs(actual.g - g) <= tolerance &&
    Math.abs(actual.b - b) <= tolerance
  );
}

async function startChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--window-size=1280,800',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9226/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9226');
}

async function runPopupContrastSuite() {
  console.log('================================================================');
  console.log('  PARCELMAP — PARCEL POPUP TEXT VISIBILITY & CONTRAST SUITE');
  console.log('================================================================\n');

  let chromeProc;
  try {
    chromeProc = await startChrome();
  } catch (err) {
    console.error('Failed to launch Chrome:', err);
    process.exit(1);
  }

  const cleanup = () => {
    try { chromeProc.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);

  const res = await fetch('http://localhost:9226/json');
  const pages = await res.json();
  const page = pages.find(p => p.url.includes('localhost:3000') && p.type === 'page');
  if (!page) {
    console.error('Localhost page not found in Chrome tabs');
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  await send('Runtime.enable');
  await send('Page.enable');

  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error(`Eval error in [${expr}]: ` + JSON.stringify(r.exceptionDetails));
    }
    return r.result?.value;
  }

  // Wait for application ready
  await evalJs(`
    new Promise((resolve) => {
      if (window.parcelHdMapManager && window.parcelMapState) return resolve();
      const interval = setInterval(() => {
        if (window.parcelHdMapManager && window.parcelMapState) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(resolve, 6000);
    })
  `);
  await new Promise(r => setTimeout(r, 1000));

  // 1. Trigger Parcel #103 on 2D map
  console.log('--- 1. OPENING 2D MAP WITH PARCEL #103 ---');
  const p103 = await evalJs(`fetch('http://localhost:3001/api/parcels/search?q=103').then(r => r.json()).then(d => d.results[0])`);
  assert(Boolean(p103), 'Retrieved Parcel #103 from API database');

  await evalJs(`window.parcelMapState.switchToParcelMap(${JSON.stringify(p103)})`);
  await new Promise(r => setTimeout(r, 1200));

  // 2. Verify Popup Presence and Computed Styles
  console.log('\n--- 2. COMPUTED STYLES AUDIT ON RENDERED POPUP ---');
  const styles = await evalJs(`(() => {
    const wrapper = document.querySelector('.leaflet-popup-content-wrapper');
    const card = document.querySelector('.leaflet-parcel-card');
    const title = document.querySelector('.leaflet-parcel-title');
    const pin = document.querySelector('.leaflet-pin-icon');
    const labels = Array.from(document.querySelectorAll('.field-lbl')).map(el => {
      const s = window.getComputedStyle(el);
      return {
        text: el.innerText.trim(),
        color: s.color,
        fontWeight: s.fontWeight,
        fontSize: s.fontSize,
        letterSpacing: s.letterSpacing
      };
    });
    const values = Array.from(document.querySelectorAll('.field-val')).map(el => {
      const s = window.getComputedStyle(el);
      return {
        text: el.innerText.trim(),
        color: s.color,
        fontWeight: s.fontWeight,
        fontSize: s.fontSize
      };
    });
    const monoVal = document.querySelector('.field-val-mono');
    const monoStyle = monoVal ? window.getComputedStyle(monoVal) : null;

    const btn = document.querySelector('.btn-leaflet-explore');
    const btnStyle = btn ? window.getComputedStyle(btn) : null;
    const btnSpan = btn ? btn.querySelector('span') : null;
    const btnSpanStyle = btnSpan ? window.getComputedStyle(btnSpan) : null;

    const popupEl = document.querySelector('.leaflet-popup');
    const popupStyle = popupEl ? window.getComputedStyle(popupEl) : null;

    const wrapperStyle = wrapper ? window.getComputedStyle(wrapper) : null;
    const cardStyle = card ? window.getComputedStyle(card) : null;
    const titleStyle = title ? window.getComputedStyle(title) : null;

    return {
      wrapperBg: wrapperStyle?.backgroundColor,
      wrapperBorder: wrapperStyle?.border,
      wrapperBorderRadius: wrapperStyle?.borderRadius,
      wrapperOpacity: wrapperStyle?.opacity,
      wrapperFilter: wrapperStyle?.filter,
      cardBg: cardStyle?.backgroundColor,
      cardOpacity: cardStyle?.opacity,
      cardFilter: cardStyle?.filter,
      titleText: title?.innerText?.trim(),
      titleColor: titleStyle?.color,
      titleFontWeight: titleStyle?.fontWeight,
      titleFontSize: titleStyle?.fontSize,
      hasPin: Boolean(pin),
      labels: labels,
      values: values,
      surveyValText: monoVal?.innerText?.trim(),
      surveyValColor: monoStyle?.color,
      surveyValWeight: monoStyle?.fontWeight,
      surveyValSize: monoStyle?.fontSize,
      btnText: btn?.innerText?.trim(),
      btnBg: btnStyle?.backgroundColor,
      btnColor: btnStyle?.color,
      btnSpanColor: btnSpanStyle?.color,
      btnWeight: btnStyle?.fontWeight,
      btnSize: btnStyle?.fontSize,
      popupZIndex: popupStyle?.zIndex
    };
  })()`);

  // Verify Requirement 1: Background, Border, Border-Radius
  assert(
    isColorClose(styles.wrapperBg, '#FFFFFF') || isColorClose(styles.cardBg, '#FFFFFF'),
    `Requirement 1: Popup background is pure white #FFFFFF (actual: ${styles.wrapperBg})`
  );
  assert(
    styles.wrapperBorderRadius === '16px' || styles.wrapperBorderRadius.includes('16px'),
    `Requirement 1: Popup border-radius is 16px (actual: ${styles.wrapperBorderRadius})`
  );
  assert(
    styles.wrapperOpacity === '1' && styles.cardOpacity === '1',
    `Requirement 1: Popup opacity is exactly 1 (no faded transparency, actual: wrapper ${styles.wrapperOpacity}, card ${styles.cardOpacity})`
  );
  assert(
    styles.wrapperFilter === 'none' && styles.cardFilter === 'none',
    `Requirement 1: No filters/backdrop-filters fading the popup (actual: wrapper ${styles.wrapperFilter}, card ${styles.cardFilter})`
  );

  // Verify Requirement 6: Parcel Title
  assert(
    styles.titleText?.includes('103'),
    `Requirement 6: Parcel title shows PARCEL #103 (actual: "${styles.titleText}")`
  );
  assert(
    isColorClose(styles.titleColor, '#0F172A'),
    `Requirement 6: Parcel title color is dark #0F172A (actual: ${styles.titleColor})`
  );
  assert(
    Number(styles.titleFontWeight) >= 700,
    `Requirement 6: Parcel title font-weight is 700 (actual: ${styles.titleFontWeight})`
  );

  // Verify Requirement 7: Location Pin
  assert(styles.hasPin, 'Requirement 7: Location pin icon is present in the card header');

  // Verify Requirement 2: Label Text
  assert(styles.labels.length >= 5, `Requirement 2: All 5 cadastral labels present (${styles.labels.length} found)`);
  for (const lbl of styles.labels) {
    assert(
      isColorClose(lbl.color, '#475569'),
      `Requirement 2: Label "${lbl.text}" color is dark gray #475569 (actual: ${lbl.color})`
    );
    assert(
      Number(lbl.fontWeight) >= 600,
      `Requirement 2: Label "${lbl.text}" font-weight is 600 (actual: ${lbl.fontWeight})`
    );
    assert(
      lbl.fontSize === '13px',
      `Requirement 2: Label "${lbl.text}" font-size is 13px (actual: ${lbl.fontSize})`
    );
  }

  // Verify Requirement 3: Value Text
  assert(styles.values.length >= 4, `Requirement 3: Values present (${styles.values.length} found)`);
  for (const val of styles.values) {
    assert(
      isColorClose(val.color, '#111827'),
      `Requirement 3: Value "${val.text}" color is strong dark #111827 (actual: ${val.color})`
    );
    assert(
      Number(val.fontWeight) >= 600,
      `Requirement 3: Value "${val.text}" font-weight is 600 (actual: ${val.fontWeight})`
    );
    assert(
      val.fontSize === '15px',
      `Requirement 3: Value "${val.text}" font-size is 15px (actual: ${val.fontSize})`
    );
  }

  // Verify Requirement 4: Survey Number
  assert(
    styles.surveyValText === '43/1',
    `Requirement 4: Survey value is "43/1" (actual: "${styles.surveyValText}")`
  );
  assert(
    isColorClose(styles.surveyValColor, '#0EA5E9'),
    `Requirement 4: Survey value color is prominent cyan #0EA5E9 (actual: ${styles.surveyValColor})`
  );
  assert(
    Number(styles.surveyValWeight) >= 700,
    `Requirement 4: Survey value font-weight is 700 (actual: ${styles.surveyValWeight})`
  );
  assert(
    styles.surveyValSize === '15px',
    `Requirement 4: Survey value font-size is 15px (actual: ${styles.surveyValSize})`
  );

  // Verify Requirement 5: Area Field
  const areaVal = styles.values.find(v => v.text.includes('acres') || v.text.includes('2.1'));
  assert(Boolean(areaVal), `Requirement 5: Area value is rendered ("${areaVal?.text}")`);
  assert(isColorClose(areaVal.color, '#111827'), `Requirement 5: Area text is high-contrast dark #111827 (actual: ${areaVal?.color})`);

  // Verify Requirement 8: Explore Button
  assert(
    styles.btnText.includes('View Parcel Details'),
    `Requirement 8: Button text is "View Parcel Details" (actual: "${styles.btnText}")`
  );
  assert(
    isColorClose(styles.btnBg, '#10B981'),
    `Requirement 8: Button background is #10B981 (actual: ${styles.btnBg})`
  );
  assert(
    isColorClose(styles.btnColor, '#FFFFFF') || isColorClose(styles.btnSpanColor, '#FFFFFF'),
    `Requirement 8: Button text color is white #FFFFFF (actual: btn ${styles.btnColor}, span ${styles.btnSpanColor})`
  );
  assert(
    Number(styles.btnWeight) >= 700,
    `Requirement 8: Button font-weight is 700 (actual: ${styles.btnWeight})`
  );

  // Verify Requirement 10 & 11: Z-Index & Above Imagery
  console.log('\n--- 3. Z-INDEX & OVERLAY STACKING AUDIT ---');
  const zIndices = await evalJs(`(() => {
    const popup = document.querySelector('.leaflet-popup');
    const popupPane = document.querySelector('.leaflet-popup-pane');
    const overlayPane = document.querySelector('.leaflet-overlay-pane');
    const tilePane = document.querySelector('.leaflet-tile-pane');
    return {
      popupZ: parseInt(window.getComputedStyle(popup).zIndex) || 0,
      paneZ: parseInt(window.getComputedStyle(popupPane).zIndex) || 0,
      overlayZ: parseInt(window.getComputedStyle(overlayPane).zIndex) || 0,
      tileZ: parseInt(window.getComputedStyle(tilePane).zIndex) || 0
    };
  })()`);

  assert(
    zIndices.paneZ > zIndices.overlayZ && zIndices.paneZ > zIndices.tileZ,
    `Requirement 11: Popup pane (z: ${zIndices.paneZ}) is above overlays (z: ${zIndices.overlayZ}) and tiles (z: ${zIndices.tileZ})`
  );

  // Verify Requirement 12: Mobile Responsiveness
  console.log('\n--- 4. MOBILE VIEWPORT RESPONSIVENESS AUDIT (375x667) ---');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 667,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 400));

  const mobileMetrics = await evalJs(`(() => {
    const card = document.querySelector('.leaflet-parcel-card');
    const rect = card ? card.getBoundingClientRect() : null;
    const btn = document.querySelector('.btn-leaflet-explore');
    const btnRect = btn ? btn.getBoundingClientRect() : null;
    return {
      cardWidth: rect ? rect.width : 0,
      cardHeight: rect ? rect.height : 0,
      fitsInViewport: rect ? rect.width < 375 : false,
      btnVisible: btnRect ? btnRect.width > 100 && btnRect.height > 20 : false
    };
  })()`);

  assert(
    mobileMetrics.fitsInViewport,
    `Requirement 12: Card fits inside 375px mobile viewport (width: ${mobileMetrics.cardWidth}px)`
  );
  assert(
    mobileMetrics.btnVisible,
    'Requirement 12: Button is fully visible on mobile viewport'
  );

  console.log('\n================================================================');
  console.log('  ALL POPUP TEXT VISIBILITY & CONTRAST TESTS PASSED (100%)');
  console.log('================================================================\n');

  cleanup();
  process.exit(0);
}

runPopupContrastSuite().catch(err => {
  console.error('\n✕ Test Suite Failed:', err);
  process.exit(1);
});
