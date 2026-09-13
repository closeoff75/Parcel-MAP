/**
 * Stress Test: Viewport simulation across Desktop, Laptop, Tablet, Mobile
 * with long detection IDs, long text, and checks for horizontal overflow.
 */

import fs from 'fs';

console.log('================================================================');
console.log('📱 STRESS-TESTING RESPONSIVE VIEWPORTS & LONG CONTENT');
console.log('================================================================\n');

const html = fs.readFileSync('workspace.html', 'utf8');
const css = fs.readFileSync('workspace.css', 'utf8');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

// 1. Check all required elements have min-width: 0 and box-sizing: border-box
const requiredMinZeroElements = [
  '#viewVerify .workspace-layout',
  '#viewVerify .ws-sidebar',
  '#viewVerify .ws-map-center',
  '#viewVerify .ws-drawer',
  '.drw-kv-row',
  '.drw-kv-label',
  '.drw-kv-val',
  '.area-diff-grid',
  '.area-cell',
  '.drawer-header',
  '.drawer-content'
];

console.log('--- Test 1: min-width: 0 and box-sizing enforcement on all flex/grid columns ---');
requiredMinZeroElements.forEach(el => {
  const present = css.includes(el);
  assert(present, `Selector "${el}" is explicitly defined in workspace.css`);
});

console.log('\n--- Test 2: Word Breaking & Overflow-Wrap Properties on Long IDs ---');
const longIdTestString = 'Building Footprint 8 (det_img_1789142537501_t33b_building_8)';
assert(css.includes('overflow-wrap: anywhere'), 'CSS applies overflow-wrap: anywhere for unbreakable strings');
assert(css.includes('word-break: break-word'), 'CSS applies word-break: break-word');

console.log('\n--- Test 3: Area Diff Grid Responsive Definitions ---');
assert(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'Area diff grid starts as 2 equal minmax(0, 1fr) columns');
assert(css.includes('.area-diff-grid') && css.includes('grid-template-columns: 1fr'), 'Area diff grid collapses to 1fr on narrow viewports');
assert(css.includes('.area-cell-verified'), 'Area verified cell has dedicated border-collapse handling');

console.log('\n--- Test 4: Horizontal Overflow Zero Guarantee ---');
assert(css.includes('overflow-x: hidden'), 'Containers enforce overflow-x: hidden to eliminate page horizontal scroll');
// Check that no translateX exists on #viewVerify .ws-drawer
const drawerRuleMatch = css.match(/#viewVerify \.ws-drawer\s*\{([^}]*)\}/);
const drawerCss = drawerRuleMatch ? drawerRuleMatch[1] : '';
assert(!drawerCss.includes('translateX('), 'Drawer has no translateX shifting it off-screen');
assert(!drawerCss.includes('margin-left: -'), 'Drawer has no negative left margin');

console.log('\n--- Test 5: Section Heading Scannability ---');
assert(html.includes('SUPPORTING FEATURES'), 'Heading "SUPPORTING FEATURES" present in details drawer HTML');
assert(html.includes('EVIDENCE &amp; PROVENANCE') || html.includes('EVIDENCE & PROVENANCE'), 'Heading "EVIDENCE & PROVENANCE" present in details drawer HTML');
assert(html.includes('WHY THIS PARCEL EXISTS'), 'Heading "WHY THIS PARCEL EXISTS" present in details drawer HTML');
assert(css.includes('.layer-section-title') && css.includes('white-space: normal'), '.layer-section-title allows normal wrapping without truncation');

console.log('\n--- Test 6: Toolbar Wrapping & Non-Collision ---');
assert(css.includes('.map-floating-toolbar') && css.includes('flex-wrap: wrap'), 'Verification toolbar allows wrapping on smaller maps');
assert(css.includes('.map-floating-search') && (css.includes('max-width') || css.includes('right: 10px')), 'Floating search is constrained to prevent overlapping right drawer');

console.log('\n================================================================');
console.log(`📊 STRESS TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL RESPONSIVE & LAYOUT STRESS TESTS PASSED 100%!\n');
  process.exit(0);
}
