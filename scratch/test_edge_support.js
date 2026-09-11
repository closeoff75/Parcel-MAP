import { db } from '../server/db/database.js';
import { GISEngine } from '../server/services/gisEngine.js';

const projectId = 'proj_1789117650907';
const imageryId = 'img_1789118184412_8b81';

const features = db.getFeaturesByProjectId(projectId, imageryId);
const roads = features.filter(f => f.detection_type === 'ROAD' || f.feature_type === 'Road');
const walls = features.filter(f => f.detection_type === 'WALL' || f.feature_type === 'Wall');
const fences = features.filter(f => f.detection_type === 'FENCE' || f.feature_type === 'Fence');
const fields = features.filter(f => f.detection_type === 'FIELD' || f.feature_type === 'Field');

function pointToSegmentDistance(p, v, w) {
  const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
  if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
  let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (v[0] + t * (w[0] - v[0])), p[1] - (v[1] + t * (w[1] - v[1])));
}

function analyzeEdgeSupport(polygonRing, evidence, currentFieldId = null) {
  const roadPolylines = (evidence.roads || []).map(r => r.coordinates || r.image_coordinates || r.geometry?.coordinates).filter(c => Array.isArray(c) && c.length >= 2);
  const wallFencePolylines = [...(evidence.walls || []), ...(evidence.fences || []), ...(evidence.boundaries || [])]
    .map(w => w.coordinates || w.image_coordinates || w.geometry?.coordinates)
    .filter(c => Array.isArray(c) && c.length >= 2);
  
  // Other fields' boundaries (shared agricultural bunds/edges)
  const otherFieldPolylines = (evidence.fields || [])
    .filter(f => f.id !== currentFieldId)
    .map(f => f.coordinates || f.image_coordinates || f.geometry?.coordinates?.[0] || f.geometry?.coordinates)
    .filter(c => Array.isArray(c) && c.length >= 2);

  const n = polygonRing.length - 1;
  const cx = polygonRing.slice(0, n).reduce((s, p) => s + p[0], 0) / n;
  const cy = polygonRing.slice(0, n).reduce((s, p) => s + p[1], 0) / n;

  let totalPerimeter = 0;
  let roadSupportedLen = 0;
  let wallFenceSupportedLen = 0;
  let fieldSupportedLen = 0;
  let unsupportedLen = 0;
  const unsupportedMidpoints = [];

  for (let i = 0; i < polygonRing.length - 1; i++) {
    const p1 = polygonRing[i];
    const p2 = polygonRing[i + 1];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (segLen === 0) continue;

    totalPerimeter += segLen;
    const numSamples = Math.max(2, Math.ceil(segLen / 8));
    let segRoadHits = 0;
    let segWallHits = 0;
    let segFieldHits = 0;

    for (let s = 0; s <= numSamples; s++) {
      const t = s / numSamples;
      const q = [p1[0] * (1 - t) + p2[0] * t, p1[1] * (1 - t) + p2[1] * t];

      let hitRoad = false;
      for (const rLine of roadPolylines) {
        for (let k = 0; k < rLine.length - 1; k++) {
          if (pointToSegmentDistance(q, rLine[k], rLine[k + 1]) <= 35.0) {
            hitRoad = true;
            break;
          }
        }
        if (hitRoad) break;
      }

      let hitWall = false;
      if (!hitRoad) {
        for (const wLine of wallFencePolylines) {
          for (let k = 0; k < wLine.length - 1; k++) {
            if (pointToSegmentDistance(q, wLine[k], wLine[k + 1]) <= 25.0) {
              hitWall = true;
              break;
            }
          }
          if (hitWall) break;
        }
      }

      let hitField = false;
      if (!hitRoad && !hitWall) {
        for (const fLine of otherFieldPolylines) {
          for (let k = 0; k < fLine.length - 1; k++) {
            if (pointToSegmentDistance(q, fLine[k], fLine[k + 1]) <= 20.0) {
              hitField = true;
              break;
            }
          }
          if (hitField) break;
        }
      }

      if (hitRoad) segRoadHits++;
      else if (hitWall) segWallHits++;
      else if (hitField) segFieldHits++;
    }

    const totalHits = numSamples + 1;
    const roadRatio = segRoadHits / totalHits;
    const wallRatio = segWallHits / totalHits;
    const fieldRatio = segFieldHits / totalHits;
    const suppRatio = Math.min(1.0, roadRatio + wallRatio + fieldRatio);

    roadSupportedLen += segLen * roadRatio;
    wallFenceSupportedLen += segLen * wallRatio;
    fieldSupportedLen += segLen * fieldRatio;
    const unsupp = segLen * (1.0 - suppRatio);
    unsupportedLen += unsupp;

    if (suppRatio < 0.4) {
      unsupportedMidpoints.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, unsupp]);
    }
  }

  if (totalPerimeter === 0) totalPerimeter = 1;
  const supportedPerimeter = Math.max(0, totalPerimeter - unsupportedLen);
  const supportedEdgePct = Math.round((supportedPerimeter / totalPerimeter) * 100);
  const unsupportedEdgePct = Math.max(0, 100 - supportedEdgePct);
  const roadSupportedPct = Math.round((roadSupportedLen / totalPerimeter) * 100);
  const wallFenceSupportedPct = Math.round((wallFenceSupportedLen / totalPerimeter) * 100);
  const fieldSupportedPct = Math.round((fieldSupportedLen / totalPerimeter) * 100);

  let unsupportedDir = 'interior';
  if (unsupportedMidpoints.length > 0) {
    let sumDx = 0, sumDy = 0, sumWeight = 0;
    unsupportedMidpoints.forEach(([mx, my, w]) => {
      sumDx += (mx - cx) * w;
      sumDy += (my - cy) * w;
      sumWeight += w;
    });
    if (sumWeight > 0) {
      const avgDx = sumDx / sumWeight;
      const avgDy = sumDy / sumWeight;
      if (Math.abs(avgDx) > Math.abs(avgDy)) {
        unsupportedDir = avgDx > 0 ? 'eastern' : 'western';
      } else {
        unsupportedDir = avgDy > 0 ? 'southern' : 'northern';
      }
    }
  }

  return {
    total_perimeter_px: Math.round(totalPerimeter),
    supported_perimeter_px: Math.round(supportedPerimeter),
    unsupported_perimeter_px: Math.round(unsupportedLen),
    supported_edge_pct: supportedEdgePct,
    unsupported_edge_pct: unsupportedEdgePct,
    road_supported_pct: roadSupportedPct,
    wall_fence_supported_pct: wallFenceSupportedPct,
    field_supported_pct: fieldSupportedPct,
    unsupported_direction: unsupportedDir
  };
}

console.log('\n--- EVALUATING ALL 6 FIELDS (WITH SHARED FIELD EDGES) ---');
fields.forEach((f, idx) => {
  const analysis = analyzeEdgeSupport(f.image_coordinates, { roads, walls, fences, fields }, f.id);
  const area = Math.round(GISEngine.planarArea(f.image_coordinates));
  console.log(`Field ${idx + 1} (${f.id}): Area=${area} px²`);
  console.log(`  Supported=${analysis.supported_edge_pct}% (Road=${analysis.road_supported_pct}%, Wall/Fence=${analysis.wall_fence_supported_pct}%, Shared Field=${analysis.field_supported_pct}%), Unsupported=${analysis.unsupported_edge_pct}% (${analysis.unsupported_direction})`);
});
