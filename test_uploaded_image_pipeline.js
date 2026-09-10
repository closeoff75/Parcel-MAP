import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const API_BASE = 'http://localhost:3001/api';

async function testPipeline() {
  console.log('--- 1. Testing Backend Health ---');
  const hRes = await fetch(`${API_BASE}/health`);
  const hData = await hRes.json();
  console.log('Health:', hData.status);

  console.log('\n--- 2. Creating New Project (Isolated from demo) ---');
  const pRes = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Solar Farm Survey Alpha',
      location: 'Chakan Industrial Zone, Pune',
      description: 'Pre-construction cadastral and boundary delineation survey',
      coordinates: [18.7562, 73.8540],
      project_type: 'Solar Infrastructure'
    })
  });
  const pData = await pRes.json();
  if (!pData.success) throw new Error('Failed to create project: ' + JSON.stringify(pData));
  const project = pData.project;
  console.log('Project created:', project.id, project.name, 'Status:', project.status);

  console.log('\n--- 3. Verifying New Project has Zero Imagery/Features Initially ---');
  const initImgRes = await fetch(`${API_BASE}/projects/${project.id}/imagery`);
  const initImgData = await initImgRes.json();
  console.log('Initial imagery count for project:', initImgData.imagery.length);
  if (initImgData.imagery.length !== 0) throw new Error('New project should have 0 imagery items!');

  console.log('\n--- 4. Preparing Test UAV Drone Image ---');
  const png = new PNG({ width: 200, height: 150 });
  for (let y = 0; y < 150; y++) {
    for (let x = 0; x < 200; x++) {
      const idx = (200 * y + x) << 2;
      // Background green pasture with brown soil plot
      if (x > 50 && x < 150 && y > 30 && y < 120) {
        png.data[idx] = 160;
        png.data[idx + 1] = 120;
        png.data[idx + 2] = 60;
      } else {
        png.data[idx] = 70;
        png.data[idx + 1] = 130;
        png.data[idx + 2] = 50;
      }
      png.data[idx + 3] = 255;
    }
  }
  const testImgPath = path.join(process.cwd(), 'scratch_test_drone_img.png');
  fs.writeFileSync(testImgPath, PNG.sync.write(png));

  console.log('\n--- 5. Uploading Test Image via POST /api/projects/:id/imagery ---');
  const blob = new Blob([fs.readFileSync(testImgPath)], { type: 'image/png' });
  const formData = new FormData();
  formData.append('imagery', blob, 'uav_solar_flight_01.png');
  formData.append('width', '4000');
  formData.append('height', '3000');

  const upRes = await fetch(`${API_BASE}/projects/${project.id}/imagery`, {
    method: 'POST',
    body: formData
  });
  const upData = await upRes.json();
  if (!upData.success) throw new Error('Upload failed: ' + JSON.stringify(upData));
  const uploadedImagery = upData.imagery;
  console.log('Upload success! Imagery ID:', uploadedImagery.id);
  console.log('File Name:', uploadedImagery.file_name);
  console.log('File URL:', uploadedImagery.file_url);
  console.log('Status:', uploadedImagery.processing_status);
  console.log('Dimensions:', `${uploadedImagery.width}x${uploadedImagery.height}`);

  console.log('\n--- 6. Verifying Uploaded File Exists in /uploads and on Disk ---');
  const diskFileName = path.basename(uploadedImagery.file_url);
  const diskPath = path.join(process.cwd(), 'uploads', diskFileName);
  if (!fs.existsSync(diskPath)) throw new Error(`Uploaded file not found on disk at ${diskPath}`);
  console.log('File exists on disk at:', diskPath, 'Size:', fs.statSync(diskPath).size, 'bytes');

  // Test loading file via HTTP from /uploads
  const fileHttpRes = await fetch(`http://localhost:3001${uploadedImagery.file_url}`);
  console.log('HTTP fetch of uploaded file:', fileHttpRes.status, fileHttpRes.headers.get('content-type'));
  if (fileHttpRes.status !== 200) throw new Error('HTTP fetch of uploaded file failed!');

  console.log('\n--- 7. Running AI Detection with imagery_id ---');
  const detRes = await fetch(`${API_BASE}/projects/${project.id}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imagery_id: uploadedImagery.id,
      mode: 'demo'
    })
  });
  const detData = await detRes.json();
  if (!detData.success) throw new Error('Detection failed: ' + JSON.stringify(detData));
  console.log('Detection complete! Mode:', detData.mode);
  console.log('Features detected:', detData.features_count);
  console.log('Categories:', detData.categories);
  console.log('Associated imagery_id:', detData.imagery_id);

  console.log('\n--- 8. Verifying Features Scoped to Project & Imagery ---');
  const featRes = await fetch(`${API_BASE}/projects/${project.id}/features?imagery_id=${uploadedImagery.id}`);
  const featData = await featRes.json();
  console.log('Features retrieved:', featData.count);
  featData.features.forEach(f => {
    if (f.imagery_id !== uploadedImagery.id) throw new Error(`Feature ${f.id} has incorrect imagery_id ${f.imagery_id}`);
    if (f.project_id !== project.id) throw new Error(`Feature ${f.id} has incorrect project_id ${f.project_id}`);
  });
  console.log('All features successfully validated and strictly scoped!');

  console.log('\n--- 9. Testing Road-Based Spatial Reasoning on New Project ---');
  const rRes = await fetch(`${API_BASE}/projects/${project.id}/spatial-reasoning`, {
    method: 'POST'
  });
  const rData = await rRes.json();
  console.log('Spatial Reasoning Result:', rData.candidates_count, 'candidates inferred');

  console.log('\n--- 10. Verifying Project Isolation ---');
  const demoFeatRes = await fetch(`${API_BASE}/projects/proj_wagholi_demo/features`);
  const demoFeatData = await demoFeatRes.json();
  console.log('Demo project features count:', demoFeatData.count);
  const leakedInDemo = demoFeatData.features.some(f => f.project_id === project.id);
  if (leakedInDemo) throw new Error('Data leak! New project data leaked into demo project');
  console.log('Project data isolation: 100% SECURE & VERIFIED');

  if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);

  console.log('\n===========================================');
  console.log('ALL API & DATA PIPELINE TESTS PASSED 100%!');
  console.log('===========================================');
}

testPipeline().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
