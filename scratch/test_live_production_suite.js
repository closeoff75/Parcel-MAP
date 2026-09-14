import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const BASE_URL = 'https://adorable-nasturtium-2d06b8.netlify.app';

// Helpers to generate test images of exact target sizes
function createTargetPng(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = (x * 255 / width) | 0;
      png.data[idx + 1] = (y * 255 / height) | 0;
      png.data[idx + 2] = 180;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function createTargetJpeg(width, height, quality = 80) {
  const frameData = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      frameData[idx] = (x ^ y) % 256;
      frameData[idx + 1] = (x * 3) % 256;
      frameData[idx + 2] = (y * 7) % 256;
      frameData[idx + 3] = 255;
    }
  }
  const rawImageData = { data: frameData, width, height };
  return jpeg.encode(rawImageData, quality).data;
}

function buildMultipart(fields, fileField, filename, buffer, mimeType) {
  const boundary = `----ParcelMapLive${Date.now().toString(16)}`;
  const chunks = [];

  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: Buffer.concat(chunks)
  };
}

async function runLiveAudit() {
  console.log('================================================================');
  console.log(`PARCELMAP LIVE NETLIFY PRODUCTION VERIFICATION SUITE`);
  console.log(`Target: ${BASE_URL}`);
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // STAGE 1: Verify API Health & Version
    // -------------------------------------------------------------
    console.log('[STAGE 1] Checking Production Serverless API Health:');
    const healthRes = await fetch(`${BASE_URL}/api/health`, { headers: { 'Cache-Control': 'no-cache' } });
    assert(healthRes.status === 200, `GET /api/health returned HTTP 200 (Got: ${healthRes.status})`);
    const healthData = await healthRes.json();
    assert(healthData.status === 'online', `API reports status: online`);
    console.log(`  Service: ${healthData.service} v${healthData.version}\n`);

    // -------------------------------------------------------------
    // STAGE 2: Create Completely Fresh Project Alpha
    // -------------------------------------------------------------
    console.log('[STAGE 2] Creating Fresh Production Project Alpha:');
    const projAlphaRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Production Survey Alfa - ${Date.now()}`,
        location: 'Coastal Survey Sector 4A',
        is_demo: false
      })
    });
    assert(projAlphaRes.status === 201, `POST /api/projects returned HTTP 201 Created`);
    const projAlphaData = await projAlphaRes.json();
    const projectAlpha = projAlphaData.project;
    const projectAlphaId = projectAlpha.id;
    assert(Boolean(projectAlphaId), `Received real project ID: ${projectAlphaId}\n`);

    // -------------------------------------------------------------
    // STAGE 3: Test Multiple File Sizes Upload (500 KB, 1.5 MB, 3.5 MB)
    // -------------------------------------------------------------
    console.log('[STAGE 3] Testing Direct Upload Across Multiple File Sizes:');

    // Test A: ~500 KB PNG
    const png500k = createTargetPng(700, 500);
    console.log(`  Upload A: PNG ~${(png500k.length / 1024).toFixed(1)} KB`);
    const mpA = buildMultipart({ project_id: projectAlphaId }, 'imagery', 'uav_survey_500k.png', png500k, 'image/png');
    const upARes = await fetch(`${BASE_URL}/api/projects/${projectAlphaId}/imagery`, {
      method: 'POST',
      headers: mpA.headers,
      body: mpA.body
    });
    assert(upARes.status === 201, `Upload 500 KB PNG returned HTTP 201 (Got: ${upARes.status})`);
    const upAData = await upARes.json();
    assert(upAData.success === true, `Upload response has success: true`);
    assert(Boolean(upAData.imagery_id), `Returns valid imagery_id: ${upAData.imagery_id}`);
    const imageAlphaId = upAData.imagery_id;

    // Test B: ~1.5 MB JPEG
    const jpg15m = createTargetJpeg(1200, 900, 85);
    console.log(`  Upload B: JPEG ~${(jpg15m.length / (1024 * 1024)).toFixed(2)} MB`);
    const mpB = buildMultipart({ project_id: projectAlphaId }, 'imagery', 'uav_survey_1500k.jpg', jpg15m, 'image/jpeg');
    const upBRes = await fetch(`${BASE_URL}/api/projects/${projectAlphaId}/imagery`, {
      method: 'POST',
      headers: mpB.headers,
      body: mpB.body
    });
    assert(upBRes.status === 201, `Upload 1.5 MB JPEG returned HTTP 201`);
    const upBData = await upBRes.json();
    assert(upBData.success === true, `Upload 1.5 MB response has success: true`);

    // Test C: ~3.5 MB JPEG
    const jpg35m = createTargetJpeg(2000, 1500, 85);
    console.log(`  Upload C: JPEG ~${(jpg35m.length / (1024 * 1024)).toFixed(2)} MB`);
    const mpC = buildMultipart({ project_id: projectAlphaId }, 'imagery', 'uav_survey_3500k.jpg', jpg35m, 'image/jpeg');
    const upCRes = await fetch(`${BASE_URL}/api/projects/${projectAlphaId}/imagery`, {
      method: 'POST',
      headers: mpC.headers,
      body: mpC.body
    });
    assert(upCRes.status === 201, `Upload 3.5 MB JPEG returned HTTP 201`);
    const upCData = await upCRes.json();
    assert(upCData.success === true, `Upload 3.5 MB response has success: true\n`);

    // -------------------------------------------------------------
    // STAGE 4: Image Retrieval & Persistence Verification
    // -------------------------------------------------------------
    console.log('[STAGE 4] Verifying Image Retrieval from Storage Endpoint:');
    const fileRes = await fetch(`${BASE_URL}/api/imagery/${imageAlphaId}/file`);
    assert(fileRes.status === 200, `GET /api/imagery/${imageAlphaId}/file returned HTTP 200`);
    const fileContentType = fileRes.headers.get('content-type');
    assert(fileContentType.includes('image/png'), `Content-Type is image/png (Got: ${fileContentType})`);
    const fileBuf = Buffer.from(await fileRes.arrayBuffer());
    assert(fileBuf.length === png500k.length, `Downloaded byte length (${fileBuf.length}) matches uploaded byte length (${png500k.length})\n`);

    // -------------------------------------------------------------
    // STAGE 5: Chunked Upload Pipeline (> 4.5 MB)
    // -------------------------------------------------------------
    console.log('[STAGE 5] Testing Large-File Chunked Upload Pipeline (> 4.5 MB):');
    const largeJpg = createTargetJpeg(2500, 2000, 90); // ~6-8 MB
    console.log(`  Large file size: ${(largeJpg.length / (1024 * 1024)).toFixed(2)} MB`);
    const CHUNK_SIZE = 2.5 * 1024 * 1024; // 2.5 MB chunks
    const totalChunks = Math.ceil(largeJpg.length / CHUNK_SIZE);

    // Init chunked session
    const initRes = await fetch(`${BASE_URL}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectAlphaId,
        filename: 'heavy_orthomosaic_live.jpg',
        file_size: largeJpg.length,
        total_chunks: totalChunks,
        mime_type: 'image/jpeg'
      })
    });
    assert(initRes.status === 200, `POST /api/upload/init returned HTTP 200`);
    const initData = await initRes.json();
    const sessionId = initData.session_id;
    assert(Boolean(sessionId), `Received session_id: ${sessionId}`);

    // Send chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, largeJpg.length);
      const chunkBuf = largeJpg.subarray(start, end);
      const chunkRes = await fetch(`${BASE_URL}/api/upload/chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Session-Id': sessionId,
          'X-Chunk-Index': String(i),
          'X-Total-Chunks': String(totalChunks)
        },
        body: chunkBuf
      });
      assert(chunkRes.status === 200, `Chunk ${i + 1}/${totalChunks} uploaded with HTTP 200`);
    }

    // Complete session
    const compRes = await fetch(`${BASE_URL}/api/upload/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        total_chunks: totalChunks,
        project_id: projectAlphaId,
        filename: 'heavy_orthomosaic_live.jpg',
        mime_type: 'image/jpeg'
      })
    });
    assert(compRes.status === 201, `POST /api/upload/complete returned HTTP 201 Created`);
    const compData = await compRes.json();
    assert(compData.success === true, `Chunked assembly success: true`);
    assert(Boolean(compData.imagery_id), `Assembled imagery_id: ${compData.imagery_id}\n`);

    // -------------------------------------------------------------
    // STAGE 6: Project Isolation Verification
    // -------------------------------------------------------------
    console.log('[STAGE 6] Testing Project Isolation (Project A vs Project B):');
    const projBetaRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Production Survey Beta - ${Date.now()}`,
        location: 'Agricultural Valley Sector 2',
        is_demo: false
      })
    });
    const projectBetaId = (await projBetaRes.json()).project.id;

    // Upload distinct image to Project Beta
    const betaPng = createTargetPng(400, 300);
    const mpBeta = buildMultipart({ project_id: projectBetaId }, 'imagery', 'beta_unique_drone.png', betaPng, 'image/png');
    const upBetaRes = await fetch(`${BASE_URL}/api/projects/${projectBetaId}/imagery`, {
      method: 'POST',
      headers: mpBeta.headers,
      body: mpBeta.body
    });
    assert(upBetaRes.status === 201, `Uploaded distinct image to Project Beta`);

    // Verify Project Alpha does NOT have beta_unique_drone.png
    const listAlphaRes = await fetch(`${BASE_URL}/api/projects/${projectAlphaId}/imagery`);
    const listAlphaData = await listAlphaRes.json();
    const alphaFiles = listAlphaData.imagery.map(i => i.file_name);
    assert(alphaFiles.includes('uav_survey_500k.png'), `Project Alpha contains uav_survey_500k.png`);
    assert(!alphaFiles.includes('beta_unique_drone.png'), `Project Alpha does NOT contain beta_unique_drone.png`);

    // Verify Project Beta does NOT have Project Alpha's images
    const listBetaRes = await fetch(`${BASE_URL}/api/projects/${projectBetaId}/imagery`);
    const listBetaData = await listBetaRes.json();
    const betaFiles = listBetaData.imagery.map(i => i.file_name);
    assert(betaFiles.includes('beta_unique_drone.png'), `Project Beta contains beta_unique_drone.png`);
    assert(!betaFiles.includes('uav_survey_500k.png'), `Project Beta does NOT contain Project Alpha's image\n`);

    // -------------------------------------------------------------
    // STAGE 7: AI Detection Pipeline Handoff
    // -------------------------------------------------------------
    console.log('[STAGE 7] Testing AI Detection on Uploaded Imagery:');
    const detectRes = await fetch(`${BASE_URL}/api/imagery/${imageAlphaId}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cv' })
    });
    assert(detectRes.status === 200, `POST /api/imagery/:id/detect returned HTTP 200`);
    const detectData = await detectRes.json();
    assert(detectData.success === true, `Detection completed with success: true`);
    assert(detectData.imagery_id === imageAlphaId, `Detection correctly associated with uploaded imagery_id`);
    assert(Array.isArray(detectData.detections), `Features returned as array (Count: ${detectData.detections.length})\n`);

  } catch (err) {
    console.error(`[Test Suite Critical Failure]: ${err.message}`);
    failed++;
  }

  console.log('================================================================');
  console.log(`LIVE AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runLiveAudit();
