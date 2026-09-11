import fs from 'fs';
import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';
import { GISEngine } from '../server/services/gisEngine.js';

const dbData = JSON.parse(fs.readFileSync('./data/parcelmap_db.json', 'utf8'));
const imgId = 'img_1789118184412_8b81';
const feats = (dbData.detectedFeatures || []).filter(f => f.imagery_id === imgId);
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

const roadGraph = RoadSpatialReasoningService.processRoadNetwork(roads, false, 1536, 1024, []);
const landBlocks = RoadSpatialReasoningService.identifyLandBlocks({ roadGraph, waterRings: [], linearBoundaries: [], imageWidth: 1536, imageHeight: 1024 });

console.log(`Loaded: ${roads.length} roads, ${fields.length} fields, ${bounds.length} bounds, ${bldgs.length} bldgs`);
console.log(`Land blocks: ${landBlocks.length}`);

// We simulate the 3 sections:
const candidates = [];
const rejections = [];

// SECTION 1: Fields
fields.forEach(field => {
  const imgRing = extractPoints(field);
  if (imgRing.length < 3) return;
  let cleanRing = RoadSpatialReasoningService.regularizeParcelGeometry(imgRing, 8.0);
  if (!cleanRing || cleanRing.length < 4) cleanRing = imgRing;
  const closedRing = [...cleanRing];
  if (closedRing[0][0] !== closedRing[closedRing.length - 1][0] || closedRing[0][1] !== closedRing[closedRing.length - 1][1]) {
    closedRing.push([closedRing[0][0], closedRing[0][1]]);
  }
  const pxArea = GISEngine.planarArea(closedRing);
  const edgeAnalysis = RoadSpatialReasoningService.analyzeEdgeSupport(closedRing, { roads, boundaries: bounds, fields, buildings: bldgs }, field.id);
  const { supported_edge_pct, unsupported_edge_pct, road_supported_pct, wall_fence_supported_pct, field_supported_pct, unsupported_direction } = edgeAnalysis;

  if (pxArea > 35000 && (unsupported_edge_pct > 35 || road_supported_pct < 10)) {
    rejections.push({ id: field.id, reason: 'Giant unpartitioned field' });
    return;
  }
  if (supported_edge_pct < 40) {
    rejections.push({ id: field.id, reason: `Insufficient boundary evidence (${supported_edge_pct}%)` });
    return;
  }
  if (road_supported_pct === 0 && wall_fence_supported_pct < 25) {
    rejections.push({ id: field.id, reason: 'No road and <25% wall' });
    return;
  }
  const jaggedCheck = RoadSpatialReasoningService.detectJaggedMaskArtifact(closedRing);
  if (jaggedCheck.isJagged && (supported_edge_pct < 65 || road_supported_pct === 0)) {
    rejections.push({ id: field.id, reason: 'Jagged mask artifact' });
    return;
  }
  candidates.push({
    id: `PM-FIELD-${field.id.split('_').pop()}`,
    source: 'field',
    area_px: Math.round(pxArea),
    supported_edge_pct,
    road_supported_pct,
    wall_fence_supported_pct,
    unsupported_edge_pct,
    status: (supported_edge_pct >= 65 && road_supported_pct >= 10 && pxArea <= 38000) ? 'ACCEPTED' : 'REVIEW'
  });
});

// SECTION 2: Physical boundaries
bounds.forEach(b => {
  const bCoords = extractPoints(b);
  if (bCoords.length < 2) return;
  const bCenter = [(bCoords[0][0] + bCoords[bCoords.length - 1][0]) / 2, (bCoords[0][1] + bCoords[bCoords.length - 1][1]) / 2];
  let nearestRoad = null, nearestDist = Infinity;
  roadGraph.segments.forEach(r => {
    const pr = RoadSpatialReasoningService.projectPointToPolyline(bCenter, r.coordinates);
    if (pr.distance < nearestDist && pr.distance <= 120) {
      nearestDist = pr.distance;
      nearestRoad = r;
    }
  });
  if (!nearestRoad) {
    rejections.push({ id: b.id, reason: 'Isolated boundary line' });
    return;
  }
  const rawSnapped = RoadSpatialReasoningService.constructLocalBoundaryPolygon(bCoords, nearestRoad.coordinates, 120);
  if (!rawSnapped || rawSnapped.length < 4) {
    rejections.push({ id: b.id, reason: 'Cannot close boundary' });
    return;
  }
  let snapped = RoadSpatialReasoningService.regularizeParcelGeometry(rawSnapped, 6.0) || rawSnapped;
  if (snapped[0][0] !== snapped[snapped.length - 1][0] || snapped[0][1] !== snapped[snapped.length - 1][1]) {
    snapped.push([snapped[0][0], snapped[0][1]]);
  }
  const areaVal = GISEngine.planarArea(snapped);
  if (areaVal < 3500) {
    rejections.push({ id: b.id, reason: `Area too small (${Math.round(areaVal)} px²)` });
    return;
  }
  if (areaVal > 45000) {
    rejections.push({ id: b.id, reason: 'Area too large' });
    return;
  }
  const edge = RoadSpatialReasoningService.analyzeEdgeSupport(snapped, { roads, boundaries: bounds, fields, buildings: bldgs }, b.id);
  if (edge.supported_edge_pct < 35) {
    rejections.push({ id: b.id, reason: `Insufficient edge support (${edge.supported_edge_pct}%)` });
    return;
  }
  candidates.push({
    id: `PM-BOUND-${b.id.split('_').pop()}`,
    source: 'boundary',
    area_px: Math.round(areaVal),
    supported_edge_pct: edge.supported_edge_pct,
    road_supported_pct: edge.road_supported_pct,
    wall_fence_supported_pct: edge.wall_fence_supported_pct,
    unsupported_edge_pct: edge.unsupported_edge_pct,
    status: edge.supported_edge_pct >= 65 ? 'ACCEPTED' : 'REVIEW'
  });
});

// SECTION 3: Road Corridor Holding Clusters
const roadClusters = {};
roadGraph.segments.forEach(r => { roadClusters[r.id] = { road: r, bldgs: [], bounds: [] }; });

bldgs.forEach(b => {
  const c = RoadSpatialReasoningService.getFeatureCenter(b);
  // Check if inside existing candidates
  const insideCand = candidates.some(cand => false);
  let minDist = Infinity, bestRoad = null;
  roadGraph.segments.forEach(r => {
    const pr = RoadSpatialReasoningService.projectPointToPolyline(c, r.coordinates);
    if (pr.distance < minDist) { minDist = pr.distance; bestRoad = r; }
  });
  if (bestRoad && minDist <= 120) {
    roadClusters[bestRoad.id].bldgs.push(b);
  }
});

bounds.forEach(b => {
  const pts = extractPoints(b);
  if (!pts.length) return;
  const c = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
  let minDist = Infinity, bestRoad = null;
  roadGraph.segments.forEach(r => {
    const pr = RoadSpatialReasoningService.projectPointToPolyline(c, r.coordinates);
    if (pr.distance < minDist) { minDist = pr.distance; bestRoad = r; }
  });
  if (bestRoad && minDist <= 120) {
    roadClusters[bestRoad.id].bounds.push(b);
  }
});

Object.values(roadClusters).forEach(({ road, bldgs: cBldgs, bounds: cBounds }) => {
  if (cBldgs.length === 0 && cBounds.length === 0) return;
  const holdingPoints = [];
  road.coordinates.forEach(p => holdingPoints.push(p));
  cBldgs.forEach(b => extractPoints(b).forEach(p => holdingPoints.push(p)));
  cBounds.forEach(b => extractPoints(b).forEach(p => holdingPoints.push(p)));
  if (holdingPoints.length < 3) return;

  const rawPoly = RoadSpatialReasoningService.computeNaturalLandPolygon(holdingPoints);
  let poly = RoadSpatialReasoningService.regularizeParcelGeometry(rawPoly, 6.0) || rawPoly;
  if (poly[0][0] !== poly[poly.length - 1][0] || poly[0][1] !== poly[poly.length - 1][1]) {
    poly.push([poly[0][0], poly[0][1]]);
  }
  const pxArea = GISEngine.planarArea(poly);
  if (pxArea < 3500 || pxArea > 45000) {
    rejections.push({ id: `corridor_${road.id}`, reason: `Area out of bounds (${Math.round(pxArea)} px²)` });
    return;
  }
  const edge = RoadSpatialReasoningService.analyzeEdgeSupport(poly, { roads, boundaries: bounds, fields, buildings: bldgs });
  if (edge.supported_edge_pct < 38) {
    rejections.push({ id: `corridor_${road.id}`, reason: `Insufficient edge support (${edge.supported_edge_pct}%)` });
    return;
  }
  candidates.push({
    id: `PM-CORRIDOR-${road.id.split('_').pop()}`,
    source: 'road_corridor',
    road_name: road.name,
    area_px: Math.round(pxArea),
    supported_edge_pct: edge.supported_edge_pct,
    road_supported_pct: edge.road_supported_pct,
    wall_fence_supported_pct: edge.wall_fence_supported_pct,
    unsupported_edge_pct: edge.unsupported_edge_pct,
    status: edge.supported_edge_pct >= 60 ? 'ACCEPTED' : 'REVIEW'
  });
});

console.log('\n--- SIMULATION RESULTS ---');
console.log(`Total Candidates: ${candidates.length}`);
candidates.forEach(c => console.log(`  ${c.id} [${c.status}]: ${c.area_px} px², edge support: ${c.supported_edge_pct}% (road: ${c.road_supported_pct}%, wall: ${c.wall_fence_supported_pct}%, unsupp: ${c.unsupported_edge_pct}%)`));
console.log(`Total Rejections: ${rejections.length}`);
