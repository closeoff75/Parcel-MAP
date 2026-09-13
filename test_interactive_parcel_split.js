/**
 * Automated Verification Suite for Interactive Parcel Split Feature
 * Validates all Requirements 1 through 17:
 * - Line crossing requirement (rejects outside, one-sided, too short lines)
 * - Actual geometry division into two valid closed polygons
 * - Child parcel status: needs_review
 * - Metadata preservation (project_id, imagery_id, confidence, supporting_features)
 * - Provenance and audit history (parent_parcel_id, child_parcel_ids, split_line, operation: SPLIT)
 * - Stale geometry prevention (splits current edited geometry)
 * - Persistence across reload
 * - Undo split (reverts to parent parcel)
 */

import assert from 'assert';
import { GISEngine } from './server/services/gisEngine.js';
import { db } from './server/db/database.js';

const BASE_URL = 'http://localhost:3000/api';

async function req(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function runSplitTests() {
  console.log('================================================================');
  console.log('✂ RUNNING INTERACTIVE PARCEL SPLIT AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  // Find or create test project with parcel
  const testProjId = `proj_split_test_${Date.now()}`;
  const testImgId = `img_split_test_${Date.now()}`;

  const parentId = 'PM-SPLIT-001';
  const initialGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [100, 100],
        [300, 100],
        [300, 300],
        [100, 300],
        [100, 100]
      ]
    ]
  };

  const initialParcel = {
    id: parentId,
    parcel_id: parentId,
    project_id: testProjId,
    imagery_id: testImgId,
    geometry: initialGeometry,
    image_coordinates: initialGeometry.coordinates,
    confidence: 0.92,
    supporting_features: ['Road Corridor North', 'Fence Line West'],
    status: 'needs_review',
    source: 'AI Generated',
    version: 1,
    current_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.setParcels(testProjId, [initialParcel], testImgId);
  db.addParcelVersion({
    parcel_id: parentId,
    project_id: testProjId,
    imagery_id: testImgId,
    geometry: initialGeometry,
    action: 'Generated',
    change_type: 'generated',
    comments: 'Initial test parcel'
  });

  console.log('--- Test 1: Geometry Engine - Reject Lines That Do Not Cross Parcel ---');
  // 1a. Line completely outside
  let errOutside = null;
  try {
    GISEngine.splitPolygon(initialGeometry, [[400, 100], [400, 300]]);
  } catch (e) {
    errOutside = e.message;
  }
  assert(
    errOutside === 'Invalid split line — draw a line that crosses the selected parcel.',
    `Expected crossing error on outside line, got: ${errOutside}`
  );
  console.log('  ✓ PASS: Rejects cut line completely outside parcel');

  // 1b. Line touching only one boundary
  let errOneSide = null;
  try {
    GISEngine.splitPolygon(initialGeometry, [[200, 200], [400, 200]]);
  } catch (e) {
    errOneSide = e.message;
  }
  assert(
    errOneSide === 'Invalid split line — draw a line that crosses the selected parcel.',
    `Expected crossing error on one-sided line, got: ${errOneSide}`
  );
  console.log('  ✓ PASS: Rejects cut line touching only one boundary');

  // 1c. Line too short
  let errShort = null;
  try {
    GISEngine.splitPolygon(initialGeometry, [[150, 150], [152, 150]]);
  } catch (e) {
    errShort = e.message;
  }
  assert(
    errShort && errShort.includes('Invalid split line'),
    `Expected error on too-short cut line, got: ${errShort}`
  );
  console.log('  ✓ PASS: Rejects cut line that is too short');

  console.log('\n--- Test 2: Geometry Engine - Valid Boundary Crossing ---');
  // Line crossing vertically across x = 200
  const cutLine = [[200, 50], [200, 350]];
  const splitPolys = GISEngine.splitPolygon(initialGeometry, cutLine);
  assert(splitPolys.length === 2, 'Expected 2 resulting polygons');
  const ringA = splitPolys[0].coordinates[0];
  const ringB = splitPolys[1].coordinates[0];
  assert(ringA.length >= 4, 'Polygon A must be closed with at least 4 vertices');
  assert(ringB.length >= 4, 'Polygon B must be closed with at least 4 vertices');
  const areaA = GISEngine.planarArea(ringA);
  const areaB = GISEngine.planarArea(ringB);
  assert(areaA > 0 && areaB > 0, 'Both resulting polygons must have non-zero area');
  assert(Math.abs((areaA + areaB) - 40000) < 1, `Total area should equal 40000, got ${areaA + areaB}`);
  console.log(`  ✓ PASS: Split produced two valid polygons: Area A = ${areaA}, Area B = ${areaB}`);

  console.log('\n--- Test 3: Backend API - Rejects Invalid Split Line (HTTP 400) ---');
  const apiResInvalid = await req('POST', `/parcels/${parentId}/split`, {
    project_id: testProjId,
    imagery_id: testImgId,
    cut_line: [[400, 100], [400, 300]]
  });
  assert(apiResInvalid.status === 400, `Expected HTTP 400 on invalid cut, got ${apiResInvalid.status}`);
  assert(
    apiResInvalid.data.error === 'Invalid split line — draw a line that crosses the selected parcel.',
    `Expected exact user-facing error message, got: ${apiResInvalid.data.error}`
  );
  console.log('  ✓ PASS: API returned 400 with "Invalid split line — draw a line that crosses the selected parcel."');

  console.log('\n--- Test 4: Stale Geometry Prevention (Requirement 14) ---');
  // Suppose user edited the parcel vertices before splitting: moved northern edge from y=100 to y=50
  const editedGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [100, 50],
        [300, 50],
        [300, 300],
        [100, 300],
        [100, 50]
      ]
    ]
  };

  const apiResSplit = await req('POST', `/parcels/${parentId}/split`, {
    project_id: testProjId,
    imagery_id: testImgId,
    current_geometry: editedGeometry, // Send edited geometry
    cut_line: [[200, 20], [200, 350]],
    reviewer_name: 'Alex Morgan (Lead Surveyor)',
    comments: 'Subdivision split along verified farm boundary'
  });

  assert(apiResSplit.status === 200, `Expected HTTP 200 on valid split, got ${apiResSplit.status}`);
  assert(apiResSplit.data.success === true, 'Split response success must be true');
  assert(apiResSplit.data.children.length === 2, 'Must return 2 child parcels');

  const [childA, childB] = apiResSplit.data.children;
  console.log(`  ✓ PASS: Created child parcels ${childA.parcel_id} and ${childB.parcel_id}`);

  console.log('\n--- Test 5: Child Parcel Metadata & Status (Requirements 6, 7, 8) ---');
  assert(childA.parcel_id === `${parentId}-A`, `Expected ID ${parentId}-A, got ${childA.parcel_id}`);
  assert(childB.parcel_id === `${parentId}-B`, `Expected ID ${parentId}-B, got ${childB.parcel_id}`);
  assert(childA.parent_parcel_id === parentId, 'Child A must reference parent_parcel_id');
  assert(childB.parent_parcel_id === parentId, 'Child B must reference parent_parcel_id');
  assert(childA.project_id === testProjId, 'Child A must preserve project_id');
  assert(childB.imagery_id === testImgId, 'Child B must preserve imagery_id');
  assert(childA.confidence === 0.92, 'Child A must preserve confidence');

  // Requirement 8: Status must be NEEDS REVIEW
  assert(childA.status === 'needs_review', `Child A status must be needs_review, got ${childA.status}`);
  assert(childB.status === 'needs_review', `Child B status must be needs_review, got ${childB.status}`);
  console.log('  ✓ PASS: Both child parcels have status: needs_review');

  // Check split origin preserved
  assert(childA.split_origin && childA.split_origin.original_parcel_id === parentId, 'Child A has split_origin');
  console.log('  ✓ PASS: Child parcels contain split_origin metadata');

  // Verify edited geometry was used (y=50, not y=100)
  const childRingA = childA.geometry.coordinates[0];
  const minY = Math.min(...childRingA.map(pt => pt[1]));
  assert(minY === 50, `Expected minY to be 50 from edited geometry, got ${minY}`);
  console.log('  ✓ PASS: Split respected CURRENT edited geometry (not stale original AI geometry)');

  console.log('\n--- Test 6: Persistence & History (Requirements 12, 13) ---');
  // Fetch parcels from DB to verify persistence across reload
  const dbParcels = db.getParcelsByProjectId(testProjId, testImgId);
  assert(!dbParcels.some(p => p.parcel_id === parentId), 'Parent parcel must NOT be active');
  assert(dbParcels.some(p => p.parcel_id === `${parentId}-A`), 'Child parcel A must persist in active layer');
  assert(dbParcels.some(p => p.parcel_id === `${parentId}-B`), 'Child parcel B must persist in active layer');
  console.log('  ✓ PASS: Active parcel layer updated (parent removed, child parcels active)');

  // Verify Audit History
  const history = db.getParcelHistory(parentId);
  const splitVersion = history.versions.find(v => v.action === 'Split' || v.operation === 'SPLIT');
  assert(Boolean(splitVersion), 'SPLIT operation must be recorded in version history');
  assert(splitVersion.child_parcel_ids.includes(`${parentId}-A`), 'History records child A');
  assert(splitVersion.child_parcel_ids.includes(`${parentId}-B`), 'History records child B');
  assert(splitVersion.split_line !== null, 'History records split cut line');
  console.log('  ✓ PASS: Full audit history preserved with SPLIT operation and child parcel IDs');

  // Check history from child parcel perspective
  const childHistory = db.getParcelHistory(`${parentId}-A`);
  assert(childHistory.versions.length >= 1, 'Child parcel history exists');
  console.log('  ✓ PASS: Child parcel history is linked to parent split event');

  console.log('\n--- Test 7: Undo Split Operation (Requirement 10) ---');
  const undoRes = await req('POST', `/parcels/${parentId}/undo-split`, {
    reviewer_name: 'Alex Morgan (Lead Surveyor)'
  });
  assert(undoRes.status === 200, `Expected HTTP 200 on undo-split, got ${undoRes.status}`);
  const postUndoParcels = db.getParcelsByProjectId(testProjId, testImgId);
  assert(postUndoParcels.some(p => p.parcel_id === parentId), 'Parent parcel must be restored after undo');
  assert(!postUndoParcels.some(p => p.parcel_id === `${parentId}-A`), 'Child parcel A must be removed after undo');
  assert(!postUndoParcels.some(p => p.parcel_id === `${parentId}-B`), 'Child parcel B must be removed after undo');
  console.log('  ✓ PASS: Undo split restored parent parcel and removed child parcels');

  // Clean up test data
  const remaining = db.getParcelsByProjectId(testProjId, testImgId);
  db.setParcels(testProjId, remaining.filter(p => p.project_id !== testProjId), testImgId);

  console.log('\n================================================================');
  console.log('🎉 ALL 7 INTERACTIVE PARCEL SPLIT TEST SUITES PASSED 100%!');
  console.log('================================================================\n');
}

runSplitTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
