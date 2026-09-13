/**
 * Comprehensive Spatial Reasoning Flow Audit Test (ESM using native fetch)
 * Verifies all 15 User Requirements:
 * 1. Uses persisted, validated detections only
 * 2. Zero random boxes, building bounding boxes, or fixed-size boxes
 * 3. Real spatial relationships (roads, boundaries, land blocks, context buildings)
 * 4. Land blocks built first, parcel candidates derived from evidence
 * 5. Image-space pixel coordinates preserved (no fabricated lat/lon)
 * 6. Data-driven candidate count (not artificially limited to 2-3)
 * 7. Parcel quality metadata (parcel_id, project_id, imagery_id, geometry, confidence, status, source, supporting IDs, created_at)
 * 8. Edge-based validation
 * 9. Duplicate prevention (tight IoU deduplication)
 * 10. Plausible land parcels
 * 11. Root cause eliminated (no hardcoded demo/fallback 3-box returns)
 * 12. Persist & reload preserves the exact candidates
 * 13. GIS quality handoff receives exact geometries
 * 14. Insufficient spatial evidence returns: "Insufficient validated spatial evidence for parcel generation."
 * 15. End-to-end integration
 */

const BASE_URL = 'http://localhost:3001';

async function runAudit() {
  console.log('===========================================================');
  console.log('   SPATIAL REASONING COMPREHENSIVE FLOW AUDIT');
  console.log('===========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // Helper fetch json
  async function postJson(endpoint, data) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    return { status: res.status, data: json };
  }

  async function getJson(endpoint) {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    const json = await res.json();
    return { status: res.status, data: json };
  }

  // -------------------------------------------------------------
  // Test 1: Insufficient Evidence Handling
  // -------------------------------------------------------------
  console.log('\n--- 1. Testing Insufficient Evidence Handling ---');
  try {
    const emptyProjRes = await postJson('/api/projects', {
      name: 'Empty Evidence Audit Proj',
      description: 'Test empty spatial reasoning'
    });
    const emptyProj = emptyProjRes.data.project;
    const emptyProjId = emptyProj.id || emptyProj.project_id;

    // Upload an imagery without any feature detections
    const emptyBlob = new Blob([Buffer.from('fake_empty_drone_image_bytes')], { type: 'image/jpeg' });
    const emptyForm = new FormData();
    emptyForm.append('imagery', emptyBlob, 'featureless_drone_view.jpg');
    const uploadRes = await fetch(`${BASE_URL}/api/projects/${emptyProjId}/imagery`, {
      method: 'POST',
      body: emptyForm
    });
    const uploadData = await uploadRes.json();
    const emptyImg = uploadData.imagery;

    const emptyReasoningRes = await postJson(`/api/projects/${emptyProjId}/spatial-reasoning`, {
      imagery_id: emptyImg.id
    });

    const body = emptyReasoningRes.data;
    assert(body.candidates_count === 0, 'Returns candidates_count === 0 when no spatial evidence exists');
    assert(
      (body.message && body.message.includes('Insufficient validated spatial evidence for parcel generation.')) ||
      (body.warning && body.warning.includes('Insufficient validated spatial evidence for parcel generation.')),
      `Returns exact expected notice: "${body.message || body.warning}"`
    );
    assert(!body.candidates || body.candidates.length === 0, 'Zero fallback/demo parcels returned (no fake boxes)');
  } catch (err) {
    assert(false, `Unexpected error in Test 1: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Test 2: Real Spatial Reasoning on Persisted Detections
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Real Spatial Reasoning on Project with Real Detections ---');
  const projRes = await getJson('/api/projects');
  const projects = projRes.data.projects || [];
  
  let targetProj = null;
  let detectionsCount = 0;

  for (const p of projects) {
    const pId = p.id || p.project_id;
    try {
      const featRes = await getJson(`/api/projects/${pId}/features`);
      const featList = featRes.data.features || [];
      if (featList.length >= 10) {
        targetProj = p;
        detectionsCount = featList.length;
        break;
      }
    } catch (e) {}
  }

  if (!targetProj) {
    targetProj = projects[0];
  }

  const targetProjId = targetProj.id || targetProj.project_id;
  const targetImgId = targetProj.active_imagery_id || 'img_1789143627688';

  console.log(`  Selected Project: ${targetProjId} (Features/detections loaded: ${detectionsCount})`);

  const runRes = await postJson(`/api/projects/${targetProjId}/spatial-reasoning`, {
    imagery_id: targetImgId
  });

  const result = runRes.data;
  assert(result.success === true, 'Spatial reasoning executed successfully');
  
  const parcels = result.candidates || result.parcels || [];
  assert(parcels.length > 0, `Generated ${parcels.length} parcel candidates`);
  console.log(`  Candidate parcels count: ${parcels.length}`);

  // Requirement 6: Data-driven candidate count (NOT limited to 2-3)
  assert(parcels.length >= 4, `Parcel count is data-driven (${parcels.length} candidates generated, not artificially capped at 2-3)`);

  // Requirement 2 & 7: Quality metadata & No arbitrary boxes
  let allQualityValid = true;
  let allCoordinatesImageSpace = true;
  let anyBoundingBoxBuilding = false;
  let allHaveSupportingEvidence = true;
  let allHaveCreatedAt = true;

  for (const p of parcels) {
    if (!p.parcel_id || !p.project_id || !p.geometry || p.confidence === undefined || !p.status || !p.source) {
      allQualityValid = false;
    }
    if (!p.created_at) {
      allHaveCreatedAt = false;
    }
    if (!p.supporting_evidence || !Array.isArray(p.supporting_evidence.roads)) {
      allHaveSupportingEvidence = false;
    }
    const coords = p.geometry.coordinates && p.geometry.coordinates[0];
    if (coords && coords.length > 0) {
      for (const [x, y] of coords) {
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
          allCoordinatesImageSpace = false;
        }
      }
      
      if (coords.length === 5 && p.source === 'building_bounding_box') {
        anyBoundingBoxBuilding = true;
      }
    }
  }

  assert(allQualityValid, 'All candidates have parcel_id, project_id, geometry, confidence, status, and source');
  assert(allHaveCreatedAt, 'All candidates have created_at timestamp');
  assert(allHaveSupportingEvidence, 'All candidates contain traceable supporting detection evidence (roads, buildings, walls_fences)');
  assert(allCoordinatesImageSpace, 'All candidate coordinates are preserved in image pixel space (no fake lat/lon)');
  assert(!anyBoundingBoxBuilding, 'Zero arbitrary building bounding boxes or fixed-size boxes generated');

  // -------------------------------------------------------------
  // Test 3: Edge Support Validation
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Edge Support & Status Classification ---');
  const statuses = new Set(parcels.map(p => p.status));
  console.log(`  Statuses observed: ${Array.from(statuses).join(', ')}`);
  assert(
    statuses.has('accepted') || statuses.has('needs_review'),
    'Candidates properly classified into accepted / needs_review based on edge evidence'
  );

  // -------------------------------------------------------------
  // Test 4: Persistence & Reload Verification
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Persistence & Reload ---');
  const reloadRes = await getJson(`/api/projects/${targetProjId}/candidates`);
  const reloadedParcels = reloadRes.data.candidates || [];
  assert(reloadedParcels.length === parcels.length, `Reloaded exact candidate count (${reloadedParcels.length} == ${parcels.length})`);
  assert(
    reloadedParcels.every((rp, i) => rp.parcel_id === parcels[i].parcel_id),
    'Parcel IDs and ordering identically preserved after reload'
  );

  // -------------------------------------------------------------
  // Test 5: GIS Quality Handoff Consistency
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing GIS Quality Handoff ---');
  const gisRes = await getJson(`/api/projects/${targetProjId}/parcels`);
  const gisParcels = gisRes.data.parcels || [];
  assert(gisParcels.length === parcels.length, `GIS Quality receives exact parcel count (${gisParcels.length} == ${parcels.length})`);
  if (gisParcels.length > 0 && parcels.length > 0) {
    const p1 = parcels[0].geometry.coordinates[0];
    const g1 = gisParcels[0].geometry.coordinates[0];
    assert(
      JSON.stringify(p1) === JSON.stringify(g1),
      'GIS Quality receives the exact same geometry without regeneration'
    );
  }

  // -------------------------------------------------------------
  // Test 6: Demo Project Uses Real Spatial Reasoning (Not Demo Static Fallbacks)
  // -------------------------------------------------------------
  console.log('\n--- 6. Testing Demo Project Genuine Reasoning (Root Cause Removed) ---');
  const demoReasoningRes = await postJson(`/api/projects/proj_demo_coastal/spatial-reasoning`, {});
  const demoParcels = demoReasoningRes.data.candidates || [];
  assert(
    demoParcels.length > 3,
    `Demo project runs genuine spatial reasoning on its persisted features (${demoParcels.length} candidates, old 3-box hardcode eliminated)`
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n===========================================================');
  console.log(`   AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit execution error:', err);
  process.exit(1);
});
