import fs from 'fs';
import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';
import { db } from '../server/db/database.js';
import { GISEngine } from '../server/services/gisEngine.js';

const imgId = 'img_1789118184412_8b81';
const dbData = db.data || JSON.parse(fs.readFileSync('./data/parcelmap_db.json', 'utf8'));
const feats = (dbData.detectedFeatures || []).filter(f => f.imagery_id === imgId);
const roads = feats.filter(f => f.detection_type === 'ROAD');
const bldgs = feats.filter(f => f.detection_type === 'BUILDING');
const bounds = feats.filter(f => ['WALL', 'FENCE', 'BOUNDARY'].includes(f.detection_type));
const fields = feats.filter(f => f.detection_type === 'FIELD');

const roadGraph = RoadSpatialReasoningService.processRoadNetwork(roads, false, 1536, 1024, []);
const blocks = RoadSpatialReasoningService.identifyLandBlocks({ roadGraph, waterRings: [], linearBoundaries: [], imageWidth: 1536, imageHeight: 1024 });

console.log('Roads count:', roads.length);
console.log('Blocks:', blocks.map(b => ({ id: b.id, name: b.name, bounds: b.bounds })));

blocks.forEach(block => {
  const unassignedBldgs = bldgs.filter(bg => {
    const center = RoadSpatialReasoningService.getFeatureCenter(bg);
    return RoadSpatialReasoningService.isPointInLandBlock(center, block);
  });
  const unassignedBounds = bounds.filter(b => {
    const coords = b.image_coordinates || b.geometry?.coordinates || [];
    if (!coords.length) return false;
    const center = [(coords[0][0] + coords[coords.length - 1][0]) / 2, (coords[0][1] + coords[coords.length - 1][1]) / 2];
    return RoadSpatialReasoningService.isPointInLandBlock(center, block);
  });
  console.log(`Block ${block.id}: ${unassignedBldgs.length} bldgs, ${unassignedBounds.length} bounds`);

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

  const holdingPoints = [];
  unassignedBounds.forEach(b => {
    extractPoints(b).forEach(p => holdingPoints.push(p));
  });
  unassignedBldgs.forEach(b => {
    extractPoints(b).forEach(p => holdingPoints.push(p));
  });

  console.log(`  Holding points count: ${holdingPoints.length}`);
  if (holdingPoints.length >= 3) {
    const rawHoldingPolygon = RoadSpatialReasoningService.computeNaturalLandPolygon(holdingPoints);
    const pxArea = GISEngine.planarArea(rawHoldingPolygon);
    console.log(`  rawHoldingPolygon vertices: ${rawHoldingPolygon.length}, pxArea: ${Math.round(pxArea)}`);
    const edgeAnalysis = RoadSpatialReasoningService.analyzeEdgeSupport(rawHoldingPolygon, { roads, boundaries: bounds, fields, buildings: bldgs });
    console.log(`  edgeAnalysis: supported=${edgeAnalysis.supported_edge_pct}%, road=${edgeAnalysis.road_supported_pct}%, wall=${edgeAnalysis.wall_fence_supported_pct}%, dir=${edgeAnalysis.unsupported_direction}`);
  }
});
