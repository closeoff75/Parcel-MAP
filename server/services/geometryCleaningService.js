/**
 * ParcelMap Geometry Cleaning Service (Step 6A Section 17)
 * 
 * Implements an 8-stage geometric refinement pipeline:
 * 1. Raw Detection Input
 * 2. Remove Noise (corrupt, non-finite, degenerate coordinate arrays)
 * 3. Remove Tiny Objects (below minimum length/area thresholds)
 * 4. Simplify Geometry (RDP simplification without over-smoothing critical boundaries)
 * 5. Fix Invalid Geometry (close polygons, remove self-adjacent identical vertices)
 * 6. Merge Appropriate Same-Class Features (collinear road/wall segment snapping)
 * 7. Remove Duplicates (centroid/bounding-box spatial deduplication)
 * 8. Final Cleaned Geometry Output
 */

import { CVEngine } from './cvEngine.js';

export class GeometryCleaningService {
  /**
   * Main cleaning pipeline executing all 8 stages on detected features grouped by class.
   * @param {Object} featuresByClass { roads: [], buildings: [], fields: [], walls: [], fences: [], vegetation: [], water: [] }
   * @param {Object} ctx Analysis context containing dimensions, scale factors, etc.
   * @returns {Object} Cleaned features by class
   */
  static clean(featuresByClass, ctx = {}) {
    const origW = ctx.origW || (ctx.width ? Math.round(ctx.width * (ctx.scaleX || 1)) : 2000);
    const origH = ctx.origH || (ctx.height ? Math.round(ctx.height * (ctx.scaleY || 1)) : 1500);
    const totalArea = origW * origH;

    const cleaned = {};
    const classes = ['roads', 'buildings', 'fields', 'walls', 'fences', 'vegetation', 'water'];

    for (const cls of classes) {
      let list = featuresByClass[cls] || [];
      const isLinear = (cls === 'roads' || cls === 'walls' || cls === 'fences');

      // Stage 2: Remove Noise
      list = this.removeNoise(list, isLinear);

      // Stage 3: Remove Tiny Objects
      list = this.removeTinyObjects(list, isLinear, totalArea);

      // Stage 4: Simplify Geometry (Ramer-Douglas-Peucker)
      list = this.simplifyGeometry(list, isLinear, cls);

      // Stage 5: Fix Invalid Geometry
      list = this.fixInvalidGeometry(list, isLinear);

      // Stage 6: Merge Appropriate Same-Class Features
      if (cls === 'roads' || cls === 'walls' || cls === 'fences') {
        list = this.mergeLinearFeatures(list, cls);
      }

      // Stage 7: Remove Duplicates
      list = this.removeDuplicates(list);

      // Stage 8: Final Geometry Validation (Requirement 13)
      cleaned[cls] = list.filter(f => this.validateGeometry(f, origW, origH, cls).valid);
    }

    return cleaned;
  }

  /**
   * Stage 2: Remove Noise
   * Filters out items with missing geometry, non-finite values, or insufficient points.
   */
  static removeNoise(features, isLinear) {
    return features.filter(f => {
      if (!f || !f.geometry || !f.geometry.coordinates) return false;
      const coords = f.geometry.coordinates;
      if (!Array.isArray(coords) || coords.length === 0) return false;

      if (isLinear) {
        // LineString needs at least 2 points
        if (coords.length < 2) return false;
        for (const pt of coords) {
          if (!Array.isArray(pt) || pt.length < 2) return false;
          if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;
        }
      } else {
        // Polygon ring needs at least 3 points
        const ring = Array.isArray(coords[0]) ? coords[0] : coords;
        if (!ring || ring.length < 3) return false;
        for (const pt of ring) {
          if (!Array.isArray(pt) || pt.length < 2) return false;
          if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;
        }
      }
      return true;
    });
  }

  /**
   * Stage 3: Remove Tiny Objects
   * Enforces minimum pixel length for linear features and minimum pixel area for polygons.
   */
  static removeTinyObjects(features, isLinear, totalArea) {
    const minLineLen = 14; // minimum 14px length for roads, walls, fences
    const minPolyArea = Math.max(25, totalArea * 0.00015); // minimum 25px² or proportional

    return features.filter(f => {
      if (isLinear) {
        const coords = f.geometry.coordinates;
        let len = 0;
        for (let i = 1; i < coords.length; i++) {
          len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
        }
        f.length_pixels = Math.round(len);
        return len >= minLineLen;
      } else {
        const ring = Array.isArray(f.geometry.coordinates[0]) ? f.geometry.coordinates[0] : f.geometry.coordinates;
        const area = this.calculatePolygonArea(ring);
        f.area_image_pixels = Math.round(area);
        return area >= minPolyArea;
      }
    });
  }

  /**
   * Stage 4: Simplify Geometry
   * Applies Ramer-Douglas-Peucker to reduce vertex noise while preserving building corners and road bends.
   */
  static simplifyGeometry(features, isLinear, cls) {
    // Epsilon tuned by class:
    // Buildings: small epsilon (1.5) to keep crisp corners and rectangularity
    // Roads: medium epsilon (2.5) to smooth out pixel stepping while keeping turns
    // Fields: epsilon 3.0 for smooth natural boundaries
    // Walls & fences: epsilon 2.0
    let epsilon = 2.0;
    if (cls === 'buildings') epsilon = 1.5;
    else if (cls === 'roads') epsilon = 2.5;
    else if (cls === 'fields' || cls === 'vegetation') epsilon = 3.0;

    return features.map(f => {
      if (isLinear) {
        const coords = f.geometry.coordinates;
        const simplified = CVEngine.ramerDouglasPeucker(coords, epsilon);
        if (simplified.length >= 2) {
          f.geometry.coordinates = simplified;
          if (f.image_coordinates) f.image_coordinates = simplified;
        }
      } else {
        const ring = Array.isArray(f.geometry.coordinates[0]) ? f.geometry.coordinates[0] : f.geometry.coordinates;
        const isClosed = ring.length > 2 &&
          ring[0][0] === ring[ring.length - 1][0] &&
          ring[0][1] === ring[ring.length - 1][1];
        
        // Simplify open ring then reclose
        const openRing = isClosed ? ring.slice(0, -1) : ring;
        let simplified = CVEngine.ramerDouglasPeucker(openRing, epsilon);
        if (simplified.length >= 3) {
          simplified.push([simplified[0][0], simplified[0][1]]);
          f.geometry.coordinates = [simplified];
          if (f.image_coordinates) f.image_coordinates = simplified;
        }
      }
      return f;
    });
  }

  /**
   * Stage 5: Fix Invalid Geometry
   * Closes open polygon rings and removes consecutive duplicate vertices.
   */
  static fixInvalidGeometry(features, isLinear) {
    return features.filter(f => {
      if (isLinear) {
        const coords = f.geometry.coordinates;
        const cleanedCoords = [];
        for (let i = 0; i < coords.length; i++) {
          const pt = coords[i];
          if (i === 0 || Math.hypot(pt[0] - cleanedCoords[cleanedCoords.length - 1][0], pt[1] - cleanedCoords[cleanedCoords.length - 1][1]) > 0.5) {
            cleanedCoords.push(pt);
          }
        }
        if (cleanedCoords.length < 2) return false;
        f.geometry.coordinates = cleanedCoords;
        if (f.image_coordinates) f.image_coordinates = cleanedCoords;
        return true;
      } else {
        let ring = Array.isArray(f.geometry.coordinates[0]) ? f.geometry.coordinates[0] : f.geometry.coordinates;
        const cleanedRing = [];
        for (let i = 0; i < ring.length; i++) {
          const pt = ring[i];
          if (i === 0 || Math.hypot(pt[0] - cleanedRing[cleanedRing.length - 1][0], pt[1] - cleanedRing[cleanedRing.length - 1][1]) > 0.5) {
            cleanedRing.push(pt);
          }
        }
        if (cleanedRing.length < 3) return false;

        // Ensure closed ring
        const first = cleanedRing[0];
        const last = cleanedRing[cleanedRing.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          cleanedRing.push([first[0], first[1]]);
        }
        if (cleanedRing.length < 4) return false;

        f.geometry.coordinates = [cleanedRing];
        if (f.image_coordinates) f.image_coordinates = cleanedRing;
        return true;
      }
    });
  }

  /**
   * Stage 6: Merge Linear Features (roads, walls, fences)
   * Connects adjacent collinear segments with small gaps (< 28px) and similar heading (< 25 deg).
   */
  static mergeLinearFeatures(features, cls) {
    if (features.length <= 1) return features;

    const lineSegments = features.map(f => f.geometry.coordinates);
    const maxGap = cls === 'roads' ? 32 : 22;
    const maxAngleDiff = 25;

    const mergedLines = CVEngine.connectCollinearSegments(lineSegments, maxGap, maxAngleDiff);

    // Re-wrap merged line coordinates into feature objects, preserving highest confidence
    return mergedLines.map((lineCoords, i) => {
      // Find matching source feature with closest center
      const mid = lineCoords[Math.floor(lineCoords.length / 2)];
      let bestMatch = features[0];
      let bestDist = Infinity;
      for (const feat of features) {
        const fc = feat.geometry.coordinates;
        const fMid = fc[Math.floor(fc.length / 2)];
        const d = Math.hypot(mid[0] - fMid[0], mid[1] - fMid[1]);
        if (d < bestDist) {
          bestDist = d;
          bestMatch = feat;
        }
      }

      return {
        ...bestMatch,
        name: bestMatch.name || `${cls.slice(0, -1)} ${i + 1}`,
        geometry: {
          type: 'LineString',
          coordinates: lineCoords
        },
        image_coordinates: lineCoords
      };
    });
  }

  /**
   * Stage 7: Remove Duplicates
   * Spatial bounding box and vertex deduplication.
   */
  static removeDuplicates(features) {
    const seenCentroids = [];
    const minSeparation = 8; // min 8px between separate features

    return features.filter(f => {
      const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
      if (!coords || !coords.length) return false;

      let sumX = 0, sumY = 0;
      for (const pt of coords) {
        sumX += pt[0];
        sumY += pt[1];
      }
      const cx = sumX / coords.length;
      const cy = sumY / coords.length;

      for (const prev of seenCentroids) {
        if (Math.hypot(cx - prev.x, cy - prev.y) < minSeparation) {
          return false; // duplicate
        }
      }

      seenCentroids.push({ x: cx, y: cy });
      return true;
    });
  }

  /**
   * Helper: Calculate Polygon Area via Shoelace Formula
   */
  static calculatePolygonArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      area += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1]);
    }
    return Math.abs(area / 2);
  }

  /**
   * Stage 8 Gatekeeper: validateGeometry
   * Enforces non-empty geometry, inside image bounds, min/max areas, aspect ratios,
   * length constraints, and rejects extreme diagonal artifacts.
   */
  static validateGeometry(feature, imgW, imgH, cls = null) {
    if (!feature || !feature.geometry) return { valid: false, reason: 'no_geometry' };
    const geom = feature.geometry;
    const coords = geom.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return { valid: false, reason: 'empty_coordinates' };

    const totalArea = imgW * imgH;
    const maxDim = Math.max(imgW, imgH);
    const rawType = (cls || feature.type || feature.detection_type || '').toLowerCase();
    const type = rawType.replace(/s$/, ''); // normalize 'roads' -> 'road', 'fields' -> 'field'

    if (geom.type === 'Polygon') {
      const ring = Array.isArray(coords[0]) ? coords[0] : coords;
      if (ring.length < 4) return { valid: false, reason: 'polygon_ring_too_short' };

      for (const pt of ring) {
        if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return { valid: false, reason: 'non_finite_coordinates' };
        if (pt[0] < -5 || pt[0] > imgW + 10 || pt[1] < -5 || pt[1] > imgH + 10) return { valid: false, reason: 'out_of_bounds' };
      }

      const area = this.calculatePolygonArea(ring);
      if (type === 'building') {
        if (area < 60 || area > totalArea * 0.35) return { valid: false, reason: 'building_area_out_of_bounds' };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const pt of ring) {
          minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
          minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
        }
        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        if (Math.min(bw, bh) < 6) return { valid: false, reason: 'building_too_thin' };
        if (Math.max(bw, bh) / Math.min(bw, bh) > 4.5) return { valid: false, reason: 'building_aspect_ratio' };
      } else if (type === 'field') {
        if (area < totalArea * 0.015 || area > totalArea * 0.55) return { valid: false, reason: 'field_area_out_of_bounds' };
      } else if (type === 'vegetation') {
        if (area < 100 || area > totalArea * 0.25) return { valid: false, reason: 'vegetation_area_out_of_bounds' };
      } else if (type === 'water') {
        if (area < 80 || area > totalArea * 0.25) return { valid: false, reason: 'water_area_out_of_bounds' };
      }
      return { valid: true };
    } else if (geom.type === 'LineString') {
      if (coords.length < 2) return { valid: false, reason: 'linestring_too_short' };

      for (const pt of coords) {
        if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return { valid: false, reason: 'non_finite_coordinates' };
        if (pt[0] < -5 || pt[0] > imgW + 10 || pt[1] < -5 || pt[1] > imgH + 10) return { valid: false, reason: 'out_of_bounds' };
      }

      let len = 0;
      for (let i = 1; i < coords.length; i++) {
        const seg = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
        if (seg > maxDim * 0.55) return { valid: false, reason: 'extreme_segment_jump' };
        len += seg;
      }
      if (len < 25) return { valid: false, reason: 'line_length_too_short' };
      if (type === 'road') {
        if (len > maxDim * 2.2) return { valid: false, reason: 'road_length_excessive' };
      } else {
        if (len > maxDim * 0.75) return { valid: false, reason: 'extreme_diagonal_artifact' };
      }

      return { valid: true };
    }

    return { valid: false, reason: 'unsupported_geometry_type' };
  }
}
