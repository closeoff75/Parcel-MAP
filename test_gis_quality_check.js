async function run() {
  console.log('Testing GIS Quality for project proj_1789109656341...');
  const res = await fetch('http://localhost:3001/api/projects/proj_1789109656341/gis-quality');
  const body = await res.json();
  console.log('Status:', res.status);
  console.log('Response summary:');
  console.log('- success:', body.success);
  console.log('- total_parcels:', body.total_parcels);
  console.log('- valid_parcels:', body.valid_parcels);
  console.log('- invalid_geometries:', body.invalid_geometries);
  console.log('- overlapping_parcels:', body.overlapping_parcels);
  console.log('- possible_gaps:', body.possible_gaps);
  console.log('- water_overlaps:', body.water_overlaps_count);
  console.log('- sliver_parcels:', body.sliver_parcels);
  console.log('- ready_for_review:', body.ready_for_review);
  console.log('- issues count:', body.issues?.length);

  console.log('\nTesting Parcels Endpoint:');
  const pRes = await fetch('http://localhost:3001/api/projects/proj_1789109656341/parcels');
  const pBody = await pRes.json();
  console.log('Parcels count:', pBody.count);
  if (pBody.parcels?.length > 0) {
    const p = pBody.parcels[0];
    console.log('First parcel:', {
      id: p.id,
      confidence: p.confidence,
      candidate_status: p.candidate_status,
      generation_reason: p.generation_reason,
      supporting_evidence: p.supporting_evidence
    });
  }
}

run().catch(console.error);
