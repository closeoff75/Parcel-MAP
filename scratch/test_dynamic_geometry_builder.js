import { db } from '../server/db/database.js';
import * as turf from '@turf/turf';

function testDynamicPipeline() {
  const feats = db.getFeaturesByProjectId('proj_demo_coastal', 'img_demo_coastal');
  const bldgs = feats.filter(f => f.feature_type === 'Building');
  const roads = feats.filter(f => f.feature_type === 'Road');
  const walls = feats.filter(f => f.feature_type === 'Wall');
  const fences = feats.filter(f => f.feature_type === 'Fence');
  const waterFeats = feats.filter(f => (f.feature_type || '').toLowerCase().includes('water'));

  const primaryRoad = roads[0];
  const roadCoords = primaryRoad.geometry.coordinates;

  function getCentroid(coords) {
    const ring = coords[0] || coords;
    let sx = 0, sy = 0, n = ring.length - 1 || ring.length;
    for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / n, sy / n];
  }

  function ptToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return { dist: Math.hypot(p[0]-a[0], p[1]-a[1]), pt: a, t: 0 };
    let t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = [a[0] + t*dx, a[1] + t*dy];
    return { dist: Math.hypot(p[0]-proj[0], p[1]-proj[1]), pt: proj, t };
  }

  function ptToPolyline(p, line) {
    let best = { dist: Infinity, pt: null, segIdx: -1, t: 0 };
    for (let i = 0; i < line.length - 1; i++) {
      const res = ptToSeg(p, line[i], line[i+1]);
      if (res.dist < best.dist) {
        best = { dist: res.dist, pt: res.pt, segIdx: i, t: res.t };
      }
    }
    return best;
  }

  // 1. Rank houses by residential suitability
  const scored = bldgs.map(b => {
    const c = getCentroid(b.geometry.coordinates);
    const rRes = ptToPolyline(c, roadCoords);
    let minWDist = Infinity, nearestW = null;
    [...walls, ...fences].forEach(w => {
      const d = ptToPolyline(c, w.geometry.coordinates).dist;
      if (d < minWDist) { minWDist = d; nearestW = w; }
    });
    const conf = b.confidence || 0.7;
    // Score based on confidence, proximity to road, and proximity to wall/fence
    const score = conf * 0.40 + Math.max(0, 1 - rRes.dist / 140) * 0.35 + Math.max(0, 1 - minWDist / 80) * 0.25;
    return { building: b, centroid: c, roadDist: rRes.dist, roadProj: rRes.pt, nearestBound: nearestW, boundDist: minWDist, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Pick the top 4 distinct residential holdings separated by >= 80px
  const selected = [];
  scored.forEach(cand => {
    const tooClose = selected.some(s => Math.hypot(s.centroid[0] - cand.centroid[0], s.centroid[1] - cand.centroid[1]) < 80);
    if (!tooClose && selected.length < 4) {
      selected.push(cand);
    }
  });

  // Optionally pick 1 review candidate (e.g. Building 7)
  const b7 = scored.find(s => s.building.id.includes('building_7'));
  if (b7 && !selected.some(s => s.building.id === b7.building.id)) {
    selected.push(b7);
  }

  console.log('Selected Houses for Demonstration:');
  selected.forEach((s, i) => {
    console.log(` #${i+1}: ${s.building.name} (${s.building.id}) at [${s.centroid.map(Math.round)}] Conf: ${s.building.confidence}`);
  });

  const waterRings = waterFeats.map(w => w.geometry.coordinates[0]);

  // Construct parcels
  const parcels = [];

  selected.forEach((sel, idx) => {
    const b = sel.building;
    const c = sel.centroid;
    const bRing = b.geometry.coordinates[0];

    // Find physical boundaries associated with this house
    const assocBounds = [...walls, ...fences].filter(w => {
      return ptToPolyline(c, w.geometry.coordinates).dist <= 55;
    });
    if (assocBounds.length === 0 && sel.nearestBound && sel.boundDist <= 75) {
      assocBounds.push(sel.nearestBound);
    }

    // Road frontage calculation
    const rProj = ptToPolyline(c, roadCoords);
    const roadPt = rProj.pt;
    const segA = roadCoords[rProj.segIdx];
    const segB = roadCoords[rProj.segIdx + 1];
    const rDx = segB[0] - segA[0];
    const rDy = segB[1] - segA[1];
    const rLen = Math.hypot(rDx, rDy);
    const rUx = rDx / rLen;
    const rUy = rDy / rLen;

    const toBldgDist = Math.hypot(c[0] - roadPt[0], c[1] - roadPt[1]) || 1;
    const toBldgX = (c[0] - roadPt[0]) / toBldgDist;
    const toBldgY = (c[1] - roadPt[1]) / toBldgDist;

    // Setback from road centerline
    const setback = 7;
    const frontSpan = Math.max(18, Math.min(30, sel.roadDist * 0.35));
    const fCenter = [roadPt[0] + toBldgX * setback, roadPt[1] + toBldgY * setback];
    const f1 = [Math.round(fCenter[0] - rUx * frontSpan), Math.round(fCenter[1] - rUy * frontSpan)];
    const f2 = [Math.round(fCenter[0] + rUx * frontSpan), Math.round(fCenter[1] + rUy * frontSpan)];

    // Boundary points from wall/fence
    const boundLinePts = [];
    assocBounds.forEach(ab => {
      ab.geometry.coordinates.forEach(pt => {
        boundLinePts.push([Math.round(pt[0]), Math.round(pt[1])]);
      });
    });

    // Yard setback points around the house
    const yardBuffer = 14;
    const yardPts = bRing.slice(0, -1).map(pt => {
      const vx = pt[0] - c[0];
      const vy = pt[1] - c[1];
      const vLen = Math.hypot(vx, vy) || 1;
      return [Math.round(pt[0] + (vx / vLen) * yardBuffer), Math.round(pt[1] + (vy / vLen) * yardBuffer)];
    });

    // All evidence points
    const evidencePts = [f1, f2, ...boundLinePts, ...yardPts];
    const ptsFC = turf.featureCollection(evidencePts.map(p => turf.point(p)));
    let hull = turf.convex(ptsFC);

    if (!hull) return;

    let pPoly = hull;
    let ring = pPoly.geometry.coordinates[0];

    // Clip water
    waterRings.forEach(wRing => {
      try {
        const wPoly = turf.polygon([wRing]);
        if (turf.booleanIntersects(pPoly, wPoly)) {
          const diff = turf.difference(turf.featureCollection([pPoly, wPoly]));
          if (diff) {
            pPoly = diff.geometry.type === 'Polygon' ? diff : turf.polygon([diff.geometry.coordinates[0]]);
            ring = pPoly.geometry.coordinates[0];
          }
        }
      } catch (e) {}
    });

    // Resolve overlap with existing parcels
    parcels.forEach(prev => {
      try {
        if (turf.booleanIntersects(pPoly, prev.poly)) {
          // If slight overlap, shrink this candidate slightly
          const diff = turf.difference(turf.featureCollection([pPoly, prev.poly]));
          if (diff) {
            pPoly = diff.geometry.type === 'Polygon' ? diff : turf.polygon([diff.geometry.coordinates[0]]);
            ring = pPoly.geometry.coordinates[0];
          }
        }
      } catch (e) {}
    });

    // Round coordinates
    ring = ring.map(([x, y]) => [Math.round(x), Math.round(y)]);
    // Ensure closed
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([ring[0][0], ring[0][1]]);
    }
    pPoly = turf.polygon([ring]);

    // Analyze perimeter support
    let totalPerimeter = 0;
    let roadSupportedLen = 0;
    let wallFenceSupportedLen = 0;

    for (let i = 0; i < ring.length - 1; i++) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      const edgeLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      totalPerimeter += edgeLen;

      // Check distance to road
      const dRoad = ptToPolyline(mid, roadCoords).dist;
      // Check distance to walls/fences
      let minWDist = Infinity;
      assocBounds.forEach(w => {
        const d = ptToPolyline(mid, w.geometry.coordinates).dist;
        if (d < minWDist) minWDist = d;
      });

      if (dRoad <= 12) {
        roadSupportedLen += edgeLen;
      } else if (minWDist <= 12) {
        wallFenceSupportedLen += edgeLen;
      }
    }

    const supportedPct = Math.min(95, Math.round(((roadSupportedLen + wallFenceSupportedLen) / totalPerimeter) * 100));
    const isAccepted = idx < 4 && supportedPct >= 50;

    parcels.push({
      id: `PM-000${idx + 1}`,
      parcel_id: `PM-000${idx + 1}`,
      building: b,
      poly: pPoly,
      ring: ring,
      status: isAccepted ? 'accepted' : 'needs_review',
      candidate_status: isAccepted ? 'ACCEPTED' : 'REVIEW',
      confidence: Number((sel.score * (supportedPct / 100) + 0.35).toFixed(2)),
      supported_perimeter_pct: supportedPct,
      road_supported_pct: Math.round((roadSupportedLen / totalPerimeter) * 100),
      wall_fence_supported_pct: Math.round((wallFenceSupportedLen / totalPerimeter) * 100),
      supportingBounds: assocBounds
    });
  });

  console.log('\n--- GENERATED PARCELS SUMMARY ---');
  parcels.forEach(p => {
    console.log(`${p.id}: status=${p.status} (${p.candidate_status}), conf=${p.confidence}, supported=${p.supported_perimeter_pct}% (road=${p.road_supported_pct}%, wall/fence=${p.wall_fence_supported_pct}%)`);
    console.log(`  Anchor: ${p.building.name}`);
    console.log(`  Bounds:`, p.supportingBounds.map(b => b.name));
    console.log(`  Ring (${p.ring.length - 1} vertices):`, JSON.stringify(p.ring));
  });

  // Overlap verification
  let hasOverlap = false;
  for (let i = 0; i < parcels.length; i++) {
    for (let j = i + 1; j < parcels.length; j++) {
      const inter = turf.intersect(turf.featureCollection([parcels[i].poly, parcels[j].poly]));
      if (inter && turf.area(inter) > 1) {
        console.error(`OVERLAP: ${parcels[i].id} and ${parcels[j].id}`);
        hasOverlap = true;
      }
    }
  }
  if (!hasOverlap) {
    console.log('\n✓ 100% DISJOINT: 0 overlaps among all generated parcels!');
  }
}

testDynamicPipeline();
