import { db } from '../server/db/database.js';
import * as turf from '@turf/turf';

function isPointInPoly(pt, ring) {
  let inside = false;
  const x = pt[0], y = pt[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function planarArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i+1][1] - ring[i+1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

const projectId = 'proj_wagholi_demo';
const imageryId = 'img_1788964523454_0vfv';
const features = db.getFeaturesByProjectId(projectId, imageryId);

const roads = features.filter(f => f.detection_type === 'ROAD' || f.type === 'road');
const buildings = features.filter(f => f.detection_type === 'BUILDING' || f.type === 'building');
const fields = features.filter(f => f.detection_type === 'FIELD' || f.type === 'field');
const walls = features.filter(f => f.detection_type === 'WALL' || f.type === 'wall');
const fences = features.filter(f => f.detection_type === 'FENCE' || f.type === 'fence');
const water = features.filter(f => f.detection_type === 'WATER' || f.type === 'water');

console.log(`Detections: Roads=${roads.length}, Buildings=${buildings.length}, Fields=${fields.length}, Walls=${walls.length}, Fences=${fences.length}, Water=${water.length}`);

const waterRings = water.map(w => w.image_coordinates || w.geometry?.coordinates?.[0] || []).filter(r => r.length >= 3);
console.log('Water rings count:', waterRings.length);

const rejections = [];
const rawCandidates = [];

// 1. Fields
fields.forEach(f => {
  const ring = f.image_coordinates || f.geometry?.coordinates?.[0] || [];
  if (ring.length >= 3) {
    rawCandidates.push({
      type: 'field',
      name: f.name,
      ring,
      confidence: f.confidence || 0.78,
      supporting: [f.name || 'Agricultural Field']
    });
  }
});

// 2. Buildings
buildings.forEach(b => {
  const bRing = b.image_coordinates || b.geometry?.coordinates?.[0] || [];
  if (bRing.length >= 3) {
    // Check if building has nearby walls/fences
    const bCenter = [
      bRing.reduce((s, p) => s + p[0], 0) / bRing.length,
      bRing.reduce((s, p) => s + p[1], 0) / bRing.length
    ];
    
    // Find nearby boundaries
    const nearbyBoundaries = [...walls, ...fences].filter(w => {
      const wCoords = w.image_coordinates || w.geometry?.coordinates || [];
      return wCoords.some(pt => Math.hypot(pt[0] - bCenter[0], pt[1] - bCenter[1]) <= 65);
    });

    // Find nearby road frontage
    const nearbyRoad = roads.find(r => {
      const rCoords = r.image_coordinates || r.geometry?.coordinates || [];
      return rCoords.some(pt => Math.hypot(pt[0] - bCenter[0], pt[1] - bCenter[1]) <= 55);
    });

    // Build curtilage buffer around building
    const minX = Math.min(...bRing.map(p => p[0]));
    const maxX = Math.max(...bRing.map(p => p[0]));
    const minY = Math.min(...bRing.map(p => p[1]));
    const maxY = Math.max(...bRing.map(p => p[1]));
    const pad = 24.0;
    const curtilage = [
      [Math.round(minX - pad), Math.round(minY - pad)],
      [Math.round(maxX + pad), Math.round(minY - pad)],
      [Math.round(maxX + pad), Math.round(maxY + pad)],
      [Math.round(minX - pad), Math.round(maxY + pad)],
      [Math.round(minX - pad), Math.round(minY - pad)]
    ];

    const supporting = [b.name || 'Building Structure'];
    let conf = b.confidence || 0.85;

    if (nearbyBoundaries.length > 0) {
      conf += 0.08;
      nearbyBoundaries.forEach(nb => supporting.push(`${nb.feature_type || 'Boundary'} (${nb.name})`));
    }
    if (nearbyRoad) {
      conf += 0.06;
      supporting.push(`Road Frontage (${nearbyRoad.name})`);
    }

    rawCandidates.push({
      type: 'building_curtilage',
      name: `Compound (${b.name || 'Residence'})`,
      ring: curtilage,
      confidence: Number(Math.min(0.95, conf).toFixed(2)),
      supporting
    });
  }
});

console.log('Raw candidates generated:', rawCandidates.length);

// Validation
const validParcels = [];
const imageW = 1536, imageH = 1024;
const totalArea = imageW * imageH;
const maxDim = Math.max(imageW, imageH);

rawCandidates.forEach(cand => {
  const ring = cand.ring;
  if (ring.length < 4) {
    rejections.push({ category: 'Invalid geometry', reason: 'Too few vertices' });
    return;
  }
  const area = planarArea(ring);
  if (area < 500) {
    rejections.push({ category: 'Invalid geometry', reason: 'Degenerate area / sliver' });
    return;
  }
  if (area > totalArea * 0.25) {
    rejections.push({ category: 'Huge polygon', reason: 'Area exceeds threshold' });
    return;
  }

  // Water check
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const inWater = waterRings.some(wRing => isPointInPoly([cx, cy], wRing));
  if (inWater) {
    rejections.push({ category: 'Water overlap', reason: 'Centroid inside water body' });
    return;
  }

  let vertexInWater = false;
  for (const pt of ring) {
    if (waterRings.some(wRing => isPointInPoly(pt, wRing))) {
      vertexInWater = true;
      break;
    }
  }
  if (vertexInWater) {
    rejections.push({ category: 'Water overlap', reason: 'Vertex inside water body' });
    return;
  }

  validParcels.push(cand);
});

console.log(`Validated parcels: ${validParcels.length}, Rejected: ${rejections.length}`);
console.log('Rejections:', rejections);
