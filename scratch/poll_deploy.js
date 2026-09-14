const site = 'https://adorable-nasturtium-2d06b8.netlify.app';

async function poll() {
  console.log(`Polling ${site}/api/health...`);
  for (let i = 1; i <= 15; i++) {
    try {
      const res = await fetch(`${site}/api/health`, { headers: { 'Cache-Control': 'no-cache' } });
      const text = await res.text();
      console.log(`[Attempt ${i}] Status: ${res.status}`);
      if (res.status === 200) {
        console.log('SUCCESS! Deployment is LIVE:');
        console.log(text);
        process.exit(0);
      } else {
        console.log(`  Body preview: ${text.substring(0, 120)}`);
      }
    } catch (e) {
      console.log(`[Attempt ${i}] Error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log('Deploy polling timed out after 150s.');
  process.exit(1);
}

poll();
