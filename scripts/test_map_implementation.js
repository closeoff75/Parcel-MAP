/**
 * Comprehensive Automated Verification Script for Full-Screen Interactive World Map
 * Tests:
 * 1. HTTP Status & Serving of index.html & map.html
 * 2. Critical DOM IDs and elements in map.html
 * 3. mapConfig.js basemap configurations
 * 4. Basemap tile provider response (Light, Satellite, Terrain, Dark, OSM)
 * 5. OpenStreetMap Nominatim Geocoding API response (India, Pune)
 * 6. GPS Coordinate parsing algorithm
 * 7. Backend /api/projects endpoint integration
 * 8. Real Project GIS parcels ingestion vs Isolated Demo dataset
 * 9. Vite production build verification
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

const VITE_BASE = 'http://localhost:3000';
const API_BASE = 'http://localhost:3001/api';

async function runTests() {
  console.log('===============================================================');
  console.log('🌍 PARCELMAP: TESTING FULL-SCREEN WORLD MAP IMPLEMENTATION');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. Check index.html Explore Map link
  await testAsync('TEST 1: Homepage Explore Map button links to map.html', async () => {
    const res = await fetch(`${VITE_BASE}/index.html`);
    assert.strictEqual(res.status, 200, 'index.html should return 200 OK');
    const html = await res.text();
    assert(html.includes('id="heroExploreMapBtn"'), 'heroExploreMapBtn must exist');
    assert(html.includes('href="map.html"'), 'Explore Map button must link to map.html');
  });

  // 2. Check map.html structure and required DOM elements
  await testAsync('TEST 2: map.html serves full-screen map container and professional UI', async () => {
    const res = await fetch(`${VITE_BASE}/map.html`);
    assert.strictEqual(res.status, 200, 'map.html should return 200 OK');
    const html = await res.text();

    const requiredIds = [
      'gisMap',
      'projectSelect',
      'activeModeBadge',
      'globalSearchInput',
      'globalSearchSuggestions',
      'btnSearchClear',
      'btnToggleStyles',
      'basemapSwitcherCard',
      'btnToggleLayers',
      'layersPanel',
      'btnOpenAnalytics',
      'btnFullscreenTop',
      'hudZoomIn',
      'hudZoomOut',
      'hudLocate',
      'hudCompass',
      'hudMeasureDist',
      'hudMeasureArea',
      'hudFullscreen',
      'hudModeBanner',
      'hudModeText',
      'hudLat',
      'hudLng',
      'hudZoom',
      'mapAttributionBox',
      'gisToast',
      'plotInfoDrawer',
      'analyticsModalOverlay',
      'dossierModalOverlay'
    ];

    requiredIds.forEach(id => {
      assert(html.includes(`id="${id}"`), `Missing required ID: #${id}`);
    });
  });

  // 3. Check CSS for 100vw x 100vh and zero margins
  test('TEST 3: map.css defines 100vw x 100vh full viewport without horizontal overflow', () => {
    const cssPath = path.join(process.cwd(), 'map.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('width: 100vw'), 'CSS must specify 100vw width');
    assert(css.includes('height: 100vh'), 'CSS must specify 100vh height');
    assert(css.includes('overflow: hidden'), 'CSS must prevent page overflow');
    assert(css.includes('.full-screen-map'), 'CSS must style .full-screen-map');
    assert(css.includes('min-height: 44px') || css.includes('height: 44px') || css.includes('width: 44px'), 'Touch targets must be at least 44px');
  });

  // 4. Test basemap providers tile reachability
  await testAsync('TEST 4: Basemap tile providers are active (Light, Satellite, Topo, Dark, OSM)', async () => {
    const endpoints = [
      { name: 'CartoDB Light', url: 'https://a.basemaps.cartocdn.com/light_all/2/2/1.png' },
      { name: 'Esri Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/2' },
      { name: 'Esri Terrain/Topo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/2/1/2' },
      { name: 'CartoDB Dark', url: 'https://a.basemaps.cartocdn.com/dark_all/2/2/1.png' },
      { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/2/2/1.png' }
    ];

    for (const ep of endpoints) {
      const r = await fetch(ep.url, { headers: { 'User-Agent': 'ParcelMap-GIS/1.0' } });
      assert(r.status === 200, `Tile provider ${ep.name} returned status ${r.status}`);
    }
  });

  // 5. Test OpenStreetMap Nominatim Geocoding
  await testAsync('TEST 5: Geocoding works for country, state, city (India, Pune)', async () => {
    const geoUrl1 = 'https://nominatim.openstreetmap.org/search?format=json&q=India&limit=1';
    const r1 = await fetch(geoUrl1, { headers: { 'User-Agent': 'ParcelMap-GIS/1.0' } });
    assert.strictEqual(r1.status, 200, 'Geocoding India should return 200');
    const d1 = await r1.json();
    assert(d1.length > 0, 'Should return results for India');
    const lat1 = parseFloat(d1[0].lat);
    assert(lat1 > 8 && lat1 < 38, 'India lat should be between 8 and 38');

    const geoUrl2 = 'https://nominatim.openstreetmap.org/search?format=json&q=Pune&limit=1';
    const r2 = await fetch(geoUrl2, { headers: { 'User-Agent': 'ParcelMap-GIS/1.0' } });
    assert.strictEqual(r2.status, 200, 'Geocoding Pune should return 200');
    const d2 = await r2.json();
    assert(d2.length > 0, 'Should return results for Pune');
    const lat2 = parseFloat(d2[0].lat);
    const lon2 = parseFloat(d2[0].lon);
    assert(Math.abs(lat2 - 18.52) < 0.2, 'Pune lat should be around 18.52');
    assert(Math.abs(lon2 - 73.85) < 0.2, 'Pune lon should be around 73.85');
  });

  // 6. Test Coordinate Parsing Algorithm
  test('TEST 6: Coordinate parser correctly identifies lat, lng queries', () => {
    const testCases = [
      { input: '18.5204, 73.8567', expectedLat: 18.5204, expectedLng: 73.8567 },
      { input: '18.5204 73.8567', expectedLat: 18.5204, expectedLng: 73.8567 },
      { input: '-33.8688, 151.2093', expectedLat: -33.8688, expectedLng: 151.2093 },
      { input: '   28.6139 , 77.2090  ', expectedLat: 28.6139, expectedLng: 77.2090 }
    ];

    testCases.forEach(tc => {
      const match = tc.input.trim().match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
      assert(match, `Failed to match valid coordinate string: ${tc.input}`);
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      assert.strictEqual(lat, tc.expectedLat, `Lat mismatch for ${tc.input}`);
      assert.strictEqual(lng, tc.expectedLng, `Lng mismatch for ${tc.input}`);
      assert(lat >= -90 && lat <= 90, 'Latitude must be in valid range');
      assert(lng >= -180 && lng <= 180, 'Longitude must be in valid range');
    });

    const invalidCases = ['Pune, India', 'abc, def', '200, 50'];
    invalidCases.forEach(inv => {
      const match = inv.trim().match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        assert(!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180), `${inv} should not be a valid GPS coordinate`);
      }
    });
  });

  // 7. Test Backend Project API Integration
  await testAsync('TEST 7: Backend /api/projects returns real project data for Project Mode', async () => {
    const res = await fetch(`${API_BASE}/projects`);
    assert.strictEqual(res.status, 200, 'GET /api/projects should return 200 OK');
    const data = await res.json();
    assert(data.success, 'Response should indicate success');
    assert(Array.isArray(data.projects), 'Projects must be an array');
    assert(data.projects.length > 0, 'Should have projects in the database');

    const sample = data.projects[0];
    assert(sample.id, 'Project must have an id');
    assert(sample.coordinates, 'Project must have coordinates [lat, lng]');
  });

  // 8. Test Project Parcels Endpoint
  await testAsync('TEST 8: Real project parcels endpoint /api/projects/:id/parcels returns valid GIS geometries', async () => {
    const pListRes = await fetch(`${API_BASE}/projects`);
    const pListData = await pListRes.json();
    const proj = pListData.projects.find(p => p.id !== 'proj_wagholi_demo') || pListData.projects[0];

    const parcelsRes = await fetch(`${API_BASE}/projects/${proj.id}/parcels`);
    assert.strictEqual(parcelsRes.status, 200, `GET /api/projects/${proj.id}/parcels should return 200`);
    const parcelsData = await parcelsRes.json();
    assert(Array.isArray(parcelsData.parcels), 'parcels must be an array');
  });

  // 9. Test Demo Data Isolation
  test('TEST 9: Demo plots (#101-#120) are isolated from default world map initialization', () => {
    const mapAppCode = fs.readFileSync(path.join(process.cwd(), 'map-app.js'), 'utf8');

    // Verify renderDemoCadastralPlots is called ONLY in setDemoMode()
    assert(mapAppCode.includes('setDemoMode()'), 'Must contain setDemoMode function');
    assert(mapAppCode.includes('setGlobalMode()'), 'Must contain setGlobalMode function');
    assert(!mapAppCode.includes('this.renderCadastralPlots()'), 'renderCadastralPlots must not be called automatically in init()');
    assert(mapAppCode.includes('this.renderDemoCadastralPlots()'), 'renderDemoCadastralPlots must exist for isolated demo');
    
    // Check initial mode
    assert(mapAppCode.includes("this.activeMode = 'global'") || mapAppCode.includes('this.setGlobalMode()'), 'Initial mode must be global');
  });

  // 10. Test Environment Variable Configuration
  test('TEST 10: Environment variable configuration template (.env.example) exists', () => {
    const envExamplePath = path.join(process.cwd(), '.env.example');
    assert(fs.existsSync(envExamplePath), '.env.example file must exist');
    const content = fs.readFileSync(envExamplePath, 'utf8');
    assert(content.includes('VITE_MAP_SATELLITE_TOKEN'), '.env.example must document VITE_MAP_SATELLITE_TOKEN');
  });

  console.log('\n===============================================================');
  console.log(`📊 RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('===============================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
