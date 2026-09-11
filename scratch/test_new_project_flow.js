// scratch/test_new_project_flow.js
import fs from 'fs';
import path from 'path';

async function testFlow() {
  const base = 'http://localhost:3001/api';
  console.log('1. Creating project...');
  const createRes = await fetch(`${base}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Aerial Project ' + Date.now(),
      location: 'Pune Rural',
      description: 'Testing real pipeline',
      coordinates: [18.58, 73.98],
      project_type: 'Rural Cadastre'
    })
  });
  const createData = await createRes.json();
  console.log('Project created:', createData);
  const projectId = createData.project.id;

  console.log('\n2. Testing loadProjectData API endpoints for this new project:');
  const pRes = await fetch(`${base}/projects/${projectId}`);
  console.log('GET /projects/:id ->', pRes.status, await pRes.json());

  const imgRes = await fetch(`${base}/projects/${projectId}/imagery`);
  console.log('GET /projects/:id/imagery ->', imgRes.status, await imgRes.json());

  const fRes = await fetch(`${base}/projects/${projectId}/features`);
  console.log('GET /projects/:id/features ->', fRes.status, await fRes.json());

  const parcRes = await fetch(`${base}/projects/${projectId}/parcels`);
  console.log('GET /projects/:id/parcels ->', parcRes.status, await parcRes.json());

  const verRes = await fetch(`${base}/projects/${projectId}/timeline`);
  console.log('GET /projects/:id/timeline ->', verRes.status, await verRes.json());

  const qcRes = await fetch(`${base}/projects/${projectId}/gis-quality`);
  console.log('GET /projects/:id/gis-quality ->', qcRes.status, await qcRes.json());

  // Upload an image
  console.log('\n3. Uploading real image to new project...');
  const sampleImgPath = path.join(process.cwd(), 'uploads', 'uav_1789051750358_mf6lr4.png');
  const fileBuffer = fs.readFileSync(sampleImgPath);
  const blob = new Blob([fileBuffer], { type: 'image/png' });
  const form = new FormData();
  form.append('imagery', blob, 'sample_aerial_uav.png');
  form.append('width', '1400');
  form.append('height', '900');

  const uploadRes = await fetch(`${base}/projects/${projectId}/imagery`, {
    method: 'POST',
    body: form
  });
  const uploadData = await uploadRes.json();
  console.log('Upload result ->', uploadRes.status, uploadData);
  const imageryId = uploadData.imagery.id;

  // Run AI Detection
  console.log('\n4. Running detection...');
  const detRes = await fetch(`${base}/imagery/${imageryId}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'ml', provider: 'ml' })
  });
  console.log('Detect status:', detRes.status);
  const detData = await detRes.json();
  console.log('Detect result summary:', {
    success: detData.success,
    provider: detData.provider,
    model: detData.model,
    model_name: detData.model_name,
    features_count: detData.features_count,
    summary: detData.summary,
    error: detData.error
  });

  // Re-fetch features
  const fRes2 = await fetch(`${base}/projects/${projectId}/features?imagery_id=${imageryId}`);
  const fData2 = await fRes2.json();
  console.log('\n5. Features stored in DB -> count:', fData2.count, 'sample:', fData2.features?.slice(0, 2));
}

testFlow().catch(console.error);
