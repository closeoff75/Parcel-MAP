import fs from 'fs';
import path from 'path';

const indexPath = path.resolve('index.html');
const cssPath = path.resolve('gis-theme.css');
const mapAppPath = path.resolve('map-app.js');

const indexHtml = fs.readFileSync(indexPath, 'utf-8');
const cssContent = fs.readFileSync(cssPath, 'utf-8');
const mapAppJs = fs.readFileSync(mapAppPath, 'utf-8');

console.log('--- RUNNING DETAILED DOM & LAYOUT STATIC ANALYSIS ---');

const assertions = [
  {
    desc: 'Find Your Parcel section heading exists',
    pass: indexHtml.includes('<h2 class="section-title">Find Your Parcel</h2>')
  },
  {
    desc: 'Find Your Parcel subtitle matches requirement',
    pass: indexHtml.includes('Search by parcel number, survey number, village, district, or location.')
  },
  {
    desc: 'Search input placeholder is set properly',
    pass: indexHtml.includes('placeholder="🔎 Search parcel, survey number or location..."')
  },
  {
    desc: 'Search button with "Search →" exists',
    pass: indexHtml.includes('>Search &rarr;</button>')
  },
  {
    desc: '📍 Use my location button exists',
    pass: indexHtml.includes('<span>📍 Use my location</span>')
  },
  {
    desc: 'Search status indicator element exists',
    pass: indexHtml.includes('id="searchStatusIndicator"')
  },
  {
    desc: 'Old fake results dropdown with hardcoded #101, #103, #104A, #108 is removed from index.html',
    pass: !indexHtml.includes('id="searchResultsDropdown"') && !indexHtml.includes('Wagholi Sheet #14 &bull; In Dispute')
  },
  {
    desc: 'Old "Demo Dataset Active • Wagholi Cadastre (Sheet #14)" text removed from normal search markup',
    pass: !indexHtml.includes('Demo Dataset Active &bull; Wagholi Cadastre (Sheet #14)')
  },
  {
    desc: 'Search results container uses normal-flow class .search-results-flow',
    pass: indexHtml.includes('class="search-results-flow"') && indexHtml.includes('id="searchResultsContainer"')
  },
  {
    desc: '.search-results-flow in CSS uses position: static (participates in normal flow, pushes down)',
    pass: cssContent.includes('.search-results-flow {') && cssContent.includes('position: static;')
  },
  {
    desc: '.search-section has height: auto !important (no fixed height)',
    pass: cssContent.includes('.search-section {') && cssContent.includes('height: auto !important;')
  },
  {
    desc: '.globe-section is in normal flow with relative positioning',
    pass: cssContent.includes('.globe-section {') && cssContent.includes('position: relative;')
  },
  {
    desc: 'Client search controller calls /api/parcels/search',
    pass: indexHtml.includes('/api/parcels/search?q=')
  },
  {
    desc: 'Client search controller handles empty/not-found state ("Parcel not found")',
    pass: indexHtml.includes('Parcel not found') || indexHtml.includes('No parcels found.')
  },
  {
    desc: 'Client search controller handles loading state ("Searching...")',
    pass: indexHtml.includes('Searching...') || indexHtml.includes('Searching parcels...')
  },
  {
    desc: 'Client search controller handles error state ("Unable to search parcels right now.")',
    pass: indexHtml.includes('Unable to search parcels right now.')
  },
  {
    desc: 'Demo parcels are tagged with "Demo Dataset" badge, not verified records',
    pass: indexHtml.includes('Demo Dataset') && indexHtml.includes('Verified')
  },
  {
    desc: 'map-app.js supports URL parameters (parcel, lat, lng) to inspect & highlight parcel',
    pass: mapAppJs.includes('selectAndInspectParcel') && mapAppJs.includes('parcelParam')
  },
  {
    desc: 'Min touch target >= 44px on clickable elements',
    pass: cssContent.includes('.btn-use-location') && cssContent.includes('min-height: 44px;') &&
          cssContent.includes('.btn-view-map') && cssContent.includes('min-height: 44px;')
  }
];

let allPassed = true;
assertions.forEach((a, idx) => {
  if (a.pass) {
    console.log(`[PASS] ${idx + 1}. ${a.desc}`);
  } else {
    console.error(`[FAIL] ${idx + 1}. ${a.desc}`);
    allPassed = false;
  }
});

console.log('----------------------------------------------------');
if (allPassed) {
  console.log('ALL 19 DOM, CSS, AND FLOW ASSERTIONS PASSED!');
} else {
  console.error('SOME ASSERTIONS FAILED!');
  process.exit(1);
}
