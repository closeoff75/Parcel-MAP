import fs from 'fs';
import path from 'path';

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const fp = path.join(dir, f);
    if (f === 'node_modules' || f === '.git' || f === 'venv' || f === '.system_generated' || f === '.tempmediaStorage') return;
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp);
    else {
      try {
        const txt = fs.readFileSync(fp, 'utf8');
        const m = txt.match(/https?:\/\/[^\s'"`\(\)]*(?:tile|osm|carto|mapbox|arcgis)[^\s'"`\(\)]*/gi);
        if (m) console.log(fp, m);
      } catch(e) {}
    }
  });
}
walk('.');
