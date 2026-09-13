// scratch/capture_reasoning_ui.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function testReasoningUI() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--window-size=1440,900',
    '--remote-debugging-port=9249',
    '--no-sandbox',
    'http://localhost:3000/workspace.html#reasoning'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://localhost:9249/json');
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

    console.log('[1] Initializing demo project on page...');
    const initEval = await send('Runtime.evaluate', {
      expression: `(async () => {
        const projId = 'proj_demo_coastal';
        window.parcelApp.activeProjectId = projId;
        localStorage.setItem('pm_active_project_id', projId);
        await window.parcelApp.loadProjectData(projId);
        window.parcelApp.switchView('reasoning');
        return {
          activeProjectId: window.parcelApp.activeProjectId,
          parcelsCount: window.parcelApp.parcels?.length,
          parcels: window.parcelApp.parcels?.map(p => ({
            id: p.id,
            status: p.status,
            cand: p.candidate_status,
            conf: p.confidence,
            supp: p.supported_perimeter_pct
          }))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('App state after load:', initEval.result.value);

    // Wait for Leaflet map and imageOverlay to load and decode
    await send('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const check = () => {
          const imgEl = document.querySelector('#reasoningMap .leaflet-image-layer');
          if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
            resolve({ src: imgEl.src, w: imgEl.naturalWidth, h: imgEl.naturalHeight });
          } else {
            setTimeout(check, 100);
          }
        };
        check();
        setTimeout(() => resolve({ timeout: true }), 4000);
      })`,
      awaitPromise: true
    });
    await new Promise(r => setTimeout(r, 600));

    console.log('[1.5] Capturing clean Spatial Reasoning overview map...');
    const overviewShot = await send('Page.captureScreenshot', { format: 'png' });
    const overviewPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\spatial_reasoning_overview.png';
    fs.writeFileSync(overviewPath, Buffer.from(overviewShot.data, 'base64'));
    console.log(`✓ Overview screenshot saved to: ${overviewPath}`);

    console.log('[2] Finding and clicking parcel polygon PM-0001...');
    const clickEval = await send('Runtime.evaluate', {
      expression: `(() => {
        let found = null;
        if (window.parcelApp.reasoningFeatureGroup) {
          window.parcelApp.reasoningFeatureGroup.eachLayer(layer => {
            if (layer._parcel && (layer._parcel.id === 'PM-0001' || layer._parcel.parcel_id === 'PM-0001')) {
              found = layer;
            }
          });
        }
        if (found) {
          found.fire('click');
          return { found: true, parcelId: found._parcel.id };
        }
        return { found: false };
      })()`,
      returnByValue: true
    });
    console.log('Click result:', clickEval.result.value);

    await new Promise(r => setTimeout(r, 600));

    console.log('[3] Inspecting popup content...');
    const popupEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const popupEl = document.querySelector('.leaflet-popup-content');
        if (!popupEl) return { hasPopup: false };
        return {
          hasPopup: true,
          text: popupEl.innerText,
          html: popupEl.innerHTML
        };
      })()`,
      returnByValue: true
    });

    console.log('Popup detected:', popupEval.result.value.hasPopup);
    if (popupEval.result.value.hasPopup) {
      console.log('Popup text:\n' + popupEval.result.value.text);
    }

    console.log('[4] Capturing screenshot of Spatial Reasoning with open parcel popup...');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shot.data, 'base64');
    const outPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\spatial_reasoning_parcels_verified.png';
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ Screenshot saved to: ${outPath} (${buffer.length} bytes)`);

    console.log('\n[5] Verifying handoff to GIS Quality, Verification, and Final Map views...');
    // GIS Quality
    await send('Runtime.evaluate', {
      expression: `(async () => {
        window.parcelApp.switchView('quality');
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));
    const qualityShot = await send('Page.captureScreenshot', { format: 'png' });
    const qualityPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\gis_quality_parcels_verified.png';
    fs.writeFileSync(qualityPath, Buffer.from(qualityShot.data, 'base64'));
    console.log(`✓ GIS Quality screenshot saved to: ${qualityPath}`);

    // Verification
    await send('Runtime.evaluate', {
      expression: `(async () => {
        window.parcelApp.switchView('verify');
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));
    const verifyShot = await send('Page.captureScreenshot', { format: 'png' });
    const verifyPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\verification_parcels_verified.png';
    fs.writeFileSync(verifyPath, Buffer.from(verifyShot.data, 'base64'));
    console.log(`✓ Verification screenshot saved to: ${verifyPath}`);

    // Final Map
    await send('Runtime.evaluate', {
      expression: `(async () => {
        window.parcelApp.switchView('map');
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));
    const mapShot = await send('Page.captureScreenshot', { format: 'png' });
    const mapPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\final_map_parcels_verified.png';
    fs.writeFileSync(mapPath, Buffer.from(mapShot.data, 'base64'));
    console.log(`✓ Final Map screenshot saved to: ${mapPath}`);

    ws.close();
    proc.kill();
  } catch (err) {
    console.error('Test error:', err);
    proc.kill();
    process.exit(1);
  }
}

testReasoningUI();
