import fs from 'fs';
import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';
import { GISEngine } from '../server/services/gisEngine.js';

const dbData = JSON.parse(fs.readFileSync('./data/parcelmap_db.json', 'utf8'));
const feats = (dbData.detectedFeatures || []).filter(f => f.imagery_id === 'img_1789118184412_8b81');
const roads = feats.filter(f => f.detection_type === 'ROAD');
const bldgs = feats.filter(f => f.detection_type === 'BUILDING');
const bounds = feats.filter(f => ['WALL', 'FENCE', 'BOUNDARY'].includes(f.detection_type));
const fields = feats.filter(f => f.detection_type === 'FIELD');

const extractPoints = (feat) => {
  let coords = feat.image_coordinates || feat.geometry?.coordinates || [];
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && typeof coords[0][0][0] === 'number') {
    coords = coords[0];
  }
  if (Array.isArray(coords) && coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    return coords;
  }
  return [];
};

// Group buildings and walls by nearest road corridor
const clusters = {};
roads.forEach(r => { clusters[r.id] = { road: r, bldgs: [], bounds: [] }; });

bldgs.forEach(b => {
  const c = RoadSpatialReasoningService.getFeatureCenter(b);
  let minDist = Infinity, bestRoad = null;
  roads.forEach(r => {
    const pr = RoadSpatialReasoningService.projectPointToPolyline(c, r.image_coordinates);
    if (pr.distance < minDist) { minDist = pr.distance; bestRoad = r; }
  });
  if (bestRoad && minDist <= 120) {
    clusters[bestRoad.id].bldgs.push(b);
  }
});

bounds.forEach(b => {
  const pts = extractPoints(b);
  if (!pts.length) return;
  const c = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
  let minDist = Infinity, bestRoad = null;
  roads.forEach(r => {
    const pr = RoadSpatialReasoningService.projectPointToPolyline(c, r.image_coordinates);
    if (pr.distance < minDist) { minDist = pr.distance; bestRoad = r; }
  });
  if (bestRoad && minDist <= 120) {
    clusters[bestRoad.id].bounds.push(b);
  }
});

Object.values(clusters).forEach(({ road, bldgs: cBldgs, bounds: cBounds }) => {
  if (cBldgs.length === 0 && cBounds.length === 0) return;
  const holdingPoints = [];
  road.image_coordinates.forEach(p => holdingPoints.push(p));
  cBldgs.forEach(b => extractPoints(b).forEach(p => holdingPoints.push(p)));
  cBounds.forEach(b => extractPoints(b).forEach(p => holdingPoints.push(p)));
  
  if (holdingPoints.length < 3) return;
  const rawPoly = RoadSpatialReasoningService.computeNaturalLandPolygon(holdingPoints);
  const pxArea = GISEngine.planarArea(rawPoly);
  const edge = RoadSpatialReasoningService.analyzeEdgeSupport(rawPoly, { roads, boundaries: bounds, fields, buildings: bldgs });
  console.log(`Road ${road.name} (${road.id}):`);
  console.log(`  bldgs: ${cBldgs.length}, bounds: ${cBounds.length}, area: ${Math.round(pxArea)} px²`);
  console.log(`  edge support: ${edge.supported_edge_pct}% (road: ${edge.road_supported_pct}%, wall: ${edge.wall_fence_supported_pct}%, unsupported: ${edge.unsupported_edge_pct}% ${edge.unsupported_direction})`);
});
