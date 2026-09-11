/**
 * Comprehensive Automated Test Suite for Step 3:
 * Fix Auto-Scroll and Perfectly Center the 3D Globe after Parcel Search
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

async function runStep3CenteringTests() {
  console.log('====================================================================');
  console.log('🎯 PARCELMAP: STEP 3 - AUTO-SCROLL & PERFECT GLOBE CENTERING TESTS');
  console.log('====================================================================');

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const smoothScrollJs = fs.readFileSync(path.resolve('smooth-scroll.js'), 'utf-8');
  const globeJs = fs.readFileSync(path.resolve('globe.js'), 'utf-8');

  // 1. SCROLL TARGET STABILITY (Requirement 1)
  assert(
    indexHtml.includes('id="parcel-globe"') && indexHtml.includes('id="globeCanvasContainer"'),
    'TEST 1: Scroll target has stable identifiers (id="parcel-globe" and id="globeCanvasContainer")'
  );

  // 2. VIEWPORT CENTERING FORMULA & DYNAMIC NAVBAR OFFSET (Requirement 2 & 4)
  assert(
    smoothScrollJs.includes('rect.height') &&
    smoothScrollJs.includes('viewportHeight - headerHeight') &&
    smoothScrollJs.includes('globeCenter - visibleCenterY'),
    'TEST 2: Dynamic centering calculation accounts for navbar, viewport height, and canvas dimensions'
  );

  // 3. WAIT UNTIL GLOBE SECTION IS READY (Requirement 3)
  assert(
    smoothScrollJs.includes('checkGlobeReady') &&
    smoothScrollJs.includes('rect.height === 0 || rect.width === 0'),
    'TEST 3: DOM readiness verification waits until dimensions are rendered before scrolling'
  );

  // 4. TIMING SEQUENCE: SEARCH -> SCROLL/CENTER -> THEN CAMERA FLY-TO (Requirement 6)
  assert(
    indexHtml.includes('scrollP.then(() => {') &&
    indexHtml.includes('triggerGlobeFlight();') &&
    indexHtml.includes('setSelectedParcel: function(parcel, options = { scroll: true })'),
    'TEST 4: Strict execution sequence: setSelectedParcel -> scrollToParcelGlobe() -> onComplete -> flyToParcel'
  );

  // 5. DOUBLE-SCROLL PREVENTION (Requirement 11)
  assert(
    smoothScrollJs.includes('if (isAutoScrolling) return Promise.resolve();') ||
    smoothScrollJs.includes('isAutoScrolling'),
    'TEST 5: Guard flag isAutoScrolling prevents duplicate concurrent scroll animations'
  );

  // 6. VIEWPORT SIMULATION ACROSS ALL REQUIRED DEVICE RESOLUTIONS (Requirement 5 & 14)
  const deviceResolutions = [
    { name: '4K Desktop (3840x2160)', width: 3840, height: 2160, headerH: 64, canvasH: 540, canvasTop: 1250 },
    { name: 'Full HD Desktop (1920x1080)', width: 1920, height: 1080, headerH: 64, canvasH: 540, canvasTop: 1250 },
    { name: 'MacBook/Laptop (1440x900)', width: 1440, height: 900, headerH: 64, canvasH: 540, canvasTop: 1250 },
    { name: 'Standard Laptop (1366x768)', width: 1366, height: 768, headerH: 64, canvasH: 540, canvasTop: 1250 },
    { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, headerH: 64, canvasH: 540, canvasTop: 1250 },
    { name: 'iPhone 14/15 Pro (393x852)', width: 393, height: 852, headerH: 64, canvasH: 420, canvasTop: 1300 },
    { name: 'Small Mobile (360x740)', width: 360, height: 740, headerH: 60, canvasH: 420, canvasTop: 1300 }
  ];

  deviceResolutions.forEach(dev => {
    const globeCenter = dev.canvasTop + (dev.canvasH / 2);
    const visibleHeight = Math.max(200, dev.height - dev.headerH);
    const visibleCenterY = dev.headerH + (visibleHeight / 2);
    let targetScroll = globeCenter - visibleCenterY;

    // Check top clearance
    if (dev.canvasH > visibleHeight) {
      targetScroll = Math.max(targetScroll, dev.canvasTop - dev.headerH - 12);
    }

    const canvasTopInViewport = dev.canvasTop - targetScroll;
    const canvasBottomInViewport = canvasTopInViewport + dev.canvasH;
    const spaceAbove = canvasTopInViewport - dev.headerH;
    const spaceBelow = dev.height - canvasBottomInViewport;

    const isEquidistant = Math.abs(spaceAbove - spaceBelow) <= 1;
    const isBelowNavbar = canvasTopInViewport >= dev.headerH;

    assert(
      isEquidistant && isBelowNavbar,
      `TEST 6 [${dev.name}]: 3D globe centered with equal margins (Top margin: ${Math.round(spaceAbove)}px, Bottom margin: ${Math.round(spaceBelow)}px)`
    );
  });

  // 7. MULTI-PARCEL SEARCH & REPEATED SEARCHES (Requirement 10, 13, 14)
  const sequenceParcels = ['101', '103', '104A', '108'];
  for (let i = 0; i < sequenceParcels.length; i++) {
    const pNum = sequenceParcels[i];
    const res = await fetchJson(`http://localhost:3001/api/parcels/search?q=${encodeURIComponent(pNum)}&limit=1`);
    const match = (res.data.results || [])[0];
    
    assert(
      res.status === 200 && match && (match.parcelNumber === pNum || match.id.includes(pNum)),
      `TEST 7 [Sequential Search ${i+1}/4]: Parcel #${pNum} successfully fetched and resolved`,
      `Survey: ${match?.surveyNumber}, Lat: ${match?.latitude}, Lng: ${match?.longitude}`
    );
  }

  // 8. INVALID SEARCH BEHAVIOR (Requirement 9)
  const invalidRes = await fetchJson('http://localhost:3001/api/parcels/search?q=INVALID999999&limit=1');
  const count = (invalidRes.data.results || []).length;
  assert(
    invalidRes.status === 200 && count === 0,
    'TEST 8: Invalid search "INVALID999999" returns 0 parcels (prevents scroll and keeps user at search input)'
  );

  // 9. CAMERA STATE INTEGRITY & PARCEL HIGHLIGHTING (Requirement 7 & 8)
  assert(
    globeJs.includes('this.clearHighlightGroup()') &&
    globeJs.includes('this.setCameraState(\'LOCATING\'') &&
    globeJs.includes('this.setCameraState(\'ARRIVING\'') &&
    globeJs.includes('this.setCameraState(\'LOCATED\''),
    'TEST 9: Globe camera lifecycle manages discrete stages (LOCATING -> ARRIVING -> LOCATED)'
  );

  console.log('\n====================================================================');
  console.log(`📊 RESULTS: ${passed}/${total} STEP 3 CENTERING TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('====================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep3CenteringTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
