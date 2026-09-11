// scratch/test_browser_project_create.js
import { spawn } from 'child_process';

async function test() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9243',
    '--no-sandbox',
    'http://localhost:3000/workspace.html#detection'
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch('http://localhost:9243/json');
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
  await send('Runtime.enable');
  await send('Log.enable');

  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', d.params.type, d.params.args.map(a => a.value || a.description).join(' '));
    }
    if (d.method === 'Runtime.exceptionThrown') {
      console.log('[BROWSER EXCEPTION]', d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text);
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('Testing create project and loadProjectData...');
  const evalCreate = await send('Runtime.evaluate', {
    expression: `(async () => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Fresh Test Project', location: 'Pune Test' })
      });
      const d = await res.json();
      const newProjId = d.project.id;
      console.log('Created project:', newProjId);
      window.parcelApp.activeProjectId = newProjId;
      window.parcelApp.selectedImageryId = null;
      await window.parcelApp.loadProjectData(newProjId);
      return {
        newProjId,
        toasts: Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText),
        featuresLength: window.parcelApp.features?.length,
        statusBadge: document.getElementById('badgeDetectionStatus')?.innerText,
        modelName: document.getElementById('lblAiModelName')?.innerText,
        modeBadge: document.getElementById('badgeAiMode')?.innerText
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  console.log('Result:', evalCreate.result?.value);

  proc.kill();
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
