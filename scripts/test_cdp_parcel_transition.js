import { spawn } from 'child_process';

async function startChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  // Wait for port 9222 to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:9222/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start in time');
}

async function getPageWsUrl() {
  const res = await fetch('http://localhost:9222/json');
  const pages = await res.json();
  const target = pages.find(p => p.url.includes('localhost:3000') && p.type === 'page');
  if (!target) throw new Error('Could not find localhost:3000 page');
  return target.webSocketDebuggerUrl;
}

async function run() {
  const chromeProc = await startChrome();
  console.log('Chrome started');

  const cleanup = () => {
    try { chromeProc.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  const wsUrl = await getPageWsUrl();
  console.log('Connecting to:', wsUrl);
  const ws = new WebSocket(wsUrl);

  let id = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    } else if (data.method === 'Runtime.consoleAPICalled') {
      const args = data.params.args.map(a => a.value || a.description || '').join(' ');
      console.log(`[BROWSER CONSOLE ${data.params.type.toUpperCase()}]:`, args);
    } else if (data.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]:', data.params.exceptionDetails);
    }
  };

  await new Promise((res) => ws.onopen = res);
  console.log('WebSocket connected');

  // Enable Page, Console and Runtime
  await send('Page.enable');
  await send('Console.enable');
  await send('Runtime.enable');

  // Wait for document.readyState === 'complete' and realSatelliteGlobeInstance to exist
  for (let i = 0; i < 50; i++) {
    const ready = await send('Runtime.evaluate', {
      expression: `Boolean(document.readyState === 'complete' && window.realSatelliteGlobeInstance && typeof executeParcelSearch === 'function')`,
      returnByValue: true
    });
    if (ready.result.value) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // 1. Initial State Check
  console.log('\n--- 1. INITIAL STATE CHECK ---');
  const initState = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      const leafletMap = document.getElementById('parcelHdLeafletMap');
      return {
        viewMode: window.parcelMapState?.viewMode,
        activeMapStage: window.parcelMapState?.activeMapStage,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        globeHeight: globe ? globe.offsetHeight : 0,
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing',
        mapHeight: map ? map.offsetHeight : 0,
        leafletMapChildren: leafletMap ? leafletMap.children.length : 0,
        hasL: typeof L !== 'undefined',
        hasHdManager: typeof window.parcelHdMapManager !== 'undefined'
      };
    })()`,
    returnByValue: true
  });
  console.log('Initial DOM State:', initState.result.value);

  // 2. Trigger Search for 101
  console.log('\n--- 2. TRIGGERING SEARCH FOR 101 ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.getElementById('mainParcelSearchInput');
      input.value = '101';
      executeParcelSearch('101');
    })()`,
    returnByValue: true
  });

  // Wait 1 second (Globe flight starts)
  await new Promise(r => setTimeout(r, 1000));
  const flightState = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      return {
        viewMode: window.parcelMapState?.viewMode,
        searchState: window.parcelMapState?.searchState,
        isFlying: window.realSatelliteGlobeInstance?.isFlying,
        flyProgress: window.realSatelliteGlobeInstance?.flyProgress,
        flyDuration: window.realSatelliteGlobeInstance?.flyDuration,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing'
      };
    })()`,
    returnByValue: true
  });
  console.log('In-Flight State (t=1s):', flightState.result.value);

  // Wait 6 seconds for scroll, flight and transition to complete
  await new Promise(r => setTimeout(r, 6000));

  const postFlightState = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      const leafletMap = document.getElementById('parcelHdLeafletMap');
      const tiles = document.querySelectorAll('.leaflet-tile');
      const polys = document.querySelectorAll('.leaflet-overlay-pane path');
      const popup = document.querySelector('.leaflet-parcel-card');
      const anchoredMarker = document.getElementById('globeAnchoredParcelMarker');
      const globeCard = document.getElementById('globeParcelCard');

      return {
        viewMode: window.parcelMapState?.viewMode,
        activeMapStage: window.parcelMapState?.activeMapStage,
        searchState: window.parcelMapState?.searchState,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing',
        mapHeight: map ? map.offsetHeight : 0,
        mapWidth: map ? map.offsetWidth : 0,
        leafletTilesCount: tiles.length,
        polygonsCount: polys.length,
        hasPopup: !!popup,
        popupTitle: popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null,
        anchoredMarkerDisplay: anchoredMarker ? window.getComputedStyle(anchoredMarker).display : 'none',
        globeCardDisplay: globeCard ? window.getComputedStyle(globeCard).display : 'none'
      };
    })()`,
    returnByValue: true
  });
  console.log('\n--- 3. POST-FLIGHT & TRANSITION STATE ---');
  console.log('Parcel #101 Result:', postFlightState.result.value);

  // 4. Consecutive in-place search for Parcel #103
  console.log('\n--- 4. CONSECUTIVE IN-PLACE SEARCH FOR 103 ---');
  await send('Runtime.evaluate', {
    expression: `executeParcelSearch('103')`,
    returnByValue: true
  });
  await new Promise(r => setTimeout(r, 600));

  const state103 = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      const title = popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null;
      const selectedPoly = document.querySelector('.selected-parcel-polygon');
      return {
        viewMode: window.parcelMapState?.viewMode,
        selectedParcelId: window.parcelMapState?.selectedParcel?.parcelNumber,
        popupTitle: title,
        hasSelectedPolygon: !!selectedPoly,
        mapDisplay: window.getComputedStyle(document.getElementById('parcel2dMapContainer')).display
      };
    })()`,
    returnByValue: true
  });
  console.log('Parcel #103 Result:', state103.result.value);

  // 5. Consecutive in-place search for Parcel #104A
  console.log('\n--- 5. CONSECUTIVE IN-PLACE SEARCH FOR 104A ---');
  await send('Runtime.evaluate', {
    expression: `executeParcelSearch('104A')`,
    returnByValue: true
  });
  await new Promise(r => setTimeout(r, 600));

  const state104A = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      const title = popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null;
      const selectedPoly = document.querySelector('.selected-parcel-polygon');
      return {
        viewMode: window.parcelMapState?.viewMode,
        selectedParcelId: window.parcelMapState?.selectedParcel?.parcelNumber,
        popupTitle: title,
        hasSelectedPolygon: !!selectedPoly,
        mapDisplay: window.getComputedStyle(document.getElementById('parcel2dMapContainer')).display
      };
    })()`,
    returnByValue: true
  });
  console.log('Parcel #104A Result:', state104A.result.value);

  // 6. Consecutive in-place search for Parcel #108
  console.log('\n--- 6. CONSECUTIVE IN-PLACE SEARCH FOR 108 ---');
  await send('Runtime.evaluate', {
    expression: `executeParcelSearch('108')`,
    returnByValue: true
  });
  await new Promise(r => setTimeout(r, 600));

  const state108 = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.querySelector('.leaflet-parcel-card');
      const title = popup ? popup.querySelector('.leaflet-parcel-title')?.textContent : null;
      const selectedPoly = document.querySelector('.selected-parcel-polygon');
      return {
        viewMode: window.parcelMapState?.viewMode,
        selectedParcelId: window.parcelMapState?.selectedParcel?.parcelNumber,
        popupTitle: title,
        hasSelectedPolygon: !!selectedPoly,
        mapDisplay: window.getComputedStyle(document.getElementById('parcel2dMapContainer')).display
      };
    })()`,
    returnByValue: true
  });
  console.log('Parcel #108 Result:', state108.result.value);

  // 7. Test "🌍 Back to Global View"
  console.log('\n--- 7. TESTING BACK TO GLOBAL VIEW ---');
  await send('Runtime.evaluate', {
    expression: `window.parcelMapState.switchToGlobalGlobe()`,
    returnByValue: true
  });
  await new Promise(r => setTimeout(r, 600));

  const stateGlobal = await send('Runtime.evaluate', {
    expression: `(() => {
      const globe = document.getElementById('globeCanvasContainer');
      const map = document.getElementById('parcel2dMapContainer');
      const switcher = document.getElementById('globeTypeSwitcher');
      const quickJumps = document.getElementById('globeQuickJumps');
      return {
        viewMode: window.parcelMapState?.viewMode,
        activeMapStage: window.parcelMapState?.activeMapStage,
        globeDisplay: globe ? window.getComputedStyle(globe).display : 'missing',
        mapDisplay: map ? window.getComputedStyle(map).display : 'missing',
        switcherDisplay: switcher ? window.getComputedStyle(switcher).display : 'missing',
        quickJumpsDisplay: quickJumps ? window.getComputedStyle(quickJumps).display : 'missing'
      };
    })()`,
    returnByValue: true
  });
  console.log('Back to Globe Result:', stateGlobal.result.value);

  // Close Chrome
  ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Error running test:', err);
  process.exit(1);
});
