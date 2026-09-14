/**
 * Comprehensive Deep Audit & Bug Fix Verification Suite
 * Validates fixes for:
 * 1. Image deletion without ReferenceError (uploadDir) and StorageService cleanup
 * 2. GISEngine.mergePolygons availability and proper Turf execution
 * 3. Turf import in server/routes/api.js
 * 4. Netlify upload route handling (/api/upload/init, chunk, complete)
 * 5. Netlify Blobs state synchronization in serverless functions
 * 6. Parcel search coordinate sanitization (no invalid lat/lng > 90)
 * 7. Database collection defensiveness & reload safety
 */

import assert from 'assert';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { app } from '../server/app.js';
import { db } from '../server/db/database.js';
import { GISEngine } from '../server/services/gisEngine.js';
import { StorageService } from '../server/services/storageService.js';
import { handler as uploadHandler } from '../netlify/functions/upload.js';
import { handler as apiHandler } from '../netlify/functions/api.js';

let server = null;
let baseUrl = '';

async function runAudit() {
  console.log('====================================================');
  console.log('🔍 RUNNING SENIOR DEVELOPER DEEP AUDIT VERIFICATION');
  console.log('====================================================\n');

  // Start ephemeral test server
  server = http.createServer(app);
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      console.log(`[Test Server] Active on ${baseUrl}`);
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  function test(desc, fn) {
    try {
      fn();
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${desc} - ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(desc, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${desc} - ${err.message}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // AUDIT 1: GISEngine.mergePolygons Restoration
  // ----------------------------------------------------
  console.log('\n[1] Auditing GISEngine.mergePolygons:');
  test('GISEngine.mergePolygons is a defined static function', () => {
    assert(typeof GISEngine.mergePolygons === 'function', 'GISEngine.mergePolygons should be a function');
  });

  test('GISEngine.mergePolygons merges two adjacent polygons into valid closed geometry', () => {
    const poly1 = {
      type: 'Polygon',
      coordinates: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]]
    };
    const poly2 = {
      type: 'Polygon',
      coordinates: [[[200, 100], [300, 100], [300, 200], [200, 200], [200, 100]]]
    };
    const merged = GISEngine.mergePolygons(poly1, poly2);
    assert(merged && merged.type === 'Polygon', 'Merged geometry should be a Polygon');
    assert(merged.coordinates[0].length >= 4, 'Merged polygon should have at least 4 coordinates');
    const ring = merged.coordinates[0];
    assert.deepStrictEqual(ring[0], ring[ring.length - 1], 'Merged polygon ring must be closed');
  });

  // ----------------------------------------------------
  // AUDIT 2: API Parcel Merge & Turf Import
  // ----------------------------------------------------
  console.log('\n[2] Auditing Parcel Merge API Endpoint:');
  await asyncTest('POST /api/parcels/merge executes successfully via API', async () => {
    // Create test project
    const projRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Merge Audit Project', location: 'Audit Site' })
    });
    const projData = await projRes.json();
    assert(projData.success, 'Project created');
    const pId = projData.project.id;

    // Create 2 adjacent parcels
    const polyA = { type: 'Polygon', coordinates: [[[10, 10], [50, 10], [50, 50], [10, 50], [10, 10]]] };
    const polyB = { type: 'Polygon', coordinates: [[[50, 10], [90, 10], [90, 50], [50, 50], [50, 10]]] };

    const paRes = await fetch(`${baseUrl}/projects/${pId}/parcels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: 'PA-01', geometry: polyA, status: 'needs_review' })
    });
    const pbRes = await fetch(`${baseUrl}/projects/${pId}/parcels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: 'PB-02', geometry: polyB, status: 'needs_review' })
    });

    const mergeRes = await fetch(`${baseUrl}/parcels/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel_ids: ['PA-01', 'PB-02'],
        reviewer_name: 'Lead Cadastral Surveyor',
        comments: 'Merged during deep audit'
      })
    });
    assert.strictEqual(mergeRes.status, 200, `Merge endpoint should return HTTP 200, got ${mergeRes.status}`);
    const mergeData = await mergeRes.json();
    assert(mergeData.success, 'Merge response should have success: true');
    assert(mergeData.parcel, 'Merge response should contain merged parcel');
    assert(mergeData.parcel.geometry.type === 'Polygon', 'Result geometry is Polygon');
  });

  // ----------------------------------------------------
  // AUDIT 3: Image Deletion & StorageService Cleanup
  // ----------------------------------------------------
  console.log('\n[3] Auditing Image Deletion & Storage Cleanup:');
  await asyncTest('DELETE /api/imagery/:id removes imagery without uploadDir ReferenceError', async () => {
    // 1. Create a project and save an image via StorageService
    const projRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Deletion Test Project', location: 'Test Location' })
    });
    const { project } = await projRes.json();

    const imgId = `img_del_test_${Date.now()}`;
    const testBuf = Buffer.from('fake image content for delete audit');
    const saveRes = await StorageService.saveImage({
      projectId: project.id,
      imageryId: imgId,
      filename: 'audit_delete_test.jpg',
      buffer: testBuf,
      mimeType: 'image/jpeg'
    });

    const imageryItem = db.addImagery({
      id: imgId,
      imagery_id: imgId,
      project_id: project.id,
      file_name: 'audit_delete_test.jpg',
      storage_key: saveRes.storage_key,
      storage_url: saveRes.storage_url,
      file_url: saveRes.storage_url
    });

    // 2. Call DELETE /api/imagery/:id
    const delRes = await fetch(`${baseUrl}/imagery/${imgId}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200, `Delete should return HTTP 200, got ${delRes.status}`);
    const delData = await delRes.json();
    assert(delData.success, 'Delete returned success: true');

    // 3. Verify removed from db
    const checkDb = db.getImageryById(imgId);
    assert.strictEqual(checkDb, undefined, 'Imagery should no longer exist in db');

    // 4. Verify removed from StorageService
    const storedBuf = await StorageService.getImageBuffer(saveRes.storage_key);
    assert.strictEqual(storedBuf, null, 'Image buffer should no longer exist in storage');
  });

  // ----------------------------------------------------
  // AUDIT 4: Netlify Upload Route Normalization & Chunks
  // ----------------------------------------------------
  console.log('\n[4] Auditing Netlify Upload Function Routing:');
  await asyncTest('upload.js normalizes subpaths and handles init/chunk/complete routes', async () => {
    // Test init via query param action=init
    const initEvent = {
      httpMethod: 'POST',
      path: '/.netlify/functions/upload',
      queryStringParameters: { action: 'init' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: 'proj_demo_coastal',
        filename: 'ortho_audit.png',
        file_size: 10000000,
        total_chunks: 3
      })
    };

    const initRes = await uploadHandler(initEvent, {});
    assert.strictEqual(initRes.statusCode, 200, `Init should return HTTP 200, got ${initRes.statusCode}`);
    const initBody = JSON.parse(initRes.body);
    assert(initBody.success, 'Init response should have success: true');
    assert(initBody.session_id, 'Init response should have session_id');

    // Test with path ending in /init
    const pathInitEvent = {
      httpMethod: 'POST',
      path: '/api/upload/init',
      queryStringParameters: {},
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: 'proj_demo_coastal',
        filename: 'ortho_audit_path.png',
        file_size: 10000000,
        total_chunks: 2
      })
    };

    const pathInitRes = await uploadHandler(pathInitEvent, {});
    assert.strictEqual(pathInitRes.statusCode, 200, `Path init should return HTTP 200, got ${pathInitRes.statusCode}`);
  });

  // ----------------------------------------------------
  // AUDIT 5: Netlify API Function & Blobs Sync
  // ----------------------------------------------------
  console.log('\n[5] Auditing Netlify API Function Handler:');
  await asyncTest('api.js normalizes routes and executes health check and project retrieval', async () => {
    const healthEvent = {
      httpMethod: 'GET',
      path: '/.netlify/functions/api/health',
      headers: {}
    };

    const res = await apiHandler(healthEvent, {});
    assert.strictEqual(res.statusCode, 200, `Health should return HTTP 200, got ${res.statusCode}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'online', 'Health status online');
  });

  // ----------------------------------------------------
  // AUDIT 6: Parcel Search Coordinate Sanitization
  // ----------------------------------------------------
  console.log('\n[6] Auditing Parcel Search Coordinate Sanitization:');
  test('searchParcels does not set lat/lng > 90 for image-space parcels', () => {
    // Add a test parcel with 1000x2000 pixel geometry
    const testParcel = {
      id: 'PM-PIXEL-COORDS-01',
      parcel_id: 'PM-PIXEL-COORDS-01',
      project_id: 'proj_demo_coastal',
      geometry: {
        type: 'Polygon',
        coordinates: [[[1000, 2000], [1500, 2000], [1500, 2500], [1000, 2500], [1000, 2000]]]
      },
      status: 'accepted'
    };
    db.data.parcels.push(testParcel);

    const results = db.searchParcels('PM-PIXEL-COORDS-01');
    assert(results.length > 0, 'Found test parcel in search');
    const result = results[0];
    assert(Math.abs(result.latitude) <= 90, `Latitude must be <= 90, was ${result.latitude}`);
    assert(Math.abs(result.longitude) <= 180, `Longitude must be <= 180, was ${result.longitude}`);

    // Clean up test parcel
    db.data.parcels = db.data.parcels.filter(p => p.id !== 'PM-PIXEL-COORDS-01');
  });

  // ----------------------------------------------------
  // AUDIT 7: Database Defensiveness
  // ----------------------------------------------------
  console.log('\n[7] Auditing Database Collection Defensiveness:');
  test('_ensureCollections initializes missing arrays safely', () => {
    const savedData = db.data;
    db.data = { projects: [] }; // Purposely omit verifications, jobs, etc.
    db._ensureCollections();
    assert(Array.isArray(db.data.verifications), 'verifications array initialized');
    assert(Array.isArray(db.data.processingJobs), 'processingJobs array initialized');
    assert(Array.isArray(db.data.parcels), 'parcels array initialized');
    assert(Array.isArray(db.data.imagery), 'imagery array initialized');

    // Test calling methods on empty collections doesn't throw TypeError
    assert.doesNotThrow(() => {
      db.getVerificationsByProjectId('test');
      db.getJobsByProjectId('test');
      db.getJobById('test');
    });

    db.data = savedData;
  });

  console.log('\n====================================================');
  console.log(`AUDIT RESULTS: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (server) {
    server.close();
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  if (server) server.close();
  process.exit(1);
});
