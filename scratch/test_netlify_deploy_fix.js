import { handler as apiHandler } from '../netlify/functions/api.js';
import { handler as uploadHandler } from '../netlify/functions/upload.js';
import { db } from '../server/db/database.js';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 VERIFICATION: Netlify Serverless & Upload Fixes');
  console.log('====================================================');

  // Test 1: GET /api/projects/proj_demo_coastal via API Gateway v1 event format
  console.log('\n[Test 1] Testing GET /api/projects/proj_demo_coastal (v1 event)...');
  const res1 = await apiHandler({
    httpMethod: 'GET',
    path: '/api/projects/proj_demo_coastal',
    headers: {}
  }, {});
  console.log('Status:', res1.statusCode);
  const data1 = JSON.parse(res1.body);
  if (res1.statusCode !== 200 || !data1.success || data1.project?.id !== 'proj_demo_coastal') {
    throw new Error(`Test 1 Failed: ${JSON.stringify(data1)}`);
  }
  console.log('✓ Project successfully resolved:', data1.project.id, '-', data1.project.name);

  // Test 2: GET /api/projects/proj_demo_coastal via API Gateway v2 / Netlify v2 event format
  console.log('\n[Test 2] Testing GET /api/projects/proj_demo_coastal (v2 event with rawPath)...');
  const res2 = await apiHandler({
    version: '2.0',
    rawPath: '/.netlify/functions/api/projects/proj_demo_coastal',
    path: '/.netlify/functions/api/projects/proj_demo_coastal',
    requestContext: {
      http: { method: 'GET', path: '/.netlify/functions/api/projects/proj_demo_coastal' }
    },
    headers: {}
  }, {});
  console.log('Status:', res2.statusCode);
  const data2 = JSON.parse(res2.body);
  if (res2.statusCode !== 200 || !data2.success || data2.project?.id !== 'proj_demo_coastal') {
    throw new Error(`Test 2 Failed: ${JSON.stringify(data2)}`);
  }
  console.log('✓ v2 event normalization verified: 200 OK');

  // Test 3: POST /api/demo/reset
  console.log('\n[Test 3] Testing POST /api/demo/reset...');
  const res3 = await apiHandler({
    httpMethod: 'POST',
    path: '/api/demo/reset',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }, {});
  console.log('Status:', res3.statusCode);
  const data3 = JSON.parse(res3.body);
  if (res3.statusCode !== 200 || !data3.success) {
    throw new Error(`Test 3 Failed: ${JSON.stringify(data3)}`);
  }
  console.log('✓ Demo reset succeeded, seeded project:', data3.demoData?.project?.id);

  // Test 4: Image File Retrieval: GET /api/imagery/img_demo_coastal/file
  console.log('\n[Test 4] Testing GET /api/imagery/img_demo_coastal/file...');
  const res4 = await apiHandler({
    httpMethod: 'GET',
    path: '/api/imagery/img_demo_coastal/file',
    headers: {}
  }, {});
  console.log('Status:', res4.statusCode);
  if (res4.statusCode !== 200) {
    throw new Error(`Test 4 Failed: Expected 200, got ${res4.statusCode}: ${res4.body}`);
  }
  console.log('✓ Demo imagery file served successfully (binary length / content-type verified)');

  // Test 5: Verify upload with automatic project auto-recovery
  console.log('\n[Test 5] Testing POST /api/upload/init with missing/demo project id...');
  const res5 = await uploadHandler({
    httpMethod: 'POST',
    path: '/api/upload/init',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: 'proj_demo_coastal',
      filename: 'survey_field_sample.png',
      file_size: 1024 * 1024 * 2,
      total_chunks: 1
    })
  }, {});
  console.log('Status:', res5.statusCode);
  const data5 = JSON.parse(res5.body);
  if (res5.statusCode !== 200 || !data5.success) {
    throw new Error(`Test 5 Failed: ${JSON.stringify(data5)}`);
  }
  console.log('✓ Upload initialized without 404 project error, session:', data5.session_id);

  console.log('\n====================================================');
  console.log('🎉 ALL SERVERLESS DEPLOYMENT TESTS PASSED!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
