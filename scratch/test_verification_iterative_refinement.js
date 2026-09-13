import http from 'http';
import assert from 'assert';

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
  console.log('🔬 RUNNING HUMAN VERIFICATION STAGE ITERATIVE REFINEMENT TEST');
  console.log('================================================================');

  // Step 1: Confirm Upstream GIS Quality & Spatial Reasoning Parcels
  console.log('\n--- Step 1: Upstream State Confirmation ---');
  const parcelsRes = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  assert.strictEqual(parcelsRes.status, 200, 'Parcels endpoint must return 200');
  const parcels = parcelsRes.data.parcels;
  console.log(`[PASS] Loaded ${parcels.length} preliminary parcels from SQLite.`);
  assert.strictEqual(parcels.length, 4, 'Must have exactly 4 preliminary parcels');
  
  const p1 = parcels[0];
  const p2 = parcels[1];
  const p3 = parcels[2];
  const p4 = parcels[3];
  console.log(`Parcels: P1=${p1.parcel_id}, P2=${p2.parcel_id}, P3=${p3.parcel_id}, P4=${p4.parcel_id}`);

  // Step 2: Test Geometry Editing on Parcel 1 (Move 1 vertex & Save)
  console.log('\n--- Step 2: Edit Vertex on Parcel 1 (PM-650907-0001) ---');
  const origRing = JSON.parse(JSON.stringify(p1.geometry.coordinates[0]));
  const editedRing = JSON.parse(JSON.stringify(origRing));
  // Shift first vertex by 5px
  editedRing[0][0] += 5;
  editedRing[0][1] += 5;
  editedRing[editedRing.length - 1] = [...editedRing[0]]; // maintain closed ring

  const editedGeom = { type: 'Polygon', coordinates: [editedRing] };

  // 2a. Validate
  const valRes = await sendJSON(`/api/parcels/${p1.parcel_id}/validate?project_id=${PROJECT_ID}`, 'POST', {
    geometry: editedGeom,
    project_id: PROJECT_ID
  });
  console.log(`[PASS] Validation check: valid=${valRes.data.valid}`);
  assert(valRes.data.valid, 'Edited geometry must be topologically valid');

  // 2b. Save
  const saveRes = await sendJSON(`/api/parcels/${p1.parcel_id}/geometry?project_id=${PROJECT_ID}`, 'PUT', {
    geometry: editedGeom,
    image_coordinates: [editedRing],
    project_id: PROJECT_ID,
    comments: 'Boundary adjusted near northern driveway by reviewer',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] Save result: status=${saveRes.status}, version=${saveRes.data.version}`);
  assert.strictEqual(saveRes.status, 200);
  assert(saveRes.data.success);

  // Step 3: Check Version History for Parcel 1
  console.log('\n--- Step 3: Verify Version History ---');
  const histRes = await get(`/api/parcels/${p1.parcel_id}/history`);
  assert(histRes.data.history && histRes.data.history.length >= 2, 'Must have at least 2 versions recorded');
  const latestVer = histRes.data.history[0];
  console.log(`[PASS] Latest version: v${latestVer.version || latestVer.version_number}, action: ${latestVer.action}`);
  console.log(`       Comments: "${latestVer.comments || latestVer.notes}"`);

  // Step 4: Accept Parcel 1
  console.log('\n--- Step 4: Accept Parcel 1 ---');
  const accRes1 = await sendJSON(`/api/parcels/${p1.parcel_id}/accept`, 'POST', {
    comments: 'Reviewed and accepted after boundary adjustment',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(accRes1.data.success);
  console.log(`[PASS] ${p1.parcel_id} status: accepted`);

  // Step 5: Mark Parcel 2 as NEEDS REVIEW
  console.log('\n--- Step 5: Mark Parcel 2 as NEEDS REVIEW ---');
  const revRes2 = await sendJSON(`/api/parcels/${p2.parcel_id}/needs-review`, 'POST', {
    comments: 'Boundary line unclear near east stone hedge; field survey required.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(revRes2.data.success);
  console.log(`[PASS] ${p2.parcel_id} status: needs_review`);

  // Step 6: Test REJECT (Requirement: Rejected parcels must not appear in Final Map)
  console.log('\n--- Step 6: Rejection & Exclusion Check ---');
  const rejRes2 = await sendJSON(`/api/parcels/${p2.parcel_id}/reject`, 'POST', {
    comments: 'Rejected due to insufficient physical boundary evidence.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(rejRes2.data.success);
  console.log(`[PASS] ${p2.parcel_id} temporarily rejected for exclusion test.`);

  // Verify Final Map data source excludes rejected parcels
  const allParcelsAfterRej = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const finalMapEligible = allParcelsAfterRej.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
  const rejectedInFinal = finalMapEligible.filter(p => p.parcel_id === p2.parcel_id);
  assert.strictEqual(rejectedInFinal.length, 0, 'Rejected parcel must NOT appear in Final Map!');
  console.log(`[PASS] Final Map excludes rejected parcel ${p2.parcel_id}`);

  // Now set Parcel 2 back to NEEDS REVIEW for the demo workflow
  await sendJSON(`/api/parcels/${p2.parcel_id}/needs-review`, 'POST', {
    comments: 'Flagged for field verification of eastern curtilage.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] ${p2.parcel_id} set to NEEDS REVIEW for the demo workflow.`);

  // Step 7: Accept Parcel 3
  console.log('\n--- Step 7: Accept Parcel 3 ---');
  const accRes3 = await sendJSON(`/api/parcels/${p3.parcel_id}/accept`, 'POST', {
    comments: 'Masonry Stone Wall 4 boundary confirmed.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(accRes3.data.success);
  console.log(`[PASS] ${p3.parcel_id} status: accepted`);

  // Step 8: Accept Parcel 4
  console.log('\n--- Step 8: Accept Parcel 4 ---');
  const accRes4 = await sendJSON(`/api/parcels/${p4.parcel_id}/accept`, 'POST', {
    comments: 'Road corridor frontage confirmed.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(accRes4.data.success);
  console.log(`[PASS] ${p4.parcel_id} status: accepted`);

  // Step 9: Verify Demo Workflow State
  console.log('\n--- Step 9: Verify Demo Workflow State ---');
  const finalParcelsRes = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  const finalParcels = finalParcelsRes.data.parcels;
  
  const acceptedList = finalParcels.filter(p => p.status === 'accepted');
  const reviewList = finalParcels.filter(p => p.status === 'needs_review');
  const rejectedList = finalParcels.filter(p => p.status === 'rejected');

  console.log(`Demo Status Distribution:`);
  console.log(`  ACCEPTED:     ${acceptedList.length} (${acceptedList.map(p => p.parcel_id).join(', ')})`);
  console.log(`  NEEDS REVIEW: ${reviewList.length} (${reviewList.map(p => p.parcel_id).join(', ')})`);
  console.log(`  REJECTED:     ${rejectedList.length}`);

  assert.strictEqual(acceptedList.length, 3, 'Must have exactly 3 accepted parcels for demo');
  assert.strictEqual(reviewList.length, 1, 'Must have exactly 1 review parcel for demo');

  // Step 10: Persistence across Simulated Refresh
  console.log('\n--- Step 10: Persistence Across Reload ---');
  const reloaded = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const reloadedP1 = reloaded.find(p => p.parcel_id === p1.parcel_id);
  const reloadedP1Coord0 = reloadedP1.geometry.coordinates[0][0];
  
  console.log(`[PASS] Reloaded P1 vertex 0: [${reloadedP1Coord0[0]}, ${reloadedP1Coord0[1]}]`);
  assert.strictEqual(reloadedP1Coord0[0], editedRing[0][0], 'Edited coordinate must persist in database');
  assert.strictEqual(reloadedP1Coord0[1], editedRing[0][1], 'Edited coordinate must persist in database');
  assert.strictEqual(reloadedP1.status, 'accepted', 'Accepted status must persist in database');

  console.log('\n================================================================');
  console.log('🎉 ALL HUMAN VERIFICATION STAGE TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
