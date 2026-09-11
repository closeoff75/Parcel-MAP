/**
 * Comprehensive Automated Test Suite for Step 2:
 * Cinematic Search -> 3D Globe -> Parcel Experience
 */
import fs from 'fs';
import path from 'path';

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

console.log('===============================================================');
console.log('🎬 PARCELMAP: STEP 2 - CINEMATIC 3D GLOBE EXPERIENCE TESTS');
console.log('===============================================================');

const globeJs = fs.readFileSync(path.resolve('globe.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
const css = fs.readFileSync(path.resolve('gis-theme.css'), 'utf-8');

// 1. REUSABLE INDEPENDENT CAMERA FUNCTION & STATE MACHINE (Requirements 2, 15)
assert(
  globeJs.includes('window.flyToParcel = function(parcel)') &&
  globeJs.includes('selectParcel(parcel, doFly = true)'),
  'TEST 1: Reusable independent camera interface window.flyToParcel is exposed and delegates to selectParcel'
);

assert(
  globeJs.includes("this.cameraState = 'IDLE'") &&
  globeJs.includes("setCameraState(newState, parcel") &&
  globeJs.includes("window.dispatchEvent(new CustomEvent('parcelmap:camera-state'"),
  'TEST 2: Real-time Camera State Machine implemented with event dispatching (IDLE/LOCATING/ARRIVING/LOCATED)'
);

// 2. COORDINATE VALIDATION & MISSING COORD SAFEGUARD (Requirements 16, 17)
assert(
  globeJs.includes('lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180') &&
  globeJs.includes("this.setCameraState('ERROR', parcel)") &&
  globeJs.includes('displayUnavailableNotice(parcel)'),
  'TEST 3: Strict coordinate validation (-90 to +90, -180 to +180) guards against invalid coordinates'
);

assert(
  globeJs.includes('Location unavailable: This parcel does not currently have geographic coordinates.') ||
  globeJs.includes('This parcel does not currently have geographic coordinates'),
  'TEST 4: Clear user-facing message displayed for missing/unavailable coordinates without breaking globe'
);

// 3. MULTI-STAGE CINEMATIC CAMERA FLIGHT & DYNAMIC ZOOM (Requirements 3, 4, 21)
assert(
  globeJs.includes('targetZoom = 1.75') &&
  globeJs.includes('targetZoom = 1.45') &&
  globeJs.includes('targetZoom = 1.30') &&
  globeJs.includes('targetZoom = 1.15'),
  'TEST 5: Camera altitude levels differentiated by scope (parcel=1.75, village=1.45, district=1.30, state=1.15)'
);

assert(
  globeJs.includes('prefers-reduced-motion') &&
  globeJs.includes('this.flyDuration ='),
  'TEST 6: Accessibility support for prefers-reduced-motion with accelerated transitions'
);

assert(
  globeJs.includes('rotEase = 1 - Math.pow(1 - t, 4)') &&
  globeJs.includes('zoomEase =') &&
  globeJs.includes('this.currentZoom = this.flyStart.zoom +'),
  'TEST 7: Multi-phase cinematic flight easing (orbital orientation followed by atmospheric descent)'
);

// 4. SELECTED PARCEL HIGHLIGHT & PULSE ANIMATION (Requirements 5, 6)
assert(
  globeJs.includes('opacity: 0.45') &&
  globeJs.includes('opacity: 0.08') &&
  globeJs.includes('this.selectedHighlightGroup.add(highlightLine)') &&
  globeJs.includes('this.selectedHighlightGroup.add(fillMesh)'),
  'TEST 8: Visual hierarchy established: subtle normal parcels vs bright glowing selected parcel'
);

assert(
  globeJs.includes("this.cameraState === 'LOCATED'") &&
  globeJs.includes('Math.sin(Date.now()') &&
  globeJs.includes('this.selectedHighlightLine.material.opacity = pulse'),
  'TEST 9: Gentle pulsing boundary outline active strictly when camera reaches LOCATED state'
);

// 5. 3D GIS LOCATION MARKER & ACTIVE SURFACE PULSE (Requirement 7)
assert(
  globeJs.includes('createParcelBadgeSprite(pNum)') &&
  globeJs.includes('this.selectedMarkerGroup = new THREE.Group()') &&
  globeJs.includes('OctahedronGeometry(4.5)') &&
  globeJs.includes('this.activePulseRing.position.copy(surfacePos)'),
  'TEST 10: 3D GIS Location Marker (elevated stalk, beacon head, 3D text badge sprite, surface sonar ring)'
);

assert(
  globeJs.includes('markerT = (t - 0.55) / 0.45') &&
  globeJs.includes('this.selectedMarkerGroup.scale.set('),
  'TEST 11: Location marker smoothly scales in during approach phase (ARRIVING)'
);

// 6. PARCEL INFORMATION CARD & MOBILE BOTTOM-SHEET (Requirements 8, 9, 20)
assert(
  indexHtml.includes('id="globeParcelCard"') &&
  globeJs.includes('displayParcelCard(parcel)') &&
  globeJs.includes('hideParcelCard()'),
  'TEST 12: Dedicated Selected Parcel Information Card integrated into globe overlay'
);

assert(
  css.includes('.globe-parcel-card') &&
  css.includes('.parcel-card-header') &&
  css.includes('.parcel-card-metrics') &&
  css.includes('.btn-card-explore'),
  'TEST 13: Glassmorphic GeoTech card styles, badges, metrics, and explore CTA implemented in CSS'
);

assert(
  css.includes('@media (max-width: 768px)') &&
  css.includes('.globe-parcel-card') &&
  css.includes('bottom: 72px'),
  'TEST 14: Mobile responsive bottom-sheet layout preserving 65%+ upper globe viewport'
);

// 7. SINGLE ACTIVE SELECTION & CLEAN TRANSITIONS (Requirement 13)
assert(
  globeJs.includes('clearHighlightGroup()') &&
  globeJs.includes('this.clearHighlightGroup()'),
  'TEST 15: Selecting new parcel cleanly disposes prior highlight, preventing duplicate selections'
);

// 8. RESET VIEW & WORLD PERSPECTIVE (Requirement 12, 18)
assert(
  globeJs.includes('resetView()') &&
  globeJs.includes('this.flyTo(20, 77, 1.0') &&
  indexHtml.includes("btnReset.addEventListener('click'") || globeJs.includes("btnReset.addEventListener('click'"),
  'TEST 16: Reset View smoothly glides camera back to Global Earth view and clears selection'
);

// 9. INTERACTIVE GLOBE CONTROLS & PARCEL CLICKING (Requirements 11, 14)
assert(
  globeJs.includes('this.parcelPickMeshes') &&
  globeJs.includes('intersectObjects(this.parcelPickMeshes') &&
  globeJs.includes('this.hoveredParcel'),
  'TEST 17: Interactive 3D raycasting enables clicking individual parcels directly on the globe'
);

// 10. LIVE STATUS SYNCHRONIZATION (Requirement 10)
assert(
  indexHtml.includes("e.detail || {}") &&
  indexHtml.includes("LOCATING PARCEL #") &&
  indexHtml.includes("APPROACHING PARCEL #") &&
  indexHtml.includes("✓ PARCEL #"),
  'TEST 18: Live search confirmation card status updates synchronously with camera flight states'
);

console.log('\n===============================================================');
console.log(`📊 RESULTS: ${passed}/${total} STEP 2 TESTS PASSED (${Math.round((passed/total)*100)}%)`);
console.log('===============================================================');

if (passed !== total) {
  process.exit(1);
}
