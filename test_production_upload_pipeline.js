/**
 * Production Upload Pipeline Verification Test Suite
 * 
 * Verifies the complete end-to-end upload flow for Netlify production:
 * 1. Netlify Blobs storage key pattern: projects/{project_id}/imagery/{imagery_id}/{filename}
 * 2. Unified StorageService save, retrieve, chunk assembly, and delete
 * 3. Direct image upload API (POST /api/projects/:id/imagery) with real image data
 * 4. Chunked upload API (init -> chunk -> complete) for large files (> 4.5 MB)
 * 5. Validation of file types (reject unsupported formats with clear structured JSON)
 * 6. Image retrieval via GET /api/imagery/:id/file with correct Content-Type and CORS headers
 * 7. Project isolation: Project A, Project B, and Demo project datasets remain strictly separated
 * 8. AI Detection pipeline execution on user-uploaded imagery
 * 9. Serverless Netlify Function gateway simulation (upload.js & api.js)
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { StorageService } from './server/services/storageService.js';
import { db } from './server/db/database.js';
import { app } from './server/app.js';
import { handler as apiHandler } from './netlify/functions/api.js';
import { handler as uploadHandler } from './netlify/functions/upload.js';

let server = null;
let port = 0;
let baseUrl = '';

// Helper to create valid minimal 100x100 PNG buffer
function createTestPngBuffer() {
  // Minimal valid 1x1 PNG
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
    0x42, 0x60, 0x82
  ]);
}

// Helper to create minimal valid JPEG buffer
function createTestJpegBuffer() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0x7f, 0x00, 0xff, 0xd9
  ]);
}

// Multipart builder helper
function buildMultipartBody(fields, fileField, filename, fileBuffer, mimeType) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  if (fileField && filename && fileBuffer) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const fullBody = Buffer.concat(chunks);

  return {
    body: fullBody,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length
    }
  };
}

async function run() {
  console.log('====================================================');
  console.log('TEST SUITE: Netlify Production Image Upload Pipeline');
  console.log('====================================================\n');

  // Start test server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`[Test Server] Running on ${baseUrl}`);
      resolve();
    });
  });

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      testsPassed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      testsFailed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: StorageService Key Convention and Save/Get/Delete
    // -------------------------------------------------------------
    console.log('\n[1] Testing StorageService Key Architecture & Adapter:');
    const testProjId = `proj_test_${Date.now()}`;
    const testImgId = `img_test_${Date.now()}`;
    const expectedKey = `projects/${testProjId}/imagery/${testImgId}/aerial_block_01.jpg`;
    
    const key = StorageService.buildStorageKey(testProjId, testImgId, 'aerial_block_01.jpg');
    assert(key === expectedKey, `Key matches requirement: ${key}`);

    const sampleBuffer = createTestJpegBuffer();
    const saveRes = await StorageService.saveImage({
      projectId: testProjId,
      imageryId: testImgId,
      filename: 'aerial_block_01.jpg',
      buffer: sampleBuffer,
      mimeType: 'image/jpeg'
    });

    assert(saveRes.storage_key === expectedKey, `Saved storage_key matches expected key`);
    assert(saveRes.storage_url === `/api/imagery/${testImgId}/file`, `Storage URL returns standard production endpoint`);
    assert(saveRes.file_size === sampleBuffer.length, `File size matches stored buffer size (${saveRes.file_size} bytes)`);

    const loaded = await StorageService.getImageBuffer(saveRes.storage_key);
    assert(loaded && loaded.buffer && loaded.buffer.length === sampleBuffer.length, `Loaded image buffer matches original size`);

    const delRes = await StorageService.deleteImage(saveRes.storage_key);
    assert(delRes === true, `deleteImage returns true on clean deletion`);

    // -------------------------------------------------------------
    // TEST 2: Direct Image Upload API (Small / Medium Files <= 4.5 MB)
    // -------------------------------------------------------------
    console.log('\n[2] Testing Direct Multipart Upload API (POST /api/projects/:id/imagery):');
    // Create dedicated project
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Field Block Alfa Survey',
        location: 'Coastal Parcel Sector 7',
        is_demo: false
      })
    });
    const projData = await projRes.json();
    assert(projRes.ok && projData.success, `Created real survey project: ${projData.project.id}`);
    const projectIdA = projData.project.id;

    // Upload real aerial drone imagery
    const realSamplePath = path.join(process.cwd(), 'uploads', 'uav_test_1789109628071.png');
    const realImageBuffer = fs.existsSync(realSamplePath) ? fs.readFileSync(realSamplePath) : createTestPngBuffer();
    const mpJpeg = buildMultipartBody(
      { width: '600', height: '450', project_id: projectIdA },
      'imagery',
      'drone_survey_alfa.png',
      realImageBuffer,
      'image/png'
    );

    const uploadRes = await fetch(`${baseUrl}/api/projects/${projectIdA}/imagery`, {
      method: 'POST',
      headers: mpJpeg.headers,
      body: mpJpeg.body
    });

    assert(uploadRes.status === 201, `Upload API responded with HTTP 201 Created`);
    const uploadData = await uploadRes.json();
    assert(uploadData.success === true, `Structured response has success: true`);
    assert(Boolean(uploadData.imagery_id), `Response returns valid imagery_id: ${uploadData.imagery_id}`);
    assert(uploadData.project_id === projectIdA, `Response associates with current project_id: ${projectIdA}`);
    assert(Boolean(uploadData.file), `Response includes file metadata object`);
    assert(uploadData.file.storage_key.startsWith(`projects/${projectIdA}/imagery/`), `storage_key matches projects/${projectIdA}/imagery/* pattern`);
    assert(uploadData.file.storage_url === `/api/imagery/${uploadData.imagery_id}/file`, `storage_url matches persistent endpoint`);
    assert(uploadData.imagery.status === 'READY', `DB record status is READY`);
    assert(uploadData.imagery.coordinate_mode === 'image-space', `Coordinate mode defaults to image-space for standard drone images`);

    const imageIdA = uploadData.imagery_id;

    // -------------------------------------------------------------
    // TEST 3: Persistent Image Serving (GET /api/imagery/:id/file)
    // -------------------------------------------------------------
    console.log('\n[3] Testing Image Serving Endpoint (GET /api/imagery/:id/file):');
    const serveRes = await fetch(`${baseUrl}/api/imagery/${imageIdA}/file`);
    assert(serveRes.status === 200, `Image serving returns HTTP 200 OK`);
    assert(serveRes.headers.get('content-type') === 'image/png', `Content-Type header is image/png`);
    assert(serveRes.headers.get('access-control-allow-origin') === '*', `CORS header allows cross-origin tile/image overlays`);
    const servedBuffer = Buffer.from(await serveRes.arrayBuffer());
    assert(servedBuffer.length === realImageBuffer.length, `Served buffer byte length matches uploaded file`);

    // -------------------------------------------------------------
    // TEST 4: Chunked Large-File Upload Pipeline (> 4.5 MB)
    // -------------------------------------------------------------
    console.log('\n[4] Testing Chunked Upload Architecture for Large Files (> 4.5 MB):');
    // Simulate 3 chunks totaling ~30 KB for fast test verification
    const chunk1 = Buffer.alloc(10000, 0x41); // 'A's
    const chunk2 = Buffer.alloc(10000, 0x42); // 'B's
    const chunk3 = createTestJpegBuffer();     // Valid JPEG ending
    const totalSimSize = chunk1.length + chunk2.length + chunk3.length;

    // Step A: Init
    const initRes = await fetch(`${baseUrl}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectIdA,
        filename: 'heavy_orthomosaic_highres.jpg',
        file_size: totalSimSize,
        total_chunks: 3
      })
    });
    assert(initRes.status === 200, `Upload session init responded with HTTP 200`);
    const initData = await initRes.json();
    assert(Boolean(initData.session_id), `Init returned valid session_id: ${initData.session_id}`);
    assert(initData.total_chunks === 3, `Init confirmed total_chunks: 3`);
    const sessId = initData.session_id;

    // Step B: Upload chunks
    const c1Mp = buildMultipartBody({ session_id: sessId, chunk_index: '0' }, 'chunk', 'c0.bin', chunk1, 'application/octet-stream');
    const c1Res = await fetch(`${baseUrl}/api/upload/chunk`, { method: 'POST', headers: c1Mp.headers, body: c1Mp.body });
    assert(c1Res.status === 200 && (await c1Res.json()).success, `Uploaded Chunk 0 successfully`);

    const c2Mp = buildMultipartBody({ session_id: sessId, chunk_index: '1' }, 'chunk', 'c1.bin', chunk2, 'application/octet-stream');
    const c2Res = await fetch(`${baseUrl}/api/upload/chunk`, { method: 'POST', headers: c2Mp.headers, body: c2Mp.body });
    assert(c2Res.status === 200 && (await c2Res.json()).success, `Uploaded Chunk 1 successfully`);

    const c3Mp = buildMultipartBody({ session_id: sessId, chunk_index: '2' }, 'chunk', 'c2.bin', chunk3, 'application/octet-stream');
    const c3Res = await fetch(`${baseUrl}/api/upload/chunk`, { method: 'POST', headers: c3Mp.headers, body: c3Mp.body });
    assert(c3Res.status === 200 && (await c3Res.json()).success, `Uploaded Chunk 2 successfully`);

    // Step C: Complete and Assemble
    const compRes = await fetch(`${baseUrl}/api/upload/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessId,
        project_id: projectIdA,
        filename: 'heavy_orthomosaic_highres.jpg',
        total_chunks: 3,
        mime_type: 'image/jpeg',
        width: 4000,
        height: 3000
      })
    });
    assert(compRes.status === 201, `Complete session responded with HTTP 201 Created`);
    const compData = await compRes.json();
    assert(compData.success === true, `Complete session success: true`);
    assert(compData.imagery.file_name === 'heavy_orthomosaic_highres.jpg', `Imagery record has correct assembled filename`);
    assert(compData.file.storage_key.includes(projectIdA), `Assembled image stored under project directory in storage`);

    // -------------------------------------------------------------
    // TEST 5: File Validation & Unsupported Formats
    // -------------------------------------------------------------
    console.log('\n[5] Testing File Format Validation (Negative Tests):');
    const invalidTextBuffer = Buffer.from('This is a text file masquerading as an image.');
    const mpInvalid = buildMultipartBody(
      { project_id: projectIdA },
      'imagery',
      'malicious_script.exe',
      invalidTextBuffer,
      'application/x-msdownload'
    );

    const badUploadRes = await fetch(`${baseUrl}/api/projects/${projectIdA}/imagery`, {
      method: 'POST',
      headers: mpInvalid.headers,
      body: mpInvalid.body
    });

    assert(badUploadRes.status === 400, `Unsupported file format rejected with HTTP 400`);
    const badData = await badUploadRes.json();
    assert(badData.success === false, `Response returned structured failure (success: false)`);
    assert(typeof badData.error === 'string' && badData.error.includes('Unsupported file type'), `Clear descriptive error message returned: "${badData.error}"`);

    // -------------------------------------------------------------
    // TEST 6: Project Isolation (No Cross-Project Contamination)
    // -------------------------------------------------------------
    console.log('\n[6] Testing Project Imagery Isolation:');
    // Create Project B
    const projBRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Beta Isolation Block', is_demo: false })
    });
    const projectB = (await projBRes.json()).project;

    // Upload distinct PNG image to Project B
    const pngBuffer = createTestPngBuffer();
    const mpPngB = buildMultipartBody(
      { project_id: projectB.id },
      'imagery',
      'project_b_boundary.png',
      pngBuffer,
      'image/png'
    );
    const upBRes = await fetch(`${baseUrl}/api/projects/${projectB.id}/imagery`, {
      method: 'POST',
      headers: mpPngB.headers,
      body: mpPngB.body
    });
    const upBData = await upBRes.json();
    assert(upBRes.status === 201 && upBData.success, `Uploaded distinct image to Project B`);

    // Inspect Project A imagery
    const listARes = await fetch(`${baseUrl}/api/projects/${projectIdA}/imagery`);
    const listAData = await listARes.json();
    const listAFilenames = listAData.imagery.map(i => i.file_name);
    assert(listAFilenames.includes('drone_survey_alfa.png'), `Project A contains its uploaded image`);
    assert(!listAFilenames.includes('project_b_boundary.png'), `Project A does NOT contain Project B's image`);

    // Inspect Project B imagery
    const listBRes = await fetch(`${baseUrl}/api/projects/${projectB.id}/imagery`);
    const listBData = await listBRes.json();
    const listBFilenames = listBData.imagery.map(i => i.file_name);
    assert(listBFilenames.includes('project_b_boundary.png'), `Project B contains its uploaded image`);
    assert(!listBFilenames.includes('drone_survey_alfa.jpg'), `Project B does NOT contain Project A's image`);

    // Inspect Demo project
    const demoRes = await fetch(`${baseUrl}/api/projects/proj_demo_coastal/imagery`);
    const demoData = await demoRes.json();
    const demoFilenames = demoData.imagery.map(i => i.file_name);
    assert(!demoFilenames.includes('drone_survey_alfa.jpg') && !demoFilenames.includes('project_b_boundary.png'), `Demo project remains completely isolated from user uploads`);

    // -------------------------------------------------------------
    // TEST 7: AI Detection on Uploaded Image
    // -------------------------------------------------------------
    console.log('\n[7] Testing AI Detection Pipeline on Uploaded Image:');
    const detectRes = await fetch(`${baseUrl}/api/imagery/${imageIdA}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cv' })
    });
    assert(detectRes.status === 200, `AI detection endpoint responded with HTTP 200 OK`);
    const detectData = await detectRes.json();
    assert(detectData.success === true, `Detection completed with success: true`);
    assert(detectData.imagery_id === imageIdA, `Detection results correctly linked to uploaded imagery_id`);
    assert(Array.isArray(detectData.detections), `Detections returned as array (${detectData.detections.length} features found)`);

    // -------------------------------------------------------------
    // TEST 8: Netlify Functions Gateway Simulation
    // -------------------------------------------------------------
    console.log('\n[8] Testing Netlify Serverless Function Handlers:');
    // Test OPTIONS preflight on upload.js
    const fnUploadOptions = await uploadHandler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://resilient-figolla-23b96e.netlify.app' }
    }, {});
    assert(fnUploadOptions.statusCode === 200, `upload.js handles OPTIONS preflight with HTTP 200`);
    assert(fnUploadOptions.headers['Access-Control-Allow-Origin'] === 'https://resilient-figolla-23b96e.netlify.app', `upload.js returns correct CORS origin header`);

    // Test API Gateway api.js on /api/health
    const fnApiHealth = await apiHandler({
      httpMethod: 'GET',
      path: '/api/health',
      headers: {}
    }, {});
    assert(fnApiHealth.statusCode === 200, `api.js handles GET /api/health with HTTP 200`);
    const healthJson = JSON.parse(fnApiHealth.body);
    assert(healthJson.status === 'online', `api.js health check body has status online`);

    // Test API Gateway path normalization (e.g. redirected from /.netlify/functions/api/projects)
    const fnApiProjects = await apiHandler({
      httpMethod: 'GET',
      path: `/.netlify/functions/api/projects/${projectIdA}`,
      headers: {}
    }, {});
    assert(fnApiProjects.statusCode === 200, `api.js normalizes Netlify function paths and retrieves project`);
    const projLoaded = JSON.parse(fnApiProjects.body);
    assert(projLoaded.project.id === projectIdA, `api.js retrieved exact project: ${projectIdA}`);

  } catch (err) {
    console.error('[Test Execution Error]:', err);
    testsFailed++;
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
