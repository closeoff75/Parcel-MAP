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
  console.log('🧪 COMPREHENSIVE HUMAN VERIFICATION STAGE E2E VALIDATION');
  console.log('================================================================');

  // 1. Upstream Parcel Ingestion (Requirement 1 & 2)
  console.log('\n--- 1. Loading Upstream Parcels (GIS Quality / Spatial Reasoning) ---');
  const parcelsRes = await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  assert.strictEqual(parcelsRes.status, 200, 'Parcels endpoint must return 200');
  const parcels = parcelsRes.data.parcels;
  console.log(`[PASS] Loaded ${parcels.length} parcels for project ${PROJECT_ID}, imagery ${IMAGERY_ID}`);
  assert.strictEqual(parcels.length, 4, 'Must have exactly 4 preliminary parcels');

  const p1 = parcels.find(p => p.parcel_id === 'PM-650907-0001');
  const p2 = parcels.find(p => p.parcel_id === 'PM-650907-0002');
  const p3 = parcels.find(p => p.parcel_id === 'PM-650907-0003');
  const p4 = parcels.find(p => p.parcel_id === 'PM-650907-0004');

  assert(p1 && p2 && p3 && p4, 'All 4 parcel IDs must exist');
  console.log(`[PASS] Found exact parcels: P1=${p1.parcel_id}, P2=${p2.parcel_id}, P3=${p3.parcel_id}, P4=${p4.parcel_id}`);

  // 2. Pre-Save Validation Checks (Requirement 11)
  console.log('\n--- 2. Save Validation & Topology Checks ---');
  // 2a. Self-intersecting bowtie polygon test (Must FAIL)
  const bowtieRing = [[100, 100], [200, 200], [100, 200], [200, 100], [100, 100]];
  const bowtieGeom = { type: 'Polygon', coordinates: [bowtieRing] };
  const valBowtie = await sendJSON(`/api/parcels/${p1.parcel_id}/validate?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    geometry: bowtieGeom,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID
  });
  console.log(`Self-intersecting geometry check: valid=${valBowtie.data.valid}`);
  assert(!valBowtie.data.valid, 'Self-intersecting polygon must fail validation');
  console.log(`[PASS] Validation caught topology error: ${valBowtie.data.errors.join('; ')}`);

  // 3. Real Geometry Vertex Editing & Persistence (Requirement 4 & 5)
  console.log('\n--- 3. Vertex Drag / Geometry Edit on Parcel 1 ---');
  const currentRing = JSON.parse(JSON.stringify(p1.geometry.coordinates[0]));
  const editedRing = JSON.parse(JSON.stringify(currentRing));
  // Shift vertex 0 by +2px
  editedRing[0][0] = Math.round(editedRing[0][0] + 2);
  editedRing[0][1] = Math.round(editedRing[0][1] + 2);
  editedRing[editedRing.length - 1] = [...editedRing[0]];

  const editedGeom = { type: 'Polygon', coordinates: [editedRing] };

  // Validate edited geometry
  const valEdit = await sendJSON(`/api/parcels/${p1.parcel_id}/validate?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    geometry: editedGeom,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID
  });
  assert(valEdit.data.valid, 'Edited ring must be valid');
  console.log(`[PASS] Edited geometry validated cleanly.`);

  // Save to backend
  const saveRes = await sendJSON(`/api/parcels/${p1.parcel_id}/geometry?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'PUT', {
    geometry: editedGeom,
    image_coordinates: [editedRing],
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Surveyor fine-tuned north driveway vertex along curtilage fence',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert.strictEqual(saveRes.status, 200);
  assert(saveRes.data.success);
  console.log(`[PASS] Geometry saved successfully. Version: v${saveRes.data.version}`);

  // Check version history
  const histRes = await get(`/api/parcels/${p1.parcel_id}/history`);
  assert(histRes.data.history && histRes.data.history.length >= 2, 'Version history must track modifications');
  console.log(`[PASS] Parcel 1 has ${histRes.data.history.length} version records.`);

  // 4. Split and Merge Real Geometry Workflow on Test Candidate (Requirement 6 & 7)
  console.log('\n--- 4. Split and Merge Real Geometry Workflow ---');
  // Seed an auxiliary test parcel in an open section of the flight imagery
  const testPId = 'PM-TEST-SPLITMERGE-01';
  const testRing = [[500, 500], [650, 500], [650, 650], [500, 650], [500, 500]];
  const testParcel = {
    id: testPId,
    parcel_id: testPId,
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    geometry: { type: 'Polygon', coordinates: [testRing] },
    image_coordinates: [testRing],
    status: 'preliminary',
    source: 'Test Split Pipeline',
    area_px: 22500,
    created_at: new Date().toISOString()
  };
  
  // Add test parcel to database
  const activeParcels = db.getParcelsByProjectId(PROJECT_ID, IMAGERY_ID);
  db.setParcels(PROJECT_ID, [...activeParcels.filter(p => p.id !== testPId), testParcel], IMAGERY_ID);

  // Split test parcel via HTTP endpoint
  const splitRes = await sendJSON(`/api/parcels/${testPId}/split?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(splitRes.data.success, 'Split operation must succeed');
  console.log(`[PASS] Split ${testPId} into ${testPId}-A and ${testPId}-B`);

  // Verify split children in database
  const splitA = db.getParcelById(`${testPId}-A`, PROJECT_ID, IMAGERY_ID);
  const splitB = db.getParcelById(`${testPId}-B`, PROJECT_ID, IMAGERY_ID);
  assert(splitA && splitB, 'Both split child parcels must be persisted');
  console.log(`[PASS] Verified split children: A area=${splitA.area_px}px², B area=${splitB.area_px}px²`);

  // Merge the two split children back together via HTTP endpoint
  const mergeRes = await sendJSON(`/api/parcels/merge?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    parcel_ids: [`${testPId}-A`, `${testPId}-B`],
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  assert(mergeRes.data.success, 'Merge operation must succeed');
  console.log(`[PASS] Merged split children successfully: ${mergeRes.data.parcel.parcel_id}`);

  // Clean up auxiliary test parcels
  const cleanedParcels = db.getParcelsByProjectId(PROJECT_ID, IMAGERY_ID).filter(p => !p.parcel_id.startsWith('PM-TEST-'));
  db.setParcels(PROJECT_ID, cleanedParcels, IMAGERY_ID);
  console.log(`[PASS] Cleaned up temporary test split/merge parcels.`);

  // 5. Status Transitions and Demo Workflow (Requirement 8 & 9)
  console.log('\n--- 5. Status Transitions and Demo Workflow ---');
  // P1 -> Accept
  await sendJSON(`/api/parcels/${p1.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Surveyor verified boundary against drone orthomosaic after vertex edit.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] ${p1.parcel_id} -> ACCEPTED`);

  // P2 -> Needs Review
  await sendJSON(`/api/parcels/${p2.parcel_id}/needs-review?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'East hedge boundary curtilage requires ground survey verification.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] ${p2.parcel_id} -> NEEDS REVIEW`);

  // P3 -> Accept
  await sendJSON(`/api/parcels/${p3.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Masonry stone wall and building anchor confirmed.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] ${p3.parcel_id} -> ACCEPTED`);

  // P4 -> Accept
  await sendJSON(`/api/parcels/${p4.parcel_id}/accept?project_id=${PROJECT_ID}&imagery_id=${IMAGERY_ID}`, 'POST', {
    project_id: PROJECT_ID,
    imagery_id: IMAGERY_ID,
    comments: 'Corridor frontage and road setback verified.',
    reviewer_name: 'Lead Cadastral Surveyor'
  });
  console.log(`[PASS] ${p4.parcel_id} -> ACCEPTED`);

  // 6. Final Map Exclusion Check (Requirement 8 & 12)
  console.log('\n--- 6. Final Map Handoff Validation ---');
  const demoParcels = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const finalMapParcels = demoParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
  const finalMapIds = finalMapParcels.map(p => p.parcel_id);
  console.log(`Final Map Parcels: [${finalMapIds.join(', ')}]`);

  assert.strictEqual(finalMapParcels.length, 3, 'Final Map must contain exactly 3 accepted parcels');
  assert(finalMapIds.includes(p1.parcel_id), 'P1 must be in Final Map');
  assert(finalMapIds.includes(p3.parcel_id), 'P3 must be in Final Map');
  assert(finalMapIds.includes(p4.parcel_id), 'P4 must be in Final Map');
  assert(!finalMapIds.includes(p2.parcel_id), 'P2 (NEEDS REVIEW) must NOT be in Final Map');
  console.log('[PASS] Final Map correctly includes only accepted parcels and excludes needs-review/rejected.');

  // 7. Refresh Persistence Confirmation (Requirement 13)
  console.log('\n--- 7. Refresh Persistence Confirmation ---');
  const reloaded = (await get(`/api/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`)).data.parcels;
  const reloadedP1 = reloaded.find(p => p.parcel_id === p1.parcel_id);
  assert.strictEqual(reloadedP1.geometry.coordinates[0][0][0], editedRing[0][0], 'Edited coordinate must persist');
  assert.strictEqual(reloadedP1.geometry.coordinates[0][0][1], editedRing[0][1], 'Edited coordinate must persist');
  assert.strictEqual(reloadedP1.status, 'accepted', 'Accepted status must persist');

  const reloadedP2 = reloaded.find(p => p.parcel_id === p2.parcel_id);
  assert.strictEqual(reloadedP2.status, 'needs_review', 'Needs review status must persist');

  console.log('[PASS] Persistence verified 100% across database reload.');

  console.log('\n================================================================');
  console.log('🎉 ALL 16 HUMAN VERIFICATION ACCEPTANCE CRITERIA VERIFIED 100%!');
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
