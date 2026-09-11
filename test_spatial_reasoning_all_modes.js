async function test() {
  console.log('--- 1. Testing spatial reasoning on uploaded farmland image (proj_1789109656341) ---');
  let res = await fetch('http://localhost:3001/api/projects/proj_1789109656341/spatial-reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagery_id: 'img_1789109656345_761m' })
  });
  let data = await res.json();
  console.log('Project 1 Result:');
  console.log('Status:', data.status);
  console.log('Candidates count:', data.candidates_count);
  console.log('Diagnostic summary:', data.diagnostic_summary);
  if (data.candidates?.length > 0) {
    console.log('First candidate:');
    console.log('- ID:', data.candidates[0].id);
    console.log('- Status:', data.candidates[0].candidate_status);
    console.log('- Reason:', data.candidates[0].generation_reason);
    console.log('- Evidence:', JSON.stringify(data.candidates[0].supporting_evidence));
  }

  console.log('\n--- 2. Testing spatial reasoning on Wagholi georeferenced ortho (proj_wagholi_demo) ---');
  res = await fetch('http://localhost:3001/api/projects/proj_wagholi_demo/spatial-reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagery_id: 'img_wagholi_ortho' })
  });
  data = await res.json();
  console.log('Project Wagholi Result:');
  console.log('Status:', data.status);
  console.log('Candidates count:', data.candidates_count);
  console.log('Diagnostic summary:', data.diagnostic_summary);
  if (data.candidates?.length > 0) {
    console.log('Wagholi candidates summary:');
    data.candidates.forEach(c => {
      console.log(`- [${c.id}] ${c.candidate_status} (conf: ${c.confidence}): ${c.generation_reason}`);
    });
  }

  console.log('\n--- 3. Testing GIS Quality endpoint on Wagholi ---');
  const qcRes = await fetch('http://localhost:3001/api/projects/proj_wagholi_demo/gis-quality');
  const qcData = await qcRes.json();
  console.log('Wagholi GIS Quality:');
  console.log('- Total parcels:', qcData.total_parcels);
  console.log('- Valid polygons:', qcData.valid_polygons_count);
  console.log('- Invalid geometries:', qcData.invalid_geometries);
  console.log('- Overlaps:', qcData.overlapping_parcels);
  console.log('- Water overlaps:', qcData.water_overlaps_count);
  console.log('- Slivers:', qcData.sliver_parcels);
  console.log('- Ready for review:', qcData.ready_for_review);
}

test().catch(console.error);
