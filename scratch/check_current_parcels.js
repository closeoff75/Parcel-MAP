import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';

async function run() {
  const res = await RoadSpatialReasoningService.runSpatialReasoning('proj_demo_coastal');
  console.log('Result status:', res.status);
  console.log('Candidates count:', res.candidates_count);
  res.candidates.forEach(c => {
    console.log(`\nParcel ${c.id}: status=${c.status} (${c.candidate_status}), conf=${c.confidence}`);
    console.log(`- Supported: ${c.supported_perimeter_pct}%, Unsupported: ${c.unsupported_perimeter_pct}%`);
    console.log(`- Supporting features:`, c.supporting_features);
    console.log(`- Supporting evidence:`, JSON.stringify(c.supporting_evidence));
    console.log(`- Coords:`, JSON.stringify(c.geometry.coordinates[0]));
  });
}
run().catch(console.error);
