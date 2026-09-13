import { spawn } from 'child_process';

async function testPersistence() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--window-size=1440,900',
    '--remote-debugging-port=9253',
    '--no-sandbox',
    'http://localhost:3000/workspace.html#reasoning'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://localhost:9253/json');
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

    console.log('1. Setting active project and loading data...');
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const projId = 'proj_demo_coastal';
        window.parcelApp.activeProjectId = projId;
        localStorage.setItem('pm_active_project_id', projId);
        await window.parcelApp.loadProjectData(projId);
      })()`,
      awaitPromise: true
    });

    console.log('2. Reloading browser page via Page.reload...');
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3000));

    console.log('3. Inspecting parcel state after reload...');
    const afterReload = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          activeProjectId: window.parcelApp.activeProjectId,
          parcelsCount: window.parcelApp.parcels?.length,
          parcels: window.parcelApp.parcels?.map(p => ({
            id: p.id,
            status: p.status,
            cand: p.candidate_status,
            conf: p.confidence,
            p0: p.geometry.coordinates[0][0]
          }))
        };
      })()`,
      returnByValue: true
    });

    console.log('Reload verification result:', afterReload.result.value);
    ws.close();
  } finally {
    proc.kill();
  }
}

testPersistence().catch(console.error);
