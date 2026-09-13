import { db } from '../server/db/database.js';

const proj = db.getProjectById('proj_demo_coastal');
const imgs = db.getImageryByProjectId('proj_demo_coastal');
console.log('Project:', proj?.name);
console.log('Imagery:', imgs.map(i => ({ id: i.id, file_name: i.file_name, w: i.width, h: i.height })));
const features = db.getFeaturesByProjectId('proj_demo_coastal', imgs[0]?.id);
console.log('Total features:', features.length);
const byType = {};
features.forEach(f => {
  const t = f.detection_type || f.feature_type || f.type;
  byType[t] = (byType[t] || 0) + 1;
});
console.log('By type:', byType);
const bldgs = features.filter(f => (f.detection_type === 'BUILDING' || f.feature_type === 'Building'));
console.log('\n--- BUILDINGS (' + bldgs.length + ') ---');
bldgs.forEach(b => {
  const coords = b.image_coordinates || b.geometry?.coordinates?.[0];
  console.log(`- ID: ${b.id}, Name: ${b.name}, Conf: ${b.confidence}`);
  console.log(`  Coords: ${JSON.stringify(coords)}`);
});

const roads = features.filter(f => (f.detection_type === 'ROAD' || f.feature_type === 'Road'));
console.log('\n--- ROADS (' + roads.length + ') ---');
roads.forEach(r => {
  const coords = r.image_coordinates || r.geometry?.coordinates;
  console.log(`- ID: ${r.id}, Name: ${r.name}, Pts: ${coords?.length}`);
  console.log(`  Coords sample: ${JSON.stringify(coords?.slice(0, 4))} ... ${JSON.stringify(coords?.slice(-2))}`);
});

const bounds = features.filter(f => (f.detection_type === 'BOUNDARY' || f.detection_type === 'WALL' || f.detection_type === 'FENCE' || f.feature_type === 'Wall' || f.feature_type === 'Fence' || f.feature_type === 'Boundary'));
console.log('\n--- BOUNDARIES/WALLS/FENCES (' + bounds.length + ') ---');
bounds.forEach(b => {
  const coords = b.image_coordinates || b.geometry?.coordinates;
  console.log(`- ID: ${b.id}, Name: ${b.name}, Type: ${b.detection_type}`);
  console.log(`  Coords: ${JSON.stringify(coords)}`);
});

const water = features.filter(f => (f.detection_type === 'WATER' || f.feature_type === 'Water' || f.type === 'water'));
console.log('\n--- WATER (' + water.length + ') ---');
water.forEach(w => {
  const coords = w.image_coordinates || w.geometry?.coordinates?.[0];
  console.log(`- ID: ${w.id}, Name: ${w.name}, Pts: ${coords?.length}`);
});
