// scratch/test_spatial_reasoning_on_upload.js
import fs from 'fs';
import path from 'path';
import { db } from '../server/db/database.js';
import { DetectionService } from '../server/services/aiDetectionService.js';
import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';

async function testUploadReasoning() {
  console.log('--- Testing Spatial Reasoning on Fresh Upload Project ---');
  
  // 1. Create project
  const proj = db.createProject({
    name: 'Spatial Reasoning Test Project ' + Date.now(),
    location: 'Purandar, Pune',
    coordinates: [18.28, 73.95],
    project_type: 'Rural Cadastral Mapping'
  });
  console.log('Project created:', proj.id);

  // 2. Ingest real image
  const srcImgPath = path.join(process.cwd(), 'test_assets', 'purandar_flight_01_farmland.png');
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const destName = `uav_test_${Date.now()}.png`;
  const destPath = path.join(uploadsDir, destName);
  fs.copyFileSync(srcImgPath, destPath);

  const img = db.addImagery({
    project_id: proj.id,
    file_name: 'purandar_flight_01_farmland.png',
    file_url: `/uploads/${destName}`,
    width: 600,
    height: 450,
    file_size: '10 KB',
    mime_type: 'image/png'
  });
  console.log('Imagery added:', img.id, img.file_url);

  // 3. Run AI Detection
  console.log('Running AI Feature Detection on uploaded image...');
  const detectRes = await DetectionService.runDetection(proj.id, {
    imagery_id: img.id,
    mode: 'auto'
  });
  console.log('Detection complete! Found features:', detectRes.features_count);
  console.log('Breakdown:', detectRes.summary);

  // 4. Run Spatial Reasoning
  console.log('\nRunning Spatial Reasoning Pipeline...');
  const reasoningRes = await RoadSpatialReasoningService.runSpatialReasoning(proj.id, {
    imagery_id: img.id
  });

  console.log('Spatial Reasoning Candidates Count:', reasoningRes.candidates_count);
  console.log('Diagnostic Summary:', reasoningRes.diagnostic_summary);
  console.log('Rejections:', reasoningRes.rejected_detections);

  reasoningRes.candidates.forEach((c, idx) => {
    console.log(`\nCandidate [${idx + 1}]: ID: ${c.id}`);
    console.log(`  Confidence: ${c.confidence} (${c.confidence_label}) - Status: ${c.candidate_status}`);
    console.log(`  Reason: ${c.generation_reason}`);
    console.log(`  Supporting Evidence:`, JSON.stringify(c.supporting_evidence, null, 2));
    console.log(`  Area px: ${c.area_px}`);
  });

  process.exit(0);
}

testUploadReasoning().catch(err => {
  console.error(err);
  process.exit(1);
});
