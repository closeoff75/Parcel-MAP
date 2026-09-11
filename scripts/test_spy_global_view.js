import { spawn } from 'child_process';
import http from 'http';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

(async () => {
  const chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9237',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000/'
  ]);
  await new Promise(r => setTimeout(r, 2000));
  const pages = await fetchJson('http://127.0.0.1:9237/json/list');
  const targetPage = pages.find(p => p.url.includes('localhost:3000')) || pages[0];
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 1;
  function send(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++;
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === curId) {
          ws.removeEventListener('message', handler);
          resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }
  await send('Runtime.enable');
  await send('Page.enable');

  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      console.log('BROWSER:', ...m.params.args.map(a => a.value || a.description));
    }
  });

  console.log('Searching parcel 101...');
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('mainParcelSearchInput').value = '101';
      document.getElementById('parcelSearchForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    `
  });

  await new Promise(r => setTimeout(r, 5000));

  console.log('Now spying and clicking btnBackToGlobe...');
  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.realSatelliteGlobeInstance;
      console.log('[DEBUG] initial g._isResettingView:', g._isResettingView);
      console.log('[DEBUG] typeof g.resetView:', typeof g.resetView);
      console.log('[DEBUG] typeof g.closeParcelExplorer:', typeof g.closeParcelExplorer);
      console.log('[DEBUG] typeof window.parcelMapState.clear:', typeof window.parcelMapState.clear);

      // Spy on g.resetView
      const originalResetView = g.resetView;
      g.resetView = function() {
        console.log('[SPY] g.resetView CALLED! Stack:', new Error().stack);
        return originalResetView.apply(this, arguments);
      };

      // Spy on window.parcelMapState.clear
      const origClear = window.parcelMapState.clear;
      window.parcelMapState.clear = function() {
        console.log('[CLEAR-SPY] clear called! _isClearing=', this._isClearing);
        try {
          return origClear.apply(this, arguments);
        } catch(err) {
          console.error('[CLEAR-SPY] error in clear:', err);
        }
      };

      try {
        const btn = document.getElementById('btnBackToGlobe');
        console.log('[SPY] btnBackToGlobe:', btn);
        btn.click();
        return 'clicked successfully';
      } catch(e) {
        console.error('[SPY] Error during click:', e);
        return 'error: ' + e.message;
      }
    })()`,
    returnByValue: true
  });
  console.log('Click eval:', res);

  await new Promise(r => setTimeout(r, 2000));

  const after = await send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.realSatelliteGlobeInstance;
      const canvas = g.renderer.domElement;
      return {
        viewMode: window.parcelMapState?.viewMode,
        isFlying: g.isFlying,
        flyProgress: g.flyProgress,
        flyDuration: g.flyDuration,
        flyTarget: g.flyTarget,
        currentZoom: g.currentZoom,
        cameraZ: g.camera.position.z,
        canvasOpacity: window.getComputedStyle(canvas).opacity,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        containerDisplay: window.getComputedStyle(g.container).display,
        containerWidth: g.container.clientWidth,
        containerHeight: g.container.clientHeight
      };
    })()`,
    returnByValue: true
  });
  console.log('After state:', after.result.value);

  ws.close();
  chromeProcess.kill();
})();
