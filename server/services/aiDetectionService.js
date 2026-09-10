/**
 * ParcelMap AI Detection Service
 * 
 * Multi-class Computer Vision detection service analyzing uploaded aerial drone imagery.
 * Separates feature classes: Roads, Buildings, Fields, Walls, Fences, Vegetation, Water.
 */

import path from 'path';
import fs from 'fs';
import { db } from '../db/database.js';
import { CVEngine } from './cvEngine.js';
import { DetectionProvider } from './detectionProviders.js';

export class DetectionService {
  /**
   * Run detection directly from an imageryId
   */
  static async detectFromImageryId(imageryId, options = {}) {
    const imagery = db.getImageryById(imageryId);
    if (!imagery) {
      throw new Error(`Imagery item not found with ID: ${imageryId}`);
    }
    return this.runDetection(imagery.project_id, { ...options, imagery_id: imageryId });
  }

  /**
   * Run detection pipeline for a project and specific imagery.
   */
  static async runDetection(projectId, options = {}) {
    const startTime = Date.now();

    // 1. Verify project
    const project = db.getProjectById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // 2. Identify target imagery
    let imagery = null;
    if (options.imagery_id) {
      imagery = db.getImageryById(options.imagery_id);
    }
    if (!imagery) {
      const allImagery = db.getImageryByProjectId(projectId);
      if (allImagery && allImagery.length > 0) {
        imagery = allImagery[0];
      }
    }

    if (!imagery) {
      throw new Error(`No imagery uploaded for project ${projectId}. Please upload drone imagery first.`);
    }

    // Security validation (Requirement 22): verify imagery belongs to project
    if (imagery.project_id && imagery.project_id !== projectId) {
      throw new Error(`Security violation: Imagery ${imagery.id} belongs to project ${imagery.project_id}, not ${projectId}.`);
    }

    // Set processing state
    db.updateImagery(imagery.id, { processing_status: 'PROCESSING' });

    console.log(`[Detection] imagery_id: ${imagery.id}`);
    console.log(`[Detection] project_id: ${projectId}`);
    console.log(`[Detection] file_name: ${imagery.file_name}`);

    // 3. Resolve disk file path
    let filePath = null;
    if (imagery.file_url) {
      const urlClean = imagery.file_url.replace(/^\//, '');
      const candidatePath = path.join(process.cwd(), urlClean);
      if (fs.existsSync(candidatePath)) {
        filePath = candidatePath;
      }
    }

    // Check fallback in uploads folder
    if (!filePath) {
      const baseName = path.basename(imagery.file_url || imagery.file_name);
      const uploadsCandidate = path.join(process.cwd(), 'uploads', baseName);
      if (fs.existsSync(uploadsCandidate)) {
        filePath = uploadsCandidate;
      }
    }

    const isDemoProject = projectId === 'proj_wagholi_demo';
    const hasDiskFile = filePath && fs.existsSync(filePath);

    let imageWidth = Number(imagery.width) || 4000;
    let imageHeight = Number(imagery.height) || 3000;
    let detectorLabel = isDemoProject 
      ? 'Demo AI / Computer Vision (Real Pixel Analysis)' 
      : 'Edge & Pixel Computer Vision AI Engine';

    const isGeoreferenced = imagery.file_name.toLowerCase().endsWith('.tif') || 
                            imagery.file_name.toLowerCase().endsWith('.tiff') || 
                            Boolean(imagery.metadata?.crs);

    let detectionResult = null;

    const detectionRunId = options.run_id || options.detection_run_id || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (hasDiskFile) {
      // ACTUAL COMPUTER VISION / ML ON UPLOADED IMAGE VIA MULTI-CLASS PROVIDER
      console.log(`[Detection] image loaded: ${filePath}`);
      try {
        try {
          const decoded = CVEngine.loadImage(filePath);
          if (decoded && decoded.width && decoded.height) {
            imageWidth = decoded.width;
            imageHeight = decoded.height;
          }
        } catch (loadErr) {
          console.log(`[Detection] Note: JS CVEngine decode skipped, will use Python OpenCV directly: ${loadErr.message}`);
        }
        console.log(`[Detection] image dimensions: ${imageWidth}x${imageHeight}`);

        // Update database with true dimensions from decoded file
        db.updateImagery(imagery.id, { width: imageWidth, height: imageHeight });

        const providerName = isDemoProject && options.mode === 'demo'
          ? 'demo'
          : (options.provider || (options.mode === 'cv' ? 'cv' : (process.env.DETECTION_PROVIDER || 'ml')));

        const provider = DetectionProvider.getProvider(providerName);
        detectionResult = await provider.detect({
          filePath,
          width: imageWidth,
          height: imageHeight,
          project_id: projectId,
          imagery_id: imagery.id,
          detection_run_id: detectionRunId,
          is_georeferenced: isGeoreferenced,
          project_coordinates: project.coordinates || [18.5818, 73.9875]
        }, options);

      } catch (cvErr) {
        console.error(`[Detection] ML/CV analysis failed on file: ${cvErr.message}`);
        db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
        throw new Error(`Detection processing failed on uploaded image: ${cvErr.message}`);
      }
    } else if (isDemoProject) {
      // Strictly isolated Demo Project fallback if demo file was not placed on disk
      console.log(`[Detection] Using isolated demo presentation dataset for ${projectId}`);
      const demoProvider = DetectionProvider.getProvider('demo');
      detectionResult = await demoProvider.detect({
        filePath: null,
        width: imageWidth,
        height: imageHeight,
        project_id: projectId,
        imagery_id: imagery.id,
        detection_run_id: detectionRunId,
        is_georeferenced: isGeoreferenced,
        project_coordinates: project.coordinates || [18.5818, 73.9875]
      }, options);
    } else {
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      throw new Error(`Imagery file not found on disk at: ${filePath || imagery.file_url}`);
    }

    // Save features in database scoped to imagery.id
    db.setFeatures(projectId, detectionResult.features, imagery.id);

    // Update imagery & project status
    db.updateImagery(imagery.id, { processing_status: 'DETECTION COMPLETE' });
    db.updateProject(projectId, {
      status: 'Detection Complete',
      progress: 40
    });

    const summary = detectionResult.summary || {};
    const boundariesCount = (summary.walls || 0) + (summary.fences || 0);
    const processingTime = Date.now() - startTime;
    const finalProvider = detectionResult.provider || 'ml';
    const finalModel = detectionResult.model_name || (
      finalProvider === 'ml' 
        ? 'YOLOv8n-seg (Keremberke Aerial Building Model)' 
        : (finalProvider === 'opencv_fallback' ? 'OpenCV Fallback Engine v1.0' : 'Demo Cadastral Presentation Dataset')
    );

    // Structured logging (Step 6B Requirement 19)
    console.log(`\n[AI Detection Run Complete]`);
    console.log(`[AI] Project: ${projectId}`);
    console.log(`[AI] Imagery: ${imagery.id}`);
    console.log(`[AI] Run ID: ${detectionResult.detection_run_id || detectionRunId}`);
    console.log(`[AI] Provider: ${finalProvider}`);
    console.log(`[AI] Model: ${finalModel}`);
    console.log(`[AI] Image dimensions: ${imageWidth}x${imageHeight}`);
    console.log(`[AI] Roads: ${summary.roads || 0}`);
    console.log(`[AI] Buildings: ${summary.buildings || 0}`);
    console.log(`[AI] Fields: ${summary.fields || 0}`);
    console.log(`[AI] Walls: ${summary.walls || 0}`);
    console.log(`[AI] Fences: ${summary.fences || 0}`);
    console.log(`[AI] Vegetation: ${summary.vegetation || 0}`);
    console.log(`[AI] Water: ${summary.water || 0}`);
    console.log(`[AI] Total Features: ${detectionResult.features.length}`);
    console.log(`[AI] Processing time: ${processingTime}ms\n`);

    const avgConfidence = detectionResult.features.length > 0
      ? Number((detectionResult.features.reduce((acc, f) => acc + (f.confidence || 0.8), 0) / detectionResult.features.length).toFixed(2))
      : 0;

    return {
      imagery_id: imagery.id,
      project_id: projectId,
      detection_run_id: detectionResult.detection_run_id || detectionRunId,
      imagery_name: imagery.file_name,
      status: detectionResult.status,
      message: detectionResult.message,
      detector: finalModel,
      model: finalModel,
      model_name: finalModel,
      mode: isDemoProject && options.mode === 'demo' ? 'Demo Mode' : 'Production AI / ML Pipeline',
      provider: finalProvider,
      coordinate_mode: isGeoreferenced ? 'geographic' : 'image',
      summary,
      layers: detectionResult.layers,
      detections: detectionResult.features,
      features: detectionResult.features,
      features_count: detectionResult.features.length,
      categories: {
        roads: summary.roads || 0,
        buildings: summary.buildings || 0,
        fields: summary.fields || 0,
        walls: summary.walls || 0,
        fences: summary.fences || 0,
        vegetation: summary.vegetation || 0,
        water: summary.water || 0,
        field_edges: summary.fields || 0
      },
      average_confidence: avgConfidence,
      diagnostic_summary: detectionResult.diagnostic_summary || detectionResult.debug?.diagnostic_summary || null,
      debug: detectionResult.debug,
      disclaimer: "AI-generated preliminary feature detection. Results require human verification. Non-georeferenced imagery is displayed in image space. AI-derived parcel boundaries are not legal cadastral boundaries.",
      execution_time_ms: Date.now() - startTime
    };
  }

  static detectRoads(ctx) {
    return CVEngine.detectRoads(ctx);
  }

  static detectBuildings(ctx) {
    return CVEngine.detectBuildings(ctx);
  }

  static detectFields(ctx) {
    return CVEngine.detectFields(ctx);
  }

  static detectBoundaries(ctx) {
    return CVEngine.detectBoundaries(ctx);
  }

  /**
   * Isolated Demo presentation dataset strictly for demo presentations.
   */
  static getIsolatedDemoDetections(w, h) {
    return [
      {
        detection_type: 'ROAD',
        sub_type: 'Primary Highway',
        name: 'Demo Arterial Highway',
        confidence: 0.94,
        image_coordinates: [[Math.round(w * 0.1), Math.round(h * 0.5)], [Math.round(w * 0.5), Math.round(h * 0.48)], [Math.round(w * 0.9), Math.round(h * 0.45)]],
        geometry: { type: 'LineString', coordinates: [[Math.round(w * 0.1), Math.round(h * 0.5)], [Math.round(w * 0.5), Math.round(h * 0.48)], [Math.round(w * 0.9), Math.round(h * 0.45)]] }
      },
      {
        detection_type: 'BUILDING',
        sub_type: 'Commercial Shed',
        name: 'Demo Structure A',
        confidence: 0.91,
        image_coordinates: [[Math.round(w * 0.2), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.2)]],
        geometry: { type: 'Polygon', coordinates: [[[Math.round(w * 0.2), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.2)], [Math.round(w * 0.3), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.3)], [Math.round(w * 0.2), Math.round(h * 0.2)]]] }
      }
    ];
  }
}

// Export both names for backwards compatibility
export const AIDetectionService = DetectionService;
