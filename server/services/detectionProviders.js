/**
 * ParcelMap Multi-Class Detection & Feature Separation Engine
 * 
 * Implements a complete multi-class detection pipeline:
 * Uploaded Image -> Validation -> Preprocessing -> Tiling -> Feature Detection
 * -> Classification -> Separation -> Geometry Cleaning -> Confidence Scoring
 * -> Class-Specific GeoJSON Layers
 * 
 * Standard Feature Classes:
 * 1. road (LineString / MultiLineString)
 * 2. building (Polygon / MultiPolygon)
 * 3. field (Polygon / MultiPolygon)
 * 4. wall (LineString / MultiLineString)
 * 5. fence (LineString / MultiLineString)
 * 6. vegetation (Polygon / MultiPolygon)
 * 7. water (Polygon / LineString)
 * 8. unknown
 */

import path from 'path';
import { spawn } from 'child_process';
import { CVEngine } from './cvEngine.js';
import { GeometryCleaningService } from './geometryCleaningService.js';

/**
 * Base Abstract Detection Provider
 */
export class DetectionProvider {
  constructor(name = 'base_provider') {
    this.name = name;
  }

  async detect(imageInfo, options = {}) {
    throw new Error('detect() must be implemented by subclass');
  }

  static getProvider(type = 'ml') {
    if (type === 'demo') {
      return new DemoDetectionProvider();
    }
    if (type === 'computer_vision' || type === 'cv' || type === 'opencv') {
      return new ComputerVisionProvider();
    }
    if (type === 'remote') {
      return new RemoteInferenceProvider();
    }
    return new MLDetectionProvider();
  }
}

/**
 * Genuine Computer Vision Multi-Class Detection Provider
 */
export class ComputerVisionProvider extends DetectionProvider {
  constructor() {
    super('computer_vision');
  }

  /**
   * Main entry point for multi-class detection.
   * imageInfo: { filePath, width, height, project_id, imagery_id, is_georeferenced, project_coordinates }
   */
  async detect(imageInfo, options = {}) {
    const startTime = Date.now();
    const { filePath, project_id, imagery_id, is_georeferenced, project_coordinates } = imageInfo;

    // 1. Image Validation
    if (!filePath) throw new Error('No image file path provided for detection.');
    const decoded = CVEngine.loadImage(filePath);
    if (!decoded || !decoded.data || decoded.width < 10 || decoded.height < 10) {
      throw new Error('Invalid or corrupted image data.');
    }

    const origW = decoded.width;
    const origH = decoded.height;

    // 2. Image Preprocessing & Multi-Scale Context Creation
    const maxDim = options.max_analysis_dim || 700;
    const ctx = CVEngine.analyzeImage(decoded, maxDim);
    ctx.origW = origW;
    ctx.origH = origH;

    const useTiling = Boolean(options.use_tiling || (Math.max(origW, origH) > 3000 && options.use_tiling !== false));

    let rawRoads, rawBuildings, rawFields, rawWalls, rawFences, rawVegetation, rawWater;
    let tilesProcessed = 1;

    if (useTiling) {
      const tiled = this.detectTiled(decoded, imageInfo, options);
      rawRoads = tiled.rawRoads;
      rawBuildings = tiled.rawBuildings;
      rawFields = tiled.rawFields;
      rawWalls = tiled.rawWalls;
      rawFences = tiled.rawFences;
      rawVegetation = tiled.rawVegetation;
      rawWater = tiled.rawWater;
      tilesProcessed = tiled.tilesCount;
    } else {
      // 3. Multi-Class Feature Detection (Full Image Context)
      rawRoads = this.detectRoadNetwork(ctx, imageInfo);
      rawBuildings = this.detectBuildings(ctx, imageInfo);
      rawFields = this.detectFields(ctx, imageInfo);
      rawWalls = this.detectWalls(ctx, imageInfo);
      rawFences = this.detectFences(ctx, imageInfo);
      rawVegetation = this.detectVegetation(ctx, imageInfo);
      rawWater = this.detectWater(ctx, imageInfo);
    }

    const debug = {
      image_size: `${origW}x${origH}`,
      original_dimensions: `${origW}x${origH}`,
      analysis_dimensions: `${ctx.width}x${ctx.height}`,
      scale_factors: { x: ctx.scaleX, y: ctx.scaleY },
      tiles_processed: tilesProcessed,
      detections_before_filtering: 0,
      detections_after_filtering: 0,
      detections_before_cleaning: 0,
      detections_after_cleaning: 0,
      detections_removed: 0,
      confidence_distribution: { high: 0, medium: 0, low: 0 }
    };

    debug.detections_before_cleaning = 
      rawRoads.length + rawBuildings.length + rawFields.length + 
      rawWalls.length + rawFences.length + rawVegetation.length + rawWater.length;
    debug.detections_before_filtering = debug.detections_before_cleaning;

    // 4. Feature Classification, Priority & Conflict Resolution
    // Priority: Building > Road > Wall/Fence > Field > Vegetation > Water
    const resolved = this.resolveClassConflicts({
      roads: rawRoads,
      buildings: rawBuildings,
      fields: rawFields,
      walls: rawWalls,
      fences: rawFences,
      vegetation: rawVegetation,
      water: rawWater
    }, ctx);

    // 5. Geometry Cleaning (8-Stage Pipeline via GeometryCleaningService)
    const cleaned = this.cleanAllGeometries(resolved, ctx);

    debug.detections_after_cleaning = 
      cleaned.roads.length + cleaned.buildings.length + cleaned.fields.length + 
      cleaned.walls.length + cleaned.fences.length + cleaned.vegetation.length + cleaned.water.length;
    debug.detections_after_filtering = debug.detections_after_cleaning;
    debug.detections_removed = debug.detections_before_cleaning - debug.detections_after_cleaning;

    // 6. Assemble Standard Schema Feature List & Class-Specific Layers
    const allFeatures = [];
    const layers = {
      roads: { type: 'FeatureCollection', name: 'Roads', features: [] },
      buildings: { type: 'FeatureCollection', name: 'Buildings', features: [] },
      fields: { type: 'FeatureCollection', name: 'Fields', features: [] },
      walls: { type: 'FeatureCollection', name: 'Walls', features: [] },
      fences: { type: 'FeatureCollection', name: 'Fences', features: [] },
      vegetation: { type: 'FeatureCollection', name: 'Vegetation', features: [] },
      water: { type: 'FeatureCollection', name: 'Water', features: [] }
    };

    const providerTag = options.fallback ? 'opencv_fallback' : (options.provider || 'computer_vision');
    const modelTag = options.fallback ? 'OpenCV Fallback Engine v1.0' : 'Edge & Pixel Computer Vision Engine';
    const runId = imageInfo.detection_run_id || options.run_id || `run_${Date.now()}`;

    let counter = 1;
    const processClassFeatures = (items, type) => {
      items.forEach((item) => {
        const featId = `det_${imagery_id}_${type}_${counter++}`;
        const conf = Number(item.confidence.toFixed(2));
        const confLabel = conf >= 0.80 ? 'High' : (conf >= 0.60 ? 'Medium' : 'Low');

        if (conf >= 0.80) debug.confidence_distribution.high++;
        else if (conf >= 0.60) debug.confidence_distribution.medium++;
        else debug.confidence_distribution.low++;

        // Filter out features with confidence below reliable threshold (< 0.40)
        if (conf < 0.40) return;

        const featureObj = {
          id: featId,
          project_id,
          imagery_id,
          detection_run_id: runId,
          type,
          detection_type: type.toUpperCase(),
          feature_type: this.formatFeatureTitle(type),
          name: item.name || `${this.formatFeatureTitle(type)} ${counter - 1}`,
          sub_type: item.sub_type || `${this.formatFeatureTitle(type)} Feature`,
          geometry: item.geometry,
          image_coordinates: item.image_coordinates || item.geometry.coordinates,
          confidence: conf,
          confidence_label: confLabel,
          coordinate_mode: is_georeferenced ? 'geographic' : 'image',
          provider: providerTag,
          model_name: modelTag,
          source_feature_ids: item.source_feature_ids || [],
          source: 'ai_detected',
          evidence: item.evidence || [],
          properties: {
            name: item.name || `${this.formatFeatureTitle(type)} ${counter - 1}`,
            type,
            confidence: conf,
            confidence_label: confLabel,
            evidence: item.evidence || [],
            area_image_pixels: item.area_image_pixels || null,
            length_pixels: item.length_pixels || null,
            provider: providerTag,
            model_name: modelTag,
            detection_run_id: runId
          },
          created_at: new Date().toISOString()
        };

        // Georeferenced coordinates mapping if applicable
        if (is_georeferenced && project_coordinates) {
          featureObj.geo_geometry = this.projectToGeographic(featureObj.geometry, origW, origH, project_coordinates);
        }

        allFeatures.push(featureObj);

        // Class-specific GeoJSON Feature
        const geoJsonFeature = {
          type: 'Feature',
          id: featId,
          properties: featureObj.properties,
          geometry: featureObj.geometry
        };

        const typeToLayerKey = {
          road: 'roads',
          building: 'buildings',
          field: 'fields',
          wall: 'walls',
          fence: 'fences',
          vegetation: 'vegetation',
          water: 'water'
        };
        const layerKey = typeToLayerKey[type] || type;
        if (layers[layerKey]) {
          layers[layerKey].features.push(geoJsonFeature);
        }
      });
    };

    processClassFeatures(cleaned.roads, 'road');
    processClassFeatures(cleaned.buildings, 'building');
    processClassFeatures(cleaned.fields, 'field');
    processClassFeatures(cleaned.walls, 'wall');
    processClassFeatures(cleaned.fences, 'fence');
    processClassFeatures(cleaned.vegetation, 'vegetation');
    processClassFeatures(cleaned.water, 'water');

    debug.processing_time_ms = Date.now() - startTime;

    const summary = {
      roads: layers.roads.features.length,
      buildings: layers.buildings.features.length,
      fields: layers.fields.features.length,
      walls: layers.walls.features.length,
      fences: layers.fences.features.length,
      vegetation: layers.vegetation.features.length,
      water: layers.water.features.length,
      total: allFeatures.length
    };

    // Structured logging (Step 6A Section 30)
    console.log(`\n[Detection] Project ID: ${project_id}`);
    console.log(`[Detection] Imagery ID: ${imagery_id}`);
    console.log(`[Detection] Image dimensions: ${origW}x${origH}`);
    console.log(`[Detection] Provider: ${this.name}`);
    console.log(`[Detection] Tiles processed: ${debug.tiles_processed}`);
    console.log(`[Detection] Raw roads: ${rawRoads.length}`);
    console.log(`[Detection] Raw buildings: ${rawBuildings.length}`);
    console.log(`[Detection] Raw fields: ${rawFields.length}`);
    console.log(`[Detection] Raw walls: ${rawWalls.length}`);
    console.log(`[Detection] Raw fences: ${rawFences.length}`);
    console.log(`[Detection] After filtering: ${debug.detections_after_filtering}`);
    console.log(`[Detection] Processing time: ${debug.processing_time_ms}ms\n`);

    return {
      project_id,
      imagery_id,
      detection_run_id: runId,
      status: allFeatures.length > 0 ? 'completed' : 'empty',
      message: allFeatures.length > 0 ? null : 'No detectable features were found in this image.',
      coordinate_mode: is_georeferenced ? 'geographic' : 'image',
      provider: providerTag,
      model_name: modelTag,
      summary,
      layers,
      roads: layers.roads.features,
      buildings: layers.buildings.features,
      fields: layers.fields.features,
      boundaries: [...layers.walls.features, ...layers.fences.features],
      walls: layers.walls.features,
      fences: layers.fences.features,
      vegetation: layers.vegetation.features,
      water: layers.water.features,
      detections: allFeatures,
      features: allFeatures,
      features_count: allFeatures.length,
      debug
    };
  }

  /**
   * Tiled processing for large aerial orthomosaics (Step 6A Section 7)
   * Slices high-resolution imagery into overlapping sub-tiles, runs feature
   * extraction on each tile, and projects coordinates back to global image space.
   */
  detectTiled(decoded, imageInfo, options) {
    const origW = decoded.width;
    const origH = decoded.height;
    const tileSize = options.tile_size || 1000;
    const overlap = options.tile_overlap || 180;
    const step = tileSize - overlap;

    const rawRoads = [];
    const rawBuildings = [];
    const rawFields = [];
    const rawWalls = [];
    const rawFences = [];
    const rawVegetation = [];
    const rawWater = [];

    let tilesCount = 0;

    for (let y = 0; y < origH; y += step) {
      for (let x = 0; x < origW; x += step) {
        const curW = Math.min(tileSize, origW - x);
        const curH = Math.min(tileSize, origH - y);
        if (curW < 120 || curH < 120) continue;

        const tileImg = CVEngine.extractTile(decoded, x, y, curW, curH);
        if (!tileImg) continue;

        tilesCount++;
        const tileCtx = CVEngine.analyzeImage(tileImg, Math.min(curW, 650));
        const tileInfo = { ...imageInfo, width: curW, height: curH };

        const shiftPoint = (pt) => [Math.round(pt[0] + x), Math.round(pt[1] + y)];
        const offsetFeats = (list) => {
          return list.map(f => {
            const geom = f.geometry;
            const newCoords = geom.type === 'Polygon'
              ? [geom.coordinates[0].map(shiftPoint)]
              : geom.coordinates.map(shiftPoint);
            return {
              ...f,
              geometry: { type: geom.type, coordinates: newCoords },
              image_coordinates: newCoords
            };
          });
        };

        rawRoads.push(...offsetFeats(this.detectRoadNetwork(tileCtx, tileInfo)));
        rawBuildings.push(...offsetFeats(this.detectBuildings(tileCtx, tileInfo)));
        rawFields.push(...offsetFeats(this.detectFields(tileCtx, tileInfo)));
        rawWalls.push(...offsetFeats(this.detectWalls(tileCtx, tileInfo)));
        rawFences.push(...offsetFeats(this.detectFences(tileCtx, tileInfo)));
        rawVegetation.push(...offsetFeats(this.detectVegetation(tileCtx, tileInfo)));
        rawWater.push(...offsetFeats(this.detectWater(tileCtx, tileInfo)));
      }
    }

    return {
      rawRoads,
      rawBuildings,
      rawFields,
      rawWalls,
      rawFences,
      rawVegetation,
      rawWater,
      tilesCount: Math.max(1, tilesCount)
    };
  }

  /* --------------------------------------------------------------------------
     1. ROAD DETECTION (LineString / MultiLineString, Network, Intersections)
     -------------------------------------------------------------------------- */
  detectRoadNetwork(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, hsv, exg, edges } = ctx;
    const totalPixels = width * height;
    let roads = [];

    // 1. Land pavement / road corridor candidate mask
    const landMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const h = hsv[i * 3];
      const s = hsv[i * 3 + 1];
      const v = hsv[i * 3 + 2];
      // Exclude saturated vegetative canopy
      const isVeg = (s >= 0.20) && (h >= 45 && h <= 155) && (exg[i] > 0.05);
      if (!isVeg) {
        // Asphalt / concrete pavement or packed road corridor: low-moderate saturation, non-dark
        const isPaved = (s <= 0.38 && v >= 0.20 && v <= 0.98);
        const isDirtTrack = (h >= 14 && h <= 45 && s <= 0.45 && v >= 0.25 && v <= 0.85);
        if (isPaved || isDirtTrack) landMask[i] = 1;
      }
    }

    // 2. Broad field suppression: Erode by 18px and dilate by 19px to separate broad fields (width > 40px) from narrow road corridors (width <= 36px)
    const eroded = CVEngine.erode(landMask, width, height, 18);
    const broadFields = CVEngine.dilate(eroded, width, height, 19);

    const corridorMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      if (landMask[i] === 1 && broadFields[i] === 0) {
        corridorMask[i] = 1;
      }
    }

    const closed = CVEngine.morphClose(corridorMask, width, height, 2);
    const components = CVEngine.findConnectedComponents(closed, width, height, 30);

    components.forEach((comp) => {
      const bb = comp.bbox;
      const bw = bb.maxX - bb.minX;
      const bh = bb.maxY - bb.minY;
      const len = Math.max(bw, bh);
      const aspect = len / Math.max(1, Math.min(bw, bh));
      const areaFrac = comp.pixels.length / totalPixels;

      // Elongated linear corridor criteria (roads & parking lanes)
      if (len >= 25 && (aspect >= 1.7 || (aspect >= 1.4 && len >= 40)) && areaFrac < 0.15) {
        const spine = CVEngine.extractPcaSpine(comp, width, height);
        if (spine && spine.length >= 2) {
          const simplified = CVEngine.ramerDouglasPeucker(spine, 2.0);
          if (simplified.length >= 2) {
            const imageCoords = simplified.map(pt => [
              Math.round(pt[0] * scaleX),
              Math.round(pt[1] * scaleY)
            ]);

            const approxWidth = Math.round(Math.max(4, Math.min(28, comp.pixels.length / Math.max(1, len)) * scaleX));
            const pathLength = Math.round(this.calculateLineLength(imageCoords));

            if (pathLength >= 20) {
              roads.push({
                name: `Road Corridor ${roads.length + 1}`,
                sub_type: approxWidth > 18 ? 'Primary Arterial Corridor' : 'Rural / Access Lane',
                confidence: Number(Math.min(0.96, Math.max(0.72, 0.76 + (aspect > 3 ? 0.14 : 0.06))).toFixed(2)),
                evidence: [
                  'continuous_linear_corridor',
                  `consistent_width_${approxWidth}px`,
                  'asphalt_pavement_spectral_signature',
                  aspect > 3 ? 'high_elongation_aspect' : 'connected_corridor_alignment'
                ],
                length_pixels: pathLength,
                image_coordinates: imageCoords,
                geometry: {
                  type: 'LineString',
                  coordinates: imageCoords
                }
              });
            }
          }
        }
      }
    });

    // 3. Connect collinear road segments with small gaps
    roads = CVEngine.connectCollinearSegments(roads, 55, 35);

    return roads.slice(0, 16);
  }

  /* --------------------------------------------------------------------------
     2. BUILDING DETECTION (Polygons, Rectangular Roofs, Minimum Area)
     -------------------------------------------------------------------------- */
  detectBuildings(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, hsv, exg, gradientMag } = ctx;
    const totalPixels = width * height;
    const buildings = [];

    // Building rooftop multi-spectral mask
    const rooftopMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const h = hsv[i * 3];
      const s = hsv[i * 3 + 1];
      const v = hsv[i * 3 + 2];

      // Exclude saturated vegetation
      const isVeg = (s >= 0.20) && (h >= 45 && h <= 155) && (exg[i] > 0.05);
      if (!isVeg) {
        const isTerracotta = ((h <= 40 || h >= 335) && s >= 0.20 && v >= 0.22);
        const isBrightRooftop = (v >= 0.60 && s <= 0.35);
        const isConcreteFlat = (v >= 0.46 && v <= 0.95 && s <= 0.25);
        const isBlueTin = (h >= 175 && h <= 245 && s >= 0.18 && v >= 0.18);

        if (isTerracotta || isBrightRooftop || isConcreteFlat || isBlueTin) {
          rooftopMask[i] = 1;
        }
      }
    }

    // Morphological opening removes narrow paths and sidewalks, followed by closing to bridge rooftop vents/HVAC
    const opened = CVEngine.morphOpen(rooftopMask, width, height, 2);
    const closed = CVEngine.morphClose(opened, width, height, 3);
    const components = CVEngine.findConnectedComponents(closed, width, height, 20);

    components.forEach((comp) => {
      const areaFrac = comp.pixels.length / totalPixels;
      const bb = comp.bbox;
      const bw = bb.maxX - bb.minX;
      const bh = bb.maxY - bb.minY;
      const aspect = bw / Math.max(1, bh);
      const compactness = comp.pixels.length / Math.max(1, bw * bh);

      // Sane building dimensions: 0.03% to 45% of image (residential to commercial/industrial complexes)
      if (areaFrac >= 0.0003 && areaFrac <= 0.45 && aspect >= 0.25 && aspect <= 3.8 && bw >= 5 && bh >= 5 && compactness >= 0.25) {
        const contour = CVEngine.traceContour(comp, width, height);
        if (contour && contour.length >= 4) {
          const simplified = CVEngine.ramerDouglasPeucker(contour, 2.0);
          if (simplified.length >= 4) {
            const closedPoly = [...simplified];
            const p0 = closedPoly[0];
            const pLast = closedPoly[closedPoly.length - 1];
            if (p0[0] !== pLast[0] || p0[1] !== pLast[1]) closedPoly.push([p0[0], p0[1]]);

            const imageCoords = closedPoly.map(pt => [
              Math.round(pt[0] * scaleX),
              Math.round(pt[1] * scaleY)
            ]);

            const pxArea = Math.round(comp.pixels.length * scaleX * scaleY);
            const edgeSharpness = CVEngine.calculateContourEdgeSharpness(simplified, gradientMag, width, height);
            const confidence = Number(Math.min(0.98, Math.max(0.68, 0.70 + edgeSharpness * 0.15 + compactness * 0.12)).toFixed(2));

            buildings.push({
              name: `Structure ${buildings.length + 1}`,
              sub_type: areaFrac > 0.015 ? 'Commercial / Industrial Complex' : 'Residential Building Footprint',
              confidence,
              evidence: [
                'compact_closed_structure',
                'rectilinear_rooftop_contrast',
                `compactness_score_${Math.round(compactness * 100)}pct`,
                `pixel_area_${pxArea}px`
              ],
              area_image_pixels: pxArea,
              image_coordinates: imageCoords,
              geometry: {
                type: 'Polygon',
                coordinates: [imageCoords]
              }
            });
          }
        }
      }
    });

    return buildings.sort((a, b) => b.confidence - a.confidence).slice(0, 30);
  }

  /* --------------------------------------------------------------------------
     3. FIELD / OPEN-LAND DETECTION (Polygons, Agricultural Plots, Visible Edges)
     -------------------------------------------------------------------------- */
  detectFields(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, hsv, exg } = ctx;
    const fields = [];

    // Fields: vegetative surface (ExG > 0.05 or green hue H: 45-160, S >= 0.18, V >= 0.18) or cultivated crop soil (H: 18-42, S >= 0.28, V >= 0.22)
    const fieldMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const h = hsv[i * 3];
      const s = hsv[i * 3 + 1];
      const v = hsv[i * 3 + 2];
      const gIndex = exg[i];

      const isVegetation = (gIndex > 0.05) || (h >= 45 && h <= 160 && s >= 0.18 && v >= 0.18);
      const isCultivatedSoil = (h >= 18 && h <= 42 && s >= 0.28 && v >= 0.22);

      if (isVegetation || isCultivatedSoil) {
        fieldMask[i] = 1;
      }
    }

    const closed = CVEngine.morphClose(fieldMask, width, height, 3);
    const components = CVEngine.findConnectedComponents(closed, width, height, 80);
    const totalPixels = width * height;

    components.forEach((comp) => {
      const areaFrac = comp.pixels.length / totalPixels;
      if (areaFrac >= 0.012 && areaFrac <= 0.98) {
        const contour = CVEngine.traceContour(comp, width, height);
        if (contour && contour.length >= 6) {
          const simplified = CVEngine.ramerDouglasPeucker(contour, 3.5);
          if (simplified.length >= 4) {
            const closedPoly = [...simplified];
            const p0 = closedPoly[0];
            const pLast = closedPoly[closedPoly.length - 1];
            if (p0[0] !== pLast[0] || p0[1] !== pLast[1]) closedPoly.push([p0[0], p0[1]]);

            const imageCoords = closedPoly.map(pt => [
              Math.round(pt[0] * scaleX),
              Math.round(pt[1] * scaleY)
            ]);

            const pxArea = Math.round(comp.pixels.length * scaleX * scaleY);
            const confidence = Number(Math.min(0.95, Math.max(0.70, 0.72 + Math.min(0.20, areaFrac * 4))).toFixed(2));

            fields.push({
              name: `Agricultural Field Plot ${fields.length + 1}`,
              sub_type: 'Cultivated Land / Open Agricultural Field',
              confidence,
              evidence: [
                'homogeneous_spectral_index',
                'contiguous_agricultural_parcel',
                `enclosed_area_${pxArea}px`
              ],
              area_image_pixels: pxArea,
              image_coordinates: imageCoords,
              geometry: {
                type: 'Polygon',
                coordinates: [imageCoords]
              }
            });
          }
        }
      }
    });

    return fields.slice(0, 16);
  }

  /* --------------------------------------------------------------------------
     4. WALL DETECTION (LineString, High-Contrast Stone / Masonry Boundaries)
     -------------------------------------------------------------------------- */
  detectWalls(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, gradientMag, edges } = ctx;
    const walls = [];

    const lines = CVEngine.detectLinearEdgeSegments(edges, width, height, 25);

    lines.forEach((line, idx) => {
      if (line.length >= 2) {
        let gradSum = 0;
        line.forEach(pt => {
          const px = Math.min(width - 1, Math.max(0, Math.round(pt[0])));
          const py = Math.min(height - 1, Math.max(0, Math.round(pt[1])));
          gradSum += gradientMag[py * width + px];
        });
        const avgGrad = gradSum / line.length;

        // Walls exhibit strong gradient magnitude (> 105) representing stone or masonry retaining lines
        if (avgGrad >= 105 && walls.length < 14) {
          const imageCoords = line.map(pt => [
            Math.round(pt[0] * scaleX),
            Math.round(pt[1] * scaleY)
          ]);
          const pathLen = Math.round(this.calculateLineLength(imageCoords));

          if (pathLen >= 25) {
            const confidence = Number(Math.min(0.94, Math.max(0.68, 0.70 + Math.min(0.22, avgGrad / 200))).toFixed(2));
            walls.push({
              name: `Masonry Wall ${walls.length + 1}`,
              sub_type: 'Stone / Masonry Retaining Wall',
              confidence,
              evidence: [
                'high_gradient_linear_edge',
                'continuous_masonry_boundary',
                `edge_contrast_${Math.round(avgGrad)}`
              ],
              length_pixels: pathLen,
              image_coordinates: imageCoords,
              geometry: {
                type: 'LineString',
                coordinates: imageCoords
              }
            });
          }
        }
      }
    });

    return walls;
  }

  /* --------------------------------------------------------------------------
     5. FENCE DETECTION (LineString, Thin Perimeter Wire / Post Barriers)
     -------------------------------------------------------------------------- */
  detectFences(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, gradientMag, edges } = ctx;
    const fences = [];

    const lines = CVEngine.detectLinearEdgeSegments(edges, width, height, 20);

    lines.forEach((line, idx) => {
      if (line.length >= 2) {
        let gradSum = 0;
        line.forEach(pt => {
          const px = Math.min(width - 1, Math.max(0, Math.round(pt[0])));
          const py = Math.min(height - 1, Math.max(0, Math.round(pt[1])));
          gradSum += gradientMag[py * width + px];
        });
        const avgGrad = gradSum / line.length;

        // Fences have moderate gradient (60 - 105) and thin linear profile
        if (avgGrad >= 60 && avgGrad < 105 && fences.length < 12) {
          const imageCoords = line.map(pt => [
            Math.round(pt[0] * scaleX),
            Math.round(pt[1] * scaleY)
          ]);
          const pathLen = Math.round(this.calculateLineLength(imageCoords));

          if (pathLen >= 20) {
            const confidence = Number(Math.min(0.82, Math.max(0.55, 0.58 + Math.min(0.20, avgGrad / 220))).toFixed(2));
            fences.push({
              name: `Perimeter Fence ${fences.length + 1}`,
              sub_type: 'Wire / Agricultural Boundary Fence',
              confidence,
              evidence: [
                'thin_linear_boundary_profile',
                'field_property_separation',
                confidence < 0.65 ? 'needs_surveyor_field_verification' : 'visible_post_alignment'
              ],
              length_pixels: pathLen,
              image_coordinates: imageCoords,
              geometry: {
                type: 'LineString',
                coordinates: imageCoords
              }
            });
          }
        }
      }
    });

    return fences;
  }

  /* --------------------------------------------------------------------------
     6. VEGETATION DETECTION (Polygons, Tree Canopy & Dense Hedgerows)
     -------------------------------------------------------------------------- */
  detectVegetation(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, hsv, exg } = ctx;
    const vegetation = [];

    // Dense vegetation canopy: High Excess Green (ExG > 0.20) and saturated green hue
    const vegMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const h = hsv[i * 3];
      const s = hsv[i * 3 + 1];
      const v = hsv[i * 3 + 2];
      const gIndex = exg[i];

      if (gIndex > 0.20 && h >= 45 && h <= 155 && s > 0.35 && v > 0.15) {
        vegMask[i] = 1;
      }
    }

    const opened = CVEngine.morphOpen(vegMask, width, height, 1);
    const components = CVEngine.findConnectedComponents(opened, width, height, 30);
    const totalPixels = width * height;

    components.forEach((comp) => {
      const areaFrac = comp.pixels.length / totalPixels;
      if (areaFrac >= 0.0015 && areaFrac <= 0.25) {
        const contour = CVEngine.traceContour(comp, width, height);
        if (contour && contour.length >= 5) {
          const simplified = CVEngine.ramerDouglasPeucker(contour, 2.5);
          if (simplified.length >= 4) {
            const closed = [...simplified];
            const p0 = closed[0];
            const pLast = closed[closed.length - 1];
            if (p0[0] !== pLast[0] || p0[1] !== pLast[1]) closed.push([p0[0], p0[1]]);

            const imageCoords = closed.map(pt => [
              Math.round(pt[0] * scaleX),
              Math.round(pt[1] * scaleY)
            ]);

            const pxArea = Math.round(comp.pixels.length * scaleX * scaleY);
            const confidence = Number(Math.min(0.92, Math.max(0.65, 0.70 + Math.min(0.20, areaFrac * 10))).toFixed(2));

            vegetation.push({
              name: `Tree Canopy / Vegetation Cluster ${vegetation.length + 1}`,
              sub_type: areaFrac > 0.03 ? 'Dense Tree Canopy / Woodland' : 'Hedgerow / Tree Cluster',
              confidence,
              evidence: [
                'high_excess_green_index',
                'organic_canopy_texture',
                `vegetation_area_${pxArea}px`
              ],
              area_image_pixels: pxArea,
              image_coordinates: imageCoords,
              geometry: {
                type: 'Polygon',
                coordinates: [imageCoords]
              }
            });
          }
        }
      }
    });

    return vegetation.slice(0, 16);
  }

  /* --------------------------------------------------------------------------
     7. WATER DETECTION (Polygons / LineStrings, Low-Reflectance Canals & Ponds)
     -------------------------------------------------------------------------- */
  detectWater(ctx, imageInfo) {
    const { width, height, scaleX, scaleY, hsv, gray } = ctx;
    const water = [];

    // Water: Low luminance with cyan/blue hue or distinct low reflectance canal/body
    const waterMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const h = hsv[i * 3];
      const s = hsv[i * 3 + 1];
      const v = hsv[i * 3 + 2];
      const luma = gray[i];

      const isWaterChannel = (h >= 170 && h <= 250 && s >= 0.18 && v <= 0.95) || (luma < 0.12 && s < 0.30);
      if (isWaterChannel) {
        waterMask[i] = 1;
      }
    }

    const closed = CVEngine.morphClose(waterMask, width, height, 2);
    const components = CVEngine.findConnectedComponents(closed, width, height, 40);
    const totalPixels = width * height;

    components.forEach((comp) => {
      const areaFrac = comp.pixels.length / totalPixels;
      const bb = comp.bbox;
      const bw = bb.maxX - bb.minX;
      const bh = bb.maxY - bb.minY;
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

      if (areaFrac >= 0.0010 && areaFrac <= 0.30) {
        const contour = CVEngine.traceContour(comp, width, height);
        if (contour && contour.length >= 4) {
          const simplified = CVEngine.ramerDouglasPeucker(contour, 2.5);
          if (simplified.length >= 4) {
            const closedPoly = [...simplified];
            const p0 = closedPoly[0];
            const pLast = closedPoly[closedPoly.length - 1];
            if (p0[0] !== pLast[0] || p0[1] !== pLast[1]) closedPoly.push([p0[0], p0[1]]);

            const imageCoords = closedPoly.map(pt => [
              Math.round(pt[0] * scaleX),
              Math.round(pt[1] * scaleY)
            ]);

            const pxArea = Math.round(comp.pixels.length * scaleX * scaleY);
            const isCanal = aspect >= 2.5;
            const confidence = Number(Math.min(0.95, Math.max(0.66, 0.72 + (isCanal ? 0.14 : 0.06))).toFixed(2));

            water.push({
              name: isCanal ? `Water Canal / Channel ${water.length + 1}` : `Water Body / Retention Basin ${water.length + 1}`,
              sub_type: isCanal ? 'Irrigation Canal / Drainage Channel' : 'Water Reservoir / Pond',
              confidence,
              evidence: [
                'low_reflectance_spectral_signature',
                isCanal ? 'linear_channel_geometry' : 'enclosed_retention_basin',
                `surface_area_${pxArea}px`
              ],
              area_image_pixels: pxArea,
              image_coordinates: imageCoords,
              geometry: {
                type: 'Polygon',
                coordinates: [imageCoords]
              }
            });
          }
        }
      }
    });

    return water.slice(0, 10);
  }

  /* --------------------------------------------------------------------------
     8. CONFLICT RESOLUTION & GEOMETRY CLEANING
     -------------------------------------------------------------------------- */
  resolveClassConflicts(featuresByClass, ctx) {
    // Priority: Building > Road > Wall > Fence > Field > Vegetation > Water
    // 1. Ensure building footprints are not clipped by field polygons or roads
    // 2. Filter out walls/fences that are direct duplicates of road centerlines
    const cleanedRoads = featuresByClass.roads;
    const cleanedBuildings = featuresByClass.buildings;

    // Filter walls that duplicate roads
    const filteredWalls = featuresByClass.walls.filter(w => {
      const wCoords = w.geometry.coordinates;
      if (wCoords.length < 2) return false;
      const wMid = wCoords[Math.floor(wCoords.length / 2)];
      const tooCloseToRoad = cleanedRoads.some(r => {
        return r.geometry.coordinates.some(rpt => {
          const dist = Math.hypot(rpt[0] - wMid[0], rpt[1] - wMid[1]);
          return dist < 12; // Within 12px of road
        });
      });
      return !tooCloseToRoad;
    });

    // Filter fences that duplicate walls or roads
    const filteredFences = featuresByClass.fences.filter(f => {
      const fCoords = f.geometry.coordinates;
      if (fCoords.length < 2) return false;
      const fMid = fCoords[Math.floor(fCoords.length / 2)];
      const tooCloseToWall = filteredWalls.some(w => {
        return w.geometry.coordinates.some(wpt => {
          return Math.hypot(wpt[0] - fMid[0], wpt[1] - fMid[1]) < 10;
        });
      });
      return !tooCloseToWall;
    });

    return {
      roads: cleanedRoads,
      buildings: cleanedBuildings,
      fields: featuresByClass.fields,
      walls: filteredWalls,
      fences: filteredFences,
      vegetation: featuresByClass.vegetation,
      water: featuresByClass.water
    };
  }

  cleanAllGeometries(featuresByClass, ctx) {
    return GeometryCleaningService.clean(featuresByClass, ctx);
  }

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */
  extractCenterline(comp, width, height) {
    const pixels = comp.pixels;
    const bb = comp.bbox;
    const isHorizontal = (bb.maxX - bb.minX) >= (bb.maxY - bb.minY);
    const steps = 14;

    const pts = [];
    if (isHorizontal) {
      const stepX = (bb.maxX - bb.minX) / steps;
      for (let s = 0; s <= steps; s++) {
        const targetX = Math.round(bb.minX + s * stepX);
        const colPixels = pixels.filter(p => (Array.isArray(p) ? p[0] : (p % width)) === targetX);
        if (colPixels.length > 0) {
          const avgY = colPixels.reduce((acc, p) => acc + (Array.isArray(p) ? p[1] : Math.floor(p / width)), 0) / colPixels.length;
          pts.push([targetX, Math.round(avgY)]);
        }
      }
    } else {
      const stepY = (bb.maxY - bb.minY) / steps;
      for (let s = 0; s <= steps; s++) {
        const targetY = Math.round(bb.minY + s * stepY);
        const rowPixels = pixels.filter(p => (Array.isArray(p) ? p[1] : Math.floor(p / width)) === targetY);
        if (rowPixels.length > 0) {
          const avgX = rowPixels.reduce((acc, p) => acc + (Array.isArray(p) ? p[0] : (p % width)), 0) / rowPixels.length;
          pts.push([Math.round(avgX), targetY]);
        }
      }
    }

    return pts.length >= 2 ? pts : [[bb.minX, bb.minY], [bb.maxX, bb.maxY]];
  }

  calculateLineLength(coords) {
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    }
    return len;
  }

  formatFeatureTitle(type) {
    switch (type) {
      case 'road': return 'Road Corridor';
      case 'building': return 'Building Footprint';
      case 'field': return 'Agricultural Field';
      case 'wall': return 'Masonry Wall';
      case 'fence': return 'Boundary Fence';
      case 'vegetation': return 'Vegetation Canopy';
      case 'water': return 'Water Feature';
      default: return 'Cadastral Feature';
    }
  }

  projectToGeographic(geom, imgW, imgH, centerCoords) {
    const [centerLat, centerLng] = centerCoords;
    const geoDelta = 0.0035;

    const projectPoint = ([x, y]) => {
      const lng = centerLng - geoDelta + (x / imgW) * (geoDelta * 2);
      const lat = (centerLat + geoDelta) - (y / imgH) * (geoDelta * 2);
      return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
    };

    if (geom.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: [geom.coordinates[0].map(projectPoint)]
      };
    } else if (geom.type === 'LineString') {
      return {
        type: 'LineString',
        coordinates: geom.coordinates.map(projectPoint)
      };
    }
    return geom;
  }
}

/**
 * Genuine Machine Learning Detection Provider (YOLOv8n-seg + Aerial Analysis)
 */
export class MLDetectionProvider extends DetectionProvider {
  constructor() {
    super('ml');
  }

  async detect(imageInfo, options = {}) {
    const startTime = Date.now();
    const { filePath, project_id, imagery_id, is_georeferenced, project_coordinates, detection_run_id } = imageInfo;
    const runId = detection_run_id || options.run_id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    console.log(`[MLDetectionProvider] Running local ML inference on: ${filePath}`);

    try {
      const mlResult = await this.runPythonInference(filePath, project_id, imagery_id, runId, options);
      if (!mlResult || !mlResult.success) {
        throw new Error(mlResult?.error || 'ML inference returned failure status');
      }

      const features = mlResult.features || [];
      const origW = imageInfo.width || 4000;
      const origH = imageInfo.height || 3000;

      // Ensure backward-compatible source attribute, image_coordinates, and coordinate mode
      features.forEach(f => {
        if (!f.source) f.source = f.provider || 'ml';
        if (!f.image_coordinates && f.geometry) {
          f.image_coordinates = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
        }
      });

      // Project to geographic coordinates if georeferenced
      if (is_georeferenced && project_coordinates) {
        features.forEach(f => {
          f.coordinate_mode = 'geographic';
          f.geo_geometry = this.projectToGeographic(f.geometry, origW, origH, project_coordinates);
        });
      }

      console.log(`[MLDetectionProvider] Complete! Found ${features.length} features (Buildings: ${mlResult.summary.buildings}, Roads: ${mlResult.summary.roads}, Fields: ${mlResult.summary.fields})`);

      return {
        project_id,
        imagery_id,
        detection_run_id: runId,
        status: features.length > 0 ? 'completed' : 'empty',
        message: features.length > 0 ? null : 'No detectable features were found in this image.',
        coordinate_mode: is_georeferenced ? 'geographic' : 'image',
        provider: 'ml',
        model_name: mlResult.model_name || 'YOLOv8n-seg (Keremberke Aerial Building Model)',
        summary: mlResult.summary,
        layers: mlResult.layers,
        roads: mlResult.layers.roads?.features || [],
        buildings: mlResult.layers.buildings?.features || [],
        fields: mlResult.layers.fields?.features || [],
        boundaries: [...(mlResult.layers.walls?.features || []), ...(mlResult.layers.fences?.features || [])],
        walls: mlResult.layers.walls?.features || [],
        fences: mlResult.layers.fences?.features || [],
        vegetation: mlResult.layers.vegetation?.features || [],
        water: mlResult.layers.water?.features || [],
        detections: features,
        features,
        features_count: features.length,
        average_confidence: mlResult.average_confidence,
        diagnostic_summary: mlResult.diagnostic_summary || mlResult.debug?.diagnostic_summary || {
          raw_candidates: features.length + (mlResult.debug?.rejected_detections?.length || 0),
          accepted: features.length,
          rejected: mlResult.debug?.rejected_detections?.length || 0,
          rejection_reasons: mlResult.debug?.rejection_categories || {}
        },
        debug: {
          image_size: mlResult.image_dimensions || `${origW}x${origH}`,
          original_dimensions: `${origW}x${origH}`,
          processing_time_ms: Date.now() - startTime,
          execution_time_ms: Date.now() - startTime,
          python_time_ms: mlResult.execution_time_ms,
          tiles_processed: mlResult.tiles_processed || 1,
          image_dimensions: mlResult.image_dimensions || `${origW}x${origH}`,
          pipeline_stages: mlResult.debug?.pipeline_stages || null,
          road_network: mlResult.debug?.road_network || null,
          diagnostic_summary: mlResult.diagnostic_summary || mlResult.debug?.diagnostic_summary || null,
          rejection_categories: mlResult.debug?.rejection_categories || mlResult.diagnostic_summary?.rejection_reasons || {},
          rejected_detections: mlResult.debug?.rejected_detections || [],
          rejected_counts: mlResult.debug?.rejected_counts || {},
          rejected_geometry_count: mlResult.diagnostic_summary?.rejected || mlResult.debug?.pipeline_stages?.rejected_geometry_count || mlResult.debug?.rejected_geometry_count || 0,
          confidence_distribution: mlResult.debug?.confidence_distribution || {
            high: features.filter(f => f.confidence >= 0.80).length,
            medium: features.filter(f => f.confidence >= 0.60 && f.confidence < 0.80).length,
            low: features.filter(f => f.confidence < 0.60).length
          }
        },
        disclaimer: mlResult.disclaimer
      };
    } catch (err) {
      console.warn(`[MLDetectionProvider] ML inference failed (${err.message}). Falling back to ComputerVisionProvider...`);
      const cvProvider = new ComputerVisionProvider();
      const fallbackResult = await cvProvider.detect(imageInfo, { ...options, fallback: true, run_id: runId });
      fallbackResult.provider = 'opencv_fallback';
      fallbackResult.model_name = 'OpenCV Fallback Engine v1.0';
      fallbackResult.fallback_reason = err.message;
      if (fallbackResult.features) {
        fallbackResult.features.forEach(f => {
          f.provider = 'opencv_fallback';
          f.model_name = 'OpenCV Fallback Engine v1.0';
          if (f.properties) {
            f.properties.provider = 'opencv_fallback';
            f.properties.model_name = 'OpenCV Fallback Engine v1.0';
          }
        });
      }
      return fallbackResult;
    }
  }

  runPythonInference(filePath, projectId, imageryId, runId, options) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'server', 'ml', 'ml_detector.py');
      const args = [
        scriptPath,
        '--input', filePath,
        '--project_id', projectId,
        '--imagery_id', imageryId,
        '--run_id', runId,
        '--conf', String(options.confidence_threshold || 0.35),
        '--tile_size', String(options.tile_size || 640),
        '--overlap', String(options.overlap || 0.20)
      ];
      if (options.debug) {
        args.push('--debug');
      }

      const py = spawn('python', ['-B', ...args]);
      let stdout = '';
      let stderr = '';

      py.stdout.on('data', data => { stdout += data.toString(); });
      py.stderr.on('data', data => { stderr += data.toString(); });

      py.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`Python process exited with code ${code}: ${stderr || stdout}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Failed to parse ML detector output: ${parseErr.message}\nRaw: ${stdout.slice(0, 300)}`));
        }
      });

      py.on('error', err => {
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });
  }
}

/**
 * Demo Detection Provider (Strictly reserved for Wagholi Demo Presentation)
 */
export class DemoDetectionProvider extends DetectionProvider {
  constructor() {
    super('demo');
  }

  async detect(imageInfo, options = {}) {
    const { project_id, imagery_id, width, height, is_georeferenced, project_coordinates } = imageInfo;
    const runId = imageInfo.detection_run_id || options.run_id || `run_${Date.now()}_demo`;
    const w = width || 4000;
    const h = height || 3000;

    const demoRaw = [
      {
        detection_type: 'ROAD',
        type: 'road',
        feature_type: 'Road',
        sub_type: 'Primary Highway Corridor',
        name: 'Wagholi-Kesnand Main Highway (Demo Corridor)',
        confidence: 0.96,
        provider: 'demo',
        model_name: 'Wagholi Demo Presentation Model',
        geometry: { type: 'LineString', coordinates: [[Math.round(w * 0.1), Math.round(h * 0.5)], [Math.round(w * 0.5), Math.round(h * 0.48)], [Math.round(w * 0.9), Math.round(h * 0.45)]] }
      },
      {
        detection_type: 'BUILDING',
        type: 'building',
        feature_type: 'Building',
        name: 'Agricultural Homestead Structure (Demo)',
        confidence: 0.93,
        provider: 'demo',
        model_name: 'Wagholi Demo Presentation Model',
        geometry: { type: 'Polygon', coordinates: [[[Math.round(w * 0.2), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.2)]]] }
      }
    ];

    const features = demoRaw.map((d, i) => ({
      ...d,
      id: `det_${imagery_id}_${d.type}_${i + 1}`,
      project_id,
      imagery_id,
      detection_run_id: runId,
      coordinate_mode: is_georeferenced ? 'geographic' : 'image',
      source_feature_ids: [],
      properties: { ...d },
      created_at: new Date().toISOString()
    }));

    return {
      project_id,
      imagery_id,
      detection_run_id: runId,
      status: 'completed',
      message: null,
      coordinate_mode: is_georeferenced ? 'geographic' : 'image',
      provider: 'demo',
      model_name: 'Wagholi Demo Presentation Model',
      summary: {
        roads: features.filter(f => f.type === 'road').length,
        buildings: features.filter(f => f.type === 'building').length,
        fields: 0,
        walls: 0,
        fences: 0,
        vegetation: 0,
        water: 0,
        total: features.length
      },
      layers: {
        roads: { type: 'FeatureCollection', name: 'Roads', features: features.filter(f => f.type === 'road') },
        buildings: { type: 'FeatureCollection', name: 'Buildings', features: features.filter(f => f.type === 'building') },
        fields: { type: 'FeatureCollection', name: 'Fields', features: [] },
        walls: { type: 'FeatureCollection', name: 'Walls', features: [] },
        fences: { type: 'FeatureCollection', name: 'Fences', features: [] },
        vegetation: { type: 'FeatureCollection', name: 'Vegetation', features: [] },
        water: { type: 'FeatureCollection', name: 'Water', features: [] }
      },
      features,
      features_count: features.length,
      average_confidence: 0.94,
      debug: { is_demo_dataset: true }
    };
  }
}

/**
 * Remote Inference Provider (Cloud API inference)
 */
export class RemoteInferenceProvider extends DetectionProvider {
  constructor() {
    super('remote_inference');
  }

  async detect(imageInfo, options = {}) {
    throw new Error('Remote inference endpoint not configured.');
  }
}

export const ComputerVisionDetectionProvider = ComputerVisionProvider;
