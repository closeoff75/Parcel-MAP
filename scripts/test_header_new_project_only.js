// scripts/test_header_new_project_only.js
// Verification suite for updated top navigation/header:
// Ensures Launch Demo & Alex Morgan user section are completely removed,
// and "+ New Project" is the only action/button in that area.

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
    '--remote-debugging-port=9229',
    '--window-size=1440,900',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000/workspace.html'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9229/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9229');
}

async function runTest() {
  console.log('================================================================');
  console.log('  TEST: HEADER CLEANUP — ONLY "+ NEW PROJECT" BUTTON IN HEADER RIGHT');
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

  const res = await fetch('http://localhost:9229/json');
  const pages = await res.json();
  const page = pages.find(p => p.url.includes('localhost:3000/workspace.html') && p.type === 'page');
  if (!page) {
    console.error('Workspace page not found in Chrome tabs');
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

  await new Promise(r => setTimeout(r, 1200));

  // --- 1. DOM AUDIT OF HEADER RIGHT ---
  console.log('--- 1. DOM AUDIT OF TOP HEADER & HEADER RIGHT ---');
  const audit = await evalJs(`(() => {
    const header = document.querySelector('.pm-header');
    const headerRight = document.querySelector('.pm-header-right');
    const btnLaunchDemo = document.getElementById('btnLaunchDemo');
    const userPill = document.querySelector('.pm-header .user-pill');
    const userAvatar = document.querySelector('.pm-header .user-avatar');
    const btnNewProject = document.getElementById('btnNewProjectModal');
    const headerText = header ? header.innerText : '';

    return {
      hasHeader: Boolean(header),
      hasHeaderRight: Boolean(headerRight),
      headerRightChildrenCount: headerRight ? headerRight.children.length : 0,
      hasBtnLaunchDemo: Boolean(btnLaunchDemo),
      hasUserPill: Boolean(userPill),
      hasUserAvatar: Boolean(userAvatar),
      headerContainsAlexMorgan: headerText.includes('Alex Morgan'),
      headerContainsLaunchDemo: headerText.includes('Launch Demo'),
      hasBtnNewProject: Boolean(btnNewProject),
      btnNewProjectText: btnNewProject ? btnNewProject.innerText.trim() : '',
      headerRightInnerHTML: headerRight ? headerRight.innerHTML.trim() : ''
    };
  })()`);

  assert(audit.hasHeader, 'Top navigation header (.pm-header) is present');
  assert(audit.hasHeaderRight, '.pm-header-right container is present');
  assert(audit.hasBtnLaunchDemo === false, '"Launch Demo" button is completely removed from DOM');
  assert(audit.hasUserPill === false, 'User pill section is completely removed from DOM');
  assert(audit.hasUserAvatar === false, 'User avatar is completely removed from DOM');
  assert(audit.headerContainsAlexMorgan === false, 'Header does NOT contain "Alex Morgan" text');
  assert(audit.headerContainsLaunchDemo === false, 'Header does NOT contain "Launch Demo" text');
  assert(audit.hasBtnNewProject === true, '"+ New Project" button is present in header');
  assert(audit.headerRightChildrenCount === 1, `Only 1 element in .pm-header-right (actual: ${audit.headerRightChildrenCount})`);
  assert(audit.btnNewProjectText.includes('New Project'), `Button text is "+ New Project" (actual: "${audit.btnNewProjectText}")`);

  // --- 2. FUNCTIONALITY CHECK: NEW PROJECT MODAL OPENS ---
  console.log('\n--- 2. FUNCTIONALITY CHECK: NEW PROJECT MODAL ---');
  await evalJs(`document.getElementById('btnNewProjectModal').click()`);
  await new Promise(r => setTimeout(r, 300));

  const modalState = await evalJs(`(() => {
    const modal = document.getElementById('modalNewProject');
    return {
      hasModal: Boolean(modal),
      isActive: modal ? modal.classList.contains('active') : false,
      display: modal ? window.getComputedStyle(modal).display : null
    };
  })()`);

  assert(modalState.hasModal, 'New Project modal exists in DOM');
  assert(modalState.isActive, 'Clicking "+ New Project" successfully opens modal (classList contains "active")');

  // Close modal
  await evalJs(`document.getElementById('btnCloseNewProjectModal')?.click()`);
  await new Promise(r => setTimeout(r, 200));

  // --- 3. RESPONSIVENESS & NO EMPTY SPACE LEFTOVER ---
  console.log('\n--- 3. RESPONSIVENESS & CLEAN SPACING AUDIT ---');
  const viewports = [
    { width: 1440, height: 900, name: 'Desktop 1440x900' },
    { width: 1024, height: 768, name: 'Tablet Landscape 1024x768' },
    { width: 768, height: 1024, name: 'Tablet Portrait 768x1024' },
    { width: 375, height: 667, name: 'Mobile 375x667' }
  ];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width <= 768
    });
    await new Promise(r => setTimeout(r, 150));

    const vpMetrics = await evalJs(`(() => {
      const header = document.querySelector('.pm-header');
      const headerRight = document.querySelector('.pm-header-right');
      const btn = document.getElementById('btnNewProjectModal');
      const docWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;

      return {
        headerHeight: header ? header.offsetHeight : 0,
        headerRightWidth: headerRight ? headerRight.offsetWidth : 0,
        btnWidth: btn ? btn.offsetWidth : 0,
        noHorizontalOverflow: docWidth <= clientWidth
      };
    })()`);

    assert(vpMetrics.noHorizontalOverflow, `${vp.name}: No horizontal scroll overflow`);
    // Check that headerRight tight-fits the button (diff should only be gap/padding <= 4px)
    const extraSpace = vpMetrics.headerRightWidth - vpMetrics.btnWidth;
    assert(extraSpace <= 8, `${vp.name}: .pm-header-right has no leftover empty space (extra space: ${extraSpace}px)`);
  }

  console.log('\n================================================================');
  console.log('  SUCCESS: HEADER CLEANED UP & VERIFIED ON ALL VIEWPORTS');
  console.log('================================================================\n');

  cleanup();
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n✕ Test Failed:', err);
  process.exit(1);
});
