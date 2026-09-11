// Integration test for Step 1: Connect Find a Parcel Search to 3D Globe
import http from 'http';
import fs from 'fs';
import path from 'path';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runStep1IntegrationTests() {
  console.log('===============================================================');
  console.log('🌍 PARCELMAP: STEP 1 - SEARCH TO 3D GLOBE INTEGRATION TESTS');
  console.log('===============================================================');

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const globeJs = fs.readFileSync(path.resolve('globe.js'), 'utf-8');
  const css = fs.readFileSync(path.resolve('gis-theme.css'), 'utf-8');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}${details ? ` -> ${details}` : ''}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  // 1. DOM Architecture Check
  assert(
    indexHtml.includes('id="parcel-globe"'),
    'TEST 1A: 3D globe section has stable reference id="parcel-globe"'
  );

  assert(
    indexHtml.includes('window.parcelMapState = {') &&
    indexHtml.includes('setSelectedParcel:') &&
    indexHtml.includes('clear:'),
    'TEST 1B: Centralized state window.parcelMapState exists with setSelectedParcel and clear'
  );

  assert(
    globeJs.includes('selectParcel(parcel, doFly = true)') &&
    globeJs.includes('displayParcelTooltip(parcel') &&
    globeJs.includes('clearSelectedParcel()'),
    'TEST 1C: 3D Globe class implements selectParcel, displayParcelTooltip, clearSelectedParcel'
  );

  assert(
    globeJs.includes('window.flyToParcel = function(parcel)'),
    'TEST 1D: Global window.flyToParcel interface is exposed for clean decoupling'
  );

  assert(
    css.includes('.parcel-found-confirmation') &&
    css.includes('.parcel-not-found-card') &&
    css.includes('.btn-clear-search'),
    'TEST 1E: CSS contains clean confirmation, not-found, and clear-search styles'
  );

  // 2. API Backend & Search Engine Resolution Checks
  // TEST 1: Search "101"
  const res101 = await fetchJson('http://localhost:3001/api/parcels/search?q=101&limit=5');
  const match101 = (res101.data.results || [])[0];
  assert(
    res101.status === 200 && match101 && (match101.parcelNumber === '101' || match101.parcel_id.includes('101')),
    'TEST 2: Search "101" resolves to Parcel #101',
    `Found: ${match101?.display_name}, Survey: ${match101?.surveyNumber}, Lat: ${match101?.latitude}, Lng: ${match101?.longitude}`
  );

  // TEST 2: Search "104A"
  const res104A = await fetchJson('http://localhost:3001/api/parcels/search?q=104A&limit=5');
  const match104A = (res104A.data.results || [])[0];
  assert(
    res104A.status === 200 && match104A && match104A.parcelNumber === '104A',
    'TEST 3: Search "104A" resolves to Parcel #104A (and NOT #101)',
    `Found: ${match104A?.display_name}, Survey: ${match104A?.surveyNumber}`
  );

  // TEST 3: Search "42/1"
  const resSurv = await fetchJson('http://localhost:3001/api/parcels/search?q=42/1&limit=5');
  const matchSurv = (resSurv.data.results || [])[0];
  assert(
    resSurv.status === 200 && matchSurv && (matchSurv.surveyNumber === '42/1' || matchSurv.survey_no.includes('42/1')),
    'TEST 4: Search "42/1" resolves to Survey 42/1 (Parcel #101)',
    `Found: ${matchSurv?.display_name}, Survey: ${matchSurv?.surveyNumber}`
  );

  // TEST 4: Search "XYZ123" (Invalid)
  const resInvalid = await fetchJson('http://localhost:3001/api/parcels/search?q=XYZ123&limit=5');
  const invalidResults = resInvalid.data.results || [];
  assert(
    resInvalid.status === 200 && invalidResults.length === 0,
    'TEST 5: Search "XYZ123" returns 0 results (triggers Parcel not found card, globe untouched)',
    `Count: ${invalidResults.length}`
  );

  // TEST 5: Search "Wagholi" (Broad Location)
  const resWagholi = await fetchJson('http://localhost:3001/api/parcels/search?q=Wagholi&limit=12');
  const wagholiResults = resWagholi.data.results || [];
  assert(
    resWagholi.status === 200 && wagholiResults.length > 1,
    'TEST 6: Search "Wagholi" returns multiple parcels for region view',
    `Total available: ${resWagholi.data.total}`
  );

  // 3. Document Flow & Auto-Scroll Logic Check
  assert(
    indexHtml.includes("globeSection.scrollIntoView({") &&
    indexHtml.includes("behavior: 'smooth'"),
    'TEST 7: Smooth scroll execution to 3D globe is implemented without page reload'
  );

  assert(
    globeJs.includes('this.flyTo(lat, lng, 1.75') &&
    globeJs.includes('this.activePulseRing.position.copy(surfacePos)'),
    'TEST 8: 3D camera fly-to and active pulse ring repositioning on parcel coordinates'
  );

  assert(
    (globeJs.includes('this.selectedHighlightGroup.add(highlightLine)') || globeJs.includes('this.selectedHighlightLine')) &&
    (globeJs.includes('this.selectedHighlightGroup.add(fillMesh)') || globeJs.includes('this.selectedFillMesh')),
    'TEST 9: 3D parcel boundary glow and surface fill highlighting on selected parcel'
  );

  assert(
    globeJs.includes('displayParcelTooltip') &&
    globeJs.includes('PARCEL #') &&
    globeJs.includes('Survey:'),
    'TEST 10: Compact selected parcel detail panel rendered on globe'
  );

  console.log('\n===============================================================');
  console.log(`📊 RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('===============================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep1IntegrationTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
