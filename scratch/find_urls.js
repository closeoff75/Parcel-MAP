import { execSync } from 'child_process';

const log = execSync('git log -p', { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
const urls = new Set(log.match(/https?:\/\/[a-zA-Z0-9.-]+\.netlify\.app[^\s\"')<>]*/g) || []);
console.log('Found Netlify URLs in git history:');
for (const u of urls) {
  console.log(' -', u);
}
