import http from 'http';
import assert from 'assert';
import { db } from '../server/db/database.js';

const BASE_URL = 'http://localhost:3000';
const PROJECT_ID = 'proj_1789117650907';
const IMAGERY_ID = 'img_1789142537501_t33b';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + path, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function sendJSON(path, method, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(BASE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('================================================================');
  console.log('🧪 VERIFYING: PARCEL METADATA, VERSION HISTORY & EXPLAINABILITY');
  console.log('================================================================');

  // -------------------------------------------------------------------------
  // 1. Inspect existing parcel PM-650907-0004 metadata
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Inspect Parcel PM-650907-0004 Persisted Metadata ---');
  const listRes = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  assert.strictEqual(listRes.status, 200);
  const p4 = listRes.data.parcels.find(p => p.parcel_id === 'PM-650907-0004');
  assert(p4, 'Parcel PM-650907-0004 must exist');

  console.log(`[PASS] Parcel PM-650907-0004 loaded from API:`);
  console.log(`       Source: "${p4.source}"`);
  console.log(`       Version: v${p4.version || p4.current_version}`);
  console.log(`       Status: "${p4.status}"`);
  console.log(`       Area: ${p4.area_px} px²`);
  console.log(`       Perimeter Support: Supported ${p4.supported_perimeter_pct}%, Unsupported ${p4.unsupported_perimeter_pct}%`);
  console.log(`       Confidence: ${p4.confidence} (${Math.round(p4.confidence * 100)}%)`);
  console.log(`       Supporting Features:`, p4.supporting_features);

  // Check Requirement 1 & 3: Source is NOT fictional "Human Verification Split"
  assert.notStrictEqual(p4.source, 'Human Verification Split', 'Source must not be fictional Human Verification Split');

  // Check Requirement 1 & 5: Supporting features does NOT contain "Merged with PM-650907-0004-B"
  const hasFictionalMerge = (p4.supporting_features || []).some(f => f.toLowerCase().includes('merged with'));
  assert.strictEqual(hasFictionalMerge, false, 'Supporting features must NOT contain fictional merge strings');

  // Check Requirement 2: Version must equal the latest persisted version, not hardcoded v1
  const histRes = await get(`/api/parcels/PM-650907-0004/history`);
  const versions = histRes.data.history || [];
  const latestVersionNumber = versions.length > 0 ? (versions[0].version || versions[0].version_number || 1) : 1;
  assert.strictEqual(p4.version, latestVersionNumber, `Current version (${p4.version}) must match latest version (${latestVersionNumber})`);

  // Check Requirement 7: Supporting detections reference actual persisted detection IDs
  const allDets = db.data.detectedFeatures?.filter(f => f.imagery_id === IMAGERY_ID) || [];
  const detIdSet = new Set(allDets.map(d => d.id));

  const se = p4.supporting_evidence || {};
  if (se.roads && se.roads.length > 0) {
    for (const rId of se.roads) {
      assert(detIdSet.has(rId), `Supporting road ID ${rId} must exist in detectedFeatures`);
    }
  }
  if (se.buildings && se.buildings.length > 0) {
    for (const bId of se.buildings) {
      assert(detIdSet.has(bId), `Supporting building ID ${bId} must exist in detectedFeatures`);
    }
  }
  console.log('[PASS] Supporting detections validated against persisted detectedFeatures.');

  // Check Requirement 8 & 9: Perimeter support & confidence agreement
  assert.strictEqual(p4.supported_perimeter_pct, 48, 'Perimeter support must be 48%');
  assert.strictEqual(p4.unsupported_perimeter_pct, 52, 'Unsupported perimeter must be 52%');
  assert.strictEqual(p4.confidence, 0.74, 'Confidence must be 0.74 (74%) matching 48% perimeter support');
  console.log('[PASS] Perimeter support (48% supported, 52% unsupported) and confidence (74%) match evidence.');

  // Check Requirement 10: Area in image-space
  assert.strictEqual(p4.area_px, 8137, 'Area must be 8,137 px²');
  assert(p4.area_sqm === null || p4.area_sqm === 0, 'Real-world sqm area must be null or 0 for ungeoreferenced image');
  console.log('[PASS] Image-space area (8,137 px²) has no fake real-world conversion.');

  // -------------------------------------------------------------------------
  // 2. Edit Parcel -> Save -> Accept (Requirement 2 & 6)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Edit Parcel -> Save -> Accept -> Verify Version & Persistence ---');
  const p1Res = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  const p1 = p1Res.data.parcels.find(p => p.parcel_id === 'PM-650907-0001');
  const initialVersion = p1.version;
  const initialCoord = [...p1.geometry.coordinates[0][0]];

  // Shift vertex by +20px
  const editedRing = JSON.parse(JSON.stringify(p1.geometry.coordinates[0]));
  editedRing[0] = [initialCoord[0] + 20, initialCoord[1] + 20];
  editedRing[editedRing.length - 1] = [initialCoord[0] + 20, initialCoord[1] + 20];
  const editedGeom = { type: 'Polygon', coordinates: [editedRing] };

  const saveRes = await sendJSON(`/api/parcels/${p1.parcel_id}/geometry?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'PUT', {
    geometry: editedGeom,
    image_coordinates: [editedRing],
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    reviewer_name: 'Lead Cadastral Surveyor',
    comments: 'Surveyor aligned boundary with driveway'
  });
  assert(saveRes.data.success);
  const postSaveVersion = saveRes.data.version;
  assert(postSaveVersion > initialVersion, 'Version must increment after edit');

  // Accept parcel with preserved geometry
  const acceptRes = await sendJSON(`/api/parcels/${p1.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    geometry: editedGeom,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    reviewer_name: 'Lead Cadastral Surveyor',
    comments: 'Verified modified driveway alignment'
  });
  assert(acceptRes.data.success);
  assert.strictEqual(acceptRes.data.parcel.status, 'accepted');
  assert.strictEqual(acceptRes.data.parcel.geometry.coordinates[0][0][0], initialCoord[0] + 20, 'Geometry must NOT revert after Accept');

  // Refresh & reload
  const reloadP1 = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels.find(p => p.parcel_id === p1.parcel_id);
  assert.strictEqual(reloadP1.geometry.coordinates[0][0][0], initialCoord[0] + 20, 'Edited geometry persists across reload');
  assert.strictEqual(reloadP1.source, 'Human Edited', 'Source must be Human Edited after vertex edit');
  assert(reloadP1.version >= postSaveVersion, 'Version number must reflect latest edit');
  console.log(`[PASS] Edit -> Save -> Accept persisted version v${reloadP1.version}, source "${reloadP1.source}", vertex [${initialCoord[0] + 20}, ${initialCoord[1] + 20}]`);

  // -------------------------------------------------------------------------
  // 3. Split Workflow (Requirement 4)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Split Workflow: Lineage & History ---');
  // Create temporary parcel to test split
  const testSplitParcelId = 'PM-TEST-SPLIT-99';
  const splitTestPoly = {
    type: 'Polygon',
    coordinates: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]]
  };
  db.data.parcels.push({
    id: testSplitParcelId,
    parcel_id: testSplitParcelId,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    geometry: splitTestPoly,
    status: 'preliminary',
    source: 'AI Generated',
    version: 1,
    supporting_features: ['Property Curtilage']
  });
  db.save();

  const splitRes = await sendJSON(`/api/parcels/${testSplitParcelId}/split?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    reviewer_name: 'Alex Morgan (Lead Surveyor)'
  });
  assert(splitRes.data.success, 'Split must succeed');
  assert.strictEqual(splitRes.data.children.length, 2);

  const childA = splitRes.data.children[0];
  const childB = splitRes.data.children[1];
  console.log(`[PASS] Child A source: "${childA.source}", parent: "${childA.parent_parcel_id}"`);
  console.log(`[PASS] Child B source: "${childB.source}", parent: "${childB.parent_parcel_id}"`);

  assert.strictEqual(childA.source, `Split from ${testSplitParcelId}`);
  assert.strictEqual(childB.source, `Split from ${testSplitParcelId}`);
  assert.strictEqual(childA.parent_parcel_id, testSplitParcelId);
  assert.strictEqual(childB.parent_parcel_id, testSplitParcelId);

  // -------------------------------------------------------------------------
  // 4. Merge Workflow (Requirement 5)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Merge Workflow: Lineage & History ---');
  const mergeRes = await sendJSON(`/api/parcels/merge?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    parcel_ids: [childA.parcel_id, childB.parcel_id],
    reviewer_name: 'Alex Morgan (Lead Surveyor)'
  });
  assert(mergeRes.data.success, 'Merge must succeed');
  const mergedParcel = mergeRes.data.parcel;
  console.log(`[PASS] Merged Parcel ID: "${mergedParcel.parcel_id}", source: "${mergedParcel.source}"`);
  console.log(`       Supporting Features:`, mergedParcel.supporting_features);

  assert.strictEqual(mergedParcel.source, `Merged from ${childA.parcel_id} + ${childB.parcel_id}`);
  assert(!mergedParcel.supporting_features.some(f => f.includes('Merged with')), 'Supporting features must NOT contain "Merged with ..."');
  assert(mergedParcel.version >= 2, 'Merged parcel version must be >= 2');

  // Clean up test merge parcel
  db.data.parcels = db.data.parcels.filter(p => p.parcel_id !== childA.parcel_id && p.parcel_id !== childB.parcel_id && p.parcel_id !== testSplitParcelId);
  db.save();
  console.log('[PASS] Cleaned up temporary test split/merge parcels.');

  // -------------------------------------------------------------------------
  // 5. Accept Without Edit Test (Requirement 7 from original prompt)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Accept Without Edit Test ---');
  const p3Before = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels.find(p => p.parcel_id === 'PM-650907-0003');
  const p3GeomBefore = JSON.stringify(p3Before.geometry);

  await sendJSON(`/api/parcels/${p3Before.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    reviewer_name: 'Lead Cadastral Surveyor',
    comments: 'Accepted without modifications'
  });

  const p3After = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels.find(p => p.parcel_id === 'PM-650907-0003');
  assert.strictEqual(JSON.stringify(p3After.geometry), p3GeomBefore, 'Unedited parcel geometry must remain identical');
  assert.strictEqual(p3After.status, 'accepted');
  console.log('[PASS] Accept without edit preserved geometry identically.');

  // -------------------------------------------------------------------------
  // 6. Compare Displayed Fields Against Persisted Backend Data
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Backend Persistence & Data Integrity Comparison ---');
  const allParcels = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  for (const p of allParcels) {
    // 1. Version must match database versions
    const hist = (await get(`/api/parcels/${p.parcel_id}/history`)).data.history || [];
    const expectedVer = hist.length > 0 ? (hist[0].version || hist[0].version_number || 1) : 1;
    assert.strictEqual(p.version, expectedVer, `${p.parcel_id}: Version mismatch (api=${p.version}, db=${expectedVer})`);

    // 2. No fictional merge string in supporting features
    const hasBadMerge = (p.supporting_features || []).some(f => f.toLowerCase().includes('merged with'));
    assert.strictEqual(hasBadMerge, false, `${p.parcel_id}: Fictional merge string found in supporting_features`);

    // 3. Perimeter support sums to 100
    assert.strictEqual(p.supported_perimeter_pct + p.unsupported_perimeter_pct, 100, `${p.parcel_id}: Perimeter support must sum to 100%`);

    // 4. Source is valid
    const validSources = ['AI Generated', 'Human Edited', 'Spatial Reasoning'];
    const isValidSource = validSources.includes(p.source) || p.source.startsWith('Split from') || p.source.startsWith('Merged from');
    assert(isValidSource, `${p.parcel_id}: Source "${p.source}" is invalid`);
  }
  console.log(`[PASS] All ${allParcels.length} project parcels have 100% consistent metadata, versions, and lineage.`);

  console.log('\n================================================================');
  console.log('🎉 ALL METADATA, VERSIONING & EXPLAINABILITY TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
