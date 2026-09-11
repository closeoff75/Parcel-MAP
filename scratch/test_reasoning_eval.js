import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';
import { db } from '../server/db/database.js';

async function test() {
  const projectId = 'proj_1789117650907';
  const imageryId = 'img_1789118184412_8b81';

  console.log('--- RUNNING SPATIAL REASONING ON ACTIVE PROJECT ---');
  const result = await RoadSpatialReasoningService.runSpatialReasoning(projectId, {
    imagery_id: imageryId
  });

  console.log('\nPipeline result:');
  console.log('Success:', result.success);
  console.log('Candidates count:', result.candidates_count);
  console.log('Diagnostic summary:', JSON.stringify(result.diagnostic_summary, null, 2));

  console.log('\nPreliminary Parcels breakdown:');
  (result.candidates || []).forEach(p => {
    console.log(`\nParcel: ${p.id} (${p.candidate_status}) | Area: ${p.area_px} px² | Conf: ${p.confidence}`);
    console.log(`  Supported edge: ${p.supported_edge_pct}% | Unsupported: ${p.unsupported_edge_pct}%`);
    console.log(`  Decision reason: ${p.decision_reason}`);
    console.log(`  Supporting features: ${p.supporting_features?.join('; ')}`);
  });

  console.log('\nRejections sample (first 5):');
  (result.diagnostic_summary.rejections_list || []).slice(0, 5).forEach(r => {
    console.log(`  [${r.category}] ${r.parcel_id || r.class}: ${r.reason}`);
  });
}

test().catch(console.error);
