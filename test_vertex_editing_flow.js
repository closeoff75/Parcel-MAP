/**
 * Automated Verification Test for ParcelMap Human Verification Vertex Editing Engine
 * Tests Requirements: 1-13, 16, 17, 20, 24, 25
 */

const BASE_URL = 'http://localhost:3001/api';
const PROJECT_ID = 'proj_wagholi_demo';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(BASE_URL + path, options);
  let data;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { status: res.status, body: data };
}

async function runTests() {
  console.log('====================================================');
  console.log('PARCELMAP VERTEX EDITING AUTOMATED TEST SUITE');
  console.log('====================================================\n');

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

  try {
    // 1. Fetch PM-0001 initial state
    console.log('[Test 1] Fetch current parcel PM-0001...');
    const parcelsRes = await request('GET', `/projects/${PROJECT_ID}/parcels`);
    assert(parcelsRes.status === 200 && parcelsRes.body.success, 'Successfully fetched parcels');
    const parcel = parcelsRes.body.parcels.find(p => p.parcel_id === 'PM-0001');
    assert(Boolean(parcel), 'Found PM-0001 in project parcels');

    const originalGeom = JSON.parse(JSON.stringify(parcel.geometry));
    const originalCoords = originalGeom.coordinates[0];
    console.log(`  PM-0001 original vertex count: ${originalCoords.length - 1} (+1 closed)`);

    // 2. Geometry Validation Tests
    console.log('\n[Test 2] Geometry Validation Checks...');

    // 2a. Valid geometry should pass
    const valGood = await request('POST', `/parcels/PM-0001/validate?project_id=${PROJECT_ID}`, {
      geometry: originalGeom,
      project_id: PROJECT_ID
    });
    assert(valGood.status === 200 && valGood.body.valid === true, 'Original valid geometry passes validation');

    // 2b. Self-intersecting polygon (bowtie) should FAIL validation
    const bowtieGeom = {
      type: 'Polygon',
      coordinates: [[
        [73.9832, 18.5860],
        [73.9858, 18.5842],
        [73.9856, 18.5858],
        [73.9832, 18.5845],
        [73.9832, 18.5860]
      ]]
    };
    const valBowtie = await request('POST', `/parcels/PM-0001/validate?project_id=${PROJECT_ID}`, {
      geometry: bowtieGeom,
      project_id: PROJECT_ID
    });
    assert(valBowtie.body.valid === false, 'Self-intersecting bowtie polygon correctly fails validation');
    assert(valBowtie.body.errors.some(e => e.toLowerCase().includes('self-intersect') || e.toLowerCase().includes('kink')), `Returns clear self-intersection error: "${valBowtie.body.errors[0]}"`);

    // 2c. Polygon with fewer than 3 vertices should FAIL validation
    const tooFewGeom = {
      type: 'Polygon',
      coordinates: [[
        [73.9832, 18.5860],
        [73.9858, 18.5858],
        [73.9832, 18.5860]
      ]]
    };
    const valTooFew = await request('POST', `/parcels/PM-0001/validate?project_id=${PROJECT_ID}`, {
      geometry: tooFewGeom,
      project_id: PROJECT_ID
    });
    assert(valTooFew.body.valid === false, 'Polygon with fewer than 3 vertices fails validation');

    // 2d. Attempting to save invalid geometry via PUT should be REJECTED with 400
    const saveInvalid = await request('PUT', `/parcels/PM-0001/geometry?project_id=${PROJECT_ID}`, {
      geometry: bowtieGeom,
      project_id: PROJECT_ID,
      comments: 'Attempting invalid save'
    });
    assert(saveInvalid.status === 400 && saveInvalid.body.success === false, 'PUT /parcels/:id/geometry rejects invalid self-intersecting geometry with HTTP 400');
    assert(saveInvalid.body.error.includes('Cannot save'), `Error message explains why: "${saveInvalid.body.error}"`);

    // 3. Backend Persistence & Version History Test (Requirement 9, 11, 12, 13)
    console.log('\n[Test 3] Live Vertex Drag Displacement & Backend Persistence...');

    // Displace vertex 1 significantly
    const modifiedCoords = JSON.parse(JSON.stringify(originalCoords));
    modifiedCoords[1] = [Number((modifiedCoords[1][0] + 0.0008).toFixed(6)), Number((modifiedCoords[1][1] - 0.0006).toFixed(6))]; // move vertex 1
    const modifiedGeom = {
      type: 'Polygon',
      coordinates: [modifiedCoords]
    };

    console.log(`  Old coordinate [1]: [${originalCoords[1][0]}, ${originalCoords[1][1]}]`);
    console.log(`  New coordinate [1]: [${modifiedCoords[1][0]}, ${modifiedCoords[1][1]}]`);

    const saveRes = await request('PUT', `/parcels/PM-0001/geometry?project_id=${PROJECT_ID}`, {
      geometry: modifiedGeom,
      image_coordinates: [modifiedCoords],
      project_id: PROJECT_ID,
      comments: 'Automated vertex drag audit test: displaced vertex #2 eastward.',
      reviewer_name: 'Alex Morgan (Lead Surveyor)'
    });

    assert(saveRes.status === 200 && saveRes.body.success === true, 'PUT /parcels/PM-0001/geometry successfully persisted modified geometry');
    assert(Boolean(saveRes.body.version), `Created version number: v${saveRes.body.version}`);

    // 4. Persistence / Refresh Verification (Requirement 13)
    console.log('\n[Test 4] Refresh / Reload Persistence Check...');
    const reloadRes = await request('GET', `/projects/${PROJECT_ID}/parcels`);
    const reloadedParcel = reloadRes.body.parcels.find(p => p.parcel_id === 'PM-0001');
    assert(Boolean(reloadedParcel), 'Reloaded parcel PM-0001 from database');

    const reloadedCoord = reloadedParcel.geometry.coordinates[0][1];
    const matchX = Math.abs(reloadedCoord[0] - modifiedCoords[1][0]) < 1e-5;
    const matchY = Math.abs(reloadedCoord[1] - modifiedCoords[1][1]) < 1e-5;
    assert(matchX && matchY, `Reloaded geometry matches modified coordinates: [${reloadedCoord[0]}, ${reloadedCoord[1]}]`);

    // 5. Version History Check (Requirement 12)
    console.log('\n[Test 5] Version History Audit Trail Check...');
    const histRes = await request('GET', '/parcels/PM-0001/history');
    assert(histRes.status === 200 && histRes.body.success, 'Fetched parcel version history');
    const historyList = histRes.body.history || [];
    assert(historyList.length > 0, `History contains ${historyList.length} version entries`);
    const latestVer = historyList[0];
    assert(latestVer.change_type === 'vertex_edit' || latestVer.action === 'Edited', `Latest version recorded with change_type: "${latestVer.change_type || latestVer.action}"`);

    // 6. Regression Testing: Split, Merge, Accept, Reject (Requirement 20)
    console.log('\n[Test 6] Workflow Regression Testing (Accept, Review, Reject, Split, Merge)...');

    // 6a. Accept
    const acceptRes = await request('POST', `/parcels/PM-0001/accept?project_id=${PROJECT_ID}`, { comments: 'Verified by reviewer' });
    assert(acceptRes.status === 200 && acceptRes.body.success, 'Accept parcel workflow functional');

    // 6b. Needs Review
    const reviewRes = await request('POST', `/parcels/PM-0001/needs-review?project_id=${PROJECT_ID}`, { comments: 'Field check needed' });
    assert(reviewRes.status === 200 && reviewRes.body.success, 'Needs-Review parcel workflow functional');

    // 6c. Split & Merge
    // Use PM-0003 for non-destructive split/merge test
    const splitRes = await request('POST', `/parcels/PM-0003/split?project_id=${PROJECT_ID}`, { reviewer_name: 'Alex Morgan' });
    assert(splitRes.status === 200 && splitRes.body.success, 'Split polygon workflow functional');

    const mergeRes = await request('POST', `/parcels/merge?project_id=${PROJECT_ID}`, {
      parcel_ids: ['PM-0003-A', 'PM-0003-B'],
      reviewer_name: 'Alex Morgan'
    });
    assert(mergeRes.status === 200 && mergeRes.body.success, 'Merge polygons workflow functional');

    // 7. Cleanup / Restore PM-0001 to original geometry
    console.log('\n[Cleanup] Restoring PM-0001 to original boundary...');
    await request('PUT', `/parcels/PM-0001/geometry?project_id=${PROJECT_ID}`, {
      geometry: originalGeom,
      image_coordinates: [originalCoords],
      project_id: PROJECT_ID,
      comments: 'Restored to baseline verified boundary'
    });
    console.log('  ✓ PM-0001 restored.');

  } catch (err) {
    console.error('Unexpected error during test:', err);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
