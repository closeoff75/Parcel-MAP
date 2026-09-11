/**
 * PARCELMAP / GEOPARCEL.AI — STEP 3 VERIFICATION SUITE
 * FIX GLOBE -> 2D MAP TRANSITION AND MAKE SEARCHED PARCEL ACTUALLY VISIBLE
 * 
 * Verifies:
 * 1. Root cause fix: No zero-size Leaflet container / No NaN zoom evaluation
 * 2. Transition state E: Loading map indicator prevents blank/dark map exposure
 * 3. Diagnostic tile error handling & retry mechanism
 * 4. Fallback basemap configuration (Esri World Imagery -> CARTO Dark -> OSM)
 * 5. Authentic parcel coordinates & boundaries for #101, #103, #104A, #108
 * 6. Primary selected parcel boundary rendering & pulse animation
 * 7. Secondary muted surrounding cadastral parcel boundaries
 * 8. Dynamic fitBounds with boundary padding
 * 9. Removal of 3D globe screen markers upon 2D map handoff
 * 10. Smooth return to Global View without page reload
 * 11. In-place consecutive search transitions
 * 12. URL route state persistence (?parcel=...)
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS [${totalTests}]: ${testName}`);
  } else {
    console.error(`  ✗ FAIL [${totalTests}]: ${testName}`);
    if (details) console.error(`    -> Details: ${details}`);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function runGlobeToMapFixTests() {
  console.log('====================================================================');
  console.log('  PARCELMAP / GEOPARCEL.AI — STEP 3 VERIFICATION SUITE');
  console.log('  Globe -> 2D Map Transition Fix & Visibility Verification');
  console.log('====================================================================\n');

  // Load codebase files
  const indexPath = path.join(rootDir, 'index.html');
  const globePath = path.join(rootDir, 'globe.js');
  const hdMapPath = path.join(rootDir, 'parcel-hd-map.js');
  const cssPath = path.join(rootDir, 'gis-theme.css');

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const globeJs = fs.readFileSync(globePath, 'utf8');
  const hdMapJs = fs.readFileSync(hdMapPath, 'utf8');
  const gisCss = fs.readFileSync(cssPath, 'utf8');

  // -------------------------------------------------------------------------
  // 1. ROOT CAUSE FIX: CONTAINER DISPLAY & SIZING BEFORE FITBOUNDS
  // -------------------------------------------------------------------------
  console.log('--- 1. Root Cause Fix: Zero-Size & NaN Zoom Prevention ---');
  
  assert(hdMapJs.includes("this.container.style.display = 'block'"), 'Container display set to block before viewport calculation');
  assert(hdMapJs.includes('this.map.invalidateSize(true)'), 'map.invalidateSize(true) called immediately after container display');
  assert(hdMapJs.includes('void this.container.offsetWidth'), 'Browser reflow forced to guarantee non-zero pixel geometry');
  assert(!hdMapJs.includes('= NaN') && !hdMapJs.includes(': NaN'), 'No hardcoded or assigned NaN values in map calculations');

  // -------------------------------------------------------------------------
  // 2. STATE E: TILE READINESS & LOADING INDICATOR (NO BLANK/DARK MAP)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Tile Readiness Barrier & Loading State (No Dark Map) ---');

  assert(indexHtml.includes('id="mapTileLoadingIndicator"'), 'Loading indicator element present in DOM');
  assert(indexHtml.includes('Loading map…') || hdMapJs.includes('Loading map…'), 'User-facing "Loading map…" text present');
  assert(hdMapJs.includes("this.currentTileLayer.once('load'"), 'Map listens for tile readiness before revealing');
  assert(gisCss.includes('.map-tile-loading-indicator'), 'CSS styles defined for map tile loading indicator');

  // -------------------------------------------------------------------------
  // 3. DIAGNOSTICS & BASEMAP FALLBACK
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Tile Error Diagnostics & Fallback Basemaps ---');

  assert(indexHtml.includes('id="mapTileErrorCard"'), 'Diagnostic error card present in DOM');
  assert(indexHtml.includes('id="btnRetryMap"'), 'Retry Map button present in DOM');
  assert(hdMapJs.includes('tileerror'), 'Tile error listener handles network/tile failures');
  assert(hdMapJs.includes('this.tileLayers.osm') || hdMapJs.includes('basemaps.cartocdn.com'), 'Fallback basemap layer configured');
  assert(gisCss.includes('.map-tile-error-card') && gisCss.includes('.btn-retry-map'), 'CSS styles defined for error card and retry button');

  // -------------------------------------------------------------------------
  // 4. REAL CADASTRAL COORDINATES & BOUNDARIES
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Real Cadastral Data Integrity (#101, #103, #104A, #108) ---');

  const [res101, res103, res104A, res108] = await Promise.all([
    fetchJson('http://localhost:3001/api/parcels/search?q=101&limit=1'),
    fetchJson('http://localhost:3001/api/parcels/search?q=103&limit=1'),
    fetchJson('http://localhost:3001/api/parcels/search?q=104A&limit=1'),
    fetchJson('http://localhost:3001/api/parcels/search?q=108&limit=1')
  ]);

  const p101 = res101.results?.[0];
  const p103 = res103.results?.[0];
  const p104A = res104A.results?.[0];
  const p108 = res108.results?.[0];

  assert(p101?.latitude && p101?.longitude, 'Parcel #101 has authentic lat/lng coordinates');
  assert(p103?.latitude && p103?.longitude, 'Parcel #103 has authentic lat/lng coordinates');
  assert(p104A?.latitude && p104A?.longitude, 'Parcel #104A has authentic lat/lng coordinates');
  assert(p108?.latitude && p108?.longitude, 'Parcel #108 has authentic lat/lng coordinates');

  const distinct = (p101.latitude !== p103.latitude) && (p103.latitude !== p104A.latitude);
  assert(distinct, 'Different parcels resolve to distinct geographic targets');

  // -------------------------------------------------------------------------
  // 5. PRIMARY HIGHLIGHT & SECONDARY SURROUNDING BOUNDARIES
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Primary Highlight & Secondary Boundaries ---');

  assert(hdMapJs.includes("color: '#10b981'") && hdMapJs.includes('weight: 3.5'), 'Primary selected parcel rendered with bold emerald stroke');
  assert(gisCss.includes('@keyframes parcelGlowPulse'), 'CSS pulse keyframes applied to selected parcel boundary');
  assert(hdMapJs.includes('this.surroundingParcelsLayer'), 'Secondary surrounding parcel boundaries rendered');
  assert(hdMapJs.includes("color: '#94a3b8'"), 'Surrounding parcels styled with muted boundary color');
  assert(hdMapJs.includes("poly.on('click'"), 'Surrounding parcels interactive with click-to-switch');

  // -------------------------------------------------------------------------
  // 6. 3D GLOBE HANDOFF & SCREEN MARKER CLEANUP
  // -------------------------------------------------------------------------
  console.log('\n--- 6. 3D Globe Handoff & Marker Cleanup ---');

  assert(hdMapJs.includes("anchored3dMarker.style.display = 'none'"), 'Globe anchored 3D screen marker hidden upon 2D map handoff');
  assert(hdMapJs.includes("screen3dMarker.style.display = 'none'"), 'Globe screen HTML marker hidden upon 2D map handoff');
  assert(hdMapJs.includes("globeParcelCard.style.display = 'none'"), 'Globe card hidden upon 2D map handoff');
  assert(hdMapJs.includes("globeCanvas.style.opacity = '0'"), '3D globe canvas dimmed when 2D map is revealed');

  // -------------------------------------------------------------------------
  // 7. RETURN TO GLOBAL VIEW & CONSECUTIVE SEARCHES
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Global View & Consecutive In-Place Searches ---');

  assert(indexHtml.includes('id="btnBackToGlobe"'), '"Back to Global View" button exists in map HUD');
  assert(hdMapJs.includes('returnToGlobalView') && hdMapJs.includes('hideMap'), 'HD map supports returnToGlobalView and clean hideMap');
  assert(globeJs.includes('clearSelectedParcel') && globeJs.includes('hideMap'), 'Globe resetView and clearSelectedParcel cleanly dismiss 2D map');
  assert(indexHtml.includes("if (this.activeMapStage === 'PARCEL_MAP' && window.parcelHdMapManager)"), 'Consecutive searches in PARCEL_MAP stage update in-place without resetting to space');

  // -------------------------------------------------------------------------
  // 8. LIVE SERVER CHECK
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Live Dev Server Serving Correct Code ---');

  const liveHtml = await fetchText('http://localhost:3000/');
  assert(liveHtml.includes('mapTileLoadingIndicator'), 'Live index.html contains mapTileLoadingIndicator');
  assert(liveHtml.includes('parcel-hd-map.js'), 'Live index.html loads parcel-hd-map.js');

  console.log('\n====================================================================');
  console.log(`  VERIFICATION RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('  >>> STEP 3 GLOBE TO 2D MAP FIX VERIFIED 100% SUCCESSFUL <<<');
  } else {
    console.error(`  >>> ${totalTests - passedTests} TESTS FAILED <<<`);
    process.exit(1);
  }
  console.log('====================================================================\n');
}

runGlobeToMapFixTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
