import fs from 'fs';
import path from 'path';

async function testInPlaceUpload() {
  console.log('--- Testing In-Place Upload & Header Layout on AI Detection Page ---');

  const html = fs.readFileSync(path.resolve('workspace.html'), 'utf8');
  const js = fs.readFileSync(path.resolve('workspace.js'), 'utf8');

  // 1. Verify fixed header layout (prevents overlapping text)
  if (!html.includes('id="badgeDetectionCoordSubtitle"')) {
    throw new Error('Missing #badgeDetectionCoordSubtitle in workspace.html');
  }
  if (!html.includes('id="badgeDetectionCoordMode"')) {
    throw new Error('Missing #badgeDetectionCoordMode in workspace.html');
  }
  if (!html.includes('id="badgeDetectionStatus"')) {
    throw new Error('Missing #badgeDetectionStatus in workspace.html');
  }
  console.log('[PASS] Fixed 2-row sidebar header layout verified in workspace.html');

  // 2. Verify in-place upload buttons and inputs exist in HTML
  if (!html.includes('id="btnUploadMoreImageryDetection"')) {
    throw new Error('Missing #btnUploadMoreImageryDetection in workspace.html');
  }
  if (!html.includes('id="dropzoneDetectionQuick"')) {
    throw new Error('Missing #dropzoneDetectionQuick in workspace.html');
  }
  if (!html.includes('id="inputUploadImageryDetection"')) {
    throw new Error('Missing #inputUploadImageryDetection in workspace.html');
  }
  console.log('[PASS] In-place upload buttons (#btnUploadMoreImageryDetection, #dropzoneDetectionQuick, #inputUploadImageryDetection) verified in workspace.html');

  // 3. Verify uploadDroneImageFile method in JS
  if (!js.includes('async uploadDroneImageFile(file, options = {})')) {
    throw new Error('Missing uploadDroneImageFile method in workspace.js');
  }
  if (!js.includes('btnUploadMoreDet?.addEventListener(\'click\'')) {
    throw new Error('Missing btnUploadMoreDet click listener in workspace.js');
  }
  if (!js.includes('dropzoneDet?.addEventListener(\'click\'')) {
    throw new Error('Missing dropzoneDet click listener in workspace.js');
  }
  if (!js.includes('inputUploadDet?.addEventListener(\'change\'')) {
    throw new Error('Missing inputUploadDet change listener in workspace.js');
  }
  console.log('[PASS] In-place upload logic and event bindings verified in workspace.js');

  // 4. Test API upload endpoint works with a real test file
  const testProjectRes = await fetch('http://localhost:3001/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'In-Place Upload Test ' + Date.now(),
      description: 'Testing upload from AI detection page'
    })
  });
  const testProj = await testProjectRes.json();
  const projId = testProj.project.id;

  // Upload an image to this project
  const testImagePath = path.resolve('uploads', 'coastal_settlement_demo.png');
  const fileBuffer = fs.readFileSync(testImagePath);
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="imagery"; filename="inplace_test.png"\r\nContent-Type: image/png\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n740\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="height"\r\n\r\n480\r\n`),
    Buffer.from(`--${boundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`http://localhost:3001/api/projects/${projId}/imagery`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: payload
  });

  const uploadData = await uploadRes.json();
  if (!uploadData.success || !uploadData.imagery) {
    throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
  }
  console.log(`[PASS] Uploaded new image in-place: ${uploadData.imagery.file_name} (ID: ${uploadData.imagery.id}, is_georeferenced: ${uploadData.imagery.is_georeferenced})`);

  // Verify project imagery now contains this uploaded image
  const imageryListRes = await fetch(`http://localhost:3001/api/projects/${projId}/imagery`);
  const imageryList = await imageryListRes.json();
  if (imageryList.imagery.length !== 1 || imageryList.imagery[0].id !== uploadData.imagery.id) {
    throw new Error('Project imagery list does not reflect uploaded image');
  }
  console.log(`[PASS] Project imagery list successfully returns the newly uploaded image`);

  console.log('\n=== ALL IN-PLACE UPLOAD TESTS PASSED ===\n');
}

testInPlaceUpload().catch(e => {
  console.error('[FAIL]', e);
  process.exit(1);
});
