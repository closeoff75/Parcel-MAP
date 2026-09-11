// Test script for Find Parcel search functionality and layout flow
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

async function runTests() {
  console.log('--- STARTING FIND PARCEL VERIFICATION ---');

  const tests = [
    {
      name: 'TEST B: Search for 101',
      q: '101',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.some(p => (p.display_name && p.display_name.includes('101')) || (p.parcel_id && p.parcel_id.includes('101')));
      }
    },
    {
      name: 'TEST C: Search for 104A',
      q: '104A',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.some(p => (p.display_name && p.display_name.includes('104A')) || (p.parcel_id && p.parcel_id.includes('104A')));
      }
    },
    {
      name: 'TEST D: Search for invalid parcel 999999',
      q: '999999',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.length === 0 && r.total === 0;
      }
    },
    {
      name: 'TEST E: Search for location Wagholi',
      q: 'Wagholi',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.length > 0 && items.some(p => p.location.includes('Wagholi') || p.project_name.includes('Wagholi'));
      }
    },
    {
      name: 'TEST: Search for survey number 42/1',
      q: '42/1',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.some(p => (p.survey_no && p.survey_no.includes('42/1')));
      }
    },
    {
      name: 'TEST: Search real project parcel PM-0001',
      q: 'PM-0001',
      check: r => {
        const items = r.results || r.parcels || [];
        return items.some(p => (p.parcel_id && p.parcel_id.includes('PM-0001')));
      }
    }
  ];

  let passed = 0;
  for (const t of tests) {
    const res = await fetchJson(`http://localhost:3001/api/parcels/search?q=${encodeURIComponent(t.q)}&limit=8`);
    const items = res.data.results || res.data.parcels || [];
    const ok = res.status === 200 && t.check(res.data);
    if (ok) {
      console.log(`[PASS] ${t.name}: status=${res.status}, items=${items.length}, total=${res.data.total}`);
      if (items.length > 0) {
        console.log(`       Sample result: ${items[0].display_name} | ${items[0].survey_no} | ${items[0].location} | MapURL: ${items[0].map_url}`);
      }
      passed++;
    } else {
      console.error(`[FAIL] ${t.name}: status=${res.status}, data=`, res.data);
    }
  }

  console.log(`\n========================================`);
  console.log(`TOTAL API TESTS: ${passed}/${tests.length} PASSED`);
  console.log(`========================================`);

  if (passed !== tests.length) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
