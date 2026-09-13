import { db } from '../server/db/database.js';
import { GISEngine } from '../server/services/gisEngine.js';
import * as turf from '@turf/turf';

const features = db.getFeaturesByProjectId('proj_demo_coastal', 'img_demo_coastal');
const bldgs = features.filter(f => (f.detection_type === 'BUILDING' || f.feature_type === 'Building'));
const roads = features.filter(f => (f.detection_type === 'ROAD' || f.feature_type === 'Road'));
const walls = features.filter(f => (f.detection_type === 'WALL' || f.feature_type === 'Wall'));
const fences = features.filter(f => (f.detection_type === 'FENCE' || f.feature_type === 'Fence'));
const water = features.filter(f => (f.detection_type === 'WATER' || f.feature_type === 'Water'));

console.log(`Loaded ${features.length} features: ${bldgs.length} bldgs, ${roads.length} roads, ${walls.length} walls, ${fences.length} fences, ${water.length} water.`);

// Test residential parcel polygon definitions derived from features:
const h3 = bldgs.find(b => b.id.includes('building_3'));
const h2 = bldgs.find(b => b.id.includes('building_2'));
const h4 = bldgs.find(b => b.id.includes('building_4'));
const h1 = bldgs.find(b => b.id.includes('building_1'));
const h7 = bldgs.find(b => b.id.includes('building_7'));

const parcels = [
  {
    id: 'PM-0001',
    house: h3,
    ring: [[288, 100], [348, 125], [405, 142], [428, 60], [365, 52], [288, 100]],
    status: 'ACCEPTED',
    wall_ref: 'det_img_demo_coastal_wall_18',
    fence_ref: 'det_img_demo_coastal_fence_20'
  },
  {
    id: 'PM-0002',
    house: h2,
    ring: [[505, 83], [585, 101], [572, 185], [445, 168], [452, 95], [505, 83]],
    status: 'ACCEPTED',
    wall_ref: null,
    fence_ref: 'det_img_demo_coastal_fence_21'
  },
  {
    id: 'PM-0003',
    house: h4,
    ring: [[518, 288], [566, 337], [618, 352], [608, 288], [555, 265], [518, 288]],
    status: 'ACCEPTED',
    wall_ref: 'det_img_demo_coastal_wall_17',
    fence_ref: null
  },
  {
    id: 'PM-0004',
    house: h1,
    ring: [[646, 243], [696, 264], [728, 322], [658, 306], [646, 243]],
    status: 'ACCEPTED',
    wall_ref: 'det_img_demo_coastal_wall_19',
    fence_ref: null
  },
  {
    id: 'PM-0005',
    house: h7,
    ring: [[555, 262], [602, 275], [625, 226], [582, 212], [555, 262]],
    status: 'NEEDS REVIEW',
    wall_ref: 'det_img_demo_coastal_wall_16',
    fence_ref: null
  }
];

function isPointInPoly(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const waterRing = water[0].image_coordinates || water[0].geometry.coordinates[0];

console.log('\n--- VERIFYING RESIDENTIAL CANDIDATE ENCLOSURE & WATER EXCLUSION ---');
parcels.forEach(p => {
  const bCoords = p.house.image_coordinates || p.house.geometry.coordinates[0];
  const bCenter = [
    bCoords.reduce((s, pt) => s + pt[0], 0) / bCoords.length,
    bCoords.reduce((s, pt) => s + pt[1], 0) / bCoords.length
  ];
  const encloses = isPointInPoly(bCenter, p.ring);
  console.log(`\nParcel ${p.id} (${p.status}) anchored on ${p.house.name}:`);
  console.log(`- Encloses building centroid [${Math.round(bCenter[0])}, ${Math.round(bCenter[1])}]: ${encloses ? '✅ YES' : '❌ NO'}`);
  
  // Water check
  let waterCross = false;
  p.ring.forEach(pt => {
    if (isPointInPoly(pt, waterRing)) waterCross = true;
  });
  console.log(`- Water intersection: ${waterCross ? '❌ CROSSES WATER' : '✅ SAFE (INLAND)'}`);
  
  // Area & Perimeter
  const area = GISEngine.planarArea(p.ring);
  const perim = GISEngine.planarPerimeter(p.ring);
  console.log(`- Area: ${Math.round(area)} px², Perimeter: ${Math.round(perim)} px`);
});

console.log('\n--- VERIFYING PAIRWISE NON-OVERLAP ---');
let hasOverlap = false;
for (let i = 0; i < parcels.length; i++) {
  for (let j = i + 1; j < parcels.length; j++) {
    const p1 = turf.polygon([parcels[i].ring]);
    const p2 = turf.polygon([parcels[j].ring]);
    const inter = turf.intersect(turf.featureCollection([p1, p2]));
    if (inter) {
      const interArea = turf.area(inter);
      console.log(`⚠️ Overlap between ${parcels[i].id} and ${parcels[j].id}: ${interArea.toFixed(2)}`);
      if (interArea > 1) hasOverlap = true;
    } else {
      console.log(`✅ ${parcels[i].id} & ${parcels[j].id}: Disjoint (0 overlap)`);
    }
  }
}
console.log(`Overlap check result: ${hasOverlap ? '❌ FAILED' : '✅ 100% DISJOINT / CLEAN'}`);
