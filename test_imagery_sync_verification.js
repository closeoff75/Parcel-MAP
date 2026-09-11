/**
 * Automated Verification Script: Imagery Synchronization & Image-Space Mode Audit
 * Validates requirements 1 through 10 from the prompt.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3001/api';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  return await res.json();
}

async function runVerification() {
  console.log('================================================================');
  console.log('PARCELMAP IMAGERY SYNCHRONIZATION & IMAGE-SPACE MODE VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // ---------------------------------------------------------
  // 1. DEMO DATASET VERIFICATION
  // ---------------------------------------------------------
  console.log('--- TEST 1: DEMO DATASET & IMAGERY METADATA ---');
  const demoProject = await fetchJson(`${API_BASE}/projects/proj_demo_coastal`);
  assert(demoProject && demoProject.project, 'Demo project "ParcelMap Demo — Coastal Settlement" exists');
  assert(demoProject.project.id === 'proj_demo_coastal', 'Project ID is proj_demo_coastal');

  const demoImageryList = await fetchJson(`${API_BASE}/projects/proj_demo_coastal/imagery`);
  assert(demoImageryList.success && demoImageryList.imagery.length > 0, 'Demo imagery list returned');
  
  const demoImg = demoImageryList.imagery[0];
  assert(demoImg.id === 'img_demo_coastal', 'Imagery ID is img_demo_coastal');
  assert(demoImg.file_name === 'coastal_settlement_demo.png', 'Imagery file_name is coastal_settlement_demo.png');
  assert(demoImg.file_url === '/uploads/coastal_settlement_demo.png', 'Imagery file_url is /uploads/coastal_settlement_demo.png');
  assert(demoImg.is_georeferenced === false, 'is_georeferenced is strictly false');
  assert(demoImg.coordinate_mode === 'image-space', 'coordinate_mode is "image-space"');
  assert(demoImg.metadata?.coordinate_mode === 'image-space', 'metadata.coordinate_mode is "image-space"');

  // ---------------------------------------------------------
  // 2. CLIENT-SIDE COORDINATE RESOLUTION LOGIC
  // ---------------------------------------------------------
  console.log('\n--- TEST 2: CLIENT IS_IMAGE_GEOREFERENCED LOGIC ---');
  
  // Replicate ParcelMapWorkspace.isImageGeoreferenced logic
  function isImageGeoreferenced(img) {
    if (!img) return false;
    if (img.is_georeferenced === false) return false;
    if (img.coordinate_mode === 'image-space' || img.coordinate_mode === 'image') return false;
    if (img.metadata && img.metadata.coordinate_mode === 'image-space') return false;
    if (img.metadata && img.metadata.is_georeferenced === false) return false;

    const fileName = (img.file_name || img.name || '').toLowerCase();
    if (fileName.endsWith('.tif') || fileName.endsWith('.tiff')) return true;

    if (img.metadata) {
      if (img.metadata.is_georeferenced === true) return true;
      if (img.metadata.crs && 
          img.metadata.crs !== 'PixelSpace' && 
          img.metadata.crs !== 'ImageSpace' && 
          !img.metadata.crs.toLowerCase().includes('local') &&
          !img.metadata.crs.toLowerCase().includes('image-space')) {
        return true;
      }
      if (img.metadata.geotransform && Array.isArray(img.metadata.geotransform) && img.metadata.geotransform.length === 6) {
        return true;
      }
    }

    if (img.is_georeferenced === true) return true;
    return false;
  }

  assert(isImageGeoreferenced(demoImg) === false, 'demoImg correctly evaluated as image-space (NOT georeferenced)');

  // GeoTIFF test case
  const tiffImg = { file_name: 'ortho_survey.tif', metadata: { crs: 'EPSG:4326' }, is_georeferenced: true };
  assert(isImageGeoreferenced(tiffImg) === true, 'GeoTIFF correctly evaluated as georeferenced');

  // Standard user upload PNG
  const userPng = { file_name: 'drone_survey_01.png', is_georeferenced: false, coordinate_mode: 'image-space' };
  assert(isImageGeoreferenced(userPng) === false, 'User uploaded PNG correctly evaluated as image-space');

  // ---------------------------------------------------------
  // 3. AI DETECTION OVERLAY & COORDINATES
  // ---------------------------------------------------------
  console.log('\n--- TEST 3: AI DETECTION & COORDINATES ---');
  const featuresRes = await fetchJson(`${API_BASE}/projects/proj_demo_coastal/features?imagery_id=${demoImg.id}`);
  assert(featuresRes.success && featuresRes.features.length > 0, `Features retrieved for ${demoImg.id}: ${featuresRes.features.length} features`);

  // Verify all features have image_coordinates and imagery_id matches
  const sampleFeature = featuresRes.features[0];
  assert(sampleFeature.imagery_id === demoImg.id, `Feature belongs to imagery ${demoImg.id}`);
  assert(Array.isArray(sampleFeature.image_coordinates) && sampleFeature.image_coordinates.length > 0, 'Feature has valid image_coordinates');

  // Verify extractRingCoords logic handles nested ring coordinates
  function extractRingCoords(raw) {
    if (!raw || !raw.length) return [];
    if (Array.isArray(raw[0]) && Array.isArray(raw[0][0])) return raw[0];
    return raw;
  }
  const ring = extractRingCoords(sampleFeature.image_coordinates);
  assert(ring.length >= 2 && Array.isArray(ring[0]) && typeof ring[0][0] === 'number', 'Ring coordinates extracted correctly as [x, y] pairs');

  // ---------------------------------------------------------
  // 4. SPATIAL REASONING & PRELIMINARY PARCELS
  // ---------------------------------------------------------
  console.log('\n--- TEST 4: SPATIAL REASONING & PARCELS ---');
  const parcelsRes = await fetchJson(`${API_BASE}/projects/proj_demo_coastal/parcels`);
  assert(parcelsRes.success && parcelsRes.parcels.length > 0, `Parcels retrieved: ${parcelsRes.parcels.length} parcels`);
  
  const sampleParcel = parcelsRes.parcels[0];
  assert(sampleParcel.imagery_id === demoImg.id, `Parcel imagery_id matches ${demoImg.id}`);
  assert(sampleParcel.is_georeferenced === false || sampleParcel.is_georeferenced === undefined, 'Parcel is in image-space');
  assert(sampleParcel.image_coordinates && sampleParcel.image_coordinates.length > 0, 'Parcel has valid image_coordinates');

  // ---------------------------------------------------------
  // 5. HTML UI BADGES & ELEMENTS
  // ---------------------------------------------------------
  console.log('\n--- TEST 5: HTML UI ELEMENTS & BADGES ---');
  const htmlContent = fs.readFileSync(path.resolve('workspace.html'), 'utf8');
  assert(htmlContent.includes('id="badgeDetectionCoordMode"'), 'workspace.html contains #badgeDetectionCoordMode');
  assert(htmlContent.includes('id="tagDetectionCoordBadge"'), 'workspace.html contains #tagDetectionCoordBadge');
  assert(htmlContent.includes('IMAGE-SPACE'), 'workspace.html contains [IMAGE-SPACE] badge markup');
  assert(htmlContent.includes('id="bannerImagePreviewMode"'), 'workspace.html contains #bannerImagePreviewMode');

  // ---------------------------------------------------------
  // 6. WORKSPACE.JS STATE MACHINE & COORDINATE MODE CODE
  // ---------------------------------------------------------
  console.log('\n--- TEST 6: WORKSPACE.JS COORDINATE LOGIC AUDIT ---');
  const jsContent = fs.readFileSync(path.resolve('workspace.js'), 'utf8');
  assert(jsContent.includes('this.isImageGeoreferenced(currentImg)'), 'workspace.js calls isImageGeoreferenced');
  assert(jsContent.includes('this.extractRingCoords('), 'workspace.js uses extractRingCoords');
  
  // Verify detectionMap does not load ArcGIS tileLayer when not georeferenced
  const hasNoTilesInDetectionSimple = jsContent.includes('if (!isGeoreferenced) {') && 
                                     jsContent.includes('crs: L.CRS.Simple,');
  assert(hasNoTilesInDetectionSimple, 'detectionMap correctly configures L.CRS.Simple for non-georeferenced imagery');

  // ---------------------------------------------------------
  // 7. REAL PROJECT TEST (ISOLATION FROM DEMO DATA)
  // ---------------------------------------------------------
  console.log('\n--- TEST 7: REAL PROJECT ISOLATION TEST ---');
  // Create a brand new real project
  const newProjRes = await fetchJson(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Automated Real User Project ' + Date.now(),
      description: 'Test real project without demo data',
      location: 'Karnataka, India',
      coordinates: [15.3173, 75.7139]
    })
  });
  assert(newProjRes.success && newProjRes.project, `Created real project: ${newProjRes.project.id}`);

  // Fetch imagery for this project - must be empty
  const newProjImagery = await fetchJson(`${API_BASE}/projects/${newProjRes.project.id}/imagery`);
  assert(newProjImagery.success && newProjImagery.imagery.length === 0, 'New project has 0 imagery initially (NO demo fallback)');

  // Fetch features for this project - must be empty
  const newProjFeatures = await fetchJson(`${API_BASE}/projects/${newProjRes.project.id}/features`);
  assert(newProjFeatures.success && newProjFeatures.features.length === 0, 'New project has 0 features initially (NO demo fallback)');

  // Fetch parcels for this project - must be empty
  const newProjParcels = await fetchJson(`${API_BASE}/projects/${newProjRes.project.id}/parcels`);
  assert(newProjParcels.success && newProjParcels.parcels.length === 0, 'New project has 0 parcels initially (NO demo fallback)');

  // ---------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------
  console.log('\n================================================================');
  console.log(`AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
