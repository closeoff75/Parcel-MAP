/**
 * ParcelMap REST API Routes
 * Implements full REST specification defined in Step 18.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db/database.js';
import { AIDetectionService } from '../services/aiDetectionService.js';
import { RoadSpatialReasoningService } from '../services/roadSpatialReasoningService.js';
import { GISEngine } from '../services/gisEngine.js';
import { CVEngine } from '../services/cvEngine.js';
import { JobQueueService } from '../services/jobQueueService.js';
import { ReportService, LEGAL_DISCLAIMER } from '../services/reportService.js';

const router = Router();

// Setup Multer for UAV imagery uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `uav_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.jfif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type (${ext || 'unknown'}). Supported formats: JPG, JPEG, PNG, WEBP, and GeoTIFF (.tif/.tiff).`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit
});

// ==========================================
// AUTHENTICATION & USER MANAGEMENT
// ==========================================
router.get('/auth/users', (req, res) => {
  res.json({ success: true, users: db.getUsers() });
});

router.post('/auth/login', (req, res) => {
  const { email } = req.body;
  const user = db.getUsers().find(u => u.email === email) || db.getUsers()[1]; // default to Alex Morgan (Analyst)
  res.json({
    success: true,
    user,
    token: `token_${user.id}_${Date.now()}`
  });
});

router.get('/auth/me', (req, res) => {
  res.json({
    success: true,
    user: db.getUserById('usr_2') // Alex Morgan (Lead Surveyor)
  });
});

// ==========================================
// PROJECTS API
// ==========================================
// GET /api/projects
router.get('/projects', (req, res) => {
  try {
    const projects = db.getProjects();
    res.json({ success: true, count: projects.length, projects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects
router.post('/projects', (req, res) => {
  try {
    const { name, description, location, coordinates, project_type } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });

    const newProject = db.createProject({
      name,
      description,
      location,
      coordinates: coordinates || [18.5818, 73.9875],
      project_type: project_type || 'Rural Cadastral Mapping',
      created_by: 'Alex Morgan (Analyst)'
    });

    res.status(201).json({ success: true, project: newProject });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id
router.get('/projects/:id', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/projects/:id
router.patch('/projects/:id', (req, res) => {
  try {
    const updated = db.updateProject(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// DRONE IMAGERY API
// ==========================================
// Reusable Upload Handler
const handleImageryUpload = (req, res) => {
  const requestStarted = new Date().toISOString();
  const requestedId = req.params.id || req.body.project_id || 'proj_wagholi_demo';
  try {
    let project = db.getProjectById(requestedId);

    // Auto-fallback if the project ID does not exist
    if (!project) {
      const allProjects = db.getProjects();
      if (allProjects && allProjects.length > 0) {
        project = allProjects.find(p => p.id === 'proj_wagholi_demo') || allProjects[0];
        console.warn(`[Upload] Project '${requestedId}' not found, automatically recovered to project '${project.id}' (${project.name})`);
      }
    }

    if (!project) {
      const errMsg = `Project '${requestedId}' not found and no default project available.`;
      console.log(`[Upload]`);
      console.log(`project_id: ${requestedId}`);
      console.log(`filename: ${req.file?.originalname || 'none'}`);
      console.log(`content_type: ${req.file?.mimetype || 'none'}`);
      console.log(`file_size: ${req.file?.size || 0}`);
      console.log(`request_started: ${requestStarted}`);
      console.log(`request_completed: ${new Date().toISOString()}`);
      console.log(`storage_result: FAILED`);
      console.log(`imagery_id: null`);
      console.log(`error: ${errMsg}`);
      return res.status(404).json({ success: false, error: errMsg });
    }

    if (!req.file) {
      const errMsg = 'No imagery file uploaded. Please attach an image.';
      console.log(`[Upload]`);
      console.log(`project_id: ${project.id}`);
      console.log(`filename: none`);
      console.log(`content_type: none`);
      console.log(`file_size: 0`);
      console.log(`request_started: ${requestStarted}`);
      console.log(`request_completed: ${new Date().toISOString()}`);
      console.log(`storage_result: FAILED`);
      console.log(`imagery_id: null`);
      console.log(`error: ${errMsg}`);
      return res.status(400).json({ success: false, error: errMsg });
    }

    const fileName = req.file.originalname;
    const sizeInMb = req.file.size / (1024 * 1024);
    const fileSize = sizeInMb >= 1 ? `${sizeInMb.toFixed(1)} MB` : `${(req.file.size / 1024).toFixed(0)} KB`;
    const fileUrl = `/uploads/${req.file.filename}`;
    let width = Number(req.body.width) || 0;
    let height = Number(req.body.height) || 0;

    if ((!width || !height) && req.file.path && fs.existsSync(req.file.path)) {
      try {
        const decoded = CVEngine.loadImage(req.file.path);
        width = decoded.width;
        height = decoded.height;
      } catch (decodeErr) {
        console.warn(`[Upload] Image dimension decode fallback: ${decodeErr.message}`);
      }
    }
    if (!width) width = 4000;
    if (!height) height = 3000;

    const imageryItem = db.addImagery({
      project_id: project.id,
      file_name: fileName,
      file_url: fileUrl,
      mime_type: req.file.mimetype || 'image/jpeg',
      file_size: fileSize,
      width,
      height,
      resolution: req.body.resolution || '2.8 cm/pixel GSD',
      sensor: req.body.sensor || 'DJI Zenmuse P1 45MP Full-Frame',
      capture_date: req.body.capture_date || new Date().toISOString().split('T')[0],
      processing_status: 'READY'
    });

    // Update project status to Uploaded
    db.updateProject(project.id, {
      status: 'Uploaded',
      progress: 25
    });

    const requestCompleted = new Date().toISOString();

    // Exact Structured Audit Logging (Section 6 Specification)
    console.log(`[Upload]`);
    console.log(`project_id: ${project.id}`);
    console.log(`filename: ${fileName}`);
    console.log(`content_type: ${req.file.mimetype || 'image/jpeg'}`);
    console.log(`file_size: ${fileSize}`);
    console.log(`request_started: ${requestStarted}`);
    console.log(`request_completed: ${requestCompleted}`);
    console.log(`storage_result: SUCCESS (${fileUrl})`);
    console.log(`imagery_id: ${imageryItem.id}`);
    console.log(`error: null`);

    res.status(201).json({
      success: true,
      imagery: imageryItem,
      project_id: project.id
    });
  } catch (err) {
    console.log(`[Upload]`);
    console.log(`project_id: ${requestedId}`);
    console.log(`filename: ${req.file?.originalname || 'unknown'}`);
    console.log(`content_type: ${req.file?.mimetype || 'unknown'}`);
    console.log(`file_size: ${req.file?.size || 'unknown'}`);
    console.log(`request_started: ${requestStarted}`);
    console.log(`request_completed: ${new Date().toISOString()}`);
    console.log(`storage_result: FAILED`);
    console.log(`imagery_id: null`);
    console.log(`error: ${err.message}`);

    console.error('[Upload API Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error during upload' });
  }
};

const uploadMiddleware = (req, res, next) => {
  upload.single('imagery')(req, res, (err) => {
    if (err) {
      console.error('[Upload Multer Error]:', err.message);
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload failed. Please ensure file is a valid image under 500 MB.'
      });
    }
    next();
  });
};

// POST /api/projects/:id/imagery
router.post('/projects/:id/imagery', uploadMiddleware, handleImageryUpload);

// POST /api/upload (Universal Upload Route Alias)
router.post('/upload', uploadMiddleware, handleImageryUpload);

// GET /api/projects/:id/imagery
router.get('/projects/:id/imagery', (req, res) => {
  try {
    const imagery = db.getImageryByProjectId(req.params.id);
    res.json({ success: true, count: imagery.length, imagery });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/projects/:projectId/imagery/:imageryId
router.delete('/projects/:projectId/imagery/:imageryId', (req, res) => {
  try {
    const { projectId, imageryId } = req.params;
    const deleted = db.deleteImagery(imageryId, projectId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Imagery not found or already deleted' });
    }
    
    // Safely remove physical uploaded file (except baseline demo orthomosaic)
    if (deleted.file_url) {
      const fname = path.basename(deleted.file_url);
      if (fname && !fname.includes('wagholi_east_ortho')) {
        const filePath = path.join(uploadDir, fname);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`[Delete Imagery] Unlinked file: ${filePath}`);
          } catch (fErr) {
            console.warn(`[Delete Imagery] File unlink error: ${fErr.message}`);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Image "${deleted.file_name}" deleted successfully`,
      deleted
    });
  } catch (err) {
    console.error('[Delete Imagery Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/imagery/:id
router.delete('/imagery/:id', (req, res) => {
  try {
    const deleted = db.deleteImagery(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Imagery not found or already deleted' });
    }
    
    // Safely remove physical uploaded file (except baseline demo orthomosaic)
    if (deleted.file_url) {
      const fname = path.basename(deleted.file_url);
      if (fname && !fname.includes('wagholi_east_ortho')) {
        const filePath = path.join(uploadDir, fname);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`[Delete Imagery] Unlinked file: ${filePath}`);
          } catch (fErr) {
            console.warn(`[Delete Imagery] File unlink error: ${fErr.message}`);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Image "${deleted.file_name}" deleted successfully`,
      deleted
    });
  } catch (err) {
    console.error('[Delete Imagery Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// AI DETECTION API
// ==========================================
// POST /api/imagery/:imageryId/detect (Item 13 Specification)
router.post('/imagery/:imageryId/detect', async (req, res) => {
  try {
    const result = await AIDetectionService.detectFromImageryId(req.params.imageryId, req.body);
    res.json({
      success: true,
      imagery_id: result.imagery_id,
      project_id: result.project_id,
      detection_run_id: result.detection_run_id,
      status: result.status,
      message: result.message,
      mode: result.mode,
      detector: result.detector,
      model: result.model,
      model_name: result.model_name,
      provider: result.provider,
      coordinate_mode: result.coordinate_mode,
      summary: result.summary,
      layers: result.layers,
      detections: result.detections,
      features: result.features,
      categories: result.categories,
      features_count: result.features_count,
      average_confidence: result.average_confidence,
      diagnostic_summary: result.diagnostic_summary || result.debug?.diagnostic_summary || null,
      debug: result.debug,
      disclaimer: result.disclaimer,
      execution_time_ms: result.execution_time_ms
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects/:id/detect
router.post('/projects/:id/detect', async (req, res) => {
  try {
    const result = await AIDetectionService.runDetection(req.params.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/features
router.get('/projects/:id/features', (req, res) => {
  try {
    const imageryId = req.query.imagery_id || null;
    const features = db.getFeaturesByProjectId(req.params.id, imageryId);
    res.json({
      success: true,
      count: features.length,
      features,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ROAD-BASED SPATIAL REASONING API
// ==========================================
// POST /api/projects/:id/spatial-reasoning
router.post('/projects/:id/spatial-reasoning', async (req, res) => {
  try {
    const result = await RoadSpatialReasoningService.runSpatialReasoning(req.params.id, req.body || {});
    res.json({
      success: true,
      parcels: result.candidates || [],
      parcels_count: result.candidates_count || 0,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/candidates
router.get('/projects/:id/candidates', (req, res) => {
  try {
    const parcels = db.getParcelsByProjectId(req.params.id, req.query.imagery_id);
    res.json({
      success: true,
      count: parcels.length,
      candidates: parcels,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// PARCEL GENERATION & GIS PROCESSING API
// ==========================================
// POST /api/projects/:id/generate-parcels
router.post('/projects/:id/generate-parcels', async (req, res) => {
  try {
    // Spatial reasoning generates & validates candidates
    const result = await RoadSpatialReasoningService.runSpatialReasoning(req.params.id, req.body || {});
    const parcels = db.getParcelsByProjectId(req.params.id, req.body?.imagery_id);
    const audit = GISEngine.auditTopology(parcels);

    res.json({
      success: true,
      message: `${parcels.length} preliminary parcels generated and validated`,
      parcels_count: parcels.length,
      quality_summary: audit,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/parcels
router.get('/projects/:id/parcels', (req, res) => {
  try {
    const imageryId = req.query.imagery_id || null;
    const parcels = db.getParcelsByProjectId(req.params.id, imageryId);
    res.json({
      success: true,
      count: parcels.length,
      parcels,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects/:id/parcels
router.post('/projects/:id/parcels', (req, res) => {
  try {
    const projectId = req.params.id;
    const parcelData = req.body || {};
    const areas = GISEngine.calculateAreas(parcelData.geometry);
    const parcelId = parcelData.parcel_id || parcelData.id || `PARCEL-${Date.now().toString().slice(-6)}`;
    const newParcel = {
      id: parcelId,
      parcel_id: parcelId,
      project_id: projectId,
      imagery_id: parcelData.imagery_id || null,
      geometry: parcelData.geometry,
      confidence: parcelData.confidence || 0.85,
      status: parcelData.status || 'needs_review',
      supporting_features: parcelData.supporting_features || [],
      source: parcelData.source || 'Manual / Imported',
      ...areas,
      created_at: new Date().toISOString()
    };
    const parcels = db.getParcelsByProjectId(projectId, parcelData.imagery_id);
    parcels.push(newParcel);
    db.setParcels(projectId, parcels, parcelData.imagery_id);
    res.json({ success: true, parcel: newParcel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/parcels/:id
router.get('/parcels/:id', (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });
    const verifications = db.getVerificationsByParcelId(req.params.id);
    const versions = db.getParcelVersions(req.params.id);
    res.json({
      success: true,
      parcel,
      verification_history: verifications,
      version_history: versions,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH & PUT /api/parcels/:id (Parcel Editing)
const handleEditParcel = (req, res) => {
  try {
    const { geometry, comments, reviewer_name } = req.body;
    const existing = db.getParcelById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Parcel not found' });

    let areaUpdates = {};
    if (geometry) {
      const cleaned = GISEngine.cleanGeometry(geometry);
      const areas = GISEngine.calculateAreas(cleaned);
      areaUpdates = {
        geometry: cleaned,
        ...areas
      };
    }

    const pid = existing.parcel_id || existing.id;

    // Add verification audit entry
    db.addVerification({
      parcel_id: pid,
      reviewer_id: 'usr_2',
      reviewer_name: reviewer_name || 'Alex Morgan (Lead Surveyor)',
      action: 'Edited',
      comments: comments || 'Boundary vertices manually modified and verified against drone imagery.',
      original_geometry: existing.geometry,
      edited_geometry: areaUpdates.geometry || existing.geometry,
      area_sqm: areaUpdates.area_sqm,
      area_hectares: areaUpdates.area_hectares,
      area_acres: areaUpdates.area_acres
    });

    const updated = db.updateParcel(pid, {
      ...areaUpdates,
      status: 'Human Verified'
    });

    res.json({
      success: true,
      parcel: updated,
      original_area_hectares: existing.area_hectares,
      verified_area_hectares: updated.area_hectares,
      message: 'Parcel geometry updated and marked Human Verified.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
router.patch('/parcels/:id', handleEditParcel);
router.put('/parcels/:id', handleEditParcel);

// Alias routes for verification
router.post('/parcels/:id/verify', (req, res, next) => {
  req.url = `/parcels/${req.params.id}/accept`;
  router.handle(req, res, next);
});
router.post('/parcels/:id/review', (req, res, next) => {
  req.url = `/parcels/${req.params.id}/needs-review`;
  router.handle(req, res, next);
});

// DELETE /api/parcels/:id (Delete Parcel)
router.delete('/parcels/:id', (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    db.deleteParcel(parcel.parcel_id || parcel.id, req.body?.reviewer_name || 'Alex Morgan');
    res.json({
      success: true,
      message: `Parcel ${parcel.parcel_id || parcel.id} deleted from project dataset.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parcels/:id/split (Split Polygon)
router.post('/parcels/:id/split', (req, res) => {
  try {
    const { polygon_a, polygon_b, cut_line, line, reviewer_name, comments } = req.body;
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    let polyA = polygon_a;
    let polyB = polygon_b;

    if (!polyA || !polyB) {
      const splitPair = GISEngine.splitPolygon(parcel.geometry, cut_line || line);
      polyA = splitPair[0];
      polyB = splitPair[1];
    }

    const pIdA = `${parcel.parcel_id || parcel.id}-A`;
    const pIdB = `${parcel.parcel_id || parcel.id}-B`;

    const cleanA = GISEngine.cleanGeometry(polyA);
    const cleanB = GISEngine.cleanGeometry(polyB);

    const areasA = GISEngine.calculateAreas(cleanA);
    const areasB = GISEngine.calculateAreas(cleanB);

    const newParcelA = {
      ...parcel,
      id: pIdA,
      parcel_id: pIdA,
      parent_parcel_id: parcel.parcel_id || parcel.id,
      geometry: cleanA,
      ...areasA,
      status: 'accepted',
      source: 'Human Verification Split',
      created_at: new Date().toISOString()
    };

    const newParcelB = {
      ...parcel,
      id: pIdB,
      parcel_id: pIdB,
      parent_parcel_id: parcel.parcel_id || parcel.id,
      geometry: cleanB,
      ...areasB,
      status: 'accepted',
      source: 'Human Verification Split',
      created_at: new Date().toISOString()
    };

    // Remove parent parcel and insert two split children
    const existingParcels = db.getParcelsByProjectId(parcel.project_id, parcel.imagery_id);
    const filtered = existingParcels.filter(p => (p.parcel_id || p.id) !== (parcel.parcel_id || parcel.id));
    filtered.push(newParcelA, newParcelB);
    db.setParcels(parcel.project_id, filtered, parcel.imagery_id);

    // Record versions
    db.addParcelVersion({
      parcel_id: parcel.parcel_id || parcel.id,
      project_id: parcel.project_id,
      imagery_id: parcel.imagery_id,
      geometry: parcel.geometry,
      edited_by: reviewer_name || 'Alex Morgan',
      action: 'Split',
      change_type: 'split'
    });
    db.addParcelVersion({
      parcel_id: pIdA,
      project_id: parcel.project_id,
      imagery_id: parcel.imagery_id,
      geometry: cleanA,
      previous_geometry: parcel.geometry,
      edited_by: reviewer_name || 'Alex Morgan',
      action: 'Split',
      change_type: 'split'
    });
    db.addParcelVersion({
      parcel_id: pIdB,
      project_id: parcel.project_id,
      imagery_id: parcel.imagery_id,
      geometry: cleanB,
      previous_geometry: parcel.geometry,
      edited_by: reviewer_name || 'Alex Morgan',
      action: 'Split',
      change_type: 'split'
    });

    res.json({
      success: true,
      message: `Parcel ${parcel.parcel_id || parcel.id} successfully split into ${pIdA} and ${pIdB}`,
      parcels: [newParcelA, newParcelB],
      children: [newParcelA, newParcelB]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parcels/:id/merge (Merge Adjacent Parcels)
router.post('/parcels/:id/merge', (req, res) => {
  try {
    const { target_parcel_id, reviewer_name, comments } = req.body;
    const parcel1 = db.getParcelById(req.params.id);
    const parcel2 = db.getParcelById(target_parcel_id);

    if (!parcel1) return res.status(404).json({ success: false, error: 'Source parcel not found' });
    if (!parcel2) return res.status(404).json({ success: false, error: 'Target parcel not found' });

    let mergedGeom;
    try {
      mergedGeom = GISEngine.mergePolygons(parcel1.geometry, parcel2.geometry);
    } catch {
      // Fallback: convex hull of combined points
      const pts1 = parcel1.geometry.coordinates[0];
      const pts2 = parcel2.geometry.coordinates[0];
      const combined = [...pts1, ...pts2];
      const hull = turf.convex(turf.multiPoint(combined));
      mergedGeom = hull ? hull.geometry : parcel1.geometry;
    }

    const areas = GISEngine.calculateAreas(mergedGeom);
    const p1Id = parcel1.parcel_id || parcel1.id;
    const p2Id = parcel2.parcel_id || parcel2.id;
    db.updateParcel(p1Id, {
      geometry: mergedGeom,
      ...areas,
      status: 'accepted',
      supporting_features: [...(parcel1.supporting_features || []), `Merged with ${p2Id}`]
    });

    // Delete parcel2
    db.deleteParcel(p2Id, reviewer_name || 'Alex Morgan');

    // Record versions
    db.addParcelVersion({
      parcel_id: p1Id,
      project_id: parcel1.project_id,
      imagery_id: parcel1.imagery_id,
      geometry: mergedGeom,
      previous_geometry: parcel1.geometry,
      edited_by: reviewer_name || 'Alex Morgan',
      action: 'Merged',
      change_type: 'merge'
    });

    res.json({
      success: true,
      message: `Parcels ${p1Id} and ${p2Id} successfully merged`,
      parcel: db.getParcelById(p1Id)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /parcels/:id/validate (Requirement 21)
router.post('/parcels/:id/validate', (req, res) => {
  try {
    const pId = req.params.id;
    const projectId = req.query.project_id || req.body.project_id || null;
    const parcel = db.getParcelById(pId, projectId);
    const geom = req.body.geometry || (parcel ? parcel.geometry : null);
    if (!geom) return res.status(400).json({ success: false, error: 'No geometry provided for validation' });

    const result = GISEngine.validateSingleParcel(geom);
    const targetProjId = projectId || (parcel ? parcel.project_id : null);
    if (targetProjId) {
      const features = db.getFeaturesByProjectId(targetProjId);
      const waterFeatures = features.filter(f => f.feature_type === 'Water' || f.detection_type === 'WATER' || f.name?.toLowerCase().includes('water') || f.name?.toLowerCase().includes('canal'));
      const waterOverlap = GISEngine.checkWaterOverlap(result.repaired_geometry || geom, waterFeatures);
      if (waterOverlap.hasOverlap) {
        result.valid = false;
        result.errors.push(...waterOverlap.errors);
      }
    }

    res.json({
      success: true,
      parcel_id: pId,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /parcels/:id/geometry (Requirement 17 & 21)
router.put('/parcels/:id/geometry', (req, res) => {
  const pId = req.params.id;
  const projectId = req.query.project_id || req.body.project_id || null;
  console.log(`[Verification] save_started: true, parcel_id: ${pId}`);

  try {
    const { geometry, image_coordinates, comments, remarks, reviewer_name } = req.body;
    const existing = db.getParcelById(pId, projectId);
    if (!existing) {
      console.log(`[Verification] save_failed: true, parcel_id: ${pId}, error: 'Parcel not found'`);
      return res.status(404).json({ success: false, error: 'Parcel not found' });
    }
    if (!geometry) {
      console.log(`[Verification] save_failed: true, parcel_id: ${pId}, error: 'Missing geometry'`);
      return res.status(400).json({ success: false, error: 'Missing geometry' });
    }

    const validation = GISEngine.validateSingleParcel(geometry);

    // Check water overlap
    const targetProjId = existing.project_id || projectId;
    if (targetProjId) {
      const features = db.getFeaturesByProjectId(targetProjId);
      const waterFeatures = features.filter(f => f.feature_type === 'Water' || f.detection_type === 'WATER' || f.name?.toLowerCase().includes('water') || f.name?.toLowerCase().includes('canal'));
      const waterOverlap = GISEngine.checkWaterOverlap(validation.repaired_geometry || geometry, waterFeatures);
      if (waterOverlap.hasOverlap) {
        validation.valid = false;
        validation.errors.push(...waterOverlap.errors);
      }
    }

    if (!validation.valid && validation.errors.length > 0) {
      console.log(`[Verification] save_failed: true, parcel_id: ${pId}, validation_result: false, reason: ${validation.errors.join('; ')}`);
      return res.status(400).json({
        success: false,
        error: 'Cannot save: ' + validation.errors.join('; '),
        details: validation.errors
      });
    }

    console.log(`[Verification] validation_result: true, parcel_id: ${pId}`);

    const cleanGeom = validation.repaired_geometry || GISEngine.cleanGeometry(geometry);
    const areas = GISEngine.calculateAreas(cleanGeom);
    const prevGeom = existing.geometry;
    const note = remarks || comments || existing.remarks || existing.comments || 'Boundary vertices adjusted and validated by reviewer.';

    // Synchronize image_coordinates and geo_geometry
    const imageCoordsToSave = image_coordinates || cleanGeom.coordinates;
    const updates = {
      geometry: cleanGeom,
      image_coordinates: imageCoordsToSave,
      ...areas,
      comments: note,
      remarks: note
    };

    if (existing.geo_geometry) {
      updates.geo_geometry = cleanGeom;
    }

    const updated = db.updateParcel(existing.parcel_id || existing.id, updates, existing.project_id);

    const newVer = db.addParcelVersion({
      parcel_id: existing.id || existing.parcel_id,
      project_id: existing.project_id,
      imagery_id: existing.imagery_id,
      geometry: cleanGeom,
      previous_geometry: prevGeom,
      edited_by: reviewer_name || 'Alex Morgan (Lead Surveyor)',
      action: 'Edited',
      change_type: 'vertex_edit',
      comments: note,
      remarks: note
    });

    console.log(`[Verification] save_completed: true, parcel_id: ${pId}, version_created: ${newVer?.version || 2}`);

    res.json({
      success: true,
      message: 'Saved successfully',
      parcel: updated,
      version: newVer?.version || 2,
      validation
    });
  } catch (err) {
    console.log(`[Verification] save_failed: true, parcel_id: ${pId}, error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /parcels/:id/accept (Requirement 14 & 21)
router.post('/parcels/:id/accept', (req, res) => {
  try {
    const { comments, remarks, reviewer_name } = req.body;
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    const note = remarks || comments || 'Surveyor verified preliminary AI boundary against drone orthomosaic evidence.';
    const reviewer = reviewer_name || 'Alex Morgan (Lead Surveyor)';

    const ver = db.addVerification({
      parcel_id: parcel.parcel_id || parcel.id,
      reviewer_id: 'usr_2',
      reviewer_name: reviewer,
      action: 'Accepted',
      comments: note,
      remarks: note,
      original_geometry: parcel.geometry
    });

    res.json({
      success: true,
      message: `Parcel ${parcel.parcel_id || parcel.id} accepted`,
      verification: ver,
      parcel: db.getParcelById(parcel.parcel_id || parcel.id)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /parcels/:id/needs-review (Requirement 14 & 21)
router.post('/parcels/:id/needs-review', (req, res) => {
  try {
    const { comments, remarks, reviewer_name } = req.body;
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    const note = remarks || comments || 'Flagged for field review by surveyor';
    const reviewer = reviewer_name || 'Alex Morgan (Lead Surveyor)';

    const ver = db.addVerification({
      parcel_id: parcel.parcel_id || parcel.id,
      reviewer_id: 'usr_2',
      reviewer_name: reviewer,
      action: 'Needs Review',
      comments: note,
      remarks: note,
      original_geometry: parcel.geometry
    });

    res.json({
      success: true,
      message: `Parcel ${parcel.parcel_id || parcel.id} marked as Needs Review`,
      verification: ver,
      parcel: db.getParcelById(parcel.parcel_id || parcel.id)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /parcels/:id/reject (Requirement 14 & 21)
router.post('/parcels/:id/reject', (req, res) => {
  try {
    const { comments, remarks, reviewer_name } = req.body;
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    const note = remarks || comments || 'Rejected due to insufficient physical boundary evidence.';
    const reviewer = reviewer_name || 'Alex Morgan (Lead Surveyor)';

    const ver = db.addVerification({
      parcel_id: parcel.parcel_id || parcel.id,
      reviewer_id: 'usr_2',
      reviewer_name: reviewer,
      action: 'Rejected',
      comments: note,
      remarks: note,
      original_geometry: parcel.geometry
    });

    res.json({
      success: true,
      message: `Parcel ${parcel.parcel_id || parcel.id} rejected`,
      verification: ver,
      parcel: db.getParcelById(parcel.parcel_id || parcel.id)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /parcels/merge (Requirement 13 & 21 - Array or pair body)
router.post('/parcels/merge', (req, res) => {
  try {
    let { parcel_ids, parcel_id_1, parcel_id_2, reviewer_name, comments } = req.body;
    if (!parcel_ids && parcel_id_1 && parcel_id_2) {
      parcel_ids = [parcel_id_1, parcel_id_2];
    }
    if (!parcel_ids || !Array.isArray(parcel_ids) || parcel_ids.length < 2) {
      return res.status(400).json({ success: false, error: 'Must provide at least two parcel IDs to merge' });
    }

    const parcel1 = db.getParcelById(parcel_ids[0]);
    const parcel2 = db.getParcelById(parcel_ids[1]);

    if (!parcel1) return res.status(404).json({ success: false, error: `Source parcel ${parcel_ids[0]} not found` });
    if (!parcel2) return res.status(404).json({ success: false, error: `Target parcel ${parcel_ids[1]} not found` });

    let mergedGeom;
    try {
      mergedGeom = GISEngine.mergePolygons(parcel1.geometry, parcel2.geometry);
    } catch {
      const pts1 = parcel1.geometry.coordinates[0];
      const pts2 = parcel2.geometry.coordinates[0];
      const hull = turf.convex(turf.multiPoint([...pts1, ...pts2]));
      mergedGeom = hull ? hull.geometry : parcel1.geometry;
    }

    const areas = GISEngine.calculateAreas(mergedGeom);
    db.updateParcel(parcel1.parcel_id || parcel1.id, {
      geometry: mergedGeom,
      ...areas,
      status: 'accepted',
      supporting_features: [...(parcel1.supporting_features || []), `Merged with ${parcel2.parcel_id || parcel2.id}`]
    });

    db.deleteParcel(parcel2.parcel_id || parcel2.id, reviewer_name || 'Alex Morgan');

    db.addParcelVersion({
      parcel_id: parcel1.id || parcel1.parcel_id,
      project_id: parcel1.project_id,
      imagery_id: parcel1.imagery_id,
      geometry: mergedGeom,
      previous_geometry: parcel1.geometry,
      edited_by: reviewer_name || 'Alex Morgan',
      action: 'Merged',
      change_type: 'merge'
    });

    const updatedMerged = db.getParcelById(parcel1.parcel_id || parcel1.id);
    res.json({
      success: true,
      message: `Parcels ${parcel1.parcel_id || parcel1.id} and ${parcel2.parcel_id || parcel2.id} successfully merged`,
      parcel: updatedMerged,
      merged_parcel: updatedMerged
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /parcels/:id/versions (Version History)
router.get('/parcels/:id/versions', (req, res) => {
  try {
    const versions = db.getParcelVersions(req.params.id);
    res.json({
      success: true,
      parcel_id: req.params.id,
      count: versions.length,
      versions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /projects/:id/parcel-versions (Project Version History)
router.get('/projects/:id/parcel-versions', (req, res) => {
  try {
    const versions = db.getParcelVersionsByProjectId(req.params.id);
    res.json({
      success: true,
      project_id: req.params.id,
      count: versions.length,
      versions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /parcels/:id/history (Requirement 15 & 21)
router.get('/parcels/:id/history', (req, res) => {
  try {
    const history = db.getParcelHistory(req.params.id);
    res.json({
      success: true,
      ...history
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET & POST /projects/:id/gis-quality & /projects/:id/quality-control (Requirement 2, 3, 4, 5, 6, 7, 8, 21)
const handleGisQuality = (req, res) => {
  try {
    const imageryId = req.query.imagery_id || req.body?.imagery_id || null;
    const parcels = db.getParcelsByProjectId(req.params.id, imageryId);
    
    // Fetch water features for water exclusion audit
    const features = db.getFeaturesByProjectId(req.params.id, imageryId);
    const waterFeatures = features.filter(f => 
      (f.detection_type || f.feature_type || '').toLowerCase().includes('water') ||
      (f.sub_type || '').toLowerCase().includes('water') ||
      (f.sub_type || '').toLowerCase().includes('canal') ||
      (f.sub_type || '').toLowerCase().includes('river') ||
      (f.sub_type || '').toLowerCase().includes('lake')
    );

    const audit = GISEngine.auditTopology(parcels, waterFeatures);

    // Strict Logging (Step 8 Section 13)
    console.log(`\n[GIS Quality]`);
    console.log(`project_id: ${req.params.id}`);
    console.log(`imagery_id: ${imageryId || 'all'}`);
    console.log(`run_id: ${req.query.detection_run_id || 'latest'}`);
    console.log(`queried_count: ${parcels.length}`);
    console.log(`returned_count: ${parcels.length}`);
    console.log(`validated_count: ${audit.valid_polygons_count}`);
    console.log(`rendered_count: ${parcels.length}\n`);

    const issues = [
      ...(audit.invalid_details || []).map(i => ({ 
        ...i,
        type: 'Invalid Geometry', 
        parcel: i.parcel_id || i.id, 
        parcel_id: i.parcel_id || i.id, 
        severity: i.severity || 'High', 
        status: i.status || 'Needs Review',
        description: i.reason || 'Geometry self-intersection or open ring'
      })),
      ...(audit.water_overlaps || []).map(w => ({ 
        ...w,
        type: 'Water Overlap', 
        parcel: w.parcel_id || w.id, 
        parcel_id: w.parcel_id || w.id, 
        severity: w.severity || 'High', 
        status: w.status || 'Needs Review',
        description: `Overlaps ${w.water_feature || 'water boundary'}`
      })),
      ...(audit.overlaps || []).map(o => ({ 
        ...o,
        type: 'Overlap', 
        parcel: `${o.parcel_a} / ${o.parcel_b}`, 
        parcel_a: o.parcel_a, 
        parcel_b: o.parcel_b, 
        severity: o.severity || 'High', 
        status: o.status || 'Needs Review',
        description: `Overlaps with adjacent parcel (${o.area_display || ''})`
      })),
      ...(audit.gaps || []).map(g => ({ 
        ...g,
        type: 'Possible Gap', 
        parcel: `${g.parcel_a} / ${g.parcel_b}`, 
        parcel_a: g.parcel_a, 
        parcel_b: g.parcel_b, 
        severity: g.severity || 'Medium', 
        status: g.status || 'Review',
        description: g.status_label || g.reason || 'Possible gap — review required'
      })),
      ...(audit.slivers || []).map(s => ({ 
        ...s,
        type: 'Sliver', 
        parcel: s.parcel_id || s.id, 
        parcel_id: s.parcel_id || s.id, 
        severity: s.severity || 'High', 
        status: s.status || 'Needs Review',
        description: s.reason || 'Very small or narrow sliver parcel'
      })),
      ...(audit.low_confidence_parcels || []).map(l => ({ 
        ...l,
        type: 'Low Confidence', 
        parcel: l.parcel_id || l.id, 
        parcel_id: l.parcel_id || l.id, 
        severity: l.severity || 'Low', 
        status: l.status || 'Review',
        description: `AI confidence: ${Math.round((l.confidence || 0) * 100)}%`
      }))
    ];

    res.json({
      success: true,
      project_id: req.params.id,
      imagery_id: imageryId,
      ...audit,
      issues,
      metrics: {
        total_parcels: audit.total_parcels,
        valid_parcels: audit.valid_polygons_count,
        invalid_geometries: audit.invalid_polygons_count,
        overlapping_parcels: audit.overlaps_count,
        possible_gaps: audit.gaps_count,
        low_confidence: audit.low_confidence_count,
        sliver_parcels: audit.slivers_count,
        ready_for_review: audit.ready_for_review_count
      },
      total_parcels: audit.total_parcels,
      valid_parcels: audit.valid_polygons_count,
      invalid_geometries: audit.invalid_polygons_count,
      overlapping_parcels: audit.overlaps_count,
      gap_areas: audit.gaps_count,
      water_overlaps_count: audit.water_overlaps_count || 0,
      low_confidence_parcels: audit.low_confidence_count,
      sliver_parcels: audit.slivers_count,
      slivers_count: audit.slivers_count,
      repairs_performed_count: audit.repairs_performed_count || 0,
      repairs_performed: audit.repairs_performed || [],
      ready_for_review: audit.ready_for_review_count,
      legal_disclaimer: LEGAL_DISCLAIMER,
      disclaimer: LEGAL_DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

router.get('/projects/:id/gis-quality', handleGisQuality);
router.post('/projects/:id/gis-quality', handleGisQuality);
router.get('/projects/:id/quality-control', handleGisQuality);
router.post('/projects/:id/quality-control', handleGisQuality);

// ==========================================
// TIMELINE & AUDIT TRAIL API (Step 5 Section 18)
// ==========================================
// GET /api/projects/:id/timeline
router.get('/projects/:id/timeline', (req, res) => {
  try {
    const verifications = db.getVerificationsByProjectId(req.params.id);
    res.json({
      success: true,
      count: verifications.length,
      timeline: verifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/activities (Step 5 Section 18)
router.get('/projects/:id/activities', (req, res) => {
  try {
    const activities = db.getActivitiesByProjectId(req.params.id);
    res.json({
      success: true,
      count: activities.length,
      activities
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// PROJECT COMPLETION (Step 5 Section 7)
// ==========================================
// POST /api/projects/:id/complete
router.post('/projects/:id/complete', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const parcels = db.getParcelsByProjectId(req.params.id).filter(p => p.status !== 'Deleted' && p.status !== 'split');
    const audit = GISEngine.auditTopology(parcels);

    const unresolvedCriticalGis = (audit.overlaps_count || 0) + (audit.invalid_polygons_count || 0);
    const lowConfidenceParcels = parcels.filter(p => (p.confidence || 0) < 0.60);
    const needsReviewParcels = parcels.filter(p => p.status === 'needs_review' || p.status === 'Needs Review');
    const rejectedParcels = parcels.filter(p => p.status === 'rejected' || p.status === 'Rejected');
    const unverifiedParcels = parcels.filter(p => p.status !== 'accepted' && p.status !== 'Human Verified');

    const issues = [];
    if (unresolvedCriticalGis > 0) {
      issues.push(`${unresolvedCriticalGis} unresolved critical GIS topology issues (overlaps/invalid geometries)`);
    }
    if (lowConfidenceParcels.length > 0) {
      issues.push(`${lowConfidenceParcels.length} parcels with low AI confidence (<60%)`);
    }
    if (needsReviewParcels.length > 0) {
      issues.push(`${needsReviewParcels.length} parcels flagged as 'Needs Review'`);
    }
    if (rejectedParcels.length > 0) {
      issues.push(`${rejectedParcels.length} rejected parcels still present`);
    }
    if (unverifiedParcels.length > 0) {
      issues.push(`${unverifiedParcels.length} parcels awaiting surveyor verification`);
    }

    const { override } = req.body || {};
    if (issues.length > 0 && !override) {
      return res.status(400).json({
        success: false,
        requires_review: true,
        message: 'Some parcels still require review.',
        issues,
        summary: {
          critical_gis_issues: unresolvedCriticalGis,
          low_confidence: lowConfidenceParcels.length,
          needs_review: needsReviewParcels.length,
          rejected: rejectedParcels.length,
          unverified: unverifiedParcels.length
        }
      });
    }

    const updated = db.updateProject(req.params.id, {
      status: 'Completed',
      completed_at: new Date().toISOString()
    });

    db.logActivity(req.params.id, {
      title: 'Project Completed',
      description: override
        ? 'Project completed with explicit surveyor override for flagged review items.'
        : 'All parcels verified and project successfully completed.',
      type: 'completion',
      user: req.body?.reviewer || 'Alex Morgan (Lead Surveyor)'
    });

    res.json({
      success: true,
      message: 'Project marked as completed',
      project: updated,
      override_used: Boolean(override)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// REPORT & EXPORT GENERATION API (Step 9: Reports & Export)
// ==========================================
// ==========================================
// GET & POST /api/projects/:id/report
router.get('/projects/:id/report', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const imageryId = req.query.imagery_id || null;
    const report = ReportService.generateProjectReport(req.params.id, imageryId);
    res.json({ success: true, report });
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/projects/:id/report', async (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const imageryId = req.query.imagery_id || req.body?.imagery_id || null;
    const report = ReportService.generateProjectReport(req.params.id, imageryId);
    
    // Log report generation in audit trail
    db.logActivity(req.params.id, {
      title: 'Dossier Report Generated',
      description: `Comprehensive AI Cadastral Report generated for ${report.parcels.length} parcels.`,
      type: 'report',
      user: 'Alex Morgan (Lead Surveyor)'
    });

    const imgQuery = imageryId ? `?imagery_id=${encodeURIComponent(imageryId)}` : '';
    res.json({
      success: true,
      report,
      pdf_url: `/api/projects/${req.params.id}/export/pdf${imgQuery}`,
      geojson_url: `/api/projects/${req.params.id}/export/geojson${imgQuery}`,
      csv_url: `/api/projects/${req.params.id}/export/csv${imgQuery}`,
      all_url: `/api/projects/${req.params.id}/export/all${imgQuery}`
    });
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/parcels/:id/report (Step 9 Section 11)
router.get('/parcels/:id/report', (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });
    const report = ReportService.generateParcelReport(req.params.id);
    res.json({ success: true, report });
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET & POST /api/parcels/:id/export/pdf (Step 9 Section 11 & 13)
const handleParcelPdfExport = async (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });

    let mapBuffer = null;
    const snapshot = req.body?.map_snapshot || req.query?.map_snapshot;
    if (snapshot && typeof snapshot === 'string') {
      const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, '');
      mapBuffer = Buffer.from(base64Data, 'base64');
    }

    const pdfBuffer = await ReportService.generateParcelPdf(req.params.id, mapBuffer);
    const filename = `ParcelMap_Parcel_Report_${req.params.id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('Parcel PDF export failed:', err);
    res.status(500).json({ success: false, error: 'Parcel report generation failed.', details: err.message });
  }
};

router.get('/parcels/:id/export/pdf', handleParcelPdfExport);
router.post('/parcels/:id/export/pdf', handleParcelPdfExport);

// GET /api/parcels/:id/export/geojson
router.get('/parcels/:id/export/geojson', (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });
    const geojson = ReportService.generateGeoJsonExport(parcel.project_id, 'parcel', req.params.id);
    const filename = `parcel_${req.params.id}.geojson`;

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(geojson);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/parcels/:id/export/csv
router.get('/parcels/:id/export/csv', (req, res) => {
  try {
    const parcel = db.getParcelById(req.params.id);
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' });
    const csv = ReportService.generateCsvExport(parcel.project_id, 'parcel', req.params.id);
    const filename = `parcel_${req.params.id}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/export/geojson (Step 9 Section 14)
router.get('/projects/:id/export/geojson', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const scope = req.query.scope || 'verified';
    const imageryId = req.query.imagery_id || null;
    const geojson = ReportService.generateGeoJsonExport(req.params.id, scope, null, imageryId);
    const filename = `parcels_${req.params.id}.geojson`;

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(geojson);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/export/csv (Step 9 Section 15)
router.get('/projects/:id/export/csv', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const scope = req.query.scope || 'verified';
    const imageryId = req.query.imagery_id || null;
    const csv = ReportService.generateCsvExport(req.params.id, scope, null, imageryId);
    const filename = `parcels_${req.params.id}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET & POST /api/projects/:id/export/pdf (Step 9 Section 13)
const handlePdfExport = async (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    let mapBuffer = null;
    const snapshot = req.body?.map_snapshot || req.query?.map_snapshot;
    if (snapshot && typeof snapshot === 'string') {
      const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, '');
      mapBuffer = Buffer.from(base64Data, 'base64');
    }

    const imageryId = req.query.imagery_id || req.body?.imagery_id || null;
    const pdfBuffer = await ReportService.generatePdfReport(req.params.id, mapBuffer, imageryId);
    const safeName = (project.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `ParcelMap_Project_Report_${req.params.id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF export failed:', err);
    res.status(500).json({ success: false, error: 'Report generation failed.', details: err.message });
  }
};

router.get('/projects/:id/export/pdf', handlePdfExport);
router.post('/projects/:id/export/pdf', handlePdfExport);
router.get('/projects/:id/report/pdf', handlePdfExport);
router.post('/projects/:id/report/pdf', handlePdfExport);

// GET & POST /api/projects/:id/export/all (Step 9 Section 13 - ZIP package)
const handleZipExport = async (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    let mapBuffer = null;
    const snapshot = req.body?.map_snapshot || req.query?.map_snapshot;
    if (snapshot && typeof snapshot === 'string') {
      const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, '');
      mapBuffer = Buffer.from(base64Data, 'base64');
    }

    const imageryId = req.query.imagery_id || req.body?.imagery_id || null;
    const zipBuffer = await ReportService.generateZipPackage(req.params.id, mapBuffer, imageryId);
    const safeName = (project.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `ParcelMap_${safeName}_Dataset.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    console.error('ZIP export failed:', err);
    res.status(500).json({ success: false, error: 'Dataset archive export failed.', details: err.message });
  }
};

router.get('/projects/:id/export/all', handleZipExport);
router.post('/projects/:id/export/all', handleZipExport);

// ==========================================
// PROCESSING JOBS & DEMO UTILITIES
// ==========================================
// GET /api/jobs/:id
router.get('/jobs/:id', (req, res) => {
  const job = db.getJobById(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  res.json({ success: true, job });
});

// GET /api/projects/:id/jobs
router.get('/projects/:id/jobs', (req, res) => {
  const jobs = db.getJobsByProjectId(req.params.id);
  res.json({ success: true, count: jobs.length, jobs });
});

// POST /api/projects/:id/pipeline (Start asynchronous full pipeline)
router.post('/projects/:id/pipeline', async (req, res) => {
  try {
    const job = await JobQueueService.startFullPipeline(req.params.id);
    res.status(202).json({
      success: true,
      message: 'Processing pipeline queued',
      job
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/demo/reset (Reset back to authentic demo seed)
router.post('/demo/reset', (req, res) => {
  const demoData = db.resetToDemo();
  res.json({ success: true, message: 'Database reset to demo state', demoData });
});

export default router;
