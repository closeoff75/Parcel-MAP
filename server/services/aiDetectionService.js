/**
 * ParcelMap AI Detection Service
 * 
 * Multi-class Computer Vision detection service analyzing uploaded aerial drone imagery.
 * Separates feature classes: Roads, Buildings, Fields, Walls, Fences, Vegetation, Water.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { db } from '../db/database.js';
import { CVEngine } from './cvEngine.js';
import { DetectionProvider } from './detectionProviders.js';
import { EnvConfig } from '../config/envConfig.js';
import { StorageService } from './storageService.js';

export class DetectionService {
  /**
   * Run detection directly from an imageryId
   */
  static async detectFromImageryId(imageryId, options = {}) {
    const imagery = db.getImageryById(imageryId);
    if (!imagery) {
      throw new Error(`Imagery item not found with ID: ${imageryId}`);
    }
    return this.runDetection(imagery.project_id, { ...options, imagery_id: imageryId, request_endpoint: `/api/imagery/${imageryId}/detect` });
  }

  /**
   * Run detection pipeline for a project and specific imagery.
   */
  static async runDetection(projectId, options = {}) {
    const startTime = Date.now();
    const endpoint = options.request_endpoint || `/api/projects/${projectId}/detect`;

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

    // 3. Resolve image buffer & disk file path via StorageService
    let imageBuffer = await StorageService.ensureLocalBuffer(imagery);
    let filePath = null;

    if (!imageBuffer) {
      if (imagery.file_url) {
        const urlClean = imagery.file_url.replace(/^\//, '');
        const candidatePath = path.join(process.cwd(), urlClean);
        if (fs.existsSync(candidatePath)) {
          filePath = candidatePath;
          imageBuffer = fs.readFileSync(filePath);
        }
      }

      if (!imageBuffer) {
        const baseName = path.basename(imagery.file_url || imagery.file_name || '');
        const uploadsCandidate = path.join(process.cwd(), 'uploads', baseName);
        if (fs.existsSync(uploadsCandidate)) {
          filePath = uploadsCandidate;
          imageBuffer = fs.readFileSync(filePath);
        }
      }
    }

    if (!imageBuffer || imageBuffer.length < 100) {
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      EnvConfig.logDiagnostic('Imagery File Missing', {
        project_id: projectId,
        imagery_id: imagery.id,
        filename: imagery.file_name,
        expected_path: imagery.storage_key || imagery.file_url,
        request_endpoint: endpoint,
        status: 'FAILED',
        error: 'File does not exist in storage or is too small (< 100 bytes)'
      });
      throw new Error(`Imagery file not found in storage at: ${imagery.storage_key || imagery.file_url}. Please upload drone imagery first.`);
    }

    // Ensure a physical file exists on disk for downstream CV/OpenCV models
    if (!filePath || !fs.existsSync(filePath)) {
      const ext = path.extname(imagery.file_name || imagery.filename || 'image.jpg') || '.jpg';
      const tmpFilename = `parcelmap_${imagery.id}_${Date.now()}${ext}`;
      const tmpPath = path.join(os.tmpdir(), tmpFilename);
      fs.writeFileSync(tmpPath, imageBuffer);
      filePath = tmpPath;
    }

    const fileStats = fs.statSync(filePath);

    // 5. Image-space mode validation (Section 3: non-georeferenced images are fully supported)
    let imageWidth = Number(imagery.width) || 4000;
    let imageHeight = Number(imagery.height) || 3000;

    const isTif = imagery.file_name.toLowerCase().endsWith('.tif') || imagery.file_name.toLowerCase().endsWith('.tiff');
    let isGeoreferenced = false;
    if (imagery.is_georeferenced !== undefined && imagery.is_georeferenced !== null) {
      isGeoreferenced = Boolean(imagery.is_georeferenced);
    } else if (isTif) {
      isGeoreferenced = true;
    } else {
      const crs = (typeof imagery.metadata?.crs === 'string') ? imagery.metadata.crs.toLowerCase() : '';
      if (crs && !crs.includes('image-space') && !crs.includes('pixel') && !crs.includes('local') && !crs.includes('none') && (crs.includes('epsg') || crs.includes('wgs') || crs.includes('utm'))) {
        isGeoreferenced = true;
      }
    }

    const coordinateMode = isGeoreferenced ? 'geographic' : 'image-space';

    // 6. Provider selection & configuration validation (Section 6)
    const providerName = options.provider || (options.mode === 'cv' ? 'cv' : (process.env.DETECTION_PROVIDER || 'ml'));
    try {
      EnvConfig.validateDetectionConfig(providerName);
    } catch (cfgErr) {
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      EnvConfig.logDiagnostic('Config Validation Error', {
        project_id: projectId,
        imagery_id: imagery.id,
        provider: providerName,
        request_endpoint: endpoint,
        status: 'FAILED',
        error: cfgErr.message
      });
      throw cfgErr;
    }

    // Diagnostic logging before model inference (Section 1)
    EnvConfig.logDiagnostic('Pre-Inference', {
      project_id: projectId,
      imagery_id: imagery.id,
      image_filename: imagery.file_name,
      image_path_or_url: filePath,
      file_size_bytes: fileStats.size,
      coordinate_mode: coordinateMode,
      request_endpoint: endpoint,
      provider: providerName
    });

    let detectionResult = null;
    const detectionRunId = options.run_id || options.detection_run_id || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      // Decode image dimensions if possible
      try {
        const decoded = CVEngine.loadImage(filePath);
        if (decoded && decoded.width && decoded.height) {
          imageWidth = decoded.width;
          imageHeight = decoded.height;
        }
      } catch (loadErr) {
        console.log(`[Detection] Note: JS CVEngine decode skipped, using Python OpenCV / safe decode: ${loadErr.message}`);
      }

      // Update database with true dimensions from decoded file
      db.updateImagery(imagery.id, { width: imageWidth, height: imageHeight });

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
      console.error(`[Detection] Detection inference failed: ${cvErr.message}`);
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      EnvConfig.logDiagnostic('Inference Failure', {
        project_id: projectId,
        imagery_id: imagery.id,
        filename: imagery.file_name,
        request_endpoint: endpoint,
        status: 'FAILED',
        error: cvErr.message
      });
      throw new Error(`Detection processing failed on uploaded image: ${cvErr.message}`);
    }

    if (!detectionResult || !detectionResult.features) {
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      throw new Error('Detection processing failed: No features returned from model');
    }

    // 7. Persist successful results (Section 7)
    // Associate each detection strictly with project_id and imagery_id
    detectionResult.features.forEach(f => {
      f.project_id = projectId;
      f.imagery_id = imagery.id;
    });

    db.setFeatures(projectId, detectionResult.features, imagery.id);

    // Verify persistence immediately
    const persisted = db.getFeaturesByProjectId(projectId, imagery.id);
    const saveSuccess = persisted && (persisted.length === detectionResult.features.length || detectionResult.features.length === 0);

    if (!saveSuccess) {
      db.updateImagery(imagery.id, { processing_status: 'DETECTION FAILED' });
      throw new Error('Database persistence failed: Detected features could not be verified in store.');
    }

    // Update imagery & project status only after verified persistence
    db.updateImagery(imagery.id, { processing_status: 'DETECTION COMPLETE' });
    db.updateProject(projectId, {
      status: 'Detection Complete',
      progress: 40
    });

    const summary = detectionResult.summary || {};
    const processingTime = Date.now() - startTime;
    const finalProvider = detectionResult.provider || 'ml';
    const finalModel = detectionResult.model_name || (
      finalProvider === 'ml' 
        ? 'YOLOv8n-seg (Keremberke Aerial Building Model)' 
        : (finalProvider === 'opencv_fallback' ? 'OpenCV Fallback Engine v1.0' : 'Aerial Computer Vision Engine v3.2')
    );

    // Structured diagnostic logging for completed flow (Section 1)
    EnvConfig.logDiagnostic('Detection Flow Complete', {
      project_id: projectId,
      imagery_id: imagery.id,
      image_filename: imagery.file_name,
      image_path_or_url: filePath,
      coordinate_mode: coordinateMode,
      request_endpoint: endpoint,
      http_status: 200,
      model_service_response: 'SUCCESS',
      model_name: finalModel,
      provider: finalProvider,
      number_of_detections: detectionResult.features.length,
      database_save_result: `SUCCESS (${persisted.length} features persisted)`,
      execution_time_ms: processingTime
    });
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
      mode: 'Production AI / ML Pipeline',
      provider: finalProvider,
      coordinate_mode: isGeoreferenced ? 'GEOGRAPHIC' : 'IMAGE_SPACE',
      summary,
      counts: summary,
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

}

// Export both names for backwards compatibility
export const AIDetectionService = DetectionService;
