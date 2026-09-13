import { db } from '../server/db/database.js';
import * as turf from '@turf/turf';

function runPrototype() {
  const feats = db.getFeaturesByProjectId('proj_demo_coastal', 'img_demo_coastal');
  const bldgs = feats.filter(f => f.feature_type === 'Building');
  const roads = feats.filter(f => f.feature_type === 'Road');
  const walls = feats.filter(f => f.feature_type === 'Wall');
  const fences = feats.filter(f => f.feature_type === 'Fence');
  const fields = feats.filter(f => f.feature_type === 'Field');
  const water = feats.filter(f => f.feature_type === 'Water Body' || f.feature_type === 'Water');

  console.log(`Loaded: ${bldgs.length} buildings, ${roads.length} roads, ${walls.length} walls, ${fences.length} fences`);

  // Helper: centroid
  function getCentroid(coords) {
    const ring = coords[0] || coords;
    let sx = 0, sy = 0, n = ring.length - 1 || ring.length;
    for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / n, sy / n];
  }

  // Helper: point to segment distance and nearest point
  function ptToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return { dist: Math.hypot(p[0]-a[0], p[1]-a[1]), pt: a };
    let t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = [a[0] + t*dx, a[1] + t*dy];
    return { dist: Math.hypot(p[0]-proj[0], p[1]-proj[1]), pt: proj };
  }

  function ptToPolyline(p, line) {
    let best = { dist: Infinity, pt: null, segIdx: -1 };
    for (let i = 0; i < line.length - 1; i++) {
      const res = ptToSeg(p, line[i], line[i+1]);
      if (res.dist < best.dist) {
        best = { dist: res.dist, pt: res.pt, segIdx: i };
      }
    }
    return best;
  }

  const primaryRoad = roads[0];
  const roadCoords = primaryRoad.geometry.coordinates;

  // 1. Rank buildings
  const scoredBuildings = bldgs.map(b => {
    const c = getCentroid(b.geometry.coordinates);
    const roadRes = ptToPolyline(c, roadCoords);
    
    // Nearest wall or fence
    let bestBound = { dist: Infinity, feat: null };
    [...walls, ...fences].forEach(wf => {
      const res = ptToPolyline(c, wf.geometry.coordinates);
      if (res.dist < bestBound.dist) {
        bestBound = { dist: res.dist, feat: wf };
      }
    });

    // Score: combination of confidence, proximity to road (<=120), and proximity to boundary evidence (<=80)
    const conf = b.confidence || 0.7;
    const roadScore = Math.max(0, 1 - (roadRes.dist / 140));
    const boundScore = Math.max(0, 1 - (bestBound.dist / 90));
    const score = conf * 0.45 + roadScore * 0.30 + boundScore * 0.25;

    return {
      building: b,
      centroid: c,
      roadDist: roadRes.dist,
      nearestRoadPt: roadRes.pt,
      nearestBound: bestBound.feat,
      boundDist: bestBound.dist,
      score: Number(score.toFixed(3))
    };
  });

  scoredBuildings.sort((a, b) => b.score - a.score);

  console.log('\n--- RANKED CANDIDATE HOUSES ---');
  scoredBuildings.forEach((sb, i) => {
    console.log(`#${i+1}: ${sb.building.name} (${sb.building.id}) Score=${sb.score} Conf=${sb.building.confidence} RoadDist=${Math.round(sb.roadDist)}px NearestBound=${sb.nearestBound?.name} (${Math.round(sb.boundDist)}px)`);
  });
}

runPrototype();
