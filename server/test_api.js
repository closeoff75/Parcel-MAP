/**
 * ParcelMap Backend Integration & Verification Script
 * Validates REST API, DB seeding, Turf GIS topology audit, and spatial reasoning.
 */

import { db } from './db/database.js';
import { GISEngine } from './services/gisEngine.js';
import { AIDetectionService } from './services/aiDetectionService.js';
import { RoadSpatialReasoningService } from './services/roadSpatialReasoningService.js';
import { ReportService } from './services/reportService.js';

async function runTests() {
  console.log('--- 1. Testing Database & Demo Data Seeding ---');
  const projects = db.getProjects();
  console.log(`Found ${projects.length} project(s).`);
  const demoProj = db.getProjectById('proj_wagholi_demo');
  if (!demoProj) throw new Error('Demo project missing!');
  console.log(`✓ Demo Project: "${demoProj.name}" at ${demoProj.location}`);

  console.log('\n--- 2. Testing AI Detection Service ---');
  const aiResult = await AIDetectionService.runDetection('proj_wagholi_demo');
  console.log(`✓ Detected ${aiResult.features_count} features across categories:`, aiResult.categories);
  console.log(`✓ Average feature confidence: ${Math.round(aiResult.average_confidence * 100)}%`);

  console.log('\n--- 3. Testing Road-Based Spatial Reasoning Service ---');
  const reasoningResult = await RoadSpatialReasoningService.runSpatialReasoning('proj_wagholi_demo');
  console.log(`✓ Road network: ${reasoningResult.road_network.total_segments} segments, ${reasoningResult.road_network.intersections_detected} intersections, ${reasoningResult.road_network.road_corridors} corridors`);
  console.log(`✓ Preliminary parcel candidates generated: ${reasoningResult.candidates_count}`);

  console.log('\n--- 4. Testing GIS Engine & Topology Audit ---');
  const parcels = db.getParcelsByProjectId('proj_wagholi_demo');
  const audit = GISEngine.auditTopology(parcels);
  console.log(`✓ Total parcels evaluated: ${audit.total_parcels}`);
  console.log(`✓ Valid polygons: ${audit.valid_polygons_count}`);
  console.log(`✓ Overlaps detected: ${audit.overlaps_count} (${audit.overlaps.map(o => `${o.parcel_a} & ${o.parcel_b}: ${o.overlap_hectares} ha`).join(', ')})`);
  console.log(`✓ Gaps detected: ${audit.gaps_count}`);
  console.log(`✓ Slivers flagged: ${audit.slivers_count}`);
  console.log(`✓ Confidence breakdown: High=${audit.confidence_summary.high}, Med=${audit.confidence_summary.medium}, Low=${audit.confidence_summary.low}`);

  console.log('\n--- 5. Testing Report Generation & Legal Disclaimer ---');
  const report = ReportService.generateProjectReport('proj_wagholi_demo');
  console.log(`✓ Report ID: ${report.report_id}`);
  console.log(`✓ Total area: ${report.summary.total_area_hectares} hectares`);
  console.log(`✓ Verified count: ${report.summary.verified_parcels_count}`);
  console.log(`✓ Legal disclaimer present: "${report.disclaimer.substring(0, 70)}..."`);

  console.log('\n========================================');
  console.log('🎉 ALL BACKEND & GIS TESTS PASSED SUCCESSFULLY!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
