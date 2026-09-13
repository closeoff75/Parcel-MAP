import { db } from '../server/db/database.js';
import * as turf from '@turf/turf';

const projectId = 'proj_1789117650907';
const imageryId = 'img_1789142537501_t33b';
const parcels = db.getParcelsByProjectId(projectId, imageryId);
const features = db.getFeaturesByProjectId(projectId, imageryId);
const roads = features.filter(f => f.detection_type === 'ROAD' || f.feature_type === 'Road');
const buildings = features.filter(f => f.detection_type === 'BUILDING' || f.feature_type === 'Building');
const walls = features.filter(f => ['WALL', 'FENCE', 'BOUNDARY', 'Wall', 'Fence'].includes(f.detection_type || f.feature_type));
const water = features.filter(f => f.detection_type === 'WATER' || f.feature_type === 'Water');

console.log('Total parcels:', parcels.length);

parcels.forEach(p => {
  const pPoly = turf.polygon(p.geometry.coordinates);
  const bbox = turf.bbox(pPoly);
  const w = bbox[2] - bbox[0];
  const h = bbox[3] - bbox[1];
  
  // Find enclosed buildings
  const bCentroids = buildings.map(b => {
    const coords = b.geometry?.coordinates?.[0] || [];
    let cx = 0, cy = 0;
    coords.forEach(([x, y]) => { cx += x; cy += y; });
    return { id: b.id, name: b.name, pt: turf.point([cx / coords.length, cy / coords.length]) };
  });
  
  const enclosed = bCentroids.filter(b => turf.booleanPointInPolygon(b.pt, pPoly));
  
  // Check road crossings
  const roadCrossings = roads.filter(r => {
    const coords = r.geometry.coordinates;
    if (!coords || coords.length < 2) return false;
    const rLine = turf.lineString(coords);
    return turf.booleanIntersects(pPoly, rLine);
  });
  
  // Check water crossings
  const waterCrossings = water.filter(w => {
    const coords = w.geometry.coordinates;
    if (!coords || coords.length < 1) return false;
    const wPoly = turf.polygon(coords);
    return turf.booleanIntersects(pPoly, wPoly);
  });
  
  console.log('\n--- Parcel:', p.parcel_id, '[' + p.candidate_status + ']');
  console.log('  Confidence:', p.confidence, '| Supported Perimeter:', p.supported_perimeter_pct + '%');
  console.log('  BBox: W=' + w.toFixed(1) + 'px, H=' + h.toFixed(1) + 'px, Ratio=' + (w/h).toFixed(2));
  console.log('  Area px:', p.area_px);
  console.log('  Enclosed Buildings (' + enclosed.length + '):', enclosed.map(b => b.name).join(', '));
  console.log('  Road Crossings:', roadCrossings.length);
  console.log('  Water Crossings:', waterCrossings.length);
  console.log('  Supporting Features:', p.supporting_features);
});
