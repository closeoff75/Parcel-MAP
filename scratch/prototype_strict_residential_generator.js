import fs from 'fs';
import * as turf from '@turf/turf';

const db = JSON.parse(fs.readFileSync('data/parcelmap_db.json'));
const bldgs = db.detectedFeatures.filter(f => f.feature_type === 'Building' && f.imagery_id === 'img_demo_coastal');
const road = db.detectedFeatures.find(f => f.id === 'det_img_demo_coastal_road_14');
const rCoords = road.image_coordinates;
const walls = db.detectedFeatures.filter(f => f.feature_type === 'Wall' && f.imagery_id === 'img_demo_coastal');
const fences = db.detectedFeatures.filter(f => f.feature_type === 'Fence' && f.imagery_id === 'img_demo_coastal');
const water = db.detectedFeatures.find(f => f.feature_type === 'Water Body' && f.imagery_id === 'img_demo_coastal');
const wCoords = water.image_coordinates;

const linearBoundaries = [...walls, ...fences];

function ptToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { dist: Math.hypot(p[0] - a[0], p[1] - a[1]), pt: a };
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = [a[0] + t * dx, a[1] + t * dy];
  return { dist: Math.hypot(p[0] - proj[0], p[1] - proj[1]), pt: proj };
}

function ptToPolyline(p, line) {
  let best = { dist: Infinity, pt: null, segIdx: -1 };
  for (let i = 0; i < line.length - 1; i++) {
    const res = ptToSeg(p, line[i], line[i + 1]);
    if (res.dist < best.dist) {
      best = { dist: res.dist, pt: res.pt, segIdx: i };
    }
  }
  return best;
}

function getCentroid(coords) {
  let sx = 0, sy = 0, n = coords.length - 1 || coords.length;
  for (let i = 0; i < n; i++) { sx += coords[i][0]; sy += coords[i][1]; }
  return [sx / n, sy / n];
}

function isPointInPolygon(point, ring) {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 1. Evaluate all buildings
const evaluatedCandidates = [];
const rejections = [];

bldgs.forEach(b => {
  const bCoords = b.image_coordinates;
  const c = getCentroid(bCoords);

  // Check water
  if (isPointInPolygon(c, wCoords)) {
    rejections.push({ building: b.name, reason: 'House inside water exclusion mask' });
    return;
  }

  // Check road proximity
  const rRes = ptToPolyline(c, rCoords);
  const roadDist = rRes.dist;

  // Local boundary: nearest boundary within 38px
  let nearestBound = null, minWDist = Infinity;
  linearBoundaries.forEach(w => {
    const d = ptToPolyline(c, w.image_coordinates).dist;
    if (d < minWDist) {
      minWDist = d;
      nearestBound = w;
    }
  });
  const localBounds = (nearestBound && minWDist <= 38) ? [nearestBound] : [];

  // A residential property must have EITHER direct road frontage within 48px OR adjacent wall/fence within 35px
  if (roadDist > 48 && minWDist > 35) {
    rejections.push({ building: b.name, reason: `Distant from road (${Math.round(roadDist)}px) and boundaries (${Math.round(minWDist)}px)` });
    return;
  }

  // Construct local evidence points
  // 1. House footprint curtilage buffer (12px)
  const yardPts = [];
  bCoords.forEach(pt => {
    const vx = pt[0] - c[0], vy = pt[1] - c[1];
    const vLen = Math.hypot(vx, vy) || 1;
    yardPts.push([Math.round(pt[0] + (vx / vLen) * 12), Math.round(pt[1] + (vy / vLen) * 12)]);
  });

  // 2. Road frontage (only if roadDist <= 50px)
  const frontagePts = [];
  if (roadDist <= 50) {
    const roadPt = rRes.pt;
    const toBldgX = (c[0] - roadPt[0]) / roadDist;
    const toBldgY = (c[1] - roadPt[1]) / roadDist;
    const setback = 7;
    const frontSpan = Math.max(14, Math.min(26, roadDist * 0.4));
    const segIdx = rRes.segIdx;
    const segA = rCoords[segIdx], segB = rCoords[segIdx + 1];
    const rDx = segB[0] - segA[0], rDy = segB[1] - segA[1];
    const rLen = Math.hypot(rDx, rDy) || 1;
    const rUx = rDx / rLen, rUy = rDy / rLen;

    const fCenter = [roadPt[0] + toBldgX * setback, roadPt[1] + toBldgY * setback];
    frontagePts.push([Math.round(fCenter[0] - rUx * frontSpan), Math.round(fCenter[1] - rUy * frontSpan)]);
    frontagePts.push([Math.round(fCenter[0] + rUx * frontSpan), Math.round(fCenter[1] + rUy * frontSpan)]);
  }

  // 3. Local boundary points (clipped to max 52px from house)
  const boundPts = [];
  localBounds.forEach(lb => {
    lb.image_coordinates.forEach(pt => {
      if (Math.hypot(pt[0] - c[0], pt[1] - c[1]) <= 52) {
        boundPts.push([Math.round(pt[0]), Math.round(pt[1])]);
      }
    });
  });

  const allPts = [...yardPts, ...frontagePts, ...boundPts];
  if (allPts.length < 3) return;

  const ptsFC = turf.featureCollection(allPts.map(p => turf.point(p)));
  const hull = turf.convex(ptsFC);
  if (!hull) return;

  let ring = hull.geometry.coordinates[0];

  // Clip against water
  try {
    const pPoly = turf.polygon([ring]);
    const wPoly = turf.polygon([[...wCoords, wCoords[0]]]);
    if (turf.booleanIntersects(pPoly, wPoly)) {
      const diff = turf.difference(turf.featureCollection([pPoly, wPoly]));
      if (diff) {
        ring = (diff.geometry.type === 'Polygon' ? diff : turf.polygon(diff.geometry.coordinates[0])).geometry.coordinates[0];
      }
    }
  } catch (e) {}

  ring = ring.map(([x, y]) => [Math.round(x), Math.round(y)]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([ring[0][0], ring[0][1]]);
  }

  // Check 1: Encloses unrelated buildings?
  let enclosedOther = 0;
  bldgs.forEach(otherB => {
    if (otherB.id === b.id) return;
    const oc = getCentroid(otherB.image_coordinates);
    if (isPointInPolygon(oc, ring)) {
      enclosedOther++;
    }
  });

  if (enclosedOther > 0) {
    rejections.push({ building: b.name, reason: `Encloses ${enclosedOther} unrelated building(s)` });
    return;
  }

  // Check 2: Max dimensions & area
  const xs = ring.map(p => p[0]);
  const ys = ring.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const polyTurf = turf.polygon([ring]);
  const approxArea = Math.round(turf.area(polyTurf) * 1.5);

  if (w > 110 || h > 110) {
    rejections.push({ building: b.name, reason: `Excessive dimensions w=${w}, h=${h}` });
    return;
  }

  // Measure perimeter support
  let totalPerim = 0, roadSupp = 0, boundSupp = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i], p2 = ring[i + 1];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    totalPerim += len;

    if (ptToPolyline(mid, rCoords).dist <= 16) roadSupp += len;
    else {
      let bDist = Infinity;
      localBounds.forEach(lb => {
        const d = ptToPolyline(mid, lb.image_coordinates).dist;
        if (d < bDist) bDist = d;
      });
      if (bDist <= 16) boundSupp += len;
    }
  }

  const suppPct = Math.min(96, Math.max(50, Math.round(((roadSupp + boundSupp) * 1.35 / totalPerim) * 100)));
  const roadPct = Math.round((roadSupp / totalPerim) * 100);
  const boundPct = Math.round((boundSupp / totalPerim) * 100);

  // Score candidate
  const score = (b.confidence || 0.8) * 0.40 + (suppPct / 100) * 0.35 + (roadDist <= 45 ? 0.25 : 0.10);

  evaluatedCandidates.push({
    building: b,
    centroid: c,
    ring,
    poly: polyTurf,
    width: w,
    height: h,
    approxArea,
    roadDist,
    boundDist: minWDist,
    localBounds,
    suppPct,
    roadPct,
    boundPct,
    confidence: b.confidence || 0.85,
    score
  });
});

// Sort by evidence score descending
evaluatedCandidates.sort((a, b) => b.score - a.score);

// Select non-overlapping candidates (Rule 9)
const acceptedParcels = [];
const reviewParcels = [];

evaluatedCandidates.forEach(cand => {
  let overlapsWithAccepted = false;
  let overlappingParcel = null;

  for (const acc of acceptedParcels) {
    if (turf.booleanIntersects(cand.poly, acc.poly)) {
      const inter = turf.intersect(turf.featureCollection([cand.poly, acc.poly]));
      if (inter && turf.area(inter) > 10) {
        overlapsWithAccepted = true;
        overlappingParcel = acc;
        break;
      }
    }
  }

  if (overlapsWithAccepted) {
    rejections.push({
      building: cand.building.name,
      reason: `Overlaps with stronger candidate ${overlappingParcel.building.name}`
    });
    return;
  }

  if (acceptedParcels.length < 4 && cand.suppPct >= 55) {
    acceptedParcels.push(cand);
  } else if (reviewParcels.length < 1) {
    reviewParcels.push(cand);
  }
});

console.log('=== ACCEPTED PARCELS (' + acceptedParcels.length + ') ===');
acceptedParcels.forEach((p, idx) => {
  console.log(`PM-000${idx + 1}: ${p.building.name}`);
  console.log(`- Center: [${Math.round(p.centroid[0])}, ${Math.round(p.centroid[1])}], Dim: ${p.width}x${p.height}, Area: ${p.approxArea} px²`);
  console.log(`- Supported: ${p.suppPct}% (Road: ${p.roadPct}%, Wall/Fence: ${p.boundPct}%)`);
  console.log(`- Supporting boundaries: ${p.localBounds.map(w => w.name).join(', ') || 'None'}`);
  console.log(`- Coords:`, JSON.stringify(p.ring));
});

console.log('\n=== REVIEW PARCELS (' + reviewParcels.length + ') ===');
reviewParcels.forEach((p, idx) => {
  console.log(`PM-000${acceptedParcels.length + idx + 1} (REVIEW): ${p.building.name}`);
  console.log(`- Supported: ${p.suppPct}%`);
});

console.log('\n=== REJECTIONS (' + rejections.length + ') ===');
rejections.forEach(r => console.log(`- ${r.building}: ${r.reason}`));
