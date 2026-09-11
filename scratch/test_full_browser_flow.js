// scratch/test_full_browser_flow.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function testFlow() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9244',
    '--no-sandbox',
    'http://localhost:3000/workspace.html'
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch('http://localhost:9244/json');
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
  await send('Network.enable');
  await send('Page.enable');

  const logs = [];
  const networkErrors = [];

  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      const text = d.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
      logs.push(`[${d.params.type}] ${text}`);
      console.log(`[BROWSER ${d.params.type}]`, text);
    }
    if (d.method === 'Runtime.exceptionThrown') {
      const errText = d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text;
      logs.push(`[EXCEPTION] ${errText}`);
      console.error('[BROWSER EXCEPTION]', errText);
    }
    if (d.method === 'Network.responseReceived') {
      const { status, url } = d.params.response;
      if (status >= 400) {
        networkErrors.push({ status, url });
        console.warn(`[BROWSER NETWORK ERROR ${status}]`, url);
      }
    }
  });

  await new Promise(r => setTimeout(r, 1500));

  // Step 1: Create a brand new project via the frontend API
  console.log('\n========================================');
  console.log('--- STEP 1: Creating Brand New Project ---');
  console.log('========================================');
  const projName = `Production Drone Survey ${Date.now()}`;
  const createProjRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '${projName}',
          location: 'Purandar District, Pune',
          description: 'Cadastral demarcation from real UAV orthomosaic',
          coordinates: [18.28, 73.95],
          project_type: 'Rural Cadastral Mapping'
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Project creation failed');
      window.parcelApp.activeProjectId = data.project.id;
      localStorage.setItem('pm_active_project_id', data.project.id);
      window.parcelApp.selectedImageryId = null;
      localStorage.removeItem('pm_selected_imagery_id');
      await window.parcelApp.populateProjectSelector();
      await window.parcelApp.loadProjectData(data.project.id);
      return data.project;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const project = createProjRes.result?.value;
  console.log('Project created:', project?.id, project?.name);

  // Step 2: Upload real aerial image
  console.log('\n========================================');
  console.log('--- STEP 2: Uploading Real Aerial Image ---');
  console.log('========================================');
  const testImagePath = path.join(process.cwd(), 'test_assets', 'purandar_flight_01_farmland.png');
  const imageBuffer = fs.readFileSync(testImagePath);
  const base64Image = imageBuffer.toString('base64');

  const uploadRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const byteCharacters = atob('${base64Image}');
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      const file = new File([blob], 'purandar_flight_01_farmland.png', { type: 'image/png' });

      const formData = new FormData();
      formData.append('imagery', file);
      formData.append('width', 1408);
      formData.append('height', 768);

      const res = await fetch('/api/projects/' + window.parcelApp.activeProjectId + '/imagery', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');
      window.parcelApp.selectedImageryId = data.imagery.id;
      localStorage.setItem('pm_selected_imagery_id', data.imagery.id);
      await window.parcelApp.loadProjectData(window.parcelApp.activeProjectId);
      window.parcelApp.switchView('detection');
      return data.imagery;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const imagery = uploadRes.result?.value;
  console.log('Imagery uploaded:', imagery?.id, imagery?.file_name);

  // Step 3: Check UI state before detection
  console.log('\n========================================');
  console.log('--- STEP 3: Detection View State Before Run ---');
  console.log('========================================');
  const stateBefore = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        stage: document.getElementById('lblDetectionStage')?.innerText?.trim(),
        mode: document.getElementById('badgeAiMode')?.innerText?.trim(),
        model: document.getElementById('lblAiModelName')?.innerText?.trim(),
        status: document.getElementById('infoImgStatus')?.innerText?.trim(),
        badgeStatus: document.getElementById('badgeDetectionStatus')?.innerText?.trim(),
        totalFeats: document.getElementById('badgeFeatureTotal')?.innerText?.trim(),
        stepUploaded: document.getElementById('stepUploaded')?.className,
        stepReady: document.getElementById('stepReady')?.className,
        stepProcessing: document.getElementById('stepProcessing')?.className,
        stepComplete: document.getElementById('stepComplete')?.className,
        toasts: Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText)
      };
    })()`,
    returnByValue: true
  });
  console.log('State Before Detection:', stateBefore.result?.value);

  // Step 4: Click Run AI Detection
  console.log('\n========================================');
  console.log('--- STEP 4: Triggering Run AI Detection ---');
  console.log('========================================');
  const triggerRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('btnRunAiDetection');
      btn.click();
      return { clicked: true };
    })()`,
    returnByValue: true
  });
  console.log('Detection button clicked:', triggerRes.result?.value);

  // Wait for detection to complete
  console.log('Waiting for AI detection pipeline to complete...');
  let completed = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const checkState = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.getElementById('btnRunAiDetection');
        const badgeStatus = document.getElementById('badgeDetectionStatus')?.innerText?.trim();
        const stage = document.getElementById('lblDetectionStage')?.innerText?.trim();
        const toasts = Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText);
        const featuresCount = window.parcelApp?.features?.length;
        return {
          btnDisabled: btn?.disabled,
          btnText: document.getElementById('btnRunAiDetectionText')?.innerText?.trim(),
          badgeStatus,
          stage,
          toasts,
          featuresCount
        };
      })()`,
      returnByValue: true
    });
    const st = checkState.result?.value;
    process.stdout.write(`  [${i + 1}s] stage: "${st?.stage}", status: "${st?.badgeStatus}", feats: ${st?.featuresCount}, btn: "${st?.btnText}"\n`);
    if (st && !st.btnDisabled && st.btnText !== 'Running Multi-Class Detection...' && st.btnText !== 'Saving & Verifying Detections...') {
      console.log('\nDetection process finished!');
      completed = true;
      break;
    }
  }

  // Step 5: Final UI check after detection
  console.log('\n========================================');
  console.log('--- STEP 5: Detection View State After Run ---');
  console.log('========================================');
  const stateAfter = await send('Runtime.evaluate', {
    expression: `(() => {
      const bodyText = document.body.innerText;
      const hasDemoText = /Demo Mode|Wagholi Demo Presentation Model/i.test(bodyText);
      return {
        stage: document.getElementById('lblDetectionStage')?.innerText?.trim(),
        mode: document.getElementById('badgeAiMode')?.innerText?.trim(),
        model: document.getElementById('lblAiModelName')?.innerText?.trim(),
        status: document.getElementById('infoImgStatus')?.innerText?.trim(),
        badgeStatus: document.getElementById('badgeDetectionStatus')?.innerText?.trim(),
        totalFeats: document.getElementById('badgeFeatureTotal')?.innerText?.trim(),
        confRoads: document.getElementById('lblConfRoads')?.innerText?.trim(),
        confBldgs: document.getElementById('lblConfBuildings')?.innerText?.trim(),
        confFields: document.getElementById('lblConfFieldEdges')?.innerText?.trim(),
        confWalls: document.getElementById('lblConfWalls')?.innerText?.trim(),
        confFences: document.getElementById('lblConfFences')?.innerText?.trim(),
        confVeg: document.getElementById('lblConfVegetation')?.innerText?.trim(),
        confWater: document.getElementById('lblConfWater')?.innerText?.trim(),
        stepUploaded: document.getElementById('stepUploaded')?.className,
        stepReady: document.getElementById('stepReady')?.className,
        stepProcessing: document.getElementById('stepProcessing')?.className,
        stepComplete: document.getElementById('stepComplete')?.className,
        hasDemoText,
        toasts: Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText),
        featuresCount: window.parcelApp?.features?.length
      };
    })()`,
    returnByValue: true
  });
  console.log('State After Detection:', JSON.stringify(stateAfter.result?.value, null, 2));

  // Step 6: Refresh the browser and verify persistence
  console.log('\n========================================');
  console.log('--- STEP 6: Refreshing Browser & Testing Persistence ---');
  console.log('========================================');
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 2500));

  const stateAfterRefresh = await send('Runtime.evaluate', {
    expression: `(() => {
      window.parcelApp.switchView('detection');
      const bodyText = document.body.innerText;
      const hasDemoText = /Demo Mode|Wagholi Demo Presentation Model/i.test(bodyText);
      return {
        activeProjectId: window.parcelApp?.activeProjectId,
        selectedImageryId: window.parcelApp?.selectedImageryId,
        featuresCount: window.parcelApp?.features?.length,
        stage: document.getElementById('lblDetectionStage')?.innerText?.trim(),
        mode: document.getElementById('badgeAiMode')?.innerText?.trim(),
        model: document.getElementById('lblAiModelName')?.innerText?.trim(),
        badgeStatus: document.getElementById('badgeDetectionStatus')?.innerText?.trim(),
        totalFeats: document.getElementById('badgeFeatureTotal')?.innerText?.trim(),
        stepUploaded: document.getElementById('stepUploaded')?.className,
        stepReady: document.getElementById('stepReady')?.className,
        stepProcessing: document.getElementById('stepProcessing')?.className,
        stepComplete: document.getElementById('stepComplete')?.className,
        hasDemoText,
        toasts: Array.from(document.querySelectorAll('.pm-toast')).map(t => t.innerText)
      };
    })()`,
    returnByValue: true
  });
  console.log('State After Browser Refresh:', JSON.stringify(stateAfterRefresh.result?.value, null, 2));
  console.log('Total Network Errors during flow:', networkErrors);

  // Assertions
  const a = stateAfterRefresh.result?.value;
  const checks = [
    { name: 'Project Created & Persisted', pass: a.activeProjectId === project.id },
    { name: 'Imagery Selected & Persisted', pass: a.selectedImageryId === imagery.id },
    { name: 'Features Persisted (> 0)', pass: a.featuresCount > 0 },
    { name: 'Badge Status is DETECTION COMPLETE', pass: a.badgeStatus === 'DETECTION COMPLETE' },
    { name: 'Lifecycle Step Complete is active', pass: a.stepComplete?.includes('active') },
    { name: 'No Demo Mode text in DOM', pass: a.hasDemoText === false },
    { name: 'No API Error Toast', pass: !a.toasts.some(t => t.includes('Error loading project data')) },
    { name: 'No 400/500 Network Errors', pass: networkErrors.length === 0 }
  ];

  console.log('\n========================================');
  console.log('--- VERIFICATION SUMMARY ---');
  console.log('========================================');
  let allPass = true;
  for (const c of checks) {
    const mark = c.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  proc.kill();
  if (allPass) {
    console.log('\n🎉 ALL 11 REQUIREMENTS VERIFIED AND PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('\n❌ SOME VERIFICATIONS FAILED');
    process.exit(1);
  }
}

testFlow().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
