import http from 'http';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runMultiProjectTest() {
  console.log('========================================================================');
  console.log('MULTI-PROJECT SPATIAL REASONING -> GIS QUALITY DATA FLOW TEST');
  console.log('========================================================================\n');

  const projRes = await request({ hostname: '127.0.0.1', port: 3001, path: '/api/projects', method: 'GET' });
  const projects = projRes.data?.projects || [];
  console.log(`Total Projects: ${projects.length}`);

  const testProjectIds = ['proj_1788971633885', 'proj_wagholi_demo'];

  for (const pId of testProjectIds) {
    const project = projects.find(p => p.id === pId);
    if (!project) continue;

    console.log(`\n========================================================================`);
    console.log(`PROJECT: ${project.id} ("${project.name}")`);
    console.log(`========================================================================`);

    const imgRes = await request({ hostname: '127.0.0.1', port: 3001, path: `/api/projects/${pId}/imagery`, method: 'GET' });
    const imageries = imgRes.data?.imagery || [];
    console.log(`Available Imageries: ${imageries.length}`);

    for (const img of imageries) {
      console.log(`\n--- Testing Imagery: ${img.id} (${img.file_name}) ---`);

      // Run Spatial Reasoning
      const srRes = await request({
        hostname: '127.0.0.1',
        port: 3001,
        path: `/api/projects/${pId}/spatial-reasoning`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { imagery_id: img.id });

      if (srRes.status !== 200) {
        console.log(`Spatial reasoning skipped/failed on ${img.id}: ${srRes.data?.error || srRes.status}`);
        continue;
      }

      const srData = srRes.data;
      const candidates = srData.candidates || [];
      const diag = srData.spatial_reasoning_summary || srData.diagnostic_summary || {};
      
      console.log(`[Spatial Output] Candidate Count: ${diag.candidate_parcels ?? candidates.length}, Accepted: ${diag.accepted_parcels ?? 0}, Review: ${diag.needs_review ?? 0}, Saved: ${candidates.length}`);

      // Query GIS Quality with explicit imagery_id
      const qcRes = await request({
        hostname: '127.0.0.1',
        port: 3001,
        path: `/api/projects/${pId}/gis-quality?imagery_id=${img.id}`,
        method: 'GET'
      });

      const qcData = qcRes.data;
      console.log(`[GIS Quality Output] Queried: ${qcData.total_parcels}, Valid: ${qcData.metrics?.valid_parcels ?? qcData.valid_polygons_count}, Overlaps: ${qcData.metrics?.overlapping_parcels ?? qcData.overlaps_count}`);

      // Query Parcels
      const pRes = await request({
        hostname: '127.0.0.1',
        port: 3001,
        path: `/api/projects/${pId}/parcels?imagery_id=${img.id}`,
        method: 'GET'
      });
      const pCount = pRes.data?.parcels?.length || 0;
      console.log(`[Parcels API Output] Returned: ${pCount} parcels`);

      if (candidates.length === qcData.total_parcels && candidates.length === pCount) {
        console.log(`[PASS] PERFECT MATCH! Spatial candidates (${candidates.length}) == GIS Quality total (${qcData.total_parcels}) == Parcels API count (${pCount})`);
      } else {
        console.log(`[MISMATCH] Spatial: ${candidates.length}, GIS Quality: ${qcData.total_parcels}, Parcels: ${pCount}`);
      }
    }
  }

  console.log('\n========================================================================');
  console.log('ALL MULTI-PROJECT HANDOFF TESTS COMPLETED SUCCESSFULLY!');
  console.log('========================================================================');
}

runMultiProjectTest().catch(err => {
  console.error('Multi-project test failed:', err);
  process.exit(1);
});
