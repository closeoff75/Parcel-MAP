/**
 * Test: Verify clean globe on refresh (no info text in middle)
 * and ensure info appears upon clicking the Search button.
 */

import { spawn } from 'child_process';

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
    '--remote-debugging-port=9227',
    '--window-size=1280,800',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9227/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9227');
}

async function runTest() {
  console.log('================================================================');
  console.log('  TEST: CLEAN GLOBE ON REFRESH + INFO ON SEARCH BUTTON CLICK');
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

  const res = await fetch('http://localhost:9227/json');
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

  // 1. Initial Load / Refresh Verification
  console.log('--- 1. VERIFYING CLEAN GLOBE ON REFRESH ---');
  await evalJs(`
    new Promise((resolve) => {
      if (window.realSatelliteGlobeInstance) return resolve();
      const interval = setInterval(() => {
        if (window.realSatelliteGlobeInstance) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(resolve, 6000);
    })
  `);
  await new Promise(r => setTimeout(r, 1200));

  const refreshState = await evalJs(`(() => {
    const tooltip = document.getElementById('globeTooltip');
    const screenMarker = document.getElementById('globeScreenParcelMarker');
    const tooltipComputed = tooltip ? window.getComputedStyle(tooltip) : null;
    const screenMarkerComputed = screenMarker ? window.getComputedStyle(screenMarker) : null;
    return {
      tooltipDisplay: tooltip ? tooltip.style.display : null,
      tooltipComputedDisplay: tooltipComputed?.display,
      screenMarkerDisplay: screenMarker ? screenMarker.style.display : null,
      screenMarkerComputedDisplay: screenMarkerComputed?.display,
      activeParcel: window.parcelMapState ? window.parcelMapState.activeParcel : null
    };
  })()`);

  assert(
    refreshState.tooltipComputedDisplay === 'none',
    `On page refresh, #globeTooltip is completely hidden (actual computed: "${refreshState.tooltipComputedDisplay}")`
  );
  assert(
    refreshState.screenMarkerComputedDisplay === 'none',
    `On page refresh, #globeScreenParcelMarker is hidden (actual computed: "${refreshState.screenMarkerComputedDisplay}")`
  );
  assert(
    refreshState.activeParcel === null,
    'On page refresh, activeParcel is null (clean state)'
  );

  // 2. Click Search Button (clicking search button triggers discovery)
  console.log('\n--- 2. CLICKING SEARCH BUTTON ---');
  await evalJs(`document.getElementById('btnSearchGo').click()`);
  await new Promise(r => setTimeout(r, 2000));

  const afterSearchState = await evalJs(`(() => {
    const tooltip = document.getElementById('globeTooltip');
    const screenMarker = document.getElementById('globeScreenParcelMarker');
    const tooltipComputed = tooltip ? window.getComputedStyle(tooltip) : null;
    const screenMarkerComputed = screenMarker ? window.getComputedStyle(screenMarker) : null;
    return {
      tooltipComputedDisplay: tooltipComputed?.display,
      tooltipText: tooltip ? tooltip.innerText.trim() : '',
      screenMarkerComputedDisplay: screenMarkerComputed?.display,
      screenMarkerText: screenMarker ? screenMarker.innerText.trim() : '',
      activeParcel: window.parcelMapState?.selectedParcel?.parcelNumber || window.parcelMapState?.activeParcel?.parcelNumber
    };
  })()`);

  assert(
    afterSearchState.tooltipComputedDisplay === 'block' || afterSearchState.screenMarkerComputedDisplay === 'flex',
    `After clicking Search, parcel information is displayed (tooltip: ${afterSearchState.tooltipComputedDisplay}, marker: ${afterSearchState.screenMarkerComputedDisplay})`
  );
  assert(
    afterSearchState.tooltipText.includes('101') || afterSearchState.screenMarkerText.includes('101'),
    `Parcel #101 information shown upon clicking search button (tooltip text: "${afterSearchState.tooltipText}")`
  );

  // 3. Clear Search / Reset View
  console.log('\n--- 3. RESET VIEW VERIFICATION ---');
  await evalJs(`window.parcelMapState.clear()`);
  await new Promise(r => setTimeout(r, 600));

  const clearedState = await evalJs(`(() => {
    const tooltip = document.getElementById('globeTooltip');
    const screenMarker = document.getElementById('globeScreenParcelMarker');
    return {
      tooltipDisplay: tooltip ? window.getComputedStyle(tooltip).display : null,
      screenMarkerDisplay: screenMarker ? window.getComputedStyle(screenMarker).display : null
    };
  })()`);

  assert(
    clearedState.tooltipDisplay === 'none',
    'Tooltip disappears again when clearing / returning to clean global view'
  );
  assert(
    clearedState.screenMarkerDisplay === 'none',
    'Screen marker disappears when clearing / returning to clean global view'
  );

  console.log('\n================================================================');
  console.log('  SUCCESS: CLEAN ON REFRESH & APPEARS ON SEARCH CONFIRMED');
  console.log('================================================================\n');

  cleanup();
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n✕ Test Failed:', err);
  process.exit(1);
});
