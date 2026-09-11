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
    '--remote-debugging-port=9235',
    '--disable-gpu',
    '--no-sandbox',
    'http://localhost:3000/'
  ]);
  await new Promise(r => setTimeout(r, 2000));
  const pages = await fetchJson('http://127.0.0.1:9235/json/list');
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
      console.log('PAGE LOG:', ...m.params.args.map(a => a.value || a.description));
    }
  });

  console.log('1. Search Parcel #101');
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('mainParcelSearchInput').value = '101';
      document.getElementById('parcelSearchForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    `
  });

  // Wait for 2D map to open
  await new Promise(r => setTimeout(r, 4500));

  const stateInMap = await send('Runtime.evaluate', {
    expression: `({
      viewMode: window.parcelMapState.viewMode,
      globeDisplay: window.getComputedStyle(document.getElementById('globeCanvasContainer')).display,
      mapDisplay: window.getComputedStyle(document.getElementById('parcel2dMapContainer')).display
    })`,
    returnByValue: true
  });
  console.log('State when 2D map is open:', stateInMap.result.value);

  console.log('2. Clicking "Back to Global View" button');
  const clickRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('btnBackToGlobe');
      console.log('[DEBUG] btnBackToGlobe:', btn, 'onclick:', btn?.onclick);
      if (btn) {
        btn.click();
        return { clicked: true, hasOnclick: Boolean(btn.onclick) };
      }
      return { clicked: false, error: 'btnBackToGlobe not found' };
    })()`,
    returnByValue: true
  });
  console.log('Click result:', clickRes.result.value);

  // Wait 1000ms
  await new Promise(r => setTimeout(r, 1000));

  const stateAfterReturn = await send('Runtime.evaluate', {
    expression: `(() => {
      const globeContainer = document.getElementById('globeCanvasContainer');
      const mapContainer = document.getElementById('parcel2dMapContainer');
      const canvas = globeContainer ? globeContainer.querySelector('canvas') : null;
      const g = window.realSatelliteGlobeInstance;

      let webglStatus = 'no-instance';
      if (g && g.renderer) {
        const gl = g.renderer.getContext();
        webglStatus = gl ? 'valid-context, error=' + gl.getError() : 'null-context';
      }

      return {
        viewMode: window.parcelMapState?.viewMode,
        globeContainerDisplay: globeContainer ? window.getComputedStyle(globeContainer).display : 'missing',
        globeContainerOpacity: globeContainer ? window.getComputedStyle(globeContainer).opacity : 'missing',
        globeContainerWidth: globeContainer ? globeContainer.clientWidth : 0,
        globeContainerHeight: globeContainer ? globeContainer.clientHeight : 0,
        mapContainerDisplay: mapContainer ? window.getComputedStyle(mapContainer).display : 'missing',
        canvasExists: Boolean(canvas),
        canvasWidth: canvas ? canvas.width : 0,
        canvasHeight: canvas ? canvas.height : 0,
        canvasOpacity: canvas ? window.getComputedStyle(canvas).opacity : 'missing',
        canvasDisplay: canvas ? window.getComputedStyle(canvas).display : 'missing',
        webglStatus: webglStatus,
        cameraZ: g && g.camera ? g.camera.position.z : null,
        cameraAspect: g && g.camera ? g.camera.aspect : null,
        isFlying: g ? g.isFlying : null,
        flyProgress: g ? g.flyProgress : null,
        flyDuration: g ? g.flyDuration : null,
        flyStart: g ? g.flyStart : null,
        flyTarget: g ? g.flyTarget : null,
        currentZoom: g ? g.currentZoom : null,
        autoRotate: g ? g.autoRotate : null
      };
    })()`,
    returnByValue: true
  });
  console.log('State after clicking "Back to Global View":', stateAfterReturn.result.value);

  ws.close();
  chromeProcess.kill();
})();
