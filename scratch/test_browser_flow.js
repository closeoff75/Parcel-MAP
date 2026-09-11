// scratch/test_browser_flow.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function runBrowserFlow() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9240',
    '--no-sandbox',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9240/json');
  const pages = await res.json();
  const page = pages[0];

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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const consoleErrors = [];
  const failedRequests = [];

  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      const text = d.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
      if (d.params.type === 'error' || text.includes('Error') || text.includes('failed')) {
        consoleErrors.push(`[Console ${d.params.type}] ${text}`);
      }
    }
    if (d.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`[Exception] ${d.params.exceptionDetails?.text} ${d.params.exceptionDetails?.exception?.description}`);
    }
    if (d.method === 'Network.responseReceived') {
      const { status, url } = d.params.response;
      if (status >= 400) {
        failedRequests.push(`[HTTP ${status}] ${url}`);
      }
    }
  });

  console.log('Navigating to workspace.html#detection...');
  await send('Page.navigate', { url: 'http://localhost:3000/workspace.html#detection' });
  await new Promise(r => setTimeout(r, 2000));

  const state1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const toasts = Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText);
      return {
        projectId: window.parcelApp?.activeProjectId,
        selectedImageryId: window.parcelApp?.selectedImageryId,
        featuresCount: window.parcelApp?.features?.length,
        toasts,
        modelName: document.getElementById('lblAiModelName')?.innerText,
        modeBadge: document.getElementById('badgeAiMode')?.innerText
      };
    })()`,
    returnByValue: true
  });
  console.log('Initial State:', state1.result?.value);
  console.log('Initial Errors:', consoleErrors);
  console.log('Initial Failed Requests:', failedRequests);

  proc.kill();
  process.exit(0);
}

runBrowserFlow().catch(err => {
  console.error(err);
  process.exit(1);
});
