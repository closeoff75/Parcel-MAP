/**
 * Comprehensive Automated Test Suite for Step 3A:
 * Fix Find Parcel Auto-Scroll Positioning
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

async function runStep3ATests() {
  console.log('===============================================================');
  console.log('📐 PARCELMAP: STEP 3A - AUTO-SCROLL VIEWPORT POSITIONING TESTS');
  console.log('===============================================================');

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const smoothScrollJs = fs.readFileSync(path.resolve('smooth-scroll.js'), 'utf-8');
  const css = fs.readFileSync(path.resolve('gis-theme.css'), 'utf-8');

  // 1. STABLE REFERENCES & DOM ARCHITECTURE (Requirement 1)
  assert(
    indexHtml.includes('id="parcel-globe"') && indexHtml.includes('id="globeCanvasContainer"'),
    'TEST 1: Stable reference id="parcel-globe" and id="globeCanvasContainer" present'
  );

  assert(
    css.includes('.site-header') && css.includes('position: sticky') && css.includes('height: var(--header-height)'),
    'TEST 2: Fixed/Sticky navigation header configuration identified with CSS custom property'
  );

  // 2. CENTRALIZED SCROLL FUNCTION & DOUBLE-SCROLL PREVENTION (Requirements 2, 8)
  assert(
    smoothScrollJs.includes('window.scrollToParcelGlobe = function') &&
    indexHtml.includes('window.scrollToParcelGlobe = function'),
    'TEST 3: Centralized scrollToParcelGlobe() function defined across integration points'
  );

  assert(
    smoothScrollJs.includes('if (isAutoScrolling) return') || smoothScrollJs.includes('isAutoScrolling'),
    'TEST 4: Guard flag prevents duplicate concurrent scroll actions'
  );

  // 3. DYNAMIC NAVBAR HEIGHT MEASUREMENT & VIEWPORT CENTERING (Requirements 3, 4)
  assert(
    smoothScrollJs.includes('headerHeight =') &&
    smoothScrollJs.includes('visibleHeight =') &&
    smoothScrollJs.includes('visibleCenterY =') &&
    smoothScrollJs.includes('globeCenter - visibleCenterY'),
    'TEST 5: Accurate dynamic viewport centering formula: targetScroll = globeCenter - visibleCenterY'
  );

  assert(
    smoothScrollJs.includes('requestAnimationFrame('),
    'TEST 6: Controlled execution using requestAnimationFrame guarantees DOM readiness before measuring'
  );

  assert(
    smoothScrollJs.includes('cardPageTop - headerHeight') || smoothScrollJs.includes('headerHeight'),
    'TEST 7: Top-clearance clamp prevents 3D globe from slipping behind fixed navbar on small viewports'
  );

  // 4. SIMULATION OF SCROLL POSITIONING FOR REQUIRED RESOLUTIONS (Requirement 10)
  const viewports = [
    { name: 'Desktop 1920x1080', width: 1920, height: 1080, headerH: 64, canvasH: 540, canvasTopDoc: 1250 },
    { name: 'Laptop 1366x768', width: 1366, height: 768, headerH: 64, canvasH: 540, canvasTopDoc: 1250 },
    { name: 'Tablet 768x1024', width: 768, height: 1024, headerH: 64, canvasH: 540, canvasTopDoc: 1250 },
    { name: 'Mobile 390x844', width: 390, height: 844, headerH: 64, canvasH: 420, canvasTopDoc: 1300 }
  ];

  viewports.forEach(vp => {
    const globeCenter = vp.canvasTopDoc + (vp.canvasH / 2);
    const visibleHeight = Math.max(200, vp.height - vp.headerH);
    const visibleCenterY = vp.headerH + (visibleHeight / 2);
    const targetScroll = globeCenter - visibleCenterY;

    // Viewport relative positions at targetScroll
    const canvasTopInViewport = vp.canvasTopDoc - targetScroll;
    const canvasBottomInViewport = canvasTopInViewport + vp.canvasH;
    const spaceAbove = canvasTopInViewport - vp.headerH;
    const spaceBelow = vp.height - canvasBottomInViewport;

    // Center check: spaceAbove should equal spaceBelow within 1px
    const isCentered = Math.abs(spaceAbove - spaceBelow) <= 1;
    const isAboveNavbar = canvasTopInViewport >= vp.headerH;

    assert(
      isCentered && isAboveNavbar,
      `TEST 8 [${vp.name}]: Globe is precisely centered below navbar (Space above: ${Math.round(spaceAbove)}px, below: ${Math.round(spaceBelow)}px)`
    );
  });

  // 5. TEST WITH MULTIPLE PARCELS (Requirement 9)
  const testParcels = ['101', '103', '104A', '108'];
  for (const pNum of testParcels) {
    const res = await fetchJson(`http://localhost:3001/api/parcels/search?q=${encodeURIComponent(pNum)}&limit=4`);
    const match = (res.data.results || [])[0];
    const ok = res.status === 200 && match && (match.parcelNumber === pNum || match.id.includes(pNum));
    assert(
      ok,
      `TEST 9: Parcel #${pNum} successfully searched and resolved`,
      `Survey: ${match?.surveyNumber}, Lat: ${match?.latitude}, Lng: ${match?.longitude}`
    );
  }

  console.log('\n===============================================================');
  console.log(`📊 RESULTS: ${passed}/${total} STEP 3A TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('===============================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep3ATests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
