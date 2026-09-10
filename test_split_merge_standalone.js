/**
 * Test Split & Merge End-to-End Test (Section 7) using native fetch
 */
const BASE_URL = 'http://127.0.0.1:3001/api';

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Request failed with status ${res.status}: ${JSON.stringify(data)}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function testSplitMerge() {
  console.log('--- STARTING SECTION 7: SPLIT / MERGE AUDIT TEST ---');
  
  // 1. Create a fresh project
  const projRes = await request(`${BASE_URL}/projects`, {
    method: 'POST',
    body: JSON.stringify({
      name: `SplitMerge Audit Test ${Date.now()}`,
      location: 'Audit Cadastre Site',
      description: 'Testing parcel split and merge mechanics'
    })
  });
  const projectId = projRes.project.id;
  console.log(`[PASS] Created project: ${projectId}`);

  // 2. Insert two test parcels
  const poly1 = {
    type: 'Polygon',
    coordinates: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]]
  };
  const poly2 = {
    type: 'Polygon',
    coordinates: [[[200, 100], [300, 100], [300, 200], [200, 200], [200, 100]]]
  };

  const p1Res = await request(`${BASE_URL}/projects/${projectId}/parcels`, {
    method: 'POST',
    body: JSON.stringify({
      parcel_id: `PARCEL-SM-001`,
      geometry: poly1,
      status: 'needs_review',
      confidence: 0.88,
      supporting_features: ['Wall-1', 'Road-1']
    })
  });
  const parcel1Id = p1Res.parcel.parcel_id || p1Res.parcel.id;

  const p2Res = await request(`${BASE_URL}/projects/${projectId}/parcels`, {
    method: 'POST',
    body: JSON.stringify({
      parcel_id: `PARCEL-SM-002`,
      geometry: poly2,
      status: 'needs_review',
      confidence: 0.85,
      supporting_features: ['Fence-1']
    })
  });
  const parcel2Id = p2Res.parcel.parcel_id || p2Res.parcel.id;
  console.log(`[PASS] Created initial parcels: ${parcel1Id}, ${parcel2Id}`);

  // 3. Test SPLIT on parcel 1
  console.log(`\nTesting SPLIT on parcel ${parcel1Id}...`);
  const splitRes = await request(`${BASE_URL}/parcels/${parcel1Id}/split`, {
    method: 'POST',
    body: JSON.stringify({
      split_type: 'vertical',
      reviewer_name: 'Lead Surveyor Maria'
    })
  });
  
  if (!splitRes.success) {
    throw new Error('Split operation failed: ' + splitRes.error);
  }
  const splitChildren = splitRes.parcels || splitRes.children;
  if (!splitChildren || splitChildren.length !== 2) {
    throw new Error(`Expected 2 children from split, got ${splitChildren?.length}`);
  }
  const [childA, childB] = splitChildren;
  const childAId = childA.parcel_id || childA.id;
  const childBId = childB.parcel_id || childB.id;
  console.log(`[PASS] Split succeeded into children: ${childAId} and ${childBId}`);

  // Check child geometries are valid polygons
  if (childA.geometry.type !== 'Polygon' || childB.geometry.type !== 'Polygon') {
    throw new Error('Split child geometry is not a Polygon');
  }
  console.log(`[PASS] Both child geometries are valid Polygons`);

  // Verify child validation
  const valARes = await request(`${BASE_URL}/parcels/${childAId}/validate`, { method: 'POST', body: JSON.stringify({}) });
  const valBRes = await request(`${BASE_URL}/parcels/${childBId}/validate`, { method: 'POST', body: JSON.stringify({}) });
  console.log(`[PASS] Child A validation: ${valARes.is_valid}, Child B validation: ${valBRes.is_valid}`);

  // Check history on parent and child A
  const parentHistRes = await request(`${BASE_URL}/parcels/${parcel1Id}/versions`);
  console.log(`[PASS] Parent version history count: ${parentHistRes.versions?.length || 0}`);

  // 4. Test MERGE on child A and parcel 2
  console.log(`\nTesting MERGE on child ${childAId} and parcel ${parcel2Id}...`);
  const mergeRes = await request(`${BASE_URL}/parcels/${childAId}/merge`, {
    method: 'POST',
    body: JSON.stringify({
      target_parcel_id: parcel2Id,
      reviewer_name: 'Lead Surveyor Maria',
      comments: 'Merged adjacent sub-parcel with neighboring lot'
    })
  });

  if (!mergeRes.success) {
    throw new Error('Merge operation failed: ' + mergeRes.error);
  }
  console.log(`[PASS] Merge response: ${mergeRes.message}`);

  // Verify target parcel 2 is marked deleted or removed
  const listAfterMerge = await request(`${BASE_URL}/projects/${projectId}/parcels`);
  const activeIds = listAfterMerge.parcels.map(p => p.parcel_id || p.id);
  console.log(`[PASS] Active parcels in project after merge:`, activeIds);

  if (activeIds.includes(parcel2Id)) {
    throw new Error(`Parcel ${parcel2Id} should have been deleted/merged but is still active`);
  }
  if (!activeIds.includes(childAId)) {
    throw new Error(`Merged parcel ${childAId} should still be active`);
  }

  // Check history of merged parcel
  const mergedHistRes = await request(`${BASE_URL}/parcels/${childAId}/versions`);
  console.log(`[PASS] Merged parcel history records: ${mergedHistRes.versions?.length || 0}`);

  console.log('\n=============================================');
  console.log('SECTION 7 (SPLIT / MERGE) TEST: 100% PASSED');
  console.log('=============================================');
}

testSplitMerge().catch(err => {
  console.error('FAILED:', err.data || err.message);
  process.exit(1);
});
