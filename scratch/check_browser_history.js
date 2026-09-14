import fs from 'fs';
import path from 'path';
import os from 'os';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const historyPaths = [
  path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
  path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'History'),
  path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'History')
];

const found = new Set();

for (const hp of historyPaths) {
  if (fs.existsSync(hp)) {
    try {
      const tempPath = path.join(os.tmpdir(), `hist_${Date.now()}_${Math.random().toString(36).substring(2,6)}`);
      fs.copyFileSync(hp, tempPath);
      const buf = fs.readFileSync(tempPath);
      const str = buf.toString('latin1');
      const matches = str.match(/https?:\/\/[a-zA-Z0-9-]+\.netlify\.app[^\s\"')<>]*/gi);
      if (matches) {
        for (const m of matches) {
          found.add(m);
        }
      }
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.error(`Error reading ${hp}: ${e.message}`);
    }
  }
}

console.log('Discovered Netlify URLs:');
for (const u of found) {
  console.log(' -', u);
}
