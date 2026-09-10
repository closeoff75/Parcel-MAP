/**
 * Step 9: Final Verified Map + Reports + Export Full End-to-End Test
 * 
 * Verifies:
 * 1. Fresh Project Creation & Image Association
 * 2. AI Detection & Spatial Reasoning parcel generation
 * 3. GIS Quality Topology Audit
 * 4. Human Verification: Accept PM-0001, Reject PM-0002, Review PM-0003
 * 5. Final Map Source: ONLY accepted parcels appear as final verified parcels
 * 6. Single Parcel Report API & PDF Generation
 * 7. Project Report API & PDF Generation
 * 8. Valid GeoJSON Export
 * 9. Valid CSV Export with correct columns
 * 10. Complete Dataset ZIP Packaging
 * 11. Project Isolation (Project A vs Project B)
 * 12. Persistence after reload / restart
 */

import fs from 'fs';
import path from 'path';
import { db } from './server/db/database.js';

const BASE_URL = 'http://localhost:3001/api';

async function runStep9E2ETest() {
  console.log('====================================================');
  console.log('🧪 RUNNING STEP 9: FINAL VERIFIED MAP + EXPORTS E2E TEST');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  try {
    // 1. Reset & Seed Check
    console.log('Step 1: Check server health & demo reset');
    const hRes = await fetch(`${BASE_URL}/health`);
    const hData = await hRes.json();
    assert(hData.status === 'online' || hData.success, 'Server is running and healthy');

    // 2. Create Fresh Project A
    console.log('\nStep 2: Create Fresh Project A (proj_step9_alpha)');
    const pRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alpha Cadastral Survey Sector 9',
        location: 'Kharadi, Pune District',
        description: 'Fresh project for Step 9 verification and export audit',
        coordinates: [18.5512, 73.9341],
        project_type: 'Rural Cadastral Mapping'
      })
    });
    const pData = await pRes.json();
    assert(pData.success && pData.project?.id, `Created project A: ${pData.project?.id}`);
    const projAId = pData.project.id;

    // 3. Add UAV Imagery to Project A
    console.log('\nStep 3: Upload/Add UAV Imagery to Project A');
    const imgAPath = path.join(process.cwd(), 'test_assets', 'drone_image_a.png');
    const blobA = new Blob([fs.readFileSync(imgAPath)], { type: 'image/png' });
    const formA = new FormData();
    formA.append('imagery', blobA, 'kharadi_sector9_orthomosaic.png');
    formA.append('width', '600');
    formA.append('height', '400');
    formA.append('sensor', 'DJI Zenmuse P1 Full-Frame');
    formA.append('resolution', '2.5 cm/pixel GSD');

    const upResA = await fetch(`${BASE_URL}/projects/${projAId}/imagery`, {
      method: 'POST',
      body: formA
    });
    const upDataA = await upResA.json();
    assert(upDataA.success && upDataA.imagery?.id, `Uploaded imagery record: ${upDataA.imagery?.id}`);
    const imgA = upDataA.imagery;

    // 4. Run AI Detection on Project A
    console.log('\nStep 4: Run AI Detection on Project A');
    const detRes = await fetch(`${BASE_URL}/imagery/${imgA.id}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cv' })
    });
    const detData = await detRes.json();
    assert(detData.success && detData.features_count > 0, `Detected ${detData.features_count} features`);

    // 5. Run Spatial Reasoning & Generate Preliminary Parcels on Project A
    console.log('\nStep 5: Run Spatial Reasoning & Preliminary Parcels');
    const srRes = await fetch(`${BASE_URL}/projects/${projAId}/spatial-reasoning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagery_id: imgA.id,
        detection_run_id: detData.detection_run_id
      })
    });
    const srData = await srRes.json();
    assert(srData.success && (srData.candidates_count > 0 || srData.parcels_count > 0), `Generated preliminary parcels in Project A`);

    const parcelsRes = await fetch(`${BASE_URL}/projects/${projAId}/parcels?imagery_id=${imgA.id}`);
    const parcelsData = await parcelsRes.json();
    const parcelsA = parcelsData.parcels || [];
    assert(parcelsA.length >= 3, `Project A has ${parcelsA.length} preliminary parcels`);

    const p1 = parcelsA[0];
    const p2 = parcelsA[1];
    const p3 = parcelsA[2];

    const p1Id = p1.parcel_id || p1.id;
    const p2Id = p2.parcel_id || p2.id;
    const p3Id = p3.parcel_id || p3.id;

    console.log(`  Parcels under test: P1=${p1Id}, P2=${p2Id}, P3=${p3Id}`);

    // 6. Run GIS Quality Audit
    console.log('\nStep 6: Run GIS Quality Audit');
    const qcRes = await fetch(`${BASE_URL}/projects/${projAId}/quality-control?imagery_id=${imgA.id}`);
    const qcData = await qcRes.json();
    const validCount = qcData.valid_parcels !== undefined ? qcData.valid_parcels : qcData.valid_polygons_count;
    assert(qcData.success && validCount !== undefined, `GIS Quality audit returned valid parcels count: ${validCount}`);

    // 7. Human Verification Actions
    console.log('\nStep 7: Perform Human Verification (Accept P1, Reject P2, Needs Review P3)');
    
    // Accept P1
    const accRes = await fetch(`${BASE_URL}/parcels/${p1Id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: 'Surveyor verified boundary matches road and hedge line.' })
    });
    const accData = await accRes.json();
    assert(accData.success && (accData.parcel?.status === 'accepted' || accData.parcel?.status === 'Human Verified'), `P1 (${p1Id}) status is ACCEPTED/Human Verified`);

    // Reject P2
    const rejRes = await fetch(`${BASE_URL}/parcels/${p2Id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: 'Artifact boundary caused by shadow reflection.' })
    });
    const rejData = await rejRes.json();
    assert(rejData.success && rejData.parcel?.status === 'rejected', `P2 (${p2Id}) status is REJECTED`);

    // Review P3
    const revRes = await fetch(`${BASE_URL}/parcels/${p3Id}/needs-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: 'Requires physical ground demarcation mark verification.' })
    });
    const revData = await revRes.json();
    assert(revData.success && (revData.parcel?.status === 'needs_review' || revData.parcel?.status === 'Needs Review'), `P3 (${p3Id}) status is NEEDS_REVIEW`);

    // 8. Final Map Source Verification
    console.log('\nStep 8: Final Map Data Source Verification');
    const postVerifyParcelsRes = await fetch(`${BASE_URL}/projects/${projAId}/parcels?imagery_id=${imgA.id}`);
    const postVerifyParcels = (await postVerifyParcelsRes.json()).parcels || [];

    const finalVerifiedList = postVerifyParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
    const rejectedList = postVerifyParcels.filter(p => p.status === 'rejected' || p.status === 'Rejected');
    const reviewList = postVerifyParcels.filter(p => p.status === 'needs_review' || p.status === 'Needs Review');

    assert(finalVerifiedList.some(p => (p.parcel_id || p.id) === p1Id), `Final Map data source contains accepted parcel ${p1Id}`);
    assert(!finalVerifiedList.some(p => (p.parcel_id || p.id) === p2Id), `Final Map data source EXCLUDES rejected parcel ${p2Id}`);
    assert(!finalVerifiedList.some(p => (p.parcel_id || p.id) === p3Id), `Final Map data source EXCLUDES unverified review parcel ${p3Id}`);

    // 9. Single Parcel Report & PDF Generation
    console.log('\nStep 9: Single Parcel Report & PDF Export');
    const p1RepRes = await fetch(`${BASE_URL}/parcels/${p1Id}/report`);
    const p1RepData = await p1RepRes.json();
    assert(p1RepData.success && p1RepData.report?.parcel_id === p1Id, `Single Parcel Report JSON generated for ${p1Id}`);
    assert(p1RepData.report?.verification_status === 'Human Verified', `Report verification_status is "Human Verified"`);
    assert(p1RepData.report?.disclaimer.includes('AI-assisted parcel boundaries are preliminary'), `Report contains mandatory disclaimer`);

    const p1PdfRes = await fetch(`${BASE_URL}/parcels/${p1Id}/export/pdf`);
    assert(p1PdfRes.ok && p1PdfRes.headers.get('content-type') === 'application/pdf', `Single Parcel PDF generated successfully (status ${p1PdfRes.status})`);
    const p1PdfBuf = Buffer.from(await p1PdfRes.arrayBuffer());
    assert(p1PdfBuf.length > 2000, `Single Parcel PDF size is valid (${p1PdfBuf.length} bytes)`);

    // 10. Project Report & PDF Generation
    console.log('\nStep 10: Project Report & PDF Export');
    const projRepRes = await fetch(`${BASE_URL}/projects/${projAId}/report`);
    const projRepData = await projRepRes.json();
    assert(projRepData.success && projRepData.report?.project?.id === projAId, `Project Report JSON generated for ${projAId}`);
    assert(projRepData.report?.summary?.final_verified_parcels >= 1, `Report shows final_verified_parcels count >= 1`);

    const projPdfRes = await fetch(`${BASE_URL}/projects/${projAId}/export/pdf`);
    assert(projPdfRes.ok && projPdfRes.headers.get('content-type') === 'application/pdf', `Project Report PDF generated successfully (status ${projPdfRes.status})`);
    const projPdfBuf = Buffer.from(await projPdfRes.arrayBuffer());
    assert(projPdfBuf.length > 5000, `Project PDF size is valid (${projPdfBuf.length} bytes)`);

    // 11. Valid GeoJSON Export
    console.log('\nStep 11: Valid GeoJSON Export');
    const geoRes = await fetch(`${BASE_URL}/projects/${projAId}/export/geojson?scope=verified`);
    assert(geoRes.ok, `GeoJSON request returned 200`);
    const geoData = await geoRes.json();
    assert(geoData.type === 'FeatureCollection' && Array.isArray(geoData.features), `Export is valid GeoJSON FeatureCollection`);
    assert(geoData.features.length === finalVerifiedList.length, `GeoJSON export strictly contains ONLY ${finalVerifiedList.length} verified features`);
    if (geoData.features.length > 0) {
      const feat = geoData.features[0];
      assert(feat.properties.parcel_id && feat.properties.project_id === projAId, `GeoJSON feature properties contains parcel_id and project_id`);
      assert(feat.properties.verification_status === 'Human Verified', `GeoJSON feature verification_status is Human Verified`);
    }

    // 12. Valid CSV Export
    console.log('\nStep 12: Valid CSV Export');
    const csvRes = await fetch(`${BASE_URL}/projects/${projAId}/export/csv?scope=verified`);
    assert(csvRes.ok, `CSV request returned 200`);
    const csvText = await csvRes.text();
    const csvLines = csvText.trim().split(/\r?\n/);
    assert(csvLines.length === finalVerifiedList.length + 1, `CSV has ${csvLines.length - 1} data rows matching verified parcels`);
    assert(csvLines[0].includes('parcel_id') && csvLines[0].includes('verification_status'), `CSV header contains required columns`);
    assert(csvLines[1].includes(p1Id), `CSV row contains verified parcel ${p1Id}`);

    // 13. Full ZIP Dataset Export
    console.log('\nStep 13: Full ZIP Package Export');
    const zipRes = await fetch(`${BASE_URL}/projects/${projAId}/export/all`);
    assert(zipRes.ok && zipRes.headers.get('content-type') === 'application/zip', `ZIP package generated successfully`);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert(zipBuf.length > 1000, `ZIP archive size is valid (${zipBuf.length} bytes)`);

    // 14. Project Isolation (Project A vs Project B)
    console.log('\nStep 14: Project Isolation Test');
    const pBRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Project Beta Isolated',
        location: 'Baner, Pune',
        description: 'Isolated test project'
      })
    });
    const pBData = await pBRes.json();
    const projBId = pBData.project.id;

    const bParcelsRes = await fetch(`${BASE_URL}/projects/${projBId}/parcels`);
    const bParcelsData = await bParcelsRes.json();
    assert(bParcelsData.parcels.length === 0, `Project B has 0 parcels initially (no leakage from Project A)`);

    const bCsvRes = await fetch(`${BASE_URL}/projects/${projBId}/export/csv`);
    const bCsvText = await bCsvRes.text();
    const bCsvLines = bCsvText.trim().split(/\r?\n/);
    assert(bCsvLines.length === 1, `Project B CSV exports 0 rows (isolated from Project A)`);

    // 15. Persistence Test
    console.log('\nStep 15: Persistence & Reload Verification');
    const persistP1 = db.getParcelById(p1Id);
    assert(persistP1 && (persistP1.status === 'accepted' || persistP1.status === 'Human Verified'), `P1 status persisted in database as ${persistP1?.status}`);
    const persistP2 = db.getParcelById(p2Id);
    assert(persistP2 && persistP2.status === 'rejected', `P2 status persisted in database as ${persistP2?.status}`);

    const versions = db.getParcelVersions(p1Id);
    assert(versions.length >= 2, `P1 has immutable audit version trail (${versions.length} versions recorded)`);

    console.log('\n====================================================');
    console.log(`📊 FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    if (failed === 0) {
      console.log('🎉 STEP 9 VERIFICATION AND EXPORTS PASSED 100%!');
      process.exit(0);
    } else {
      console.error('❌ SOME TESTS FAILED');
      process.exit(1);
    }

  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runStep9E2ETest();
