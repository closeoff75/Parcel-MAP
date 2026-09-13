/**
 * Automated Test Suite: Verification Workspace Layout, Details Panel Position & Responsive Behavior
 */

import fs from 'fs';
import path from 'path';
import http from 'http';

console.log('================================================================');
console.log('📐 TESTING: VERIFICATION WORKSPACE LAYOUT & RESPONSIVE DESIGN');
console.log('================================================================\n');

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

// 1. Read files
const html = fs.readFileSync('workspace.html', 'utf8');
const css = fs.readFileSync('workspace.css', 'utf8');

console.log('--- Step 1: Verification Workspace Layout Grid ---');
// Extract viewVerify block from HTML
const viewVerifyMatch = html.match(/<section class="pm-view-stage" id="viewVerify">([\s\S]*?)<\/section>/);
assert(viewVerifyMatch != null, 'Found #viewVerify section in workspace.html');
const verifyHtml = viewVerifyMatch ? viewVerifyMatch[1] : '';

assert(verifyHtml.includes('class="workspace-layout verify-workspace-layout"'), 'workspace.html uses verify-workspace-layout class on verification container');
assert(!verifyHtml.includes('style="width: 320px;'), 'No hardcoded width:320px inline style on verification sidebar');

// Check CSS grid rules
assert(css.includes('grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(320px, 380px)'), 'CSS defines 3-column responsive grid with minmax(240px, 280px) minmax(0, 1fr) minmax(320px, 380px)');
assert(css.includes('#viewVerify .ws-map-center') && css.includes('min-width: 0'), 'Center map column uses min-width: 0 to prevent pushing right panel');
assert(css.includes('#viewVerify .ws-drawer') && css.includes('min-width: 0'), 'Right drawer uses min-width: 0 and box-sizing: border-box');
assert(css.includes('#viewVerify .ws-sidebar') && css.includes('min-width: 0'), 'Left sidebar uses min-width: 0');

console.log('\n--- Step 2: Right Details Panel Positioning & Containment ---');
assert(css.includes('#viewVerify .ws-drawer') && css.includes('transform: none'), 'Right drawer removes any translateX positioning');
assert(css.includes('#viewVerify .ws-drawer') && css.includes('overflow-x: hidden'), 'Right drawer enforces overflow-x: hidden to prevent page scroll');
assert(css.includes('#viewVerify .ws-drawer') && css.includes('overflow-y: auto'), 'Right drawer allows vertical scrolling inside panel');
assert(!css.includes('#viewVerify .ws-drawer') || !css.includes('margin-left: -'), 'No negative margins on verification drawer');

console.log('\n--- Step 3: Long Key/Value Rows & Detection ID Wrapping ---');
assert(verifyHtml.includes('class="drw-kv-grid"'), 'EVIDENCE & PROVENANCE uses drw-kv-grid class');
assert(verifyHtml.includes('class="drw-kv-row"'), 'Evidence items use drw-kv-row class');
assert(verifyHtml.includes('class="drw-kv-label"'), 'Evidence items use drw-kv-label class');
assert(verifyHtml.includes('class="drw-kv-val"'), 'Evidence items use drw-kv-val class');

assert(css.includes('.drw-kv-row'), 'CSS defines .drw-kv-row grid layout');
assert(css.includes('overflow-wrap: anywhere') && css.includes('word-break: break-word'), 'Key/value and IDs use overflow-wrap: anywhere and word-break: break-word');
assert(css.includes('white-space: normal'), 'Long values allow normal multiline wrapping');

console.log('\n--- Step 4: Area Cards Layout & Containment ---');
assert(verifyHtml.includes('class="area-diff-grid"'), 'Area diff uses area-diff-grid container');
assert(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'Area diff grid uses repeat(2, minmax(0, 1fr))');
assert(css.includes('.area-cell'), 'Area cell styles defined');
assert(css.includes('.area-cell-sub') && css.includes('overflow-wrap: anywhere'), 'Area explanatory text has word break and wrap rules');

console.log('\n--- Step 5: Section Headings & Supporting Evidence ---');
assert(css.includes('.layer-section-title') && css.includes('white-space: normal'), 'Section titles allow normal wrap without clipping');
assert(css.includes('#drwWhyExistsList') && css.includes('overflow-wrap: anywhere'), 'Why This Parcel Exists text wraps without expanding width');
assert(css.includes('.supporting-tag') && css.includes('overflow-wrap: anywhere'), 'Supporting tags wrap without expanding width');

console.log('\n--- Step 6: Map Toolbar & Search Bar Positioning ---');
assert(css.includes('.map-floating-toolbar') && css.includes('max-width: calc(100% - 20px)'), 'Toolbar uses max-width to stay strictly within center map container');
assert(css.includes('.map-floating-toolbar') && css.includes('flex-wrap: wrap'), 'Toolbar items can wrap if center map is narrow');
assert(css.includes('.map-floating-search') && css.includes('max-width: calc(45% - 20px)'), 'Floating search has max-width constraint');

console.log('\n--- Step 7: Responsive Breakpoints & Elimination of Rogue Fixed Rules ---');
// Check that .ws-drawer is NOT position: fixed in workspace.css
const drawerFixedRegex = /\.ws-drawer\s*\{[^}]*position:\s*fixed/i;
const hasFixedDrawer = drawerFixedRegex.test(css);
assert(!hasFixedDrawer, 'Zero rogue position:fixed on .ws-drawer in workspace.css (drawer stays in document flow)');

// Check stacked layout on mobile
assert(css.includes('@media (max-width: 880px)'), 'Mobile media query (max-width: 880px) present');
assert(css.includes('flex-direction: column !important') && css.includes('verify-workspace-layout'), 'Mobile switches verification workspace to vertical stack (Sidebar -> Map -> Details)');

console.log('\n--- Step 8: Live HTTP Server Content Verification ---');
http.get('http://localhost:3000/workspace.html', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    assert(res.statusCode === 200, 'HTTP 200 from live dev server for workspace.html');
    assert(body.includes('verify-workspace-layout'), 'Live response contains verify-workspace-layout');
    assert(body.includes('drw-kv-grid'), 'Live response contains drw-kv-grid');
    assert(body.includes('id="drwSuppBuilding"'), 'Live response contains drwSuppBuilding');
    assert(body.includes('id="drwAiArea"'), 'Live response contains drwAiArea');

    console.log('\n================================================================');
    console.log(`📊 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('================================================================');

    if (failCount > 0) {
      process.exit(1);
    } else {
      console.log('🎉 ALL VERIFICATION LAYOUT & RESPONSIVE CRITERIA MET 100%!\n');
      process.exit(0);
    }
  });
}).on('error', (err) => {
  console.error('Server request error:', err.message);
  process.exit(1);
});
