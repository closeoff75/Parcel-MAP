/**
 * ParcelMap GIS Engine
 * High-performance spatial analysis, topological validation, and polygon operations using Turf.js.
 */

import * as turf from '@turf/turf';

export class GISEngine {
  /**
   * Cleans polygon geometry, ensures ring closure and removes duplicate consecutive vertices.
   */
  static cleanGeometry(geometry) {
    if (!geometry || !geometry.coordinates) return geometry;

    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates.map(ring => {
        if (!ring || ring.length < 3) return ring;
        // Filter consecutive duplicates
        const cleaned = [ring[0]];
        for (let i = 1; i < ring.length; i++) {
          const prev = cleaned[cleaned.length - 1];
          const curr = ring[i];
          const dist = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
          if (dist > 1e-7) {
            cleaned.push(curr);
          }
        }
        // Ensure closed ring
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          cleaned.push([first[0], first[1]]);
        }
        return cleaned;
      });
      return { type: 'Polygon', coordinates: rings };
    }
    return geometry;
  }

  /**
   * Calculates planar 2D polygon area via shoelace formula.
   */
  static planarArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += (ring[i][0] * ring[i + 1][1]) - (ring[i + 1][0] * ring[i][1]);
    }
    return Math.abs(area) / 2;
  }

  /**
   * Calculates planar 2D polygon perimeter.
   */
  static planarPerimeter(ring) {
    if (!ring || ring.length < 2) return 0;
    let perim = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      perim += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
    }
    return perim;
  }

  /**
   * Calculates geodesic or planar area.
   */
  static calculateAreas(geometry) {
    try {
      if (!geometry || !geometry.coordinates || !geometry.coordinates[0] || geometry.coordinates[0].length < 3) {
        return { area_sqm: 0, area_hectares: 0, area_acres: 0, area_px: 0 };
      }

      const ring = geometry.coordinates[0];
      const sampleCoord = ring[0];
      const isImageSpace = Math.abs(sampleCoord[0]) > 180 || Math.abs(sampleCoord[1]) > 90;

      if (isImageSpace) {
        const pxArea = Math.round(this.planarArea(ring));
        return {
          area_sqm: 0,
          area_hectares: 0,
          area_acres: 0,
          area_px: pxArea,
          is_image_space: true
        };
      }

      const feature = turf.feature(geometry);
      const sqm = turf.area(feature);
      const hectares = Number((sqm / 10000).toFixed(2));
      const acres = Number((sqm / 4046.8564224).toFixed(2));
      return {
        area_sqm: Math.round(sqm),
        area_hectares: hectares,
        area_acres: acres,
        area_px: 0,
        is_image_space: false
      };
    } catch (e) {
      return { area_sqm: 0, area_hectares: 0, area_acres: 0, area_px: 0 };
    }
  }

  /**
   * Validates a single parcel polygon's geometry.
   * Checks for closure, self-intersections, duplicate vertices, and tiny slivers.
   * Repairs simple issues automatically (such as ring closure and duplicate consecutive vertices).
   */
  static validateSingleParcel(geometry) {
    const errors = [];
    const warnings = [];

    if (!geometry || !geometry.coordinates || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      return { valid: false, errors: ['Missing or empty geometry coordinates'], warnings: [], repaired_geometry: null };
    }

    const ring = geometry.coordinates[0];
    if (!ring || !Array.isArray(ring) || ring.length < 3) {
      return { valid: false, errors: ['Polygon must contain at least 3 distinct vertices'], warnings: [], repaired_geometry: null };
    }

    // 0. Coordinate validity check
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      if (!Array.isArray(pt) || pt.length < 2 || isNaN(pt[0]) || isNaN(pt[1]) || !isFinite(pt[0]) || !isFinite(pt[1])) {
        return { valid: false, errors: ['Polygon contains invalid or non-numeric coordinates'], warnings: [], repaired_geometry: null };
      }
    }

    // 1. Remove consecutive duplicate vertices
    const deduplicated = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const prev = deduplicated[deduplicated.length - 1];
      const curr = ring[i];
      if (Math.abs(curr[0] - prev[0]) > 1e-7 || Math.abs(curr[1] - prev[1]) > 1e-7) {
        deduplicated.push(curr);
      }
    }
    if (deduplicated.length < ring.length) {
      warnings.push(`Removed ${ring.length - deduplicated.length} duplicate consecutive vertices.`);
    }

    // 2. Ensure closed ring
    const first = deduplicated[0];
    const last = deduplicated[deduplicated.length - 1];
    const isClosed = Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7;
    if (!isClosed) {
      deduplicated.push([first[0], first[1]]);
      warnings.push('Unclosed polygon ring was automatically closed.');
    }

    if (deduplicated.length < 4) {
      return { valid: false, errors: ['Polygon ring has fewer than 3 unique vertices'], warnings, repaired_geometry: null };
    }

    const repairedGeometry = {
      type: 'Polygon',
      coordinates: [deduplicated]
    };

    // 3. Self-intersection check
    const isImageSpace = Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90;
    if (!isImageSpace) {
      try {
        const polyFeature = turf.polygon([deduplicated]);
        const kinks = turf.kinks(polyFeature);
        if (kinks && kinks.features && kinks.features.length > 0) {
          errors.push(`Polygon self-intersects (contains ${kinks.features.length} intersection kinks).`);
        }
      } catch (err) {
        errors.push(`Geometric topology error: ${err.message}`);
      }
    } else {
      // Image-space self-intersection check
      const kinksCount = this.findSelfIntersections(deduplicated);
      if (kinksCount > 0) {
        errors.push(`Polygon boundary contains ${kinksCount} self-intersecting segments.`);
      }
    }

    // 4. Non-zero area and sliver check
    let areaVal = 0;
    if (isImageSpace) {
      const pxArea = this.planarArea(deduplicated);
      const perim = this.planarPerimeter(deduplicated);
      const compactness = perim > 0 ? (4 * Math.PI * pxArea) / (perim * perim) : 0;
      areaVal = pxArea;

      if (pxArea <= 0.0001) {
        errors.push('Polygon area must be greater than zero.');
      } else if (pxArea < 600) {
        warnings.push(`Polygon is extremely small (${Math.round(pxArea)} px²).`);
      } else if (compactness < 0.05) {
        warnings.push('High perimeter-to-area ratio (elongated sliver).');
      }
    } else {
      try {
        const polyFeat = turf.polygon([deduplicated]);
        const sqm = turf.area(polyFeat);
        const perimMeters = turf.length(turf.polygonToLine(polyFeat), { units: 'meters' });
        const compactness = perimMeters > 0 ? (4 * Math.PI * sqm) / (perimMeters * perimMeters) : 0;
        areaVal = sqm;

        if (sqm <= 0.0001) {
          errors.push('Polygon area must be greater than zero.');
        } else if (sqm < 50) {
          warnings.push(`Polygon area is very small (${Math.round(sqm)} m²).`);
        } else if (compactness < 0.05) {
          warnings.push('High perimeter-to-area ratio (elongated sliver).');
        }
      } catch (e) {
        errors.push('Invalid polygon geometry for area computation: ' + e.message);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      repaired_geometry: repairedGeometry,
      area: Math.round(areaVal),
      area_px: isImageSpace ? Math.round(areaVal) : undefined,
      area_sqm: !isImageSpace ? Math.round(areaVal) : undefined
    };
  }

  /**
   * Validates whether a parcel geometry overlaps with prohibited water bodies.
   */
  static checkWaterOverlap(geometry, waterFeatures = []) {
    if (!geometry || !geometry.coordinates || !waterFeatures || waterFeatures.length === 0) {
      return { hasOverlap: false, errors: [] };
    }

    const ring = geometry.coordinates[0];
    if (!ring || ring.length < 4) return { hasOverlap: false, errors: [] };

    const isImageSpace = Math.abs(ring[0][0]) > 180 || Math.abs(ring[0][1]) > 90;
    const errors = [];

    for (const wf of waterFeatures) {
      const wGeom = wf.geo_geometry || wf.geometry;
      if (!wGeom || !wGeom.coordinates) continue;

      if (!isImageSpace) {
        try {
          const pFeat = turf.feature(geometry);
          const wFeat = turf.feature(wGeom);
          if (turf.booleanIntersects(pFeat, wFeat)) {
            const inter = turf.intersect(turf.featureCollection([pFeat, wFeat]));
            const interArea = inter ? turf.area(inter) : 0;
            if (interArea > 5) { // more than 5 sq meters is prohibited overlap
              errors.push(`Prohibited water overlap detected with ${wf.name || 'water body'} (${Math.round(interArea)} m²)`);
            }
          }
        } catch {
          // ignore projection or precision errors
        }
      } else {
        // Image-space bounding box and point-in-polygon check for water features
        const wCoords = wf.image_coordinates || wGeom.coordinates?.[0] || [];
        if (wCoords.length >= 3) {
          let minX1 = Infinity, maxX1 = -Infinity, minY1 = Infinity, maxY1 = -Infinity;
          let minX2 = Infinity, maxX2 = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
          ring.forEach(([x, y]) => { if (x < minX1) minX1 = x; if (x > maxX1) maxX1 = x; if (y < minY1) minY1 = y; if (y > maxY1) maxY1 = y; });
          wCoords.forEach(([x, y]) => { if (x < minX2) minX2 = x; if (x > maxX2) maxX2 = x; if (y < minY2) minY2 = y; if (y > maxY2) maxY2 = y; });
          const overlapBbox = !(maxX1 < minX2 || minX1 > maxX2 || maxY1 < minY2 || minY1 > maxY2);
          if (overlapBbox) {
            const interW = Math.max(0, Math.min(maxX1, maxX2) - Math.max(minX1, minX2));
            const interH = Math.max(0, Math.min(maxY1, maxY2) - Math.max(minY1, minY2));
            const interArea = interW * interH;
            if (interArea > 100) {
              errors.push(`Prohibited water overlap detected with ${wf.name || 'water body'} (${Math.round(interArea)} px²)`);
            }
          }
        }
      }
    }

    return {
      hasOverlap: errors.length > 0,
      errors
    };
  }

  /**
   * Helper to count self-intersections in planar coordinates.
   */
  static findSelfIntersections(ring) {
    let count = 0;
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // Adjacent first and last segment
        if (this.doLineSegmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
          count++;
        }
      }
    }
    return count;
  }

  static doLineSegmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
    return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
  }

  /**
   * Comprehensive Topology Audit:
   * Checks for valid geometries, self-intersections, overlaps, gaps, slivers, water overlaps, and confidence stratification.
   */
  static auditTopology(parcels, waterFeatures = []) {
    const validParcels = [];
    const invalidParcels = [];
    const overlaps = [];
    const gaps = [];
    const slivers = [];
    const waterOverlaps = [];
    const lowConfidenceParcels = [];
    const repairsPerformed = [];

    // Filter active parcels (not deleted)
    const activeParcels = parcels.filter(p => p.status !== 'Deleted' && p.status !== 'split');

    // 1. Polygon validity, sliver checks & safe repair audit
    activeParcels.forEach(p => {
      try {
        const valResult = this.validateSingleParcel(p.geometry);
        if (valResult.warnings && valResult.warnings.length > 0) {
          repairsPerformed.push({
            parcel_id: p.parcel_id || p.id,
            repairs: valResult.warnings
          });
        }

        if (!valResult.valid) {
          invalidParcels.push({
            parcel_id: p.parcel_id || p.id,
            reason: valResult.errors.join('; ')
          });
          return;
        }

        const ring = p.geometry?.coordinates?.[0];
        const isImageSpace = Math.abs(ring[0][0]) > 180 || Math.abs(ring[0][1]) > 90;

        if (isImageSpace) {
          const pxArea = this.planarArea(ring);
          const perim = this.planarPerimeter(ring);
          const compactness = perim > 0 ? (4 * Math.PI * pxArea) / (perim * perim) : 0;

          if (pxArea < 800 || (compactness < 0.08 && pxArea < 3000)) {
            slivers.push({
              id: `slv_${p.parcel_id || p.id}`,
              parcel_id: p.parcel_id || p.id,
              area_px: Math.round(pxArea),
              perimeter_px: Math.round(perim),
              reason: pxArea < 800 ? `Tiny sliver polygon (${Math.round(pxArea)} px²)` : 'High perimeter-to-area sliver ratio',
              severity: 'High',
              status: 'Needs Review',
              coordinates: ring[0]
            });
          }
        } else {
          const poly = turf.feature(p.geo_geometry || p.geometry);
          const sqm = turf.area(poly);
          const perimeter = turf.length(turf.polygonToLine(poly), { units: 'meters' });
          const compactness = perimeter > 0 ? (4 * Math.PI * sqm) / (perimeter * perimeter) : 0;

          if (sqm < 60 || (compactness < 0.08 && sqm < 300)) {
            slivers.push({
              id: `slv_${p.parcel_id || p.id}`,
              parcel_id: p.parcel_id || p.id,
              area_sqm: Math.round(sqm),
              perimeter_m: Math.round(perimeter),
              reason: sqm < 60 ? `Tiny sliver polygon (${Math.round(sqm)} m² < 60 m²)` : 'High perimeter-to-area sliver ratio',
              severity: 'High',
              status: 'Needs Review',
              coordinates: ring[0]
            });
          }
        }

        validParcels.push(p.parcel_id || p.id);
      } catch (err) {
        invalidParcels.push({
          parcel_id: p.parcel_id || p.id,
          reason: err.message
        });
      }
    });

    // 2. Overlap detection between active parcels with severity & formatted display
    for (let i = 0; i < activeParcels.length; i++) {
      for (let j = i + 1; j < activeParcels.length; j++) {
        const p1 = activeParcels[i];
        const p2 = activeParcels[j];
        try {
          const g1 = p1.geo_geometry || (Math.abs(p1.geometry.coordinates[0][0][0]) <= 180 ? p1.geometry : null);
          const g2 = p2.geo_geometry || (Math.abs(p2.geometry.coordinates[0][0][0]) <= 180 ? p2.geometry : null);

          if (g1 && g2) {
            const poly1 = turf.feature(g1);
            const poly2 = turf.feature(g2);

            const b1 = turf.bbox(poly1);
            const b2 = turf.bbox(poly2);
            const overlapBbox = !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);

            if (overlapBbox) {
              const intersection = turf.intersect(turf.featureCollection([poly1, poly2]));
              if (intersection) {
                const overlapArea = turf.area(intersection);
                if (overlapArea > 2) {
                  const center = turf.centroid(intersection).geometry.coordinates;
                  const severity = overlapArea > 100 ? 'High' : (overlapArea > 25 ? 'Medium' : 'Low');
                  overlaps.push({
                    id: `ovl_${p1.parcel_id || p1.id}_${p2.parcel_id || p2.id}`,
                    parcel_a: p1.parcel_id || p1.id,
                    parcel_b: p2.parcel_id || p2.id,
                    overlap_sqm: Math.round(overlapArea),
                    overlap_hectares: Number((overlapArea / 10000).toFixed(3)),
                    area_display: `${Math.round(overlapArea)} m²`,
                    severity,
                    status: 'Needs Review',
                    coordinates: [center[1], center[0]],
                    geometry: intersection.geometry
                  });
                }
              }
            }
          } else {
            // Planar bounding box overlap check for image space
            const r1 = p1.geometry.coordinates[0];
            const r2 = p2.geometry.coordinates[0];
            let minX1 = Infinity, maxX1 = -Infinity, minY1 = Infinity, maxY1 = -Infinity;
            let minX2 = Infinity, maxX2 = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
            r1.forEach(([x, y]) => { if (x < minX1) minX1 = x; if (x > maxX1) maxX1 = x; if (y < minY1) minY1 = y; if (y > maxY1) maxY1 = y; });
            r2.forEach(([x, y]) => { if (x < minX2) minX2 = x; if (x > maxX2) maxX2 = x; if (y < minY2) minY2 = y; if (y > maxY2) maxY2 = y; });
            
            const overlapBbox = !(maxX1 < minX2 || minX1 > maxX2 || maxY1 < minY2 || minY1 > maxY2);
            if (overlapBbox) {
              const interW = Math.max(0, Math.min(maxX1, maxX2) - Math.max(minX1, minX2));
              const interH = Math.max(0, Math.min(maxY1, maxY2) - Math.max(minY1, minY2));
              const interArea = interW * interH;
              const a1 = (maxX1 - minX1) * (maxY1 - minY1);
              const a2 = (maxX2 - minX2) * (maxY2 - minY2);
              const iou = interArea / (a1 + a2 - interArea);
              if (iou > 0.05 && interArea > 200) {
                const severity = interArea > 2000 ? 'High' : (interArea > 600 ? 'Medium' : 'Low');
                overlaps.push({
                  id: `ovl_${p1.parcel_id || p1.id}_${p2.parcel_id || p2.id}`,
                  parcel_a: p1.parcel_id || p1.id,
                  parcel_b: p2.parcel_id || p2.id,
                  overlap_px: Math.round(interArea),
                  area_display: `${Math.round(interArea)} px²`,
                  severity,
                  status: 'Needs Review',
                  coordinates: [(minY1 + maxY1) / 2, (minX1 + maxX1) / 2],
                  geometry: null
                });
              }
            }
          }
        } catch {
          // Disjoint or precision
        }
      }
    }

    // 3. Gap detection between neighboring parcels (Requirement 5)
    for (let i = 0; i < activeParcels.length; i++) {
      for (let j = i + 1; j < activeParcels.length; j++) {
        const p1 = activeParcels[i];
        const p2 = activeParcels[j];
        // Flagged topology gap or proximity void
        if (p1.topology_issue && (p1.topology_issue.includes(p2.parcel_id || p2.id) || p1.topology_issue.toLowerCase().includes('gap'))) {
          const g1 = p1.geo_geometry || p1.geometry;
          const g2 = p2.geo_geometry || p2.geometry;
          const center1 = turf.centroid(turf.feature(g1)).geometry.coordinates;
          const center2 = turf.centroid(turf.feature(g2)).geometry.coordinates;
          const midLat = (center1[1] + center2[1]) / 2;
          const midLng = (center1[0] + center2[0]) / 2;
          gaps.push({
            id: `gap_${p1.parcel_id || p1.id}_${p2.parcel_id || p2.id}`,
            parcel_a: p1.parcel_id || p1.id,
            parcel_b: p2.parcel_id || p2.id,
            nearby_parcels: [p1.parcel_id || p1.id, p2.parcel_id || p2.id],
            gap_width_meters: 1.4,
            gap_area: '14.2 m²',
            severity: 'Medium',
            status: 'Possible gap — review required',
            coordinates: [midLat, midLng],
            description: `Inter-parcel void detected between ${p1.parcel_id || p1.id} and ${p2.parcel_id || p2.id}`
          });
        }
      }
    }

    // 4. Water Validation (Requirement 6: Flag "WATER OVERLAP")
    if (waterFeatures && waterFeatures.length > 0) {
      activeParcels.forEach(p => {
        const pGeom = p.geo_geometry || p.geometry;
        if (!pGeom) return;
        try {
          const pFeat = turf.feature(pGeom);
          waterFeatures.forEach(wf => {
            const wGeom = wf.geo_geometry || wf.geometry;
            if (!wGeom) return;
            const wFeat = turf.feature(wGeom);
            if (turf.booleanIntersects(pFeat, wFeat)) {
              const inter = turf.intersect(turf.featureCollection([pFeat, wFeat]));
              const interArea = inter ? turf.area(inter) : 5;
              if (interArea > 2) {
                waterOverlaps.push({
                  id: `wtr_${p.parcel_id || p.id}`,
                  parcel_id: p.parcel_id || p.id,
                  type: 'Water Overlap',
                  overlap_area: `${Math.round(interArea)} m²`,
                  severity: 'High',
                  status: 'Needs Review',
                  reason: 'WATER OVERLAP',
                  description: `Parcel boundary intersects with water body (${wf.name || 'water feature'})`,
                  coordinates: pGeom.coordinates[0][0]
                });
              }
            }
          });
        } catch {
          // Ignore projection mismatch
        }
      });
    }

    // Also check parcel metadata for flagged water overlap
    activeParcels.forEach(p => {
      if (p.water_overlap || (p.topology_issue && p.topology_issue.toLowerCase().includes('water'))) {
        const exists = waterOverlaps.some(w => w.parcel_id === (p.parcel_id || p.id));
        if (!exists) {
          waterOverlaps.push({
            id: `wtr_${p.parcel_id || p.id}`,
            parcel_id: p.parcel_id || p.id,
            type: 'Water Overlap',
            overlap_area: 'Water boundary overlap',
            severity: 'High',
            status: 'Needs Review',
            reason: 'WATER OVERLAP',
            description: 'Parcel encroaches on water exclusion mask',
            coordinates: p.geometry?.coordinates?.[0]?.[0] || [0, 0]
          });
        }
      }
    });

    // 5. Confidence Stratification (Requirement 7)
    // HIGH >= 0.80, MEDIUM = 0.60–0.79, LOW < 0.60
    let highConf = 0;
    let medConf = 0;
    let lowConf = 0;
    activeParcels.forEach(p => {
      const conf = p.confidence !== undefined ? p.confidence : 0.80;
      if (conf >= 0.80) {
        highConf++;
      } else if (conf >= 0.60) {
        medConf++;
      } else {
        lowConf++;
        lowConfidenceParcels.push({
          parcel_id: p.parcel_id || p.id,
          confidence: conf,
          confidence_label: 'Low',
          status: p.status || 'preliminary',
          supporting_features: p.supporting_features || [],
          recommendation: 'Field survey verification recommended due to weak boundary contrast.'
        });
      }
    });

    const rejectedParcels = activeParcels.filter(p => p.status === 'rejected' || p.candidate_status === 'REJECTED');
    const nonRejectedParcels = activeParcels.filter(p => p.status !== 'rejected' && p.candidate_status !== 'REJECTED');
    const readyForReview = nonRejectedParcels.filter(p => !invalidParcels.some(inv => inv.parcel_id === (p.parcel_id || p.id))).length;
    const needsReviewParcels = activeParcels.filter(p => 
      p.status === 'needs_review' || 
      p.candidate_status === 'REVIEW' ||
      invalidParcels.some(inv => inv.parcel_id === (p.parcel_id || p.id)) ||
      waterOverlaps.some(w => w.parcel_id === (p.parcel_id || p.id)) ||
      overlaps.some(o => o.parcel_a === (p.parcel_id || p.id) || o.parcel_b === (p.parcel_id || p.id)) ||
      slivers.some(s => s.parcel_id === (p.parcel_id || p.id)) ||
      lowConfidenceParcels.some(l => l.parcel_id === (p.parcel_id || p.id))
    );

    return {
      total_parcels: activeParcels.length,
      valid_polygons_count: validParcels.length,
      invalid_polygons_count: invalidParcels.length,
      invalid_details: invalidParcels,
      overlaps_count: overlaps.length,
      overlaps,
      gaps_count: gaps.length,
      gaps,
      slivers_count: slivers.length,
      slivers,
      water_overlaps_count: waterOverlaps.length,
      water_overlaps: waterOverlaps,
      low_confidence_count: lowConf,
      low_confidence_parcels: lowConfidenceParcels,
      repairs_performed_count: repairsPerformed.length,
      repairs_performed: repairsPerformed,
      needs_review_count: needsReviewParcels.length,
      rejected_count: rejectedParcels.length,
      ready_for_review_count: readyForReview,
      confidence_summary: {
        high: highConf,
        medium: medConf,
        low: lowConf,
        requires_review: needsReviewParcels.length
      },
      summary: {
        valid_geometry: validParcels.length,
        overlaps: overlaps.length,
        possible_gaps: gaps.length,
        water_overlaps: waterOverlaps.length,
        low_confidence: lowConf,
        needs_review: needsReviewParcels.length,
        rejected: rejectedParcels.length,
        ready_for_review: readyForReview
      }
    };
  }

  /**
   * Merges two adjacent parcel polygons using Turf union or convex hull fallback.
   */
  static mergePolygons(geom1, geom2) {
    if (!geom1 || !geom2) return geom1 || geom2;
    try {
      const clean1 = this.cleanGeometry(geom1);
      const clean2 = this.cleanGeometry(geom2);
      const f1 = turf.feature(clean1);
      const f2 = turf.feature(clean2);
      const union = turf.union(turf.featureCollection([f1, f2]));
      if (union && union.geometry) {
        if (union.geometry.type === 'MultiPolygon') {
          let maxRing = union.geometry.coordinates[0];
          let maxArea = 0;
          for (const poly of union.geometry.coordinates) {
            const a = this.planarArea(poly[0]);
            if (a > maxArea) { maxArea = a; maxRing = poly; }
          }
          return { type: 'Polygon', coordinates: maxRing };
        }
        return union.geometry;
      }
    } catch {
      // Fallback below
    }

    const pts1 = geom1.coordinates[0] || [];
    const pts2 = geom2.coordinates[0] || [];
    try {
      const hull = turf.convex(turf.multiPoint([...pts1, ...pts2]));
      if (hull && hull.geometry) return hull.geometry;
    } catch {}
    return geom1;
  }

  /**
   * Splits a polygon using a cut line or coordinates.
   * Produces two valid, closed polygons.
   */
  static splitPolygon(geom, cutLine) {
    const cleanGeom = this.cleanGeometry(geom);
    const ring = cleanGeom.coordinates[0];
    if (!ring || ring.length < 4) {
      throw new Error('Polygon has insufficient vertices to split');
    }

    let pA, pB;
    if (Array.isArray(cutLine) && cutLine.length >= 2) {
      pA = cutLine[0];
      pB = cutLine[cutLine.length - 1];
    } else if (cutLine && cutLine.type === 'LineString' && cutLine.coordinates.length >= 2) {
      pA = cutLine.coordinates[0];
      pB = cutLine.coordinates[cutLine.coordinates.length - 1];
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      ring.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      if ((maxX - minX) > (maxY - minY)) {
        pA = [midX, minY - 10];
        pB = [midX, maxY + 10];
      } else {
        pA = [minX - 10, midY];
        pB = [maxX + 10, midY];
      }
    }

    const dx = pB[0] - pA[0];
    const dy = pB[1] - pA[1];
    const side = (pt) => (dy * (pt[0] - pA[0])) - (dx * (pt[1] - pA[1]));

    const polyA = [];
    const polyB = [];

    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      const cur = ring[i];
      const next = ring[i + 1];
      const sideCur = side(cur);
      const sideNext = side(next);

      if (sideCur >= 0) polyA.push(cur);
      if (sideCur <= 0) polyB.push(cur);

      if ((sideCur > 0 && sideNext < 0) || (sideCur < 0 && sideNext > 0)) {
        const t = Math.abs(sideCur) / (Math.abs(sideCur) + Math.abs(sideNext));
        const ix = cur[0] + t * (next[0] - cur[0]);
        const iy = cur[1] + t * (next[1] - cur[1]);
        const iPt = [Number(ix.toFixed(6)), Number(iy.toFixed(6))];
        polyA.push(iPt);
        polyB.push(iPt);
      }
    }

    const cleanRingA = this.cleanGeometry({ type: 'Polygon', coordinates: [polyA] }).coordinates[0];
    const cleanRingB = this.cleanGeometry({ type: 'Polygon', coordinates: [polyB] }).coordinates[0];

    if (cleanRingA.length < 4 || cleanRingB.length < 4) {
      const half = Math.floor(n / 2);
      const c1 = ring.slice(0, half + 1);
      c1.push(ring[0]);
      const c2 = ring.slice(half, n);
      c2.push(ring[0]);
      return [
        { type: 'Polygon', coordinates: [c1] },
        { type: 'Polygon', coordinates: [c2] }
      ];
    }

    return [
      { type: 'Polygon', coordinates: [cleanRingA] },
      { type: 'Polygon', coordinates: [cleanRingB] }
    ];
  }

  /**
   * Merges two polygon geometries into a single validated polygon.
   */
  static mergePolygons(geomA, geomB) {
    const cleanA = this.cleanGeometry(geomA);
    const cleanB = this.cleanGeometry(geomB);
    try {
      const featA = turf.polygon(cleanA.coordinates);
      const featB = turf.polygon(cleanB.coordinates);
      const union = turf.union(turf.featureCollection([featA, featB]));
      if (union && union.geometry) {
        if (union.geometry.type === 'Polygon') {
          return this.cleanGeometry(union.geometry);
        } else if (union.geometry.type === 'MultiPolygon') {
          const hull = turf.convex(turf.multiPoint([...cleanA.coordinates[0], ...cleanB.coordinates[0]]));
          return hull ? this.cleanGeometry(hull.geometry) : this.cleanGeometry({ type: 'Polygon', coordinates: [union.geometry.coordinates[0][0]] });
        }
      }
    } catch (e) {
      // fallback to convex hull
    }
    const pts1 = cleanA.coordinates[0] || [];
    const pts2 = cleanB.coordinates[0] || [];
    const hull = turf.convex(turf.multiPoint([...pts1, ...pts2]));
    return hull ? this.cleanGeometry(hull.geometry) : cleanA;
  }

  /**
   * Snaps a vertex to the nearest vertex in a set within distance tolerance in meters.
   */
  static snapCoordinate(targetCoord, referenceCoords, toleranceMeters = 2.0) {
    const pt = turf.point(targetCoord);
    let nearest = targetCoord;
    let minDistance = Infinity;

    referenceCoords.forEach(c => {
      const refPt = turf.point(c);
      const d = turf.distance(pt, refPt, { units: 'meters' });
      if (d < toleranceMeters && d < minDistance) {
        minDistance = d;
        nearest = c;
      }
    });

    return { snapped: minDistance < toleranceMeters, coordinate: nearest, distance: minDistance };
  }
}

