/**
 * Verification script for darkroomengineering/lenis smooth scrolling integration
 */
import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASS] ${message}`);
}

console.log('===============================================================');
console.log('⚡ LENIS SMOOTH SCROLL INTEGRATION VERIFICATION');
console.log('===============================================================');

// 1. package.json check
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert(pkg.dependencies && pkg.dependencies.lenis, 'TEST 1: lenis package is installed in package.json');

// 2. smooth-scroll.js check
const smoothScrollJs = fs.readFileSync('smooth-scroll.js', 'utf8');
assert(smoothScrollJs.includes("import Lenis from 'lenis'"), 'TEST 2: Lenis is imported in smooth-scroll.js');
assert(smoothScrollJs.includes("import 'lenis/dist/lenis.css'"), 'TEST 3: Lenis CSS is imported in smooth-scroll.js');
assert(smoothScrollJs.includes('new Lenis('), 'TEST 4: Lenis instance is created with modern configuration');
assert(smoothScrollJs.includes('window.lenis = lenis'), 'TEST 5: window.lenis is exposed globally');
assert(smoothScrollJs.includes('window.smoothScrollToGlobe = function'), 'TEST 6: window.smoothScrollToGlobe helper is exported');

// 3. index.html integration check
const indexHtml = fs.readFileSync('index.html', 'utf8');
assert(indexHtml.includes('<script type="module" src="./smooth-scroll.js"></script>'), 'TEST 7: smooth-scroll.js is included in index.html');
assert(indexHtml.includes('window.smoothScrollToGlobe()'), 'TEST 8: window.smoothScrollToGlobe() is invoked on parcel selection');
assert(indexHtml.includes('window.lenis.scrollTo('), 'TEST 9: direct lenis.scrollTo target option is supported');
assert(indexHtml.includes('globeSection.scrollIntoView({'), 'TEST 10: Fallback to native scrollIntoView is maintained');

console.log('===============================================================');
console.log('📊 ALL 10/10 LENIS INTEGRATION CHECKS PASSED!');
console.log('===============================================================');
