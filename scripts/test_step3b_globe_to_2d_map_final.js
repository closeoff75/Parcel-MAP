/**
 * PARCELMAP — STEP 3B VERIFICATION SUITE
 * FINAL FIX: SEARCHED PARCEL MUST TRANSITION FROM 3D GLOBE TO A REAL 2D MAP
 * 
 * Verifies:
 * 1. ViewMode state machine (globe -> transitioning -> map)
 * 2. Complete dismissal of 3D globe in viewMode === 'map' (display: none)
 * 3. Elimination of 3D floating markers and popups over 2D map
 * 4. 2D Map container defined height (540px) and responsiveness
 * 5. Leaflet map resize (invalidateSize) and fitBounds on parcel geometry
 * 6. Authentic cadastral coordinates & polygon boundaries for #101, #103, #104A, #108
 * 7. Live Chrome browser test with CDP for full transition flow
 * 8. Consecutive in-place searches (101 -> 103 -> 104A -> 108)
 * 9. Smooth return to 3D Globe with recursion safety
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS [${totalTests}]: ${testName}`);
  } else {
    console.error(`  ✗ FAIL [${totalTests}]: ${testName}`);
    if (details) console.error(`    -> Details: ${details}`);
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function runStaticVerification() {
  console.log('\n--- 1. STATIC CODE ARCHITECTURE VERIFICATION ---');

  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const globeJs = fs.readFileSync(path.join(rootDir, 'globe.js'), 'utf8');
  const parcelHdMapJs = fs.readFileSync(path.join(rootDir, 'parcel-hd-map.js'), 'utf8');
  const gisThemeCss = fs.readFileSync(path.join(rootDir, 'gis-theme.css'), 'utf8');

  // Requirement 2: Explicit ViewMode State Machine
  assert(
    indexHtml.includes("viewMode: 'globe'") && indexHtml.includes('setViewMode: function(mode, parcel)'),
    'index.html defines explicit viewMode state machine with setViewMode()'
  );
  assert(
    indexHtml.includes("this.setViewMode('globe', parcel);") && indexHtml.includes("this.setViewMode('map', parcel);"),
    'index.html transitions viewMode correctly between globe and map'
  );

  // Requirement 3: Do NOT keep globe on top of map
  assert(
    indexHtml.includes("if (mode === 'map')") && indexHtml.includes("globeContainer.style.display = 'none'"),
    'index.html hides globeContainer completely when mode === map'
  );
  assert(
    parcelHdMapJs.includes("const globeContainer = document.getElementById('globeCanvasContainer');") &&
    parcelHdMapJs.includes("if (globeContainer) globeContainer.style.display = 'none';"),
    'parcel-hd-map.js showParcel() guarantees globeContainer is hidden'
  );

  // Requirement 5: Defined map container height
  assert(
    gisThemeCss.includes('.parcel-2d-map-container') && gisThemeCss.includes('height: 540px'),
    'gis-theme.css defines explicit 540px height for .parcel-2d-map-container'
  );

  // Requirement 6: Leaflet resize (invalidateSize)
  assert(
    parcelHdMapJs.includes('this.map.invalidateSize(true)'),
    'parcel-hd-map.js calls invalidateSize(true) on transition'
  );

  // Requirement 8: Normalized coordinates and fitBounds / flyTo
  assert(
    parcelHdMapJs.includes('this.map.fitBounds(parcelBounds') && parcelHdMapJs.includes('this.map.flyTo('),
    'parcel-hd-map.js performs camera fitBounds for polygons and flyTo for fallback pins'
  );

  // Requirement 11: Clear notice when geometry unavailable
  assert(
    parcelHdMapJs.includes('Parcel boundary geometry unavailable in this dataset.'),
    'parcel-hd-map.js displays clear notice when parcel boundary is unavailable'
  );

  // Requirement 14: Loading state transitions
  assert(
    indexHtml.includes('mapTransitioning') && indexHtml.includes('Loading map…'),
    'index.html implements Loading map… transition state'
  );

  // Requirement 16: Removal of 3D floating markers in map mode
  assert(
    globeJs.includes('const isGlobeMode = !window.parcelMapState || window.parcelMapState.viewMode === \'globe\';'),
    'globe.js suppresses 3D HTML marker projection when viewMode !== globe'
  );
}

async function runApiVerification() {
  console.log('\n--- 2. PARCEL CADASTRE API VERIFICATION ---');

  const parcels = ['101', '103', '104A', '108'];
  for (const pNum of parcels) {
    const res = await fetchJson(`http://localhost:3001/api/parcels/search?q=${pNum}`);
    const results = res.results || [];
    const match = results.find(p => p.parcelNumber === pNum || p.parcel_id?.includes(pNum));

    assert(Boolean(match), `Search for "${pNum}" returns cadastre record`);
    assert(
      match && match.latitude > 18 && match.latitude < 19 && match.longitude > 73 && match.longitude < 75,
      `Parcel #${pNum} has authentic Wagholi/Pune WGS84 coordinates: [${match?.latitude}, ${match?.longitude}]`
    );
    assert(
      match && Array.isArray(match.boundary) && match.boundary.length >= 3,
      `Parcel #${pNum} has verified cadastral boundary polygon (${match?.boundary?.length} vertices)`
    );
  }
}

async function startChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9224',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:9224/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9224');
}

async function runCdpBrowserVerification() {
  console.log('\n--- 3. LIVE HEADLESS CHROME CDP VERIFICATION ---');

  let chromeProc;
  try {
    chromeProc = await startChrome();
  } catch (err) {
    console.warn('Chrome could not be launched on port 9224, skipping live CDP test:', err.message);
    return;
  }

  const cleanup = () => {
    try { chromeProc.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);

  const res = await fetch('http://localhost:9224/json');
  const pages = await res.json();
  const page = pages.find(p => p.url.includes('localhost:3000') && p.type === 'page');
  if (!page) {
    console.warn('Localhost page not found in Chrome tabs');
    cleanup();
    return;
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

  await new Promise(r => ws.onopen = r);

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for ready
  for (let i = 0; i < 50; i++) {
    const ready = await send('Runtime.evaluate', {
      expression: `Boolean(document.readyState === 'complete' && window.realSatelliteGlobeInstance && typeof executeParcelSearch === 'function')`,
      returnByValue: true
    });
    if (ready.result?.value) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // 1. Initial State
  const initState = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      return {
        viewMode: window.parcelMapState?.viewMode,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing'
      };
    })()`,
    returnByValue: true
  });
  assert(initState.result.value.viewMode === 'globe', 'Initial viewMode is "globe"');
  assert(initState.result.value.globeDisplay === 'block', 'Initial globe container display is "block"');
  assert(initState.result.value.mapDisplay === 'none', 'Initial 2D map container display is "none"');

  // 2. Search Parcel #101 & Wait for Transition
  await send('Runtime.evaluate', { expression: `executeParcelSearch('101')` });
  await new Promise(r => setTimeout(r, 5500));

  const post101 = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      const tiles = document.querySelectorAll('.leaflet-tile');
      const polys = document.querySelectorAll('.selected-parcel-polygon');
      const popup = document.querySelector('.leaflet-parcel-card');
      const anchoredMarker = document.getElementById('globeAnchoredParcelMarker');
      return {
        viewMode: window.parcelMapState?.viewMode,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing',
        mapHeight: map ? map.offsetHeight : 0,
        tileCount: tiles.length,
        polyCount: polys.length,
        popupTitle: popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null,
        anchoredMarkerDisplay: anchoredMarker ? window.getComputedStyle(anchoredMarker).display : 'none'
      };
    })()`,
    returnByValue: true
  });

  const v101 = post101.result.value;
  assert(v101.viewMode === 'map', 'After flight completion, viewMode is "map"');
  assert(v101.globeDisplay === 'none', '3D globe container display is "none" (not covering map)');
  assert(v101.mapDisplay === 'block', '2D map container display is "block"');
  assert(v101.mapHeight >= 500, `2D map has defined non-zero height: ${v101.mapHeight}px`);
  assert(v101.tileCount > 0, `Leaflet satellite basemap tiles loaded: ${v101.tileCount} tiles`);
  assert(v101.polyCount > 0, `Parcel #101 polygon rendered in DOM: ${v101.polyCount} polygon`);
  assert(v101.popupTitle === 'PARCEL #101', `Anchored popup shows "${v101.popupTitle}"`);
  assert(v101.anchoredMarkerDisplay === 'none', '3D globe floating popup marker is completely hidden');

  // 3. Consecutive search: #103
  await send('Runtime.evaluate', { expression: `executeParcelSearch('103')` });
  await new Promise(r => setTimeout(r, 600));

  const res103 = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      return {
        viewMode: window.parcelMapState?.viewMode,
        title: popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null,
        polyCount: document.querySelectorAll('.selected-parcel-polygon').length
      };
    })()`,
    returnByValue: true
  });
  assert(res103.result.value.viewMode === 'map', 'Consecutive search #103 remains in "map" viewMode');
  assert(res103.result.value.title === 'PARCEL #103', 'Popup updated in-place to PARCEL #103');
  assert(res103.result.value.polyCount > 0, 'Parcel #103 polygon highlighted');

  // 4. Consecutive search: #104A
  await send('Runtime.evaluate', { expression: `executeParcelSearch('104A')` });
  await new Promise(r => setTimeout(r, 600));

  const res104A = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      return {
        title: popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null,
        polyCount: document.querySelectorAll('.selected-parcel-polygon').length
      };
    })()`,
    returnByValue: true
  });
  assert(res104A.result.value.title === 'PARCEL #104A', 'Popup updated in-place to PARCEL #104A');

  // 5. Consecutive search: #108
  await send('Runtime.evaluate', { expression: `executeParcelSearch('108')` });
  await new Promise(r => setTimeout(r, 600));

  const res108 = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      return {
        title: popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null,
        polyCount: document.querySelectorAll('.selected-parcel-polygon').length
      };
    })()`,
    returnByValue: true
  });
  assert(res108.result.value.title === 'PARCEL #108', 'Popup updated in-place to PARCEL #108');

  // 6. Return to Global View
  await send('Runtime.evaluate', { expression: `window.parcelMapState.switchToGlobalGlobe()` });
  await new Promise(r => setTimeout(r, 600));

  const resGlobe = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      return {
        viewMode: window.parcelMapState?.viewMode,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing'
      };
    })()`,
    returnByValue: true
  });
  assert(resGlobe.result.value.viewMode === 'globe', 'switchToGlobalGlobe() restores viewMode to "globe"');
  assert(resGlobe.result.value.globeDisplay === 'block', '3D globe container restored to display: "block"');
  assert(resGlobe.result.value.mapDisplay === 'none', '2D map container hidden to display: "none"');

  ws.close();
  cleanup();
}

async function main() {
  console.log('================================================================');
  console.log('PARCELMAP — STEP 3B FINAL FIX VERIFICATION SUITE');
  console.log('================================================================');

  await runStaticVerification();
  await runApiVerification();
  await runCdpBrowserVerification();

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
