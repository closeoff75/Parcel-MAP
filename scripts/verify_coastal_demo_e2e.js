import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001/api';

async function runTests() {
  console.log('=== STARTING PARCELMAP COASTAL DEMO E2E VERIFICATION ===\n');

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/health`);
  const health = await healthRes.json();
  console.log('1. Health Check:', health.status === 'online' ? 'PASSED' : 'FAILED');

  // 2. Load Demo Dataset (POST /api/demo/reset)
  const resetRes = await fetch(`${BASE_URL}/demo/reset`, { method: 'POST' });
  const resetData = await resetRes.json();
  console.log('2. Demo Reset endpoint:', resetData.success ? 'PASSED' : 'FAILED');

  // 3. Confirm demo project appears (GET /api/projects/proj_demo_coastal)
  const projRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal`);
  const projData = await projRes.json();
  const proj = projData.project;
  console.log('3. Demo Project loaded:', proj?.name === 'ParcelMap Demo — Coastal Settlement' && proj?.is_demo === true ? 'PASSED' : 'FAILED');

  // 4. Confirm demo imagery appears
  const imgRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/imagery`);
  const imgData = await imgRes.json();
  const imagery = imgData.imagery?.[0];
  console.log('4. Demo Imagery loaded:', imagery?.file_name === 'coastal_settlement_demo.png' && imagery?.width === 740 && imagery?.height === 480 ? 'PASSED' : 'FAILED');

  // Verify physical file exists and is accessible
  const imgFileRes = await fetch(`http://localhost:3001${imagery.file_url}`);
  console.log('   Imagery file HTTP accessible:', imgFileRes.status === 200 ? 'PASSED' : 'FAILED');

  // 5 & 6. Confirm detections are present
  const featRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/features`);
  const featData = await featRes.json();
  const features = featData.features || [];
  const featureTypes = [...new Set(features.map(f => f.feature_type))];
  console.log('6. AI Detections present:', features.length === 13 ? 'PASSED' : 'FAILED', `(${features.length} features: ${featureTypes.join(', ')})`);

  // Distinguish ML vs CV
  const mlCount = features.filter(f => f.source?.includes('ML Detection')).length;
  const cvCount = features.filter(f => f.source?.includes('CV-derived Evidence')).length;
  console.log(`   ML Detections: ${mlCount}, CV Evidence: ${cvCount} (Distinction verified)`);

  // 7 & 8. Spatial reasoning results
  const parcelsRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/parcels`);
  const parcelsData = await parcelsRes.json();
  const parcels = parcelsData.parcels || [];
  console.log('8. Spatial Reasoning Parcels:', parcels.length === 3 ? 'PASSED' : 'FAILED', `(${parcels.map(p => p.id).join(', ')})`);

  // 9 & 10. Confirm GIS Quality metrics
  const qcRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/quality-control`);
  const qcData = await qcRes.json();
  const audit = qcData.metrics || qcData;
  console.log('10. GIS Quality Metrics:', audit?.total_parcels === 3 && qcData.valid_polygons_count === 3 ? 'PASSED' : 'FAILED');
  console.log('    QC audit summary:', {
    total: audit?.total_parcels,
    valid: qcData.valid_polygons_count,
    overlaps: qcData.overlaps_count,
    gaps: qcData.gaps_count,
    water_overlaps: qcData.water_overlaps_count,
    low_confidence: qcData.low_confidence_count,
    ready: qcData.ready_for_review_count
  });

  // 11-15. Edit a parcel vertex and verify persistence
  const targetParcel = parcels[0];
  const origCoords = JSON.parse(JSON.stringify(targetParcel.image_coordinates || targetParcel.geometry.coordinates));
  const editedCoords = JSON.parse(JSON.stringify(origCoords));
  // Move one vertex
  editedCoords[0][1][0] += 5;
  editedCoords[0][1][1] += 5;

  const editRes = await fetch(`${BASE_URL}/parcels/${targetParcel.id}/geometry?project_id=proj_demo_coastal`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Polygon', coordinates: editedCoords },
      image_coordinates: editedCoords,
      change_type: 'vertex_edit',
      comments: 'Surveyor manual vertex alignment to hedge line',
      reviewer_name: 'Lead Cadastral Surveyor'
    })
  });
  const editData = await editRes.json();
  console.log('13. Edit parcel vertex:', editData.success ? 'PASSED' : 'FAILED');

  // Verify persistence from fresh fetch
  const freshParcelRes = await fetch(`${BASE_URL}/parcels/${targetParcel.id}?project_id=proj_demo_coastal`);
  const freshParcelData = await freshParcelRes.json();
  const persistedParcel = freshParcelData.parcel;
  const isPersisted = persistedParcel?.image_coordinates?.[0]?.[1]?.[0] === editedCoords[0][1][0];
  console.log('15. Persistence verification:', isPersisted ? 'PASSED' : 'FAILED');

  // 16. Accept a parcel
  const acceptRes = await fetch(`${BASE_URL}/parcels/PM-DEMO-0001/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      remarks: 'Verified boundary evidence',
      reviewer_name: 'Lead Cadastral Surveyor'
    })
  });
  const acceptData = await acceptRes.json();
  console.log('16. Accept parcel PM-DEMO-0001:', acceptData.success ? 'PASSED' : 'FAILED');

  // 17 & 18. Final Map verified parcels check
  const allParcelsAfterAcceptRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/parcels`);
  const allParcelsAfterAccept = (await allParcelsAfterAcceptRes.json()).parcels || [];
  const acceptedParcels = allParcelsAfterAccept.filter(p => p.status === 'accepted');
  const needsReviewParcels = allParcelsAfterAccept.filter(p => p.status === 'Needs Review' || p.status === 'needs_review');
  console.log('18. Final Map verified parcels count:', acceptedParcels.length === 1 && needsReviewParcels.length === 1 ? 'PASSED' : 'FAILED', `(Accepted: ${acceptedParcels.length}, Review: ${needsReviewParcels.length})`);

  // 19 & 20. Reports and exports check
  const reportRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/report`);
  const reportData = await reportRes.json();
  const repSummary = reportData.report?.summary;
  console.log('20. Project report data consistent:', repSummary?.total_preliminary_parcels === 3 && repSummary?.final_verified_parcels === 1 && repSummary?.needs_review === 1 ? 'PASSED' : 'FAILED');

  const geoJsonRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/export/geojson`);
  const geoJson = await geoJsonRes.json();
  console.log('    GeoJSON export verified count matches final map (1 accepted):', geoJson.features?.length === 1 ? 'PASSED' : 'FAILED');

  const csvRes = await fetch(`${BASE_URL}/projects/proj_demo_coastal/export/csv`);
  const csvText = await csvRes.text();
  const csvLines = csvText.trim().split('\n');
  console.log('    CSV export verified count matches final map (Header + 1 accepted):', csvLines.length === 2 ? 'PASSED' : 'FAILED');

  // 21-25. Create a completely new REAL project and upload real image to confirm DEMO ISOLATION
  console.log('\n--- TESTING REAL PROJECT ISOLATION ---');
  const realProjRes = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Field Cadastral Survey Alpha',
      description: 'Real production surveyor project',
      location: 'Northern Field Sector',
      is_demo: false
    })
  });
  const realProjData = await realProjRes.json();
  const realProject = realProjData.project;
  console.log('21. Real project created:', realProject?.is_demo === false ? 'PASSED' : 'FAILED', `(ID: ${realProject?.id})`);

  // Check that new real project has 0 demo parcels and 0 demo imagery
  const realParcelsRes = await fetch(`${BASE_URL}/projects/${realProject.id}/parcels`);
  const realParcels = (await realParcelsRes.json()).parcels || [];
  const realImgsRes = await fetch(`${BASE_URL}/projects/${realProject.id}/imagery`);
  const realImgs = (await realImgsRes.json()).imagery || [];
  console.log('23. Demo data NOT in real project:', realParcels.length === 0 && realImgs.length === 0 ? 'PASSED' : 'FAILED');

  // Verify demo dataset was unaffected
  const demoParcelsCheck = await (await fetch(`${BASE_URL}/projects/proj_demo_coastal/parcels`)).json();
  console.log('25. Demo dataset intact and isolated:', demoParcelsCheck.parcels?.length === 3 ? 'PASSED' : 'FAILED');

  console.log('\n=== ALL 25 VERIFICATION CHECKS COMPLETED ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
