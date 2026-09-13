// scratch/test_tab_order_and_landing.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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
    '--remote-debugging-port=9231',
    '--window-size=1440,900',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000/workspace.html'
  ]);

  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://localhost:9231/json');
      if (res.ok) return chromeProc;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome did not start on port 9231');
}

async function run() {
  console.log('================================================================');
  console.log('  TEST: VERIFY NAVIGATION TABS ORDER & DIRECT LANDING ON DRONE IMAGERY');
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

  const res = await fetch('http://localhost:9231/json');
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

  await new Promise(resolve => { ws.onopen = resolve; });

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

  // Wait for page to initialize
  await new Promise(r => setTimeout(r, 1500));

  console.log('--- 1. AUDIT OF NAVIGATION TAB ORDER ---');
  const tabInfo = await evalJs(`(() => {
    const tabs = Array.from(document.querySelectorAll('.pm-nav-tab'));
    const tabTexts = tabs.map(t => t.innerText.trim());
    const tabViews = tabs.map(t => t.dataset.view);
    const activeTab = document.querySelector('.pm-nav-tab.active')?.innerText.trim();
    const activeView = document.querySelector('.pm-nav-tab.active')?.dataset.view;
    const activeStage = document.querySelector('.pm-view-stage.active')?.id;
    const nextBtn = document.getElementById('btnNewProjectModal')?.innerText.trim();
    return { tabTexts, tabViews, activeTab, activeView, activeStage, nextBtn };
  })()`);

  console.log('Tabs:', tabInfo.tabTexts);
  console.log('Views:', tabInfo.tabViews);
  console.log('Active Tab:', tabInfo.activeTab);
  console.log('Active View:', tabInfo.activeView);
  console.log('Active Stage ID:', tabInfo.activeStage);
  console.log('Button next to tabs:', tabInfo.nextBtn);

  assert(tabInfo.tabTexts[0] === 'Drone Imagery', 'First tab is Drone Imagery');
  assert(tabInfo.tabTexts[tabInfo.tabTexts.length - 1] === 'Projects', 'Last tab before New Project is Projects');
  assert(tabInfo.tabViews[tabInfo.tabViews.length - 1] === 'dashboard', 'Projects tab routes to dashboard view');
  assert(tabInfo.nextBtn.includes('New Project'), 'Next button in header right is New Project');

  console.log('\n--- 2. VERIFY DIRECT LANDING ON DRONE IMAGERY ---');
  assert(tabInfo.activeTab === 'Drone Imagery', 'Active tab on initial load is Drone Imagery');
  assert(tabInfo.activeView === 'imagery', 'Active view data-attribute on initial load is "imagery"');
  assert(tabInfo.activeStage === 'viewImagery', 'Active visible stage is viewImagery');

  console.log('\n--- 3. TEST SWITCHING TO PROJECTS TAB AND BACK ---');
  await evalJs(`document.querySelector('.pm-nav-tab[data-view="dashboard"]').click()`);
  await new Promise(r => setTimeout(r, 500));

  const afterProjectsClick = await evalJs(`(() => {
    return {
      activeTab: document.querySelector('.pm-nav-tab.active')?.innerText.trim(),
      activeStage: document.querySelector('.pm-view-stage.active')?.id
    };
  })()`);
  assert(afterProjectsClick.activeTab === 'Projects', 'Clicking Projects activates Projects tab');
  assert(afterProjectsClick.activeStage === 'viewDashboard', 'Projects dashboard stage is now active');

  await evalJs(`document.querySelector('.pm-nav-tab[data-view="imagery"]').click()`);
  await new Promise(r => setTimeout(r, 500));

  const afterImageryClick = await evalJs(`(() => {
    return {
      activeTab: document.querySelector('.pm-nav-tab.active')?.innerText.trim(),
      activeStage: document.querySelector('.pm-view-stage.active')?.id
    };
  })()`);
  assert(afterImageryClick.activeTab === 'Drone Imagery', 'Clicking Drone Imagery returns to Drone Imagery tab');
  assert(afterImageryClick.activeStage === 'viewImagery', 'Drone Imagery stage is active again');

  console.log('\n--- 4. CAPTURING VERIFICATION SCREENSHOT ---');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const artifactDir = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75';
  const screenshotPath = path.join(artifactDir, 'drone_imagery_landing_verified.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`  ✓ Screenshot saved to: ${screenshotPath}`);

  console.log('\n================================================================');
  console.log('✅ ALL NAVIGATION & LANDING CHECKS PASSED PERFECTLY!');
  console.log('================================================================');

  cleanup();
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
