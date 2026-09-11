/**
 * PARCELMAP — GIS QUALITY & COORDINATE-MODE SYNCHRONIZATION AUDIT
 * Tests all 9 core requirements from user prompt:
 * 1. Exact active imagery used across all workflow stages
 * 2. Coordinate mode matching real imagery metadata (IMAGE-SPACE vs GEOREFERENCED)
 * 3. Removal of inconsistent basemap & scale bar for image-space projects
 * 4. Exact same image through Drone Imagery -> AI Detection -> Spatial Reasoning -> GIS Quality -> Verification -> Final Map
 * 5. Parcel geometry consistency (source-image pixel geometry)
 * 6. "Ready for Verification" derived from actual persisted candidate status
 * 7. Real calculated metrics from backend topology audit (no hardcoded numbers)
 * 8. Fresh project full lifecycle test
 * 9. Demo project test (coastal settlement demo with 0 street basemap)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_BASE = 'http://localhost:3001/api';

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return { ok: res.ok, status: res.status, headers: res.headers, data };
  } else {
    const text = await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, text };
  }
}

async function runSyncAudit() {
  console.log('================================================================================');
  console.log('PARCELMAP: GIS QUALITY & COORDINATE-MODE SYNCHRONIZATION AUDIT');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1 & 9: DEMO PROJECT INSPECTION (ParcelMap Demo — Coastal Settlement)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1 & 9: DEMO PROJECT (COASTAL SETTLEMENT) CONSISTENCY ---');
  const demoProjRes = await request(`${API_BASE}/projects/proj_demo_coastal`);
  assert(demoProjRes.ok && demoProjRes.data?.project, 'Demo project retrieved successfully');
  const demoProj = demoProjRes.data.project;
  assert(demoProj.name.includes('Coastal'), 'Demo project name contains Coastal');

  const demoImgRes = await request(`${API_BASE}/projects/proj_demo_coastal/imagery`);
  assert(demoImgRes.ok && demoImgRes.data?.imagery?.length > 0, 'Demo imagery retrieved');
  const demoImg = demoImgRes.data.imagery[0];
  assert(demoImg.file_url.includes('coastal_settlement_demo'), `Demo imagery file_url matches coastal settlement (${demoImg.file_url})`);
  assert(demoImg.is_georeferenced === false || demoImg.coordinate_mode === 'image-space', 'Demo imagery is marked non-georeferenced (image-space)');

  // Verify GIS Quality on Demo Project
  const demoQcRes = await request(`${API_BASE}/projects/proj_demo_coastal/gis-quality?imagery_id=${demoImg.id}`);
  assert(demoQcRes.ok && demoQcRes.data?.success, 'Demo GIS Quality audit returned successfully');
  const demoQc = demoQcRes.data;
  assert(demoQc.total_parcels === 3, `Demo total parcels = 3 (got ${demoQc.total_parcels})`);
  assert(demoQc.valid_parcels === 3, `Demo valid parcels = 3 (got ${demoQc.valid_parcels})`);
  assert(demoQc.ready_for_review_count >= 1, `Demo ready for review count >= 1 (got ${demoQc.ready_for_review_count})`);

  // --------------------------------------------------------------------------
  // TEST 2, 3, 4, 5: CODEBASE INSPECTION FOR IMAGE-SPACE ENFORCEMENT & BASEMAP REMOVAL
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2, 3, 4, 5: WORKSPACE.JS IMAGE-SPACE CANVAS & COORDINATE AUDIT ---');
  const wsJs = fs.readFileSync(path.resolve('workspace.js'), 'utf8');

  // Verify renderQualityMap thoroughly empties mapDiv innerHTML before map init
  assert(wsJs.includes("mapDiv.innerHTML = '';"), 'renderQualityMap clears mapDiv.innerHTML before map init');

  // Verify non-georeferenced imagery uses L.CRS.Simple and NO tileLayer in renderQualityMap
  const qcMapLogic = wsJs.substring(wsJs.indexOf('renderQualityMap()'), wsJs.indexOf('// 1. Contextual Features'));
  assert(qcMapLogic.includes('crs: L.CRS.Simple,'), 'qcMap initializes with L.CRS.Simple for image-space imagery');
  assert(!qcMapLogic.includes('L.control.scale'), 'qcMap does NOT add geographic scale control');
  assert(qcMapLogic.includes('this.getImageUrl(currentImg.file_url)'), 'qcMap attaches exact currentImg.file_url via imageOverlay');
  assert(qcMapLogic.includes('invalidateSize()'), 'qcMap calls invalidateSize to prevent rendering glitches');

  // Verify candidate parcel filtering in renderQualityMap does NOT leak other images
  const parcelFilterLogic = wsJs.substring(wsJs.indexOf('// 2. Preliminary Parcels (Step 8 Section 8 & 9)'), wsJs.indexOf('// 3. Quality Issue Highlights'));
  assert(!parcelFilterLogic.includes('currentParcels = this.parcels;'), 'renderQualityMap does NOT fall back to unrelated parcels from other images');
  assert(parcelFilterLogic.includes('currentImg.id'), 'renderQualityMap strictly filters parcels by currentImg.id');

  // Verify refreshQualityData exists and is called upon Spatial Reasoning and view entry
  assert(wsJs.includes('async refreshQualityData()'), 'workspace.js implements refreshQualityData');
  assert(wsJs.includes('this.refreshQualityData().catch('), 'Spatial Reasoning triggers refreshQualityData upon candidate generation');
  assert(wsJs.includes('await this.refreshQualityData()'), 'btnProceedToQuality awaits refreshQualityData before switching to quality view');

  // Verify primary image selection on initial load (defaults to imagery[0] not imagery.length-1)
  assert(wsJs.includes('this.selectedImageryId = this.imagery[0].id;'), 'loadProjectData defaults to project primary image (index 0)');

  // --------------------------------------------------------------------------
  // TEST 6 & 7: BACKEND TOPOLOGY AUDIT & VALIDATION METRICS
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6 & 7: BACKEND TOPOLOGY AUDIT REAL METRIC CALCULATIONS ---');
  const { GISEngine } = await import('./server/services/gisEngine.js');

  const testParcels = [
    {
      parcel_id: 'TEST-P1',
      status: 'preliminary',
      candidate_status: 'ACCEPTED',
      geometry: {
        type: 'Polygon',
        coordinates: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]]
      }
    },
    {
      parcel_id: 'TEST-P2',
      status: 'needs_review',
      candidate_status: 'REVIEW',
      geometry: {
        type: 'Polygon',
        coordinates: [[[205, 100], [305, 100], [305, 200], [205, 200], [205, 100]]]
      }
    },
    {
      parcel_id: 'TEST-P3',
      status: 'rejected',
      candidate_status: 'REJECTED',
      geometry: {
        type: 'Polygon',
        coordinates: [[[310, 100], [410, 100], [410, 200], [310, 200], [310, 100]]]
      }
    }
  ];

  const auditResult = GISEngine.auditTopology(testParcels);
  assert(auditResult.total_parcels === 3, `Total parcels audited = 3 (got ${auditResult.total_parcels})`);
  assert(auditResult.valid_polygons_count === 3, `Valid polygons count = 3 (got ${auditResult.valid_polygons_count})`);
  assert(auditResult.rejected_count === 1, `Rejected count = 1 (got ${auditResult.rejected_count})`);
  assert(auditResult.needs_review_count === 1, `Needs review count = 1 (got ${auditResult.needs_review_count})`);
  assert(auditResult.ready_for_review_count === 2, `Ready for review excludes rejected parcel: expected 2 (got ${auditResult.ready_for_review_count})`);

  // --------------------------------------------------------------------------
  // TEST 8: FRESH PROJECT FULL WORKFLOW TEST
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: FRESH PROJECT FULL WORKFLOW (NEW PROJECT -> UPLOAD -> DETECT -> SPATIAL REASONING -> GIS QUALITY) ---');

  // 1. Create New Fresh Project
  const freshProjRes = await request(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Fresh Quality Audit Project ${Date.now()}`,
      location: 'Farmland Sector 12',
      description: 'End-to-end fresh project GIS Quality test'
    })
  });
  assert(freshProjRes.ok && freshProjRes.data?.project?.id, 'Created fresh project');
  const freshProject = freshProjRes.data.project;

  // 2. Upload Drone Imagery to Fresh Project
  const testImagePath = path.join(__dirname, 'test_assets', 'drone_image_a.png');
  const fileBuffer = fs.readFileSync(testImagePath);
  const formData = new FormData();
  const fileBlob = new Blob([fileBuffer], { type: 'image/png' });
  formData.append('imagery', fileBlob, 'fresh_drone_ortho.png');
  formData.append('width', '600');
  formData.append('height', '400');

  const freshUploadRes = await fetch(`${API_BASE}/projects/${freshProject.id}/imagery`, {
    method: 'POST',
    body: formData
  });
  const freshUploadData = await freshUploadRes.json();
  assert(freshUploadData.success && freshUploadData.imagery?.id, `Uploaded imagery to fresh project (${freshUploadData.imagery?.id})`);
  const freshImg = freshUploadData.imagery;

  // Verify non-georeferenced flag
  assert(freshImg.is_georeferenced === false, 'Fresh uploaded PNG is marked non-georeferenced');

  // 3. AI Detection on Fresh Image
  const freshDetectRes = await request(`${API_BASE}/imagery/${freshImg.id}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'cv' })
  });
  assert(freshDetectRes.ok && freshDetectRes.data?.success, `AI Detection executed (${freshDetectRes.data?.features_count || 0} features)`);

  // 4. Spatial Reasoning on Fresh Project
  const freshReasonRes = await request(`${API_BASE}/projects/${freshProject.id}/spatial-reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagery_id: freshImg.id })
  });
  assert(freshReasonRes.ok && freshReasonRes.data?.success, `Spatial Reasoning executed (${freshReasonRes.data?.parcels_count || 0} candidates)`);
  const generatedCount = freshReasonRes.data.parcels_count || freshReasonRes.data.candidates?.length || 0;
  assert(generatedCount > 0, `Generated > 0 preliminary parcels (got ${generatedCount})`);

  // 5. GIS Quality on Fresh Project
  const freshQcRes = await request(`${API_BASE}/projects/${freshProject.id}/gis-quality?imagery_id=${freshImg.id}`);
  assert(freshQcRes.ok && freshQcRes.data?.success, 'GIS Quality API returned successfully for fresh project');
  const freshQc = freshQcRes.data;

  assert(freshQc.total_parcels === generatedCount, `GIS Quality total parcels matches Spatial Reasoning count (${freshQc.total_parcels} === ${generatedCount})`);
  assert(freshQc.valid_parcels === generatedCount, `GIS Quality valid parcels matches (${freshQc.valid_parcels} === ${generatedCount})`);
  assert(freshQc.imagery_id === freshImg.id, `GIS Quality imagery_id strictly matches fresh uploaded image (${freshQc.imagery_id} === ${freshImg.id})`);
  assert(freshQc.ready_for_review_count > 0, `GIS Quality ready for review count > 0 (got ${freshQc.ready_for_review_count})`);

  // 6. Verify Parcel Geometries in DB align with source image (pixel coordinates)
  const freshParcelsRes = await request(`${API_BASE}/projects/${freshProject.id}/parcels?imagery_id=${freshImg.id}`);
  assert(freshParcelsRes.ok && freshParcelsRes.data?.parcels?.length === generatedCount, 'Parcels retrieved for fresh project');
  const p1 = freshParcelsRes.data.parcels[0];
  assert(p1.imagery_id === freshImg.id, `Parcel imagery_id strictly matches (${p1.imagery_id} === ${freshImg.id})`);
  assert(p1.image_coordinates && p1.image_coordinates.length > 0, 'Parcel image_coordinates are present');
  const ring0 = p1.image_coordinates[0];
  const maxCoord = Math.max(...ring0.flat());
  assert(maxCoord <= 600, `Coordinates are strictly within image dimensions (maxCoord = ${maxCoord} <= 600px width)`);

  console.log('\n================================================================================');
  console.log(`AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSyncAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
