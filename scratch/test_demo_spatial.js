import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';

async function testDemo() {
  console.log('--- RUNNING SPATIAL REASONING ON PROJ_DEMO_COASTAL ---');
  const result = await RoadSpatialReasoningService.runSpatialReasoning('proj_demo_coastal', {
    imagery_id: 'img_demo_coastal'
  });

  console.log('Candidates count:', result.candidates_count);
  console.log('Diagnostic summary:', JSON.stringify(result.diagnostic_summary, null, 2));
  console.log('\nCandidates:');
  (result.candidates || []).forEach(p => {
    console.log(`  ${p.id}: status=${p.candidate_status}, area=${p.area_px}px, supp=${p.supported_edge_pct}%, unsupp=${p.unsupported_edge_pct}%, conf=${p.confidence}`);
    console.log(`    Reason: ${p.decision_reason}`);
  });
}

testDemo().catch(console.error);
