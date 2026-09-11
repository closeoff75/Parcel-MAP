// scratch/inspect_detection_state.js
import { spawn } from 'child_process';

async function inspect() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9230',
    '--no-sandbox',
    'http://localhost:3000/workspace.html#detection'
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch('http://localhost:9230/json');
  const pages = await res.json();
  const page = pages.find(p => p.url.includes('localhost:3000') && p.type === 'page');
  if (!page) {
    console.error('Page not found');
    proc.kill();
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const cur = id++;
    const handler = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === cur) {
        ws.removeEventListener('message', handler);
        if (d.error) reject(d.error);
        else resolve(d.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Log.enable');

  const consoleLogs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push(d.params.args.map(a => a.value || a.description).join(' '));
    }
  });

  await new Promise(r => setTimeout(r, 2500));

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const toasts = Array.from(document.querySelectorAll('.pm-toast, .toast, [role="alert"]')).map(t => t.innerText);
      const stage = document.getElementById('lblDetectionStage')?.innerText;
      const mode = document.getElementById('badgeAiMode')?.innerText;
      const model = document.getElementById('lblAiModelName')?.innerText;
      const status = document.getElementById('infoImgStatus')?.innerText;
      const featCount = document.getElementById('badgeFeatureTotal')?.innerText;
      const cardStatus = document.getElementById('badgeImageryCardStatus')?.innerText;
      return {
        hash: window.location.hash,
        activeProjectId: window.parcelApp?.activeProjectId,
        selectedImageryId: window.parcelApp?.selectedImageryId,
        project: window.parcelApp?.project,
        imageryLength: window.parcelApp?.imagery?.length,
        imagery: window.parcelApp?.imagery,
        featuresLength: window.parcelApp?.features?.length,
        toasts,
        stage,
        mode,
        model,
        status,
        featCount,
        cardStatus
      };
    })()`,
    returnByValue: true
  });

  console.log('Browser State:', JSON.stringify(evalRes.result?.value, null, 2));
  console.log('\nConsole Logs:', consoleLogs);

  proc.kill();
  process.exit(0);
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
