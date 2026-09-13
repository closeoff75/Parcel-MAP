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
  console.log('🧪 VERIFYING: EDITED PARCEL PERSISTENCE ACROSS SAVE, ACCEPT & REFRESH');
  console.log('================================================================');

  // Load current preliminary parcels
  const initialRes = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  assert.strictEqual(initialRes.status, 200);
  const initialParcels = initialRes.data.parcels;
  console.log(`[PASS] Loaded ${initialParcels.length} parcels from backend.`);

  const p1 = initialParcels.find(p => p.parcel_id === 'PM-650907-0001');
  assert(p1, 'Parcel PM-650907-0001 must exist');
  const originalVertex0 = [...p1.geometry.coordinates[0][0]];
  console.log(`Initial P1 vertex 0: [${originalVertex0[0]}, ${originalVertex0[1]}]`);

  // =======================================================================
  // TEST 1: The Mandatory 9-Step Refresh Test (Requirement 6)
  // =======================================================================
  console.log('\n--- TEST 1: Mandatory 9-Step Refresh & Edit-Save-Accept Test ---');
  
  // 1. Move vertex significantly (shift by +15px)
  const targetX = Math.round(originalVertex0[0] + 15);
  const targetY = Math.round(originalVertex0[1] + 15);
  const editedRing1 = JSON.parse(JSON.stringify(p1.geometry.coordinates[0]));
  editedRing1[0] = [targetX, targetY];
  editedRing1[editedRing1.length - 1] = [targetX, targetY]; // maintain closure
  const editedGeom1 = { type: 'Polygon', coordinates: [editedRing1] };

  // 2. Validate
  const valRes1 = await sendJSON(`/api/parcels/${p1.parcel_id}/validate?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    geometry: editedGeom1,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID
  });
  assert(valRes1.data.valid, 'Geometry must be valid');

  // 3. Save
  const saveRes1 = await sendJSON(`/api/parcels/${p1.parcel_id}/geometry?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'PUT', {
    geometry: editedGeom1,
    image_coordinates: [editedRing1],
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Surveyor moved vertex by +15px for visible boundary adjustment',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert.strictEqual(saveRes1.status, 200);
  assert(saveRes1.data.success);
  console.log(`[PASS] Step 3: Saved vertex edit to backend. Version: v${saveRes1.data.version}`);

  // 4. Refresh / Reload from backend
  const reload1 = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const p1AfterSave = reload1.find(p => p.parcel_id === p1.parcel_id);
  console.log(`[PASS] Step 4 & 5: Reloaded from backend. Vertex 0 is: [${p1AfterSave.geometry.coordinates[0][0][0]}, ${p1AfterSave.geometry.coordinates[0][0][1]}]`);
  assert.strictEqual(p1AfterSave.geometry.coordinates[0][0][0], targetX, 'Edited X must persist after save & refresh');
  assert.strictEqual(p1AfterSave.geometry.coordinates[0][0][1], targetY, 'Edited Y must persist after save & refresh');

  // 6. Click ACCEPT
  const acceptRes1 = await sendJSON(`/api/parcels/${p1.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    geometry: p1AfterSave.geometry,
    comments: 'Surveyor verified preliminary boundary with modified vertex',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert.strictEqual(acceptRes1.status, 200);
  assert(acceptRes1.data.success);
  console.log(`[PASS] Step 6: Accepted parcel.`);

  // 7. Confirm geometry remains edited immediately in returned parcel
  const returnedGeom = acceptRes1.data.parcel.geometry.coordinates[0][0];
  console.log(`[PASS] Step 7: Post-accept returned vertex 0 is: [${returnedGeom[0]}, ${returnedGeom[1]}]`);
  assert.strictEqual(returnedGeom[0], targetX, 'Vertex must NOT revert after accept');
  assert.strictEqual(returnedGeom[1], targetY, 'Vertex must NOT revert after accept');

  // 8. Refresh again
  const reload2 = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const p1AfterAccept = reload2.find(p => p.parcel_id === p1.parcel_id);
  console.log(`[PASS] Step 8 & 9: Post-accept reloaded vertex 0 is: [${p1AfterAccept.geometry.coordinates[0][0][0]}, ${p1AfterAccept.geometry.coordinates[0][0][1]}]`);
  assert.strictEqual(p1AfterAccept.geometry.coordinates[0][0][0], targetX, 'Edited X must persist after second refresh');
  assert.strictEqual(p1AfterAccept.geometry.coordinates[0][0][1], targetY, 'Edited Y must persist after second refresh');
  assert.strictEqual(p1AfterAccept.status, 'accepted', 'Status must be ACCEPTED');

  // =======================================================================
  // TEST 2: Direct Edit -> ACCEPT without separate Save click (Requirement 2)
  // =======================================================================
  console.log('\n--- TEST 2: Direct Edit -> ACCEPT Workflow ---');
  // Edit Parcel 3 (PM-650907-0003)
  const p3 = reload2.find(p => p.parcel_id === 'PM-650907-0003');
  const p3OrigX = p3.geometry.coordinates[0][0][0];
  const p3OrigY = p3.geometry.coordinates[0][0][1];
  const p3NewX = p3OrigX + 10;
  const p3NewY = p3OrigY + 10;

  const editedRing3 = JSON.parse(JSON.stringify(p3.geometry.coordinates[0]));
  editedRing3[0] = [p3NewX, p3NewY];
  editedRing3[editedRing3.length - 1] = [p3NewX, p3NewY];
  const editedGeom3 = { type: 'Polygon', coordinates: [editedRing3] };

  // Send accept with the newly edited geometry payload directly
  const directAcceptRes = await sendJSON(`/api/parcels/${p3.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    geometry: editedGeom3,
    comments: 'Accepting directly with edited boundary geometry',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(directAcceptRes.data.success);
  assert.strictEqual(directAcceptRes.data.parcel.geometry.coordinates[0][0][0], p3NewX);

  // Reload and confirm persistence
  const reload3 = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const p3Reloaded = reload3.find(p => p.parcel_id === p3.parcel_id);
  assert.strictEqual(p3Reloaded.geometry.coordinates[0][0][0], p3NewX, 'Directly accepted geometry must persist');
  assert.strictEqual(p3Reloaded.status, 'accepted', 'Directly accepted status must be accepted');
  console.log(`[PASS] Direct Edit -> ACCEPT persisted vertex 0: [${p3NewX}, ${p3NewY}], status: accepted`);

  // =======================================================================
  // TEST 3: Accept Without Edit Test (Requirement 7)
  // =======================================================================
  console.log('\n--- TEST 3: Accept Without Edit Test ---');
  const p4 = reload3.find(p => p.parcel_id === 'PM-650907-0004');
  const p4Before = JSON.stringify(p4.geometry);
  await sendJSON(`/api/parcels/${p4.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Accepted without geometry modifications',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  const p4After = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels.find(p => p.parcel_id === p4.parcel_id);
  assert.strictEqual(JSON.stringify(p4After.geometry), p4Before, 'Unedited parcel geometry must remain identical');
  assert.strictEqual(p4After.status, 'accepted');
  console.log('[PASS] Accept without edit preserved geometry exactly.');

  // =======================================================================
  // TEST 4: Edit -> Needs Review -> Refresh Test
  // =======================================================================
  console.log('\n--- TEST 4: Edit -> Needs Review -> Refresh Test ---');
  const p2 = reload3.find(p => p.parcel_id === 'PM-650907-0002');
  const p2OrigX = p2.geometry.coordinates[0][0][0];
  const p2NewX = p2OrigX + 8;
  const p2NewY = p2.geometry.coordinates[0][0][1] + 8;
  const editedRing2 = JSON.parse(JSON.stringify(p2.geometry.coordinates[0]));
  editedRing2[0] = [p2NewX, p2NewY];
  editedRing2[editedRing2.length - 1] = [p2NewX, p2NewY];
  const editedGeom2 = { type: 'Polygon', coordinates: [editedRing2] };

  await sendJSON(`/api/parcels/${p2.parcel_id}/needs-review?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    geometry: editedGeom2,
    comments: 'Boundary adjusted then marked for ground survey confirmation',
    reviewer_name: 'Lead Cadastral Surveyor'
  });

  const p2Reloaded = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels.find(p => p.parcel_id === p2.parcel_id);
  assert.strictEqual(p2Reloaded.geometry.coordinates[0][0][0], p2NewX, 'Needs-review parcel must preserve edited geometry');
  assert.strictEqual(p2Reloaded.status, 'needs_review', 'Status must be needs_review');
  console.log('[PASS] Edit -> Needs Review persisted geometry and status.');

  // =======================================================================
  // TEST 5: Final Map Handoff: Only Accepted Parcels Enter Final Map
  // =======================================================================
  console.log('\n--- TEST 5: Final Map Handoff Verification ---');
  const allCurrent = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const finalMapParcels = allCurrent.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
  const finalMapIds = finalMapParcels.map(p => p.parcel_id);
  console.log(`Final Map Parcels: [${finalMapIds.join(', ')}]`);

  assert.strictEqual(finalMapParcels.length, 3, 'Must have exactly 3 accepted parcels in Final Map');
  assert(finalMapIds.includes('PM-650907-0001'), 'PM-650907-0001 must be in Final Map');
  assert(finalMapIds.includes('PM-650907-0003'), 'PM-650907-0003 must be in Final Map');
  assert(finalMapIds.includes('PM-650907-0004'), 'PM-650907-0004 must be in Final Map');
  assert(!finalMapIds.includes('PM-650907-0002'), 'PM-650907-0002 (Needs Review) must NOT enter Final Map');

  // Verify that the geometry in Final Map is the EDITED geometry
  const p1Final = finalMapParcels.find(p => p.parcel_id === 'PM-650907-0001');
  assert.strictEqual(p1Final.geometry.coordinates[0][0][0], targetX, 'Final Map must use the EDITED geometry, not pre-edit!');
  console.log(`[PASS] Final Map parcel PM-650907-0001 contains the EDITED vertex [${targetX}, ${targetY}]!`);

  // =======================================================================
  // TEST 6: Version History Verification (Requirement 5)
  // =======================================================================
  console.log('\n--- TEST 6: Version History Verification ---');
  const histRes = await get(`/api/parcels/PM-650907-0001/history`);
  assert(histRes.data.history && histRes.data.history.length >= 2, 'Must have at least 2 versions in history');
  const latestVer = histRes.data.history[0];
  console.log(`[PASS] Latest version recorded: v${latestVer.version || latestVer.version_number}, action: ${latestVer.action}`);

  console.log('\n================================================================');
  console.log('🎉 ALL PERSISTENCE AND GEOMETRY INTEGRITY TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
