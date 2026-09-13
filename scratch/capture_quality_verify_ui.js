import { spawn } from 'child_process';
import fs from 'fs';

async function captureViews() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--window-size=1440,900',
    '--remote-debugging-port=9251',
    '--no-sandbox',
    'http://localhost:3000/workspace.html#quality'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://localhost:9251/json');
    const pages = await res.json();
    const page = pages.find(p => p.url.includes('workspace.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);

    let id = 1;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const cur = id++;
      const h = (e) => {
        const d = JSON.parse(e.data);
        if (d.id === cur) {
          ws.removeEventListener('message', h);
          if (d.error) reject(d.error);
          else resolve(d.result);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: cur, method, params }));
    });

    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');

    await send('Runtime.evaluate', {
      expression: `(async () => {
        const projId = 'proj_demo_coastal';
        window.parcelApp.activeProjectId = projId;
        localStorage.setItem('pm_active_project_id', projId);
        await window.parcelApp.loadProjectData(projId);
        window.parcelApp.switchView('quality');
      })()`,
      awaitPromise: true
    });

    await new Promise(r => setTimeout(r, 1500));
    const shotQ = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\gis_quality_parcels_verified.png', Buffer.from(shotQ.data, 'base64'));

    await send('Runtime.evaluate', {
      expression: `(async () => {
        window.parcelApp.switchView('verify');
      })()`,
      awaitPromise: true
    });

    await new Promise(r => setTimeout(r, 1500));
    const shotV = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\verification_parcels_verified.png', Buffer.from(shotV.data, 'base64'));

    console.log('✓ Captured GIS Quality & Verification screenshots!');
    ws.close();
  } finally {
    proc.kill();
  }
}

captureViews().catch(console.error);
