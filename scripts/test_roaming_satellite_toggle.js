// scripts/test_roaming_satellite_toggle.js
// Verification suite for single roaming satellite orbiting Earth and toggle control

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
    '--remote-debugging-port=9228',
    '--window-size=1280,800',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9228/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9228');
}

async function runTest() {
  console.log('================================================================');
  console.log('  TEST: ROAMING SATELLITE ORBITING EARTH & TOGGLE CONTROL');
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
  process.on('SIGINT', cleanup);

  const res = await fetch('http://localhost:9228/json');
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

  await new Promise(resolve => {
    ws.onopen = resolve;
  });

  await send('Runtime.enable');
  await send('Page.enable');

  async function evalJs(expr) {
    const result = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  }

  // Wait for 3D Globe initialization
  await evalJs(`
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (window.realSatelliteGlobeInstance && window.realSatelliteGlobeInstance.roamingSatellite) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(resolve, 6000);
    })
  `);
  await new Promise(r => setTimeout(r, 1000));

  // --- 1. SATELLITE INITIALIZATION & PRESENCE AUDIT ---
  console.log('--- 1. SATELLITE INITIALIZATION & MESH AUDIT ---');
  const satAudit = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    const btn = document.getElementById('globeBtnToggleSatellite');
    return {
      hasGlobe: Boolean(g),
      hasBtn: Boolean(btn),
      btnText: btn ? btn.textContent.trim() : null,
      btnActive: btn ? btn.classList.contains('active') : false,
      btnAriaPressed: btn ? btn.getAttribute('aria-pressed') : null,
      roamingSatelliteVisible: g ? g.roamingSatelliteVisible : null,
      hasSatelliteGroup: Boolean(g && g.roamingSatelliteGroup),
      groupVisible: g && g.roamingSatelliteGroup ? g.roamingSatelliteGroup.visible : null,
      hasVehicleMesh: Boolean(g && g.roamingSatellite),
      vehicleChildrenCount: g && g.roamingSatellite ? g.roamingSatellite.children.length : 0,
      hasOrbitLine: Boolean(g && g.roamingOrbitLine),
      orbitRadius: g ? g.roamingOrbitRadius : null
    };
  })()`);

  assert(satAudit.hasGlobe, '3D Globe initialized with realSatelliteGlobeInstance');
  assert(satAudit.hasBtn, 'Satellite toggle button #globeBtnToggleSatellite exists in DOM');
  assert(satAudit.btnText.includes('Satellite: ON'), `Button initial label is Satellite: ON (actual: "${satAudit.btnText}")`);
  assert(satAudit.btnActive === true, 'Button has active CSS class on initial load');
  assert(satAudit.roamingSatelliteVisible === true, 'roamingSatelliteVisible is true initially');
  assert(satAudit.hasSatelliteGroup && satAudit.groupVisible === true, 'roamingSatelliteGroup is present and visible in scene');
  assert(satAudit.hasVehicleMesh && satAudit.vehicleChildrenCount >= 4, `Roaming satellite vehicle constructed with components (components: ${satAudit.vehicleChildrenCount})`);
  assert(satAudit.hasOrbitLine === true, 'Orbit trajectory ring is rendered');
  assert(satAudit.orbitRadius === 246, `Orbit radius is calibrated at LEO 246 (actual: ${satAudit.orbitRadius})`);

  // --- 2. ORBIT MOTION & ROTATION VERIFICATION ---
  console.log('\n--- 2. ORBIT MOTION & ROTATION VERIFICATION ---');
  const pos0 = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    return {
      x: g.roamingSatellite.position.x,
      y: g.roamingSatellite.position.y,
      z: g.roamingSatellite.position.z,
      angle: g.roamingOrbitAngle
    };
  })()`);

  await new Promise(r => setTimeout(r, 600));

  const pos1 = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    return {
      x: g.roamingSatellite.position.x,
      y: g.roamingSatellite.position.y,
      z: g.roamingSatellite.position.z,
      angle: g.roamingOrbitAngle
    };
  })()`);

  const deltaAngle = Math.abs(pos1.angle - pos0.angle);
  const deltaDistance = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);

  assert(deltaAngle > 0.01, `Satellite angle advanced along orbit (delta angle: ${deltaAngle.toFixed(4)} rad)`);
  assert(deltaDistance > 1.5, `Satellite spatial position changed continuously in 3D orbit (delta dist: ${deltaDistance.toFixed(2)} units)`);

  // --- 3. TOGGLE BUTTON INTERACTION (OFF -> ON) ---
  console.log('\n--- 3. TOGGLE BUTTON INTERACTION (OFF -> ON) ---');
  await evalJs(`document.getElementById('globeBtnToggleSatellite').click()`);
  await new Promise(r => setTimeout(r, 200));

  const offState = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    const btn = document.getElementById('globeBtnToggleSatellite');
    return {
      btnText: btn ? btn.textContent.trim() : null,
      btnActive: btn ? btn.classList.contains('active') : false,
      btnAriaPressed: btn ? btn.getAttribute('aria-pressed') : null,
      roamingVisible: g ? g.roamingSatelliteVisible : null,
      groupVisible: g && g.roamingSatelliteGroup ? g.roamingSatelliteGroup.visible : null
    };
  })()`);

  assert(offState.btnText.includes('Satellite: OFF'), `After click, button label updated to Satellite: OFF (actual: "${offState.btnText}")`);
  assert(offState.btnActive === false, 'Button active class removed when toggled OFF');
  assert(offState.btnAriaPressed === 'false', 'aria-pressed is false');
  assert(offState.roamingVisible === false, 'roamingSatelliteVisible set to false');
  assert(offState.groupVisible === false, 'roamingSatelliteGroup hidden from 3D scene');

  // Toggle back ON
  await evalJs(`document.getElementById('globeBtnToggleSatellite').click()`);
  await new Promise(r => setTimeout(r, 200));

  const onState = await evalJs(`(() => {
    const g = window.realSatelliteGlobeInstance;
    const btn = document.getElementById('globeBtnToggleSatellite');
    return {
      btnText: btn ? btn.textContent.trim() : null,
      btnActive: btn ? btn.classList.contains('active') : false,
      btnAriaPressed: btn ? btn.getAttribute('aria-pressed') : null,
      roamingVisible: g ? g.roamingSatelliteVisible : null,
      groupVisible: g && g.roamingSatelliteGroup ? g.roamingSatelliteGroup.visible : null
    };
  })()`);

  assert(onState.btnText.includes('Satellite: ON'), `After second click, button label restored to Satellite: ON (actual: "${onState.btnText}")`);
  assert(onState.btnActive === true, 'Button active class restored when toggled ON');
  assert(onState.btnAriaPressed === 'true', 'aria-pressed is true');
  assert(onState.roamingVisible === true, 'roamingSatelliteVisible restored to true');
  assert(onState.groupVisible === true, 'roamingSatelliteGroup restored to visible in 3D scene');

  console.log('\n================================================================');
  console.log('  SUCCESS: ROAMING SATELLITE & TOGGLE FULLY VERIFIED');
  console.log('================================================================\n');

  cleanup();
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n✕ Test Failed:', err);
  process.exit(1);
});
