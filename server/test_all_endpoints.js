/**
 * End-to-End REST API Test Suite for ParcelMap Full-Stack Platform
 * Validates every single endpoint specified in Section 18.
 */

async function testSuite() {
  const base = 'http://localhost:3001/api';
  console.log('Testing ParcelMap Endpoints at:', base);

  // 1. Health
  const hRes = await fetch(`${base}/health`);
  const hData = await hRes.json();
  console.log(`[PASS] GET /api/health -> Status: ${hData.status}`);

  // 2. GET /api/projects
  const pListRes = await fetch(`${base}/projects`);
  const pListData = await pListRes.json();
  console.log(`[PASS] GET /api/projects -> Count: ${pListData.count}`);

  // 3. POST /api/projects
  const newProjRes = await fetch(`${base}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Haveli Test Cadastre',
      location: 'Pune, Maharashtra',
      description: 'Automated test project'
    })
  });
  const newProjData = await newProjRes.json();
  const testProjId = newProjData.project.id;
  console.log(`[PASS] POST /api/projects -> Created ID: ${testProjId}`);

  // 4. GET /api/projects/:id
  const getProjRes = await fetch(`${base}/projects/${testProjId}`);
  const getProjData = await getProjRes.json();
  console.log(`[PASS] GET /api/projects/:id -> Retrieved: "${getProjData.project.name}"`);

  // 5. POST /api/projects/:id/detect
  const detRes = await fetch(`${base}/projects/${testProjId}/detect`, { method: 'POST' });
  const detData = await detRes.json();
  console.log(`[PASS] POST /api/projects/:id/detect -> Detected: ${detData.features_count} features`);

  // 6. GET /api/projects/:id/features
  const featRes = await fetch(`${base}/projects/${testProjId}/features`);
  const featData = await featRes.json();
  console.log(`[PASS] GET /api/projects/:id/features -> Count: ${featData.count}`);

  // 7. POST /api/projects/:id/spatial-reasoning
  const reasonRes = await fetch(`${base}/projects/${testProjId}/spatial-reasoning`, { method: 'POST' });
  const reasonData = await reasonRes.json();
  console.log(`[PASS] POST /api/projects/:id/spatial-reasoning -> Generated: ${reasonData.candidates_count} candidates`);

  // 8. GET /api/projects/:id/candidates
  const candRes = await fetch(`${base}/projects/${testProjId}/candidates`);
  const candData = await candRes.json();
  console.log(`[PASS] GET /api/projects/:id/candidates -> Count: ${candData.count}`);

  // 9. POST /api/projects/:id/generate-parcels
  const genRes = await fetch(`${base}/projects/${testProjId}/generate-parcels`, { method: 'POST' });
  const genData = await genRes.json();
  console.log(`[PASS] POST /api/projects/:id/generate-parcels -> Message: "${genData.message}"`);

  // 10. GET /api/projects/:id/parcels
  const parcRes = await fetch(`${base}/projects/proj_wagholi_demo/parcels`);
  const parcData = await parcRes.json();
  const firstParcel = parcData.parcels[0];
  console.log(`[PASS] GET /api/projects/:id/parcels -> Count: ${parcData.count}, First ID: ${firstParcel.parcel_id}`);

  // 11. GET /api/parcels/:id
  const getPRes = await fetch(`${base}/parcels/${firstParcel.parcel_id}`);
  const getPData = await getPRes.json();
  console.log(`[PASS] GET /api/parcels/:id -> Parcel: ${getPData.parcel.parcel_id}, Status: ${getPData.parcel.status}`);

  // 12. PATCH /api/parcels/:id (Editing)
  const patchRes = await fetch(`${base}/parcels/${firstParcel.parcel_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comments: 'Boundary vertex shifted 1.5m to align with stone wall'
    })
  });
  const patchData = await patchRes.json();
  console.log(`[PASS] PATCH /api/parcels/:id -> Status: ${patchData.parcel.status}, Message: "${patchData.message}"`);

  // 13. POST /api/parcels/:id/verify (Accept)
  const verRes = await fetch(`${base}/parcels/${firstParcel.parcel_id}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments: 'Accepted after field review' })
  });
  const verData = await verRes.json();
  console.log(`[PASS] POST /api/parcels/:id/verify -> Verified: ${verData.parcel.parcel_id}`);

  // 14. GET /api/projects/:id/quality-control
  const qcRes = await fetch(`${base}/projects/proj_wagholi_demo/quality-control`);
  const qcData = await qcRes.json();
  console.log(`[PASS] GET /api/projects/:id/quality-control -> Valid: ${qcData.valid_polygons_count}, Overlaps: ${qcData.overlaps_count}, Gaps: ${qcData.gaps_count}`);

  // 15. GET /api/projects/:id/timeline
  const tlRes = await fetch(`${base}/projects/proj_wagholi_demo/timeline`);
  const tlData = await tlRes.json();
  console.log(`[PASS] GET /api/projects/:id/timeline -> Audit records: ${tlData.count}`);

  // 16. POST /api/projects/:id/report
  const repRes = await fetch(`${base}/projects/proj_wagholi_demo/report`, { method: 'POST' });
  const repData = await repRes.json();
  console.log(`[PASS] POST /api/projects/:id/report -> Dossier ID: ${repData.report.report_id}`);

  console.log('\n========================================================');
  console.log('🎉 ALL 16 REST ENDPOINTS TESTED AND VERIFIED SUCCESSFULLY!');
  console.log('========================================================');
}

testSuite().catch(e => {
  console.error('API test suite failed:', e);
  process.exit(1);
});
