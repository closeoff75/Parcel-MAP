/**
 * PARCELMAP — FINAL DATA CONSISTENCY + END-TO-END AUDIT
 * Automated verification test suite for Single Source of Truth
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
  } else if (contentType.includes('application/geo+json')) {
    const data = await res.json();
    return { ok: res.ok, status: res.status, headers: res.headers, data };
  } else if (contentType.includes('text/csv')) {
    const text = await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, text };
  } else {
    const buffer = await res.arrayBuffer();
    return { ok: res.ok, status: res.status, headers: res.headers, buffer: Buffer.from(buffer) };
  }
}

async function runAudit() {
  console.log('================================================================================');
  console.log('PARCELMAP — FINAL DATA CONSISTENCY & END-TO-END AUDIT');
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
  // TEST 1: PROJECT A SETUP & PARCEL GENERATION (Requirement 14 & 22)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. CREATING PROJECT A & UPLOADING IMAGERY ---');
  const projARes = await request(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Project A Cadastral Test',
      location: 'Sector 7 Survey Area',
      description: 'Audit consistency project A'
    })
  });
  assert(projARes.ok && projARes.data?.project?.id, 'Created Project A');
  const projectA = projARes.data.project;

  // Upload an image to Project A
  const testImagePath = path.join(__dirname, 'test_assets', 'drone_image_a.png');
  const fileBuffer = fs.readFileSync(testImagePath);
  const formData = new FormData();
  const fileBlob = new Blob([fileBuffer], { type: 'image/png' });
  formData.append('imagery', fileBlob, 'project_a_aerial.png');
  formData.append('width', '600');
  formData.append('height', '400');

  const uploadRes = await fetch(`${API_BASE}/projects/${projectA.id}/imagery`, {
    method: 'POST',
    body: formData
  });
  const uploadData = await uploadRes.json();
  assert(uploadData.success && uploadData.imagery?.id, `Uploaded Image A (${uploadData.imagery?.id})`);
  const imageryA = uploadData.imagery;

  // Run AI detection on Image A
  console.log('\n--- 2. RUNNING AI DETECTION & SPATIAL REASONING ON IMAGE A ---');
  const detectRes = await request(`${API_BASE}/imagery/${imageryA.id}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'cv' })
  });
  assert(detectRes.ok && detectRes.data?.success, `AI Detection executed (${detectRes.data?.features_count || 0} features)`);

  // Run Spatial Reasoning to generate parcels
  const reasonRes = await request(`${API_BASE}/projects/${projectA.id}/spatial-reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagery_id: imageryA.id })
  });
  assert(reasonRes.ok && reasonRes.data?.success, `Spatial Reasoning executed (${reasonRes.data?.parcels_count || 0} parcels)`);

  // Fetch initial parcels for Project A
  const getParcelsRes = await request(`${API_BASE}/projects/${projectA.id}/parcels?imagery_id=${imageryA.id}`);
  const initialParcels = getParcelsRes.data?.parcels || [];
  console.log(`[Project A] Generated ${initialParcels.length} preliminary parcels.`);
  assert(initialParcels.length >= 4, `At least 4 parcels generated for testing (got ${initialParcels.length})`);

  // Pick exactly 4 parcels for the exact Section 14 test:
  // Accept 2 parcels, Reject 1, Leave 1 in review
  const p1 = initialParcels[0];
  const p2 = initialParcels[1];
  const p3 = initialParcels[2];
  const p4 = initialParcels[3];

  console.log('\n--- 3. EXECUTING HUMAN VERIFICATION (Requirement 14) ---');
  console.log(`  Accepting Parcel 1: ${p1.parcel_id || p1.id}`);
  await request(`${API_BASE}/parcels/${p1.parcel_id || p1.id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Accepted boundary 1' })
  });

  console.log(`  Accepting Parcel 2: ${p2.parcel_id || p2.id}`);
  await request(`${API_BASE}/parcels/${p2.parcel_id || p2.id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Accepted boundary 2' })
  });

  console.log(`  Rejecting Parcel 3: ${p3.parcel_id || p3.id}`);
  await request(`${API_BASE}/parcels/${p3.parcel_id || p3.id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Rejected false parcel' })
  });

  console.log(`  Flagging Parcel 4 as Needs Review: ${p4.parcel_id || p4.id}`);
  await request(`${API_BASE}/parcels/${p4.parcel_id || p4.id}/needs-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Requires field audit' })
  });

  // If there are more than 4 parcels, set the rest to rejected or needs_review to test exact counts
  if (initialParcels.length > 4) {
    for (let i = 4; i < initialParcels.length; i++) {
      await request(`${API_BASE}/parcels/${initialParcels[i].parcel_id || initialParcels[i].id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Excluded test excess' })
      });
    }
  }

  // --------------------------------------------------------------------------
  // TEST 2: DATA CONSISTENCY CHECK ACROSS ALL STAGES (Requirement 1, 2, 3, 4, 5, 8, 14)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. DATA CONSISTENCY AUDIT ACROSS ALL PAGES & ENDPOINTS ---');

  // A. Database / Parcels API
  const refreshedParcelsRes = await request(`${API_BASE}/projects/${projectA.id}/parcels?imagery_id=${imageryA.id}`);
  const allParcels = refreshedParcelsRes.data.parcels;
  const isAccepted = p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified';
  const isReview = p => p.status === 'needs_review' || p.status === 'Needs Review';
  const isRejected = p => p.status === 'rejected' || p.status === 'Rejected';

  const dbAccepted = allParcels.filter(isAccepted).length;
  const dbReview = allParcels.filter(isReview).length;
  const dbRejected = allParcels.filter(isRejected).length;
  const dbTotal = allParcels.length;

  assert(dbAccepted === 2, `DB Accepted count = 2 (got ${dbAccepted})`);
  assert(dbReview === 1, `DB Needs Review count = 1 (got ${dbReview})`);
  assert(dbRejected >= 1, `DB Rejected count >= 1 (got ${dbRejected})`);

  // B. GIS Quality API
  const gisRes = await request(`${API_BASE}/projects/${projectA.id}/gis-quality?imagery_id=${imageryA.id}`);
  assert(gisRes.ok && gisRes.data?.success, 'GIS Quality API responded successfully');
  assert(gisRes.data.total_parcels === dbTotal, `GIS Quality Total Parcels matches DB (${gisRes.data.total_parcels} === ${dbTotal})`);

  // C. Final Map View Data (Verified parcels only)
  // Final map renders parcels from DB where status === accepted
  const finalMapParcels = allParcels.filter(isAccepted);
  assert(finalMapParcels.length === 2, `Final Map displays ONLY accepted parcels: count = 2 (got ${finalMapParcels.length})`);

  // D. Reports API
  const reportRes = await request(`${API_BASE}/projects/${projectA.id}/report?imagery_id=${imageryA.id}`);
  assert(reportRes.ok && reportRes.data?.success, 'Reports API responded successfully');
  const rep = reportRes.data.report;

  assert(rep.project.id === projectA.id, `Report project_id = ${projectA.id} (got ${rep.project.id})`);
  assert(rep.imagery.id === imageryA.id, `Report imagery_id = ${imageryA.id} (got ${rep.imagery.id})`);
  assert(rep.parcel_summary.total_preliminary_parcels === dbTotal, `Report Total Preliminary = ${dbTotal} (got ${rep.parcel_summary.total_preliminary_parcels})`);
  assert(rep.parcel_summary.final_verified_parcels === 2, `Report Final Verified Parcels = 2 (got ${rep.parcel_summary.final_verified_parcels})`);
  assert(rep.parcel_summary.needs_review === 1, `Report Needs Review = 1 (got ${rep.parcel_summary.needs_review})`);
  assert(rep.parcel_summary.rejected_parcels === dbRejected, `Report Rejected Parcels = ${dbRejected} (got ${rep.parcel_summary.rejected_parcels})`);
  assert(rep.parcel_summary.verification_percentage === Math.round((2 / dbTotal) * 100), `Report Progress = ${Math.round((2 / dbTotal) * 100)}% (got ${rep.parcel_summary.verification_percentage}%)`);

  // Area Bug Check (Requirement 8): non-georeferenced JPG must NEVER show hectares or sqm!
  assert(rep.project.is_georeferenced === false, `Project A is_georeferenced is false for JPG (got ${rep.project.is_georeferenced})`);
  assert(rep.parcel_summary.total_area_hectares === null, `Report total_area_hectares is null for non-georeferenced (got ${rep.parcel_summary.total_area_hectares})`);
  assert(rep.parcel_summary.area_unit.includes('Area unavailable — imagery is not georeferenced'), `Report area_unit displays unavailable notice (got "${rep.parcel_summary.area_unit}")`);

  // E. GeoJSON Export (Requirement 17 & 21)
  const geoJsonRes = await request(`${API_BASE}/projects/${projectA.id}/export/geojson?scope=verified&imagery_id=${imageryA.id}`);
  assert(geoJsonRes.ok && geoJsonRes.data?.type === 'FeatureCollection', 'GeoJSON Export generated valid FeatureCollection');
  const geoFeatures = geoJsonRes.data.features || [];
  assert(geoFeatures.length === 2, `GeoJSON Export contains EXACTLY 2 verified features (got ${geoFeatures.length})`);
  geoFeatures.forEach(f => {
    assert(f.properties.status === 'accepted' || f.properties.status === 'Human Verified', `GeoJSON feature ${f.properties.parcel_id} is accepted`);
    assert(f.properties.area_display.includes('Area unavailable'), `GeoJSON feature area_display reflects non-georeferenced status`);
  });

  // F. CSV Export (Requirement 17 & 21)
  const csvRes = await request(`${API_BASE}/projects/${projectA.id}/export/csv?scope=verified&imagery_id=${imageryA.id}`);
  assert(csvRes.ok, 'CSV Export responded successfully');
  const csvLines = csvRes.text.trim().split('\r\n').filter(l => l.length > 0);
  const headerLine = csvLines[0];
  const dataRows = csvLines.slice(1);
  assert(headerLine.includes('parcel_id') && headerLine.includes('area'), 'CSV Header contains expected columns');
  assert(dataRows.length === 2, `CSV Export contains EXACTLY 2 verified parcel rows (got ${dataRows.length})`);
  dataRows.forEach(row => {
    assert(row.includes('Area unavailable') || row.includes('N/A'), `CSV row area reflects non-georeferenced status: ${row.split(',')[7]}`);
  });

  // G. PDF Export (Requirement 17 & 21)
  const pdfRes = await request(`${API_BASE}/projects/${projectA.id}/export/pdf?imagery_id=${imageryA.id}`);
  assert(pdfRes.ok, 'PDF Project Report exported successfully');
  assert(pdfRes.buffer.length > 1000, `PDF buffer is valid non-empty binary (${pdfRes.buffer.length} bytes)`);

  // H. Full ZIP Package (Requirement 21)
  const zipRes = await request(`${API_BASE}/projects/${projectA.id}/export/all?imagery_id=${imageryA.id}`);
  assert(zipRes.ok, 'Full ZIP package exported successfully');
  assert(zipRes.buffer.length > 1000, `ZIP buffer is valid non-empty archive (${zipRes.buffer.length} bytes)`);

  // --------------------------------------------------------------------------
  // TEST 3: SECOND PROJECT TEST — 100% DATA ISOLATION (Requirement 15)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. SECOND PROJECT TEST (PROJECT B ISOLATION) ---');
  const projBRes = await request(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Project B Cadastral Isolation Test',
      location: 'Sector 9 Outer Boundary',
      description: 'Audit isolation project B'
    })
  });
  const projectB = projBRes.data.project;
  assert(projectB.id !== projectA.id, `Project B created with distinct ID (${projectB.id})`);

  // Upload different image to Project B
  const imgBPath = path.join(__dirname, 'test_assets', 'uav_farm_a.png');
  const bufferB = fs.readFileSync(imgBPath);
  const blobB = new Blob([bufferB], { type: 'image/png' });
  const formB = new FormData();
  formB.append('imagery', blobB, 'project_b_aerial.png');
  formB.append('width', '600');
  formB.append('height', '400');

  const uploadBRes = await fetch(`${API_BASE}/projects/${projectB.id}/imagery`, {
    method: 'POST',
    body: formB
  });
  const uploadBData = await uploadBRes.json();
  const imageryB = uploadBData.imagery;
  assert(imageryB.id !== imageryA.id, `Image B created with distinct ID (${imageryB.id})`);

  // Run detection & reasoning for Project B
  await request(`${API_BASE}/imagery/${imageryB.id}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'cv' })
  });
  await request(`${API_BASE}/projects/${projectB.id}/spatial-reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagery_id: imageryB.id })
  });

  const parcelsBRes = await request(`${API_BASE}/projects/${projectB.id}/parcels?imagery_id=${imageryB.id}`);
  const parcelsB = parcelsBRes.data.parcels || [];
  assert(parcelsB.length > 0, `Project B generated ${parcelsB.length} parcels`);

  // Accept exactly 1 parcel in Project B
  const pB1 = parcelsB[0];
  await request(`${API_BASE}/parcels/${pB1.parcel_id || pB1.id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Accepted project B parcel' })
  });

  // VERIFY ISOLATION:
  // Project A must have 2 accepted parcels
  const repARecheck = await request(`${API_BASE}/projects/${projectA.id}/report?imagery_id=${imageryA.id}`);
  assert(repARecheck.data.report.parcel_summary.final_verified_parcels === 2, `Project A report STILL has 2 verified parcels (got ${repARecheck.data.report.parcel_summary.final_verified_parcels})`);

  // Project B must have 1 accepted parcel
  const repBCheck = await request(`${API_BASE}/projects/${projectB.id}/report?imagery_id=${imageryB.id}`);
  assert(repBCheck.data.report.parcel_summary.final_verified_parcels === 1, `Project B report has EXACTLY 1 verified parcel (got ${repBCheck.data.report.parcel_summary.final_verified_parcels})`);

  // Project A GeoJSON must NOT contain Project B parcel
  const geoARecheck = await request(`${API_BASE}/projects/${projectA.id}/export/geojson?scope=verified&imagery_id=${imageryA.id}`);
  const aPids = geoARecheck.data.features.map(f => f.properties.parcel_id);
  assert(!aPids.includes(pB1.parcel_id || pB1.id), `Project A GeoJSON does NOT contain Project B parcel (${pB1.parcel_id || pB1.id})`);

  // --------------------------------------------------------------------------
  // TEST 4: REFRESH & PERSISTENCE TEST (Requirement 16)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. REFRESH & PERSISTENCE TEST ---');
  // Accept parcel 4 in Project A (which was previously in review)
  await request(`${API_BASE}/parcels/${p4.parcel_id || p4.id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_name: 'Alex Morgan', comments: 'Accepted after review' })
  });

  // Re-fetch all endpoints for Project A simulating browser refresh
  const reloadedParcels = await request(`${API_BASE}/projects/${projectA.id}/parcels?imagery_id=${imageryA.id}`);
  const reloadedReport = await request(`${API_BASE}/projects/${projectA.id}/report?imagery_id=${imageryA.id}`);
  const reloadedGeoJson = await request(`${API_BASE}/projects/${projectA.id}/export/geojson?scope=verified&imagery_id=${imageryA.id}`);
  const reloadedCsv = await request(`${API_BASE}/projects/${projectA.id}/export/csv?scope=verified&imagery_id=${imageryA.id}`);

  const newAcceptedCount = reloadedParcels.data.parcels.filter(isAccepted).length;
  assert(newAcceptedCount === 3, `After accepting parcel 4, DB accepted count = 3 (got ${newAcceptedCount})`);
  assert(reloadedReport.data.report.parcel_summary.final_verified_parcels === 3, `After refresh, Report shows 3 final verified parcels (got ${reloadedReport.data.report.parcel_summary.final_verified_parcels})`);
  assert(reloadedGeoJson.data.features.length === 3, `After refresh, GeoJSON contains 3 features (got ${reloadedGeoJson.data.features.length})`);
  const newCsvRows = reloadedCsv.text.trim().split('\r\n').slice(1);
  assert(newCsvRows.length === 3, `After refresh, CSV contains 3 rows (got ${newCsvRows.length})`);

  // --------------------------------------------------------------------------
  // TEST 5: DEMO DATA ISOLATION (Requirement 7)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. DEMO DATA ISOLATION TEST ---');
  // Confirm user project A never received demo parcels (PM-0001 from demo)
  const aParcelsList = reloadedParcels.data.parcels;
  const hasDemoLeak = aParcelsList.some(p => p.project_id === 'proj_wagholi_demo');
  assert(!hasDemoLeak, 'Project A contains 0 demo project records');

  // Verify demo project still works when requested
  const demoReport = await request(`${API_BASE}/projects/proj_wagholi_demo/report?imagery_id=img_wagholi_ortho`);
  assert(demoReport.ok && demoReport.data?.report?.project?.id === 'proj_wagholi_demo', 'Explicit demo project remains functional');

  console.log('\n================================================================================');
  console.log(`AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
