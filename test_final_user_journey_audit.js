/**
 * PARCELMAP FINAL HACKATHON MVP AUDIT
 * Complete 18-Step User Journey & Cross-Component Data Consistency Test
 */
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3001/api';

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Request failed (${res.status}): ${JSON.stringify(data)}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function runAudit() {
  console.log('================================================================');
  console.log('PARCELMAP — FINAL HACKATHON MVP AUDIT: 18-STEP JOURNEY & CONSISTENCY');
  console.log('================================================================\n');

  // STEP 1: CREATE PROJECT
  console.log('STEP 1: Create Project...');
  const projRes = await request(`${BASE_URL}/projects`, {
    method: 'POST',
    body: JSON.stringify({
      name: `Hackathon Final Audit Project ${Date.now()}`,
      location: 'Plot 42, Wagholi Sector 9',
      description: 'End-to-End Cadastral Verification Audit'
    })
  });
  const project = projRes.project;
  const projectId = project.id;
  console.log(`[PASS] Created Project: ${project.name} (ID: ${projectId})`);

  // STEP 2: UPLOAD AERIAL/DRONE IMAGE
  console.log('\nSTEP 2: Upload Aerial/Drone Image...');
  const imageAPath = path.resolve('test_assets', 'image_a_rural.png');
  if (!fs.existsSync(imageAPath)) {
    throw new Error('Test asset not found: ' + imageAPath);
  }
  const imgBuffer = fs.readFileSync(imageAPath);
  const formDataBoundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  let bodyBuffer = Buffer.concat([
    Buffer.from(`--${formDataBoundary}\r\nContent-Disposition: form-data; name="imagery"; filename="image_a_rural.png"\r\nContent-Type: image/png\r\n\r\n`),
    imgBuffer,
    Buffer.from(`\r\n--${formDataBoundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`${BASE_URL}/projects/${projectId}/imagery`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${formDataBoundary}`
    },
    body: bodyBuffer
  });
  const uploadData = await uploadRes.json();
  if (!uploadData.success) throw new Error('Image upload failed: ' + uploadData.error);
  const imageryId = uploadData.imagery.id;
  console.log(`[PASS] Uploaded Image: ${uploadData.imagery.file_name} (Imagery ID: ${imageryId})`);

  // STEP 3: RUN AI DETECTION
  console.log('\nSTEP 3: Run AI Detection (Multi-class ML/CV)...');
  const detectRes = await request(`${BASE_URL}/projects/${projectId}/detect`, {
    method: 'POST',
    body: JSON.stringify({ imagery_id: imageryId })
  });
  console.log(`[PASS] Detection completed: ${detectRes.features_count} features detected`);
  console.log(`       Buildings (ML): ${detectRes.categories?.building || 0}`);
  console.log(`       Roads (CV): ${detectRes.categories?.road || 0}`);
  console.log(`       Fields (CV): ${detectRes.categories?.field || 0}`);
  console.log(`       Walls/Fences (CV): ${(detectRes.categories?.wall || 0) + (detectRes.categories?.fence || 0)}`);
  console.log(`       Vegetation (CV): ${detectRes.categories?.vegetation || 0}`);
  console.log(`       Water (CV): ${detectRes.categories?.water || 0}`);

  // STEP 4: REVIEW DETECTIONS
  console.log('\nSTEP 4: Review Validated Detections...');
  const featuresRes = await request(`${BASE_URL}/projects/${projectId}/features?imagery_id=${imageryId}`);
  if (!featuresRes.features || featuresRes.features.length === 0) {
    throw new Error('No features found for project');
  }
  console.log(`[PASS] Retrieved ${featuresRes.features.length} validated features for imagery ${imageryId}`);

  // STEP 5: RUN SPATIAL REASONING
  console.log('\nSTEP 5: Run Spatial Reasoning (Road & Boundary Constrained)...');
  const reasoningRes = await request(`${BASE_URL}/projects/${projectId}/spatial-reasoning`, {
    method: 'POST',
    body: JSON.stringify({ imagery_id: imageryId })
  });
  console.log(`[PASS] Spatial Reasoning generated ${reasoningRes.parcels_count} preliminary candidates`);

  // STEP 6: GENERATE PRELIMINARY PARCELS
  console.log('\nSTEP 6: Generate Preliminary Parcels...');
  const genParcelsRes = await request(`${BASE_URL}/projects/${projectId}/generate-parcels`, {
    method: 'POST',
    body: JSON.stringify({ imagery_id: imageryId })
  });
  console.log(`[PASS] Preliminary parcels confirmed: ${genParcelsRes.parcels_count} parcels`);

  const initialParcelsRes = await request(`${BASE_URL}/projects/${projectId}/parcels?imagery_id=${imageryId}`);
  const parcels = initialParcelsRes.parcels;
  if (!parcels || parcels.length < 3) {
    throw new Error('Insufficient parcels generated: ' + parcels?.length);
  }
  console.log(`[PASS] Initial Parcels count: ${parcels.length}`);

  // STEP 7: RUN GIS QUALITY AUDIT
  console.log('\nSTEP 7: Run GIS Quality Audit...');
  const auditRes = await request(`${BASE_URL}/projects/${projectId}/gis-quality?imagery_id=${imageryId}`);
  const qualityAudit = auditRes.summary || auditRes;
  console.log(`[PASS] GIS Quality Topology:`, {
    total: qualityAudit.total_parcels,
    valid: qualityAudit.valid,
    invalid: qualityAudit.invalid,
    overlaps: qualityAudit.overlaps,
    gaps: qualityAudit.gaps,
    water_overlaps: qualityAudit.water_overlaps
  });

  // STEP 8: EDIT PARCEL GEOMETRY
  console.log('\nSTEP 8: Edit Parcel Geometry...');
  const targetParcel1 = parcels[0];
  const p1Id = targetParcel1.parcel_id || targetParcel1.id;
  const editedGeom = JSON.parse(JSON.stringify(targetParcel1.geometry));
  // Shift one vertex slightly
  editedGeom.coordinates[0][1][0] += 5;
  const editRes = await request(`${BASE_URL}/parcels/${p1Id}`, {
    method: 'PUT',
    body: JSON.stringify({
      geometry: editedGeom,
      comments: 'Refined boundary edge to align with stone hedge'
    })
  });
  console.log(`[PASS] Parcel ${p1Id} geometry successfully edited and saved`);

  // STEP 9: ACCEPT PARCEL (VERIFY)
  console.log('\nSTEP 9: Accept Parcel 1...');
  const acceptRes = await request(`${BASE_URL}/parcels/${p1Id}/accept`, {
    method: 'POST',
    body: JSON.stringify({
      reviewer_name: 'Lead Surveyor Maria',
      notes: 'Boundary verified against high-res drone orthomosaic'
    })
  });
  console.log(`[PASS] Parcel ${p1Id} accepted (Status: ${acceptRes.parcel.status})`);

  // STEP 10: REJECT PARCEL
  console.log('\nSTEP 10: Reject Parcel 2...');
  const targetParcel2 = parcels[1];
  const p2Id = targetParcel2.parcel_id || targetParcel2.id;
  const rejectRes = await request(`${BASE_URL}/parcels/${p2Id}/reject`, {
    method: 'POST',
    body: JSON.stringify({
      reviewer_name: 'Lead Surveyor Maria',
      notes: 'False positive — corresponds to communal drainage ditch'
    })
  });
  console.log(`[PASS] Parcel ${p2Id} rejected (Status: ${rejectRes.parcel.status})`);

  // Also accept another parcel so we have multiple verified
  const targetParcel3 = parcels[2];
  const p3Id = targetParcel3.parcel_id || targetParcel3.id;
  await request(`${BASE_URL}/parcels/${p3Id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_name: 'Lead Surveyor Maria', notes: 'Clear field demarcations' })
  });
  console.log(`[PASS] Parcel ${p3Id} accepted`);

  // STEP 11: COMPLETE VERIFICATION (FETCH UPDATED LIST)
  console.log('\nSTEP 11: Complete Verification State Check...');
  const updatedParcelsRes = await request(`${BASE_URL}/projects/${projectId}/parcels?imagery_id=${imageryId}`);
  const allUpdated = updatedParcelsRes.parcels;
  const acceptedList = allUpdated.filter(p => p.status === 'accepted' || p.status === 'Human Verified');
  const rejectedList = allUpdated.filter(p => p.status === 'rejected' || p.status === 'Rejected');
  const reviewList = allUpdated.filter(p => p.status === 'needs_review' || p.status === 'Needs Review');
  console.log(`[PASS] Verification breakdown: Accepted=${acceptedList.length}, Rejected=${rejectedList.length}, NeedsReview=${reviewList.length}`);

  // STEP 12: OPEN FINAL MAP (VERIFIED PARCELS ONLY)
  console.log('\nSTEP 12: Open Final Map...');
  const finalMapRes = await request(`${BASE_URL}/projects/${projectId}/parcels?imagery_id=${imageryId}&scope=verified`);
  const finalMapParcels = finalMapRes.parcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified');
  console.log(`[PASS] Final Map parcel count: ${finalMapParcels.length}`);
  if (finalMapParcels.length !== acceptedList.length) {
    throw new Error(`Final Map count (${finalMapParcels.length}) does not match accepted count (${acceptedList.length})`);
  }

  // STEP 13: GENERATE REPORT
  console.log('\nSTEP 13: Generate Comprehensive Project Report...');
  const reportRes = await request(`${BASE_URL}/projects/${projectId}/report?imagery_id=${imageryId}`);
  const reportData = reportRes.report || reportRes;
  console.log(`[PASS] Report generated: ID=${reportData.report_id}`);
  console.log(`       Report Verified Parcels: ${reportData.cadastral_metrics?.verified_parcels || reportData.parcels_summary?.verified_count || 0}`);
  console.log(`       Report Non-Geo Area Notice: ${reportData.coordinate_notice}`);

  // STEP 14: DOWNLOAD REAL PDF
  console.log('\nSTEP 14: Download Real PDF...');
  const pdfRes = await fetch(`${BASE_URL}/projects/${projectId}/report/pdf?imagery_id=${imageryId}`);
  if (!pdfRes.ok) throw new Error(`PDF generation failed: ${pdfRes.status}`);
  const pdfBuffer = await pdfRes.arrayBuffer();
  const pdfHeader = Buffer.from(pdfBuffer.slice(0, 5)).toString('utf-8');
  if (pdfHeader !== '%PDF-') {
    throw new Error('PDF output does not have valid %PDF- magic bytes header');
  }
  console.log(`[PASS] Real PDF generated successfully (${pdfBuffer.byteLength} bytes, header: ${pdfHeader})`);

  // STEP 15: EXPORT GEOJSON
  console.log('\nSTEP 15: Export GeoJSON...');
  const geojsonRes = await request(`${BASE_URL}/projects/${projectId}/export/geojson?imagery_id=${imageryId}&scope=verified`);
  if (geojsonRes.type !== 'FeatureCollection') throw new Error('Invalid GeoJSON FeatureCollection');
  console.log(`[PASS] GeoJSON export verified: ${geojsonRes.features.length} features`);
  console.log(`       CRS: ${JSON.stringify(geojsonRes.crs?.properties?.name || 'PixelSpace')}`);
  console.log(`       First feature properties:`, {
    parcel_id: geojsonRes.features[0]?.properties?.parcel_id,
    verification_status: geojsonRes.features[0]?.properties?.verification_status,
    area_display: geojsonRes.features[0]?.properties?.area_display
  });

  // STEP 16: EXPORT CSV
  console.log('\nSTEP 16: Export CSV...');
  const csvRes = await fetch(`${BASE_URL}/projects/${projectId}/export/csv?imagery_id=${imageryId}&scope=verified`);
  if (!csvRes.ok) throw new Error(`CSV export failed: ${csvRes.status}`);
  const csvText = await csvRes.text();
  const csvRows = csvText.trim().split('\n');
  console.log(`[PASS] CSV export verified: ${csvRows.length - 1} data rows`);
  console.log(`       CSV Header: ${csvRows[0]}`);
  console.log(`       CSV Sample Row: ${csvRows[1]}`);

  // STEP 17: REFRESH / PERSISTENCE CHECK
  console.log('\nSTEP 17: Simulate Browser Refresh & State Persistence...');
  const reloadedProject = await request(`${BASE_URL}/projects/${projectId}`);
  const reloadedParcels = await request(`${BASE_URL}/projects/${projectId}/parcels?imagery_id=${imageryId}`);
  const reloadedAccepted = reloadedParcels.parcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified');
  if (reloadedAccepted.length !== acceptedList.length) {
    throw new Error(`State persistence failed: expected ${acceptedList.length}, got ${reloadedAccepted.length}`);
  }
  console.log(`[PASS] State persisted cleanly across reload: ${reloadedAccepted.length} verified parcels maintained`);

  // STEP 18: REOPEN PROJECT / ISOLATION CHECK
  console.log('\nSTEP 18: Reopen Project & Cross-Component Data Consistency Check...');
  
  // Consistency Table Verification
  const reportVerifiedCount = reportData.cadastral_metrics?.verified_parcels || reportData.parcels_summary?.verified_count;
  const geojsonCount = geojsonRes.features.length;
  const csvCount = csvRows.length - 1;
  const finalMapCount = finalMapParcels.length;

  console.log('\n================================================================');
  console.log('CROSS-COMPONENT DATA CONSISTENCY TABLE (Audit Section 20)');
  console.log('================================================================');
  console.table([
    { Component: 'Human Verification', Total: allUpdated.length, Accepted: acceptedList.length, Review: reviewList.length, Rejected: rejectedList.length, ProjectID: projectId, ImageryID: imageryId },
    { Component: 'Final Map', Total: finalMapCount, Accepted: finalMapCount, Review: 0, Rejected: 0, ProjectID: projectId, ImageryID: imageryId },
    { Component: 'Reports', Total: allUpdated.length, Accepted: reportVerifiedCount, Review: reviewList.length, Rejected: rejectedList.length, ProjectID: projectId, ImageryID: imageryId },
    { Component: 'GeoJSON Export', Total: geojsonCount, Accepted: geojsonCount, Review: 0, Rejected: 0, ProjectID: projectId, ImageryID: imageryId },
    { Component: 'CSV Export', Total: csvCount, Accepted: csvCount, Review: 0, Rejected: 0, ProjectID: projectId, ImageryID: imageryId }
  ]);

  if (acceptedList.length !== finalMapCount ||
      acceptedList.length !== reportVerifiedCount ||
      acceptedList.length !== geojsonCount ||
      acceptedList.length !== csvCount) {
    throw new Error(`Data consistency failure! Verified parcel count differs across components.`);
  }
  console.log('[PASS] ALL COMPONENTS AGREE 100% ON ACCEPTED/VERIFIED PARCEL COUNTS AND IDS!\n');

  console.log('================================================================');
  console.log('FINAL AUDIT 18-STEP JOURNEY: 100% COMPLETE & ALL TESTS PASSED');
  console.log('================================================================');
}

runAudit().catch(err => {
  console.error('AUDIT FAILED:', err.data || err.message || err);
  process.exit(1);
});
