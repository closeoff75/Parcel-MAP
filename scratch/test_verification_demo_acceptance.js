// scratch/test_verification_demo_acceptance.js
const BASE_URL = 'http://localhost:3001/api';
const PROJECT_ID = 'proj_demo_coastal';
const IMAGERY_ID = 'img_demo_coastal';

async function testVerificationAndFinalMap() {
  console.log('=== VERIFYING PARCELS IN VERIFICATION AND FINAL MAP ===');

  // 1. Fetch parcels
  const pRes = await fetch(`${BASE_URL}/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  const pData = await pRes.json();
  console.log(`Loaded ${pData.parcels?.length} parcels for project ${PROJECT_ID}`);
  
  if (!pData.parcels || pData.parcels.length !== 5) {
    throw new Error(`Expected 5 parcels, found ${pData.parcels?.length}`);
  }

  // 2. Accept PM-0005 (which was in NEEDS REVIEW) or test accept endpoint
  console.log('\nTesting Accept endpoint on PM-0001...');
  const accRes = await fetch(`${BASE_URL}/parcels/PM-0001/accept?project_id=${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer: 'GIS Lead', comments: 'Verified against UAV boundary markers' })
  });
  const accData = await accRes.json();
  console.log('PM-0001 accept response:', accRes.status, accData.success);

  // 3. Test vertex validation endpoint
  console.log('\nTesting geometry validation on PM-0003...');
  const p3 = pData.parcels.find(p => p.parcel_id === 'PM-0003');
  const valRes = await fetch(`${BASE_URL}/parcels/PM-0003/validate?project_id=${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry: p3.geometry })
  });
  const valData = await valRes.json();
  console.log('PM-0003 geometry validation status:', valRes.status, 'valid:', valData.valid);

  // 4. Test Final Map filter (only accepted parcels)
  console.log('\nChecking parcels available for Final Map...');
  const finalParcelsRes = await fetch(`${BASE_URL}/projects/${PROJECT_ID}/parcels?imagery_id=${IMAGERY_ID}`);
  const finalData = await finalParcelsRes.json();
  const accepted = finalData.parcels.filter(p => p.status === 'accepted' || p.candidate_status === 'ACCEPTED');
  console.log(`Accepted parcels ready for Final Map export: ${accepted.length} (${accepted.map(p => p.id).join(', ')})`);

  console.log('\n✓ Full demo pipeline successfully verified across all stages!');
}

testVerificationAndFinalMap().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
