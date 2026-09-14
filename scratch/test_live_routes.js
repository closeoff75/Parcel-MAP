// Forensic Route Inspection Script for Netlify Production
const baseUrl = 'https://resilient-figolla-23b96e.netlify.app';

const routes = [
  '/',
  '/workspace.html',
  '/workspace',
  '/.netlify/functions/api/projects',
  '/api/projects',
  '/.netlify/functions/upload',
  '/api/upload'
];

async function checkRoutes() {
  console.log(`Testing Base URL: ${baseUrl}\n`);
  for (const r of routes) {
    const url = baseUrl + r;
    try {
      const res = await fetch(url, {
        method: r.includes('upload') ? 'OPTIONS' : 'GET',
        headers: { 'Accept': 'application/json, text/html, */*' }
      });
      const text = await res.text();
      console.log(`[${res.status}] ${r}`);
      console.log(`  Content-Type: ${res.headers.get('content-type')}`);
      console.log(`  Body (first 200 chars): ${text.substring(0, 200).replace(/\n/g, ' ')}\n`);
    } catch (e) {
      console.error(`[ERROR] ${r}: ${e.message}\n`);
    }
  }
}

checkRoutes();
