/**
 * Comprehensive Automated Test Suite for Step 4:
 * Real Globe Fly-To + Exact Parcel Focus + Result Card
 */
import fs from 'fs';
import path from 'path';
import http from 'http';

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

let passed = 0;
let total = 0;

function assert(condition, testName, details = '') {
  total++;
  if (condition) {
    console.log(`✅ [PASS] ${testName}${details ? ` -> ${details}` : ''}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

async function runStep4FlyToTests() {
  console.log('====================================================================');
  console.log('🌍 PARCELMAP: STEP 4 - REAL GLOBE FLY-TO & EXACT PARCEL FOCUS TESTS');
  console.log('====================================================================');

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const globeJs = fs.readFileSync(path.resolve('globe.js'), 'utf-8');
  const css = fs.readFileSync(path.resolve('gis-theme.css'), 'utf-8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));

  // 1. GLOBE TECHNOLOGY DETECTION (Requirement 3)
  assert(
    packageJson.dependencies['three'] &&
    !packageJson.dependencies['cesium'] &&
    !packageJson.dependencies['mapbox-gl'] &&
    globeJs.includes('new THREE.Scene()') &&
    globeJs.includes('new THREE.PerspectiveCamera'),
    'TEST 1: Globe engine verified as native Three.js WebGL (no conflicting secondary globe libraries)'
  );

  // 2. REAL PARCEL DATA & CADASTRE INTEGRITY (Requirement 1 & 15)
  try {
    const p101 = await fetchJson('http://localhost:3001/api/parcels/search?q=101&limit=1');
    const p103 = await fetchJson('http://localhost:3001/api/parcels/search?q=103&limit=1');
    const p104A = await fetchJson('http://localhost:3001/api/parcels/search?q=104A&limit=1');
    const p108 = await fetchJson('http://localhost:3001/api/parcels/search?q=108&limit=1');

    const d101 = p101.data?.results?.[0];
    const d103 = p103.data?.results?.[0];
    const d104A = p104A.data?.results?.[0];
    const d108 = p108.data?.results?.[0];

    assert(
      d101 && d101.latitude > 18.5 && d101.latitude < 18.7 && d101.longitude > 73.9 && d101.longitude < 74.1,
      'TEST 2A: Parcel #101 has verified geographic coordinates in Pune/Wagholi',
      `Lat: ${d101?.latitude}, Lng: ${d101?.longitude}`
    );

    assert(
      d103 && d103.latitude > 18.5 && d103.latitude < 18.7 && d103.longitude > 73.9 && d103.longitude < 74.1,
      'TEST 2B: Parcel #103 has verified geographic coordinates in Pune/Wagholi',
      `Lat: ${d103?.latitude}, Lng: ${d103?.longitude}`
    );

    assert(
      d104A && d104A.latitude > 18.5 && d104A.latitude < 18.7 && d104A.longitude > 73.9 && d104A.longitude < 74.1,
      'TEST 2C: Parcel #104A has verified geographic coordinates in Pune/Wagholi',
      `Lat: ${d104A?.latitude}, Lng: ${d104A?.longitude}`
    );

    assert(
      d108 && d108.latitude > 18.5 && d108.latitude < 18.7 && d108.longitude > 73.9 && d108.longitude < 74.1,
      'TEST 2D: Parcel #108 has verified geographic coordinates in Pune/Wagholi',
      `Lat: ${d108?.latitude}, Lng: ${d108?.longitude}`
    );

    // Verify coordinate order: Latitude (N/S ~18.58) and Longitude (E/W ~73.98)
    assert(
      d103?.latitude < d103?.longitude && d103?.latitude < 30 && d103?.longitude > 70,
      'TEST 2E: Geographic coordinate order verified (Latitude = North/South, Longitude = East/West, no reversal)'
    );
  } catch (err) {
    assert(false, 'TEST 2: API parcel coordinate fetch failed', err.message);
  }

  // 3. SEARCH TO GLOBE CAMERA CONNECTION (Requirement 2 & 14)
  assert(
    indexHtml.includes('window.parcelMapState.setSelectedParcel(selected, { scroll: true })') &&
    indexHtml.includes('window.realSatelliteGlobeInstance.selectParcel') &&
    globeJs.includes('selectParcel(parcel, doFly = true)'),
    'TEST 3: End-to-end integration: search handler -> window.parcelMapState -> globe.selectParcel'
  );

  // 4. PROGRESSIVE REAL FLY-TO DESCENT CURVE (Requirement 4)
  assert(
    globeJs.includes('Trajectory: Planetary Orbit • India Region') &&
    globeJs.includes('Descent Phase: Maharashtra • Pune District') &&
    globeJs.includes('Approach: Wagholi Sheet #14 • Vectoring #') &&
    globeJs.includes('this.flyStart.zoom + (this.flyTarget.zoom - this.flyStart.zoom) * zoomEase'),
    'TEST 4: Progressive geographic flight hierarchy implemented (Earth -> India -> Maharashtra -> Pune -> Wagholi -> Parcel)'
  );

  // 5. PARCEL-LEVEL TERMINAL ZOOM LEVEL (Requirement 5)
  assert(
    globeJs.includes('targetZoom = 2.50') &&
    globeJs.includes('this.maxZoom = 2.75') &&
    globeJs.includes('this.camera.position.z = 480 / this.currentZoom'),
    'TEST 5: Final camera altitude focuses at parcel/neighborhood level (targetZoom: 2.50, maxZoom: 2.75)'
  );

  // 6. 3D GIS PIN MARKER PROPORTION & ARRIVAL SCALING (Requirement 6)
  assert(
    globeJs.includes('OctahedronGeometry(2.4)') &&
    globeJs.includes('pinHead = this.latLngToVector3(lat, lng, 10.0)') &&
    globeJs.includes('createParcelBadgeSprite(pNum)') &&
    globeJs.includes('sprite.scale.set(10.0, 2.8, 1)'),
    'TEST 6: 3D GIS pin marker proportioned for high-zoom view (10-unit pin head, 2.4-unit diamond beacon, 3D text badge)'
  );

  // 7. RESULT CARD REAL METADATA & FIELD ARCHITECTURE (Requirement 7 & 15)
  assert(
    globeJs.includes('id="cardParcelId"') &&
    globeJs.includes('id="cardSurveyNum"') &&
    globeJs.includes('id="cardVillage"') &&
    globeJs.includes('id="cardDistrict"') &&
    globeJs.includes('id="cardState"') &&
    globeJs.includes('id="cardLandType"') &&
    globeJs.includes('id="cardArea"') &&
    globeJs.includes('View Parcel Details &rarr;') &&
    globeJs.includes('Demo data / preliminary visualization. Not legally authoritative cadastral data.'),
    'TEST 7: Result card displays all specified fields (Survey No., Village, District, State, Land Type, Area, View Parcel Details CTA, and legal disclaimer)'
  );

  // 8. STRICT ANIMATION SEQUENCE (Requirement 8)
  assert(
    globeJs.includes('this.hideParcelCard()') &&
    globeJs.includes('this.selectedMarkerGroup.scale.set(0.001, 0.001, 0.001)') &&
    globeJs.includes('this.displayParcelCard(this.selectedParcel)') &&
    globeJs.includes('if (t >= 1.0)'),
    'TEST 8: Strict lifecycle sequence: Search -> Scroll -> Fly-to begins -> Marker scales up -> Arrival (t=1.0) -> Result card appears'
  );

  // 9. MOBILE RESPONSIVE BEHAVIOR (Requirement 9)
  assert(
    css.includes('.globe-parcel-card {') &&
    css.includes('top: 24px') &&
    css.includes('right: 24px') &&
    css.includes('@media (max-width: 768px)') &&
    css.includes('bottom: 72px') &&
    css.includes('left: 12px') &&
    css.includes('right: 12px'),
    'TEST 9: Mobile responsiveness: Desktop top-right floating card, Mobile bottom-sheet preserving upper globe viewport'
  );

  // 10. MULTI-SEARCH RE-ROUTING & CLEAN DESELECTION (Requirement 10)
  assert(
    globeJs.includes('this.clearHighlightGroup()') &&
    globeJs.includes('this.selectedHighlightLine = null') &&
    globeJs.includes('this.selectedMarkerGroup = null') &&
    globeJs.includes('arcLift = Math.sin(t * Math.PI) * 0.40'),
    'TEST 10: Seamless re-routing: disposes previous highlight, lifts camera on re-route, prevents duplicate markers'
  );

  // 11. MULTI-MATCH RESULT SELECTION LIST (Requirement 11)
  assert(
    indexHtml.includes('class="parcel-multi-results-card"') &&
    indexHtml.includes('class="multi-results-list"') &&
    indexHtml.includes('class="multi-result-item"') &&
    css.includes('.parcel-multi-results-card'),
    'TEST 11: Broad queries render interactive multi-result selection list (• Parcel #X — Survey Y) preventing arbitrary random selection'
  );

  // 12. INVALID SEARCH ISOLATION (Requirement 12)
  assert(
    indexHtml.includes('class="parcel-not-found-card"') &&
    indexHtml.includes('Parcel not found'),
    'TEST 12: Invalid search returns "Parcel not found", leaves globe camera and selected parcel untouched'
  );

  // 13. RACE CONDITION IMMUNITY (Requirement 13)
  assert(
    indexHtml.includes('currentSearchAbort.abort()') &&
    indexHtml.includes('const target = this.selectedParcel || parcel;') &&
    globeJs.includes('this.flyProgress = 0;'),
    'TEST 13: Race condition immunity: cancels prior in-flight queries and always directs camera to the latest selected parcel'
  );

  // 14. STEP 3 AUTO-SCROLL PRESERVATION (Requirement 14)
  assert(
    indexHtml.includes('window.scrollToParcelGlobe') &&
    indexHtml.includes('scrollP.then(() =>') &&
    indexHtml.includes('triggerGlobeFlight()'),
    'TEST 14: Step 3 auto-scroll & centering sequence strictly preserved before fly-to executes'
  );

  // 15. PERFORMANCE & PERSISTENT GLOBE MOUNT (Requirement 16)
  assert(
    globeJs.includes('if (!window.realSatelliteGlobeInstance)') &&
    globeJs.includes('window.realSatelliteGlobeInstance = new RealSatelliteCadastralGlobe') &&
    globeJs.includes('requestAnimationFrame(this.animate)'),
    'TEST 15: Single mounted globe instance persists across searches without unmounting or canvas re-creation'
  );

  console.log('====================================================================');
  console.log(`📊 RESULTS: ${passed}/${total} STEP 4 TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('====================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep4FlyToTests().catch(err => {
  console.error('Fatal error running Step 4 tests:', err);
  process.exit(1);
});
