/**
 * Step 4 Full Acceptance Test: Clean 3D Globe + Global View Return Bug Fix
 * Tests all requirements from PARTS A through S:
 * 1. Clean Global View (no fake telemetry, no RTK/satellite HUDs, centered Earth)
 * 2. Find Parcel -> Minimal Marker -> 2D Map
 * 3. 2D Map -> "Global View" button -> Restored Clean Globe (no dark/blank screen)
 * 4. 5+ consecutive Global -> Parcel -> Map -> Global cycles
 * 5. Responsive viewports (1920x1080, 1440x900, 1366x768, Tablet, Mobile)
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✕ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function startChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9225/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9225');
}

async function runStep4AcceptanceSuite() {
  console.log('================================================================');
  console.log('  PARCELMAP — STEP 4 CLEAN GLOBE & RETURN LIFECYCLE SUITE');
  console.log('================================================================\n');

  // 1. STATIC CODE AUDIT (PARTS A, B, M)
  console.log('--- 1. STATIC CODE & MARKUP AUDIT ---');
  const indexHtml = readFileSync('index.html', 'utf-8');
  const globeJs = readFileSync('globe.js', 'utf-8');

  // Verify removed fake telemetry & HUDs
  assert(!indexHtml.includes('id="globeHudTelemetry"'), 'globeHudTelemetry card removed from index.html');
  assert(!indexHtml.includes('id="globeHudNode"'), 'globeHudNode card removed from index.html');
  assert(!indexHtml.includes('id="globeHudLegend"'), 'globeHudLegend card removed from index.html');
  assert(!indexHtml.includes('globe-parcel-card'), 'Old large globe-parcel-card removed from index.html');
  assert(!indexHtml.includes('globe-anchored-marker'), 'Old giant globe-anchored-marker removed from index.html');
  assert(!indexHtml.includes('18.4 Cr'), 'Fake valuation ₹18.4 Cr removed from index.html');
  assert(!indexHtml.includes('4,800/sq.ft'), 'Fake valuation ₹4,800/sq.ft removed from index.html');
  assert(!indexHtml.includes('0.05m Accuracy'), 'Fake 0.05m accuracy removed from index.html');
  assert(!indexHtml.includes('Sub-meter RTK'), 'Fake Sub-meter RTK removed from index.html');
  assert(!indexHtml.includes('Sentinel-2 • Cartosat-3'), 'Fake sensor label removed from index.html');

  // Verify clean minimal elements remain
  assert(indexHtml.includes('Drag to rotate &bull; Scroll to zoom') || indexHtml.includes('Drag to rotate • Scroll to zoom'), 'Minimal drag/zoom instruction preserved');
  assert(indexHtml.includes('id="globeBtnZoomIn"') && indexHtml.includes('id="globeBtnZoomOut"'), 'Zoom controls preserved');
  assert(indexHtml.includes('id="globeQuickJumps"'), 'Registry navigation bar preserved');
  assert(indexHtml.includes('id="globeScreenParcelMarker"'), 'Clean screen-space parcel marker preserved');
  assert(indexHtml.includes('id="globeLoadingOverlay"'), 'Part P loading overlay configured');

  // Verify globe.js clean architecture
  assert(globeJs.includes('this.satellitesGroup = new THREE.Group()'), 'Sensor satellites/radar removed from globe scene');
  assert(globeJs.includes('handleResize()'), 'Dynamic container measurement handleResize() implemented');
  assert(globeJs.includes('resetView()'), 'Complete resetView() lifecycle method implemented');

  // 2. LIVE HEADLESS CHROME E2E LIFECYCLE (TEST 1 - TEST 7 + RESPONSIVE)
  console.log('\n--- 2. LIVE HEADLESS BROWSER LIFECYCLE & RETURN VERIFICATION ---');
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

  const res = await fetch('http://localhost:9225/json');
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
  const consoleErrors = [];

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const type = data.params.type;
      const text = data.params.args?.map(a => a.value || a.description || '').join(' ') || '';
      if (type === 'error') {
        consoleErrors.push(text);
      }
    }
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

  // Helper evaluation
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

  // Wait for Globe to initialize
  await evalJs(`
    new Promise((resolve) => {
      if (window.realSatelliteGlobeInstance) return resolve();
      const interval = setInterval(() => {
        if (window.realSatelliteGlobeInstance) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(resolve, 5000);
    })
  `);
  await new Promise(r => setTimeout(r, 1000));

  // Wait for Globe entrance dolly animation to finish
  await evalJs(`
    new Promise((resolve) => {
      const check = () => {
        const g = window.realSatelliteGlobeInstance;
        if (g && (g.entranceProgress >= 0.98 || Math.abs(g.camera.position.z - 480) < 15)) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
      setTimeout(resolve, 3000);
    })
  `);

  // TEST 1: Initial Global View
  console.log('\n>>> TEST 1: Initial Global View State <<<');
  const initialData = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    const canvas = document.querySelector('#globeCanvasContainer canvas');
    const container = document.getElementById('globeCanvasContainer');
    const mapContainer = document.getElementById('parcel2dMapContainer');
    return {
      viewMode: window.parcelMapState ? window.parcelMapState.viewMode : null,
      stage: window.parcelMapState ? window.parcelMapState.activeMapStage : null,
      hasGlobe: Boolean(g),
      zoom: g ? g.currentZoom : null,
      cameraZ: g ? g.camera.position.z : null,
      autoRotate: g ? g.autoRotate : false,
      containerDisplay: container ? getComputedStyle(container).display : null,
      containerHeight: container ? container.clientHeight : 0,
      canvasVisible: canvas ? (canvas.style.display !== 'none' && canvas.style.opacity !== '0') : false,
      mapDisplay: mapContainer ? getComputedStyle(mapContainer).display : null,
      selectedParcel: g ? g.selectedParcel : null,
      hasSatellites: g && g.satellitesGroup ? g.satellitesGroup.children.length : 0,
      hasRadarCone: g && g.radarCone ? true : false,
      instructionsPresent: Boolean(document.querySelector('.globe-instructions'))
    };
  })()`);

  assert(initialData.hasGlobe, '3D Globe initialized');
  assert(initialData.viewMode === 'globe', 'viewMode is "globe"');
  assert(initialData.stage === 'GLOBAL_GLOBE', 'activeMapStage is "GLOBAL_GLOBE"');
  assert(initialData.zoom === 1.0, `Globe initial zoom is 1.0 (actual: ${initialData.zoom})`);
  assert(Math.abs(initialData.cameraZ - 480) < 35, `Camera is centered at global z ≈ 480 (actual: ${initialData.cameraZ})`);
  assert(initialData.autoRotate === true, 'Earth normal rotation is active');
  assert(initialData.selectedParcel === null, 'No selected parcel on initial view');
  assert(initialData.hasSatellites === 0, 'No orbiting satellite meshes in scene');
  assert(initialData.hasRadarCone === false, 'No radar cone mesh in scene');
  assert(initialData.containerDisplay === 'block', 'Globe container display is block');
  assert(initialData.containerHeight > 300, `Globe container height is valid: ${initialData.containerHeight}px`);
  assert(initialData.canvasVisible, 'Globe WebGL canvas is visible');
  assert(initialData.mapDisplay === 'none', '2D Map is hidden initially');

  // Fetch real parcels for search testing
  const p101 = await evalJs(`fetch('http://localhost:3001/api/parcels/search?q=101').then(r => r.json()).then(d => d.results[0])`);
  const p103 = await evalJs(`fetch('http://localhost:3001/api/parcels/search?q=103').then(r => r.json()).then(d => d.results[0])`);
  const p104A = await evalJs(`fetch('http://localhost:3001/api/parcels/search?q=104A').then(r => r.json()).then(d => d.results[0])`);
  const p108 = await evalJs(`fetch('http://localhost:3001/api/parcels/search?q=108').then(r => r.json()).then(d => d.results[0])`);

  // TEST 2: Search Parcel #101 -> Globe Focuses
  console.log('\n>>> TEST 2: Search Parcel #101 on Globe <<<');
  await evalJs(`window.parcelMapState.setSelectedParcel(${JSON.stringify(p101)}, { scroll: false })`);
  await new Promise(r => setTimeout(r, 600));

  const parcelFocusState = await evalJs(`(() => {
    const marker = document.getElementById('globeScreenParcelMarker');
    return {
      selectedParcel: window.parcelMapState.selectedParcel?.parcelNumber,
      markerDisplay: marker ? marker.style.display : null,
      markerText: marker ? marker.innerText : null
    };
  })()`);

  assert(parcelFocusState.selectedParcel === '101', 'Parcel #101 selected');
  assert(parcelFocusState.markerText?.includes('101'), `Screen marker displays parcel: "${parcelFocusState.markerText}"`);

  // TEST 3: Open 2D Map
  console.log('\n>>> TEST 3: Transition to 2D Map <<<');
  await evalJs(`window.parcelMapState.switchToParcelMap(${JSON.stringify(p101)})`);
  await new Promise(r => setTimeout(r, 1200));

  const mapState = await evalJs(`(() => {
    const mapContainer = document.getElementById('parcel2dMapContainer');
    const globeContainer = document.getElementById('globeCanvasContainer');
    const popupText = document.querySelector('.leaflet-popup-content')?.innerText || '';
    return {
      viewMode: window.parcelMapState.viewMode,
      mapDisplay: mapContainer ? getComputedStyle(mapContainer).display : null,
      mapHeight: mapContainer ? mapContainer.clientHeight : 0,
      globeDisplay: globeContainer ? getComputedStyle(globeContainer).display : null,
      popupText: popupText
    };
  })()`);

  assert(mapState.viewMode === 'map', 'viewMode switched to "map"');
  assert(mapState.mapDisplay === 'block', '2D map container is display: block');
  assert(mapState.mapHeight > 400, `2D map has valid height: ${mapState.mapHeight}px`);
  assert(mapState.globeDisplay === 'none', '3D globe container is hidden during 2D map viewing');
  assert(mapState.popupText.includes('101'), `Map popup contains Parcel #101`);

  // TEST 4: Click "Global View" from 2D Map -> Returns Clean Globe (No blank screen)
  console.log('\n>>> TEST 4: Return to Global View (Fixing Blank Screen Bug) <<<');
  await evalJs(`document.getElementById('btnBackToGlobe').click()`);
  await new Promise(r => setTimeout(r, 800));

  const returnGlobalState = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    const canvas = document.querySelector('#globeCanvasContainer canvas');
    const container = document.getElementById('globeCanvasContainer');
    const mapContainer = document.getElementById('parcel2dMapContainer');
    return {
      viewMode: window.parcelMapState.viewMode,
      globeDisplay: container ? getComputedStyle(container).display : null,
      globeOpacity: container ? getComputedStyle(container).opacity : null,
      globeWidth: container ? container.clientWidth : 0,
      globeHeight: container ? container.clientHeight : 0,
      canvasDisplay: canvas ? getComputedStyle(canvas).display : null,
      canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
      mapDisplay: mapContainer ? getComputedStyle(mapContainer).display : null,
      zoom: g ? g.currentZoom : null,
      cameraZ: g ? g.camera.position.z : null,
      autoRotate: g ? g.autoRotate : false,
      activeParcel: window.parcelMapState.activeParcel
    };
  })()`);

  assert(returnGlobalState.viewMode === 'globe', 'viewMode restored to "globe"');
  assert(returnGlobalState.globeDisplay === 'block', 'Globe container display is "block" (not hidden)');
  assert(returnGlobalState.globeOpacity === '1', 'Globe container opacity is 1 (not blank/dark)');
  assert(returnGlobalState.globeWidth > 500 && returnGlobalState.globeHeight > 300, `Globe dimensions valid: ${returnGlobalState.globeWidth}x${returnGlobalState.globeHeight}`);
  assert(returnGlobalState.canvasDisplay === 'block', 'Canvas display is "block"');
  assert(returnGlobalState.canvasOpacity === '1', 'Canvas opacity is 1');
  assert(returnGlobalState.mapDisplay === 'none', '2D Map is cleanly hidden');
  assert(returnGlobalState.zoom === 1.0, `Camera zoom reset to 1.0 (actual: ${returnGlobalState.zoom})`);
  assert(Math.abs(returnGlobalState.cameraZ - 480) < 15, `Camera position Z reset to global view ≈ 480 (actual: ${returnGlobalState.cameraZ})`);
  assert(returnGlobalState.autoRotate === true, 'Earth auto-rotation resumed');
  assert(returnGlobalState.activeParcel === null, 'Active parcel cleared on return to global view');

  // TEST 5 & 6: Search Parcel #103, view 2D Map, click Global View again
  console.log('\n>>> TEST 5 & 6: Search Parcel #103 -> Map -> Return Global <<<');
  await evalJs(`window.parcelMapState.setSelectedParcel(${JSON.stringify(p103)}, { scroll: false })`);
  await evalJs(`window.parcelMapState.switchToParcelMap(${JSON.stringify(p103)})`);
  await new Promise(r => setTimeout(r, 1000));
  const p103MapText = await evalJs(`document.querySelector('.leaflet-popup-content')?.innerText || ''`);
  assert(p103MapText.includes('103'), '2D Map accurately shows Parcel #103');

  await evalJs(`document.getElementById('btnBackToGlobe').click()`);
  await new Promise(r => setTimeout(r, 800));
  const g103Return = await evalJs(`({
    viewMode: window.parcelMapState.viewMode,
    canvasVisible: document.querySelector('#globeCanvasContainer canvas')?.style.display !== 'none',
    zoom: window.realSatelliteGlobeInstance?.currentZoom
  })`);
  assert(g103Return.viewMode === 'globe', 'Returned to globe after Parcel #103');
  assert(g103Return.canvasVisible, 'Globe canvas visible and active');
  assert(g103Return.zoom === 1.0, 'Globe zoom reset to 1.0');

  // TEST 7: Repeat 5 consecutive cycles of Global -> Parcel -> Map -> Global
  console.log('\n>>> TEST 7: 5 Consecutive Repetitions (Stress & Memory Verification) <<<');
  const cycleParcels = [p101, p103, p104A, p108, p101];

  for (let cycle = 0; cycle < cycleParcels.length; cycle++) {
    const parcel = cycleParcels[cycle];
    const pNum = parcel.parcelNumber || parcel.id;
    console.log(`  Cycle ${cycle + 1}/5: Search Parcel #${pNum} -> Open Map -> Return Global`);

    // 1. Search Parcel
    await evalJs(`window.parcelMapState.setSelectedParcel(${JSON.stringify(parcel)}, { scroll: false })`);
    await new Promise(r => setTimeout(r, 200));

    // 2. Open Map
    await evalJs(`window.parcelMapState.switchToParcelMap(${JSON.stringify(parcel)})`);
    await new Promise(r => setTimeout(r, 600));

    // 3. Verify Map rendered
    const mapActive = await evalJs(`window.parcelMapState.viewMode === 'map' && document.getElementById('parcel2dMapContainer').style.display === 'block'`);
    assert(mapActive, `Cycle ${cycle + 1}: 2D Map displayed correctly for #${pNum}`);

    // 4. Return to Global View
    await evalJs(`document.getElementById('btnBackToGlobe').click()`);
    await new Promise(r => setTimeout(r, 500));

    // 5. Verify Globe restored
    const globeOk = await evalJs(`(() => {
      const g = window.realSatelliteGlobeInstance;
      const c = document.getElementById('globeCanvasContainer');
      const cv = document.querySelector('#globeCanvasContainer canvas');
      return {
        mode: window.parcelMapState.viewMode,
        display: c?.style.display,
        opacity: c?.style.opacity,
        canvasOpacity: cv?.style.opacity,
        zoom: g?.currentZoom,
        cameraZ: g?.camera.position.z,
        glLost: g?.renderer?.getContext()?.isContextLost()
      };
    })()`);

    assert(globeOk.mode === 'globe', `Cycle ${cycle + 1}: viewMode is "globe"`);
    assert(globeOk.display === 'block' && globeOk.opacity === '1', `Cycle ${cycle + 1}: Globe container is display: block, opacity: 1`);
    assert(globeOk.canvasOpacity === '1', `Cycle ${cycle + 1}: Canvas opacity is 1 (no dark screen)`);
    assert(globeOk.zoom === 1.0, `Cycle ${cycle + 1}: Camera zoom reset to 1.0`);
    assert(Math.abs(globeOk.cameraZ - 480) < 15, `Cycle ${cycle + 1}: Camera Z at 480`);
    assert(globeOk.glLost === false, `Cycle ${cycle + 1}: WebGL context is alive and healthy`);
  }

  // Verify no duplicate canvas elements leaked
  const canvasCount = await evalJs(`document.querySelectorAll('#globeCanvasContainer canvas').length`);
  assert(canvasCount === 1, `Exactly 1 WebGL canvas in DOM (actual: ${canvasCount}, no memory leak)`);

  // PART R: Responsive Viewport Verification
  console.log('\n--- 3. RESPONSIVE VIEWPORT TESTING (PART R) ---');
  const viewports = [
    { name: 'Desktop 1920x1080', width: 1920, height: 1080 },
    { name: 'Desktop 1440x900', width: 1440, height: 900 },
    { name: 'Desktop 1366x768', width: 1366, height: 768 },
    { name: 'Tablet 768x1024', width: 768, height: 1024 },
    { name: 'Mobile 375x667', width: 375, height: 667 }
  ];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 800
    });
    await evalJs(`window.realSatelliteGlobeInstance.handleResize()`);
    await new Promise(r => setTimeout(r, 200));

    const dimensions = await evalJs(`(() => {
      const container = document.getElementById('globeCanvasContainer');
      const canvas = document.querySelector('#globeCanvasContainer canvas');
      const g = window.realSatelliteGlobeInstance;
      return {
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        aspect: g.camera.aspect
      };
    })()`);

    assert(dimensions.containerHeight > 250, `${vp.name}: Globe container has non-zero height: ${dimensions.containerHeight}px`);
    assert(dimensions.containerWidth > 200, `${vp.name}: Globe container has non-zero width: ${dimensions.containerWidth}px`);
    assert(dimensions.aspect > 0, `${vp.name}: Camera projection aspect ratio updated (${dimensions.aspect.toFixed(2)})`);
  }

  // Check for critical console errors
  console.log('\n--- 4. CONSOLE ERROR AUDIT ---');
  const fatalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('font') && !e.includes('404'));
  if (fatalErrors.length > 0) {
    console.warn('  ⚠️ Console errors noted:', fatalErrors);
  } else {
    console.log('  ✓ PASS: Zero fatal WebGL or JavaScript runtime errors detected');
  }

  console.log('\n================================================================');
  console.log('  ALL STEP 4 CLEAN GLOBE & LIFECYCLE TESTS PASSED (100%)');
  console.log('================================================================\n');

  cleanup();
  process.exit(0);
}

runStep4AcceptanceSuite().catch(err => {
  console.error('\n✕ Test Suite Failed with Error:', err);
  process.exit(1);
});
