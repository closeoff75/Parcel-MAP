/**
 * ParcelMap Spatially-Aware Database Store
 * Schema implementation for Projects, Imagery, DetectedFeatures, Parcels, Verification, and ProcessingJobs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GISEngine } from '../services/gisEngine.js';
import { buildCoastalDemoDataset } from '../../scripts/setup_clean_demo_seed.js';
import { getStore } from '@netlify/blobs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'parcelmap_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Clean Demonstration Seed Data: ParcelMap Demo — Coastal Settlement
function getInitialSeed() {
  return buildCoastalDemoDataset();
}


class Database {
  constructor() {
    this.data = null;
    this.lastMtime = 0;
    this.init();
  }

  reload() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const stats = fs.statSync(DB_FILE);
        if (stats.mtimeMs !== this.lastMtime) {
          const raw = fs.readFileSync(DB_FILE, 'utf8');
          this.data = JSON.parse(raw);
          if (!this.data.parcel_versions) this.data.parcel_versions = [];
          if (!this.data.activities) this.data.activities = [];
          this.lastMtime = stats.mtimeMs;
        }
      }
    } catch (err) {
      // Ignore read error during concurrent writes
    }
  }

  init() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.parcel_versions) {
          this.data.parcel_versions = [];
        }
        if (!this.data.activities) {
          this.data.activities = [];
        }
        this.lastMtime = fs.statSync(DB_FILE).mtimeMs;
        // Ensure all legacy demo features/parcels have imagery_id: 'img_wagholi_ortho' so they don't leak into user uploads
        if (this.data.detectedFeatures) {
          this.data.detectedFeatures.forEach(f => {
            if (f.project_id === 'proj_wagholi_demo' && !f.imagery_id) {
              f.imagery_id = 'img_wagholi_ortho';
            }
          });
        }
        if (this.data.parcels) {
          this.data.parcels.forEach(p => {
            if (p.project_id === 'proj_wagholi_demo' && !p.imagery_id) {
              p.imagery_id = 'img_wagholi_ortho';
            }
          });
        }
        this.save();
      } else {
        this.data = getInitialSeed();
        this.save();
      }
    } catch (err) {
      console.warn('Could not read existing database file, re-seeding:', err.message);
      this.data = getInitialSeed();
      this.save();
    }
  }

  _getBlobStore() {
    try {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
      if (siteID && token) {
        return getStore({ name: 'parcelmap-data', siteID, token, consistency: 'strong' });
      }
      return getStore({ name: 'parcelmap-data', consistency: 'strong' });
    } catch (e) {
      return null;
    }
  }

  async _syncToNetlifyBlobs() {
    try {
      const store = this._getBlobStore();
      if (store && this.data) {
        await store.setJSON('db_state', this.data);
      }
    } catch (e) {
      // Non-blocking in environments without Blobs credentials
    }
  }

  async syncFromNetlifyBlobs() {
    try {
      const store = this._getBlobStore();
      if (store) {
        const cloudData = await store.get('db_state', { type: 'json' });
        if (cloudData && cloudData.projects) {
          this.data = cloudData;
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      if (fs.existsSync(DB_FILE)) {
        this.lastMtime = fs.statSync(DB_FILE).mtimeMs;
      }
    } catch (err) {
      console.warn('Failed to persist database to disk:', err.message);
    }
    this._syncToNetlifyBlobs();
  }

  // --- Users ---
  getUsers() { return this.data.users; }
  getUserById(id) { return this.data.users.find(u => u.id === id); }

  // --- Activities / Audit Trail (Requirement 18) ---
  getActivitiesByProjectId(projectId) {
    if (!this.data.activities) this.data.activities = [];
    return this.data.activities
      .filter(a => a.project_id === projectId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  logActivity(projectId, activity) {
    if (!this.data.activities) this.data.activities = [];
    const item = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      project_id: projectId,
      title: activity.title || 'Activity Logged',
      description: activity.description || '',
      type: activity.type || 'info', // 'detection', 'spatial_reasoning', 'edit', 'verification', 'report', 'completion'
      user: activity.user || 'Cadastral Surveyor',
      timestamp: activity.timestamp || new Date().toISOString()
    };
    this.data.activities.unshift(item);
    this.save();
    return item;
  }

  // --- Dynamic Project Metrics (Requirements 4, 5, 6, 16) ---
  getProjectMetrics(projectId) {
    const p = this.data.projects.find(x => x.id === projectId);
    if (!p) return null;

    const imagery = this.getImageryByProjectId(projectId);
    const detections = this.getFeaturesByProjectId(projectId);
    const parcels = this.getParcelsByProjectId(projectId).filter(x => x.status !== 'Deleted' && x.status !== 'split');

    const acceptedCount = parcels.filter(x => x.status === 'accepted' || x.status === 'Human Verified' || x.status === 'verified').length;
    const needsReviewCount = parcels.filter(x => x.status === 'needs_review' || x.status === 'Needs Review').length;
    const rejectedCount = parcels.filter(x => x.status === 'rejected' || x.status === 'Rejected').length;

    const totalPreliminary = parcels.length;
    const verificationPct = totalPreliminary > 0 ? Math.round((acceptedCount / totalPreliminary) * 100) : 0;

    // Topology audit for critical errors
    let criticalIssuesCount = 0;
    try {
      const audit = GISEngine.auditTopology(parcels);
      criticalIssuesCount = (audit.overlaps_count || 0) + (audit.invalid_polygons_count || 0);
    } catch (e) {}

    // Dynamic Final Map Status (Requirement 6)
    let finalStatus = 'PROCESSING';
    if (totalPreliminary === 0) {
      finalStatus = 'PROCESSING';
    } else if (criticalIssuesCount > 0) {
      finalStatus = 'REQUIRES ATTENTION';
    } else if (acceptedCount === totalPreliminary && totalPreliminary > 0) {
      finalStatus = 'VERIFIED';
    } else if (needsReviewCount > 0 || (acceptedCount > 0 && acceptedCount < totalPreliminary)) {
      finalStatus = 'PARTIALLY VERIFIED';
    } else {
      finalStatus = 'READY FOR REVIEW';
    }

    return {
      imagery_count: imagery.length,
      detections_count: detections.length,
      preliminary_parcels: totalPreliminary,
      verified_parcels: acceptedCount,
      needs_review_parcels: needsReviewCount,
      rejected_parcels: rejectedCount,
      gis_issues_count: criticalIssuesCount,
      verification_pct: verificationPct,
      final_status: finalStatus
    };
  }

  // --- Projects ---
  getProjects() {
    this.reload();
    return this.data.projects.map(p => {
      const metrics = this.getProjectMetrics(p.id) || {};
      return {
        ...p,
        ...metrics,
        status: metrics.final_status || p.status
      };
    });
  }

  getProjectById(id) {
    this.reload();
    const p = this.data.projects.find(proj => proj.id === id);
    if (!p) return null;
    const metrics = this.getProjectMetrics(id) || {};
    return {
      ...p,
      ...metrics,
      status: p.status === 'Completed' ? 'Completed' : (metrics.final_status || p.status)
    };
  }

  createProject(proj) {
    this.reload();
    const newProj = {
      id: proj.id || `proj_${Date.now()}`,
      name: proj.name || 'Untitled Project',
      description: proj.description || '',
      location: proj.location || 'Unknown Location',
      coordinates: proj.coordinates || [0, 0],
      project_type: proj.project_type || 'Cadastral Survey Project',
      created_by: proj.created_by || 'Cadastral Surveyor',
      status: proj.status || 'Created',
      progress: proj.progress || 0,
      is_demo: Boolean(proj.is_demo),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.data.projects.unshift(newProj);
    this.logActivity(newProj.id, {
      title: 'Project Initialized',
      description: `Project "${newProj.name}" created at ${newProj.location}.`,
      type: 'project'
    });
    this.save();
    return newProj;
  }

  updateProject(id, updates) {
    this.reload();
    const p = this.data.projects.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, updates, { updated_at: new Date().toISOString() });
    this.save();
    return p;
  }

  // --- Imagery ---
  getImageryByProjectId(projectId) {
    this.reload();
    return this.data.imagery.filter(img => img.project_id === projectId);
  }
  getImageryById(id) {
    this.reload();
    return this.data.imagery.find(img => img.id === id);
  }
  updateImagery(id, updates) {
    this.reload();
    const img = this.getImageryById(id);
    if (!img) return null;
    Object.assign(img, updates);
    this.save();
    return img;
  }
  addImagery(img) {
    this.reload();
    const isTif = (img.file_name || '').toLowerCase().endsWith('.tif') || (img.file_name || '').toLowerCase().endsWith('.tiff');
    let isGeoreferenced = false;
    if (img.is_georeferenced !== undefined && img.is_georeferenced !== null) {
      isGeoreferenced = Boolean(img.is_georeferenced);
    } else if (isTif) {
      isGeoreferenced = true;
    }

    const item = {
      id: img.id || `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      imagery_id: img.imagery_id || img.id || `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      project_id: img.project_id,
      file_name: img.file_name || img.filename,
      filename: img.file_name || img.filename,
      file_url: img.file_url || img.storage_url,
      storage_key: img.storage_key || null,
      storage_url: img.storage_url || img.file_url,
      mime_type: img.mime_type || 'image/jpeg',
      file_size: img.file_size || '10 MB',
      width: Number(img.width) || 4000,
      height: Number(img.height) || 3000,
      resolution: img.resolution || '2.8 cm/pixel GSD',
      sensor: img.sensor || 'Drone RGB Sensor',
      flight_altitude: img.flight_altitude || '120m AGL',
      capture_date: img.capture_date || new Date().toISOString().split('T')[0],
      status: img.status || img.processing_status || 'READY',
      processing_status: img.processing_status || img.status || 'READY',
      is_georeferenced: isGeoreferenced,
      coordinate_mode: img.coordinate_mode || (isGeoreferenced ? 'geographic' : 'image-space'),
      is_demo: Boolean(img.is_demo),
      created_at: img.created_at || new Date().toISOString(),
      metadata: {
        ...(img.metadata || {}),
        storage_key: img.storage_key || null,
        storage_url: img.storage_url || img.file_url,
        coordinate_mode: isGeoreferenced ? 'geographic' : 'image-space'
      }
    };
    this.data.imagery.push(item);
    this.save();
    return item;
  }
  deleteImagery(id, projectId = null) {
    this.reload();
    const idx = this.data.imagery.findIndex(img => img.id === id && (!projectId || img.project_id === projectId));
    if (idx === -1) return null;
    const [deletedImg] = this.data.imagery.splice(idx, 1);

    // Remove associated detected features
    this.data.detectedFeatures = (this.data.detectedFeatures || []).filter(f => f.imagery_id !== id);

    // Remove associated parcels for this imagery
    this.data.parcels = (this.data.parcels || []).filter(p => p.imagery_id !== id);

    // Remove associated parcel versions for this imagery
    this.data.parcel_versions = (this.data.parcel_versions || []).filter(v => v.imagery_id !== id);

    // Log activity
    if (deletedImg.project_id) {
      this.logActivity(deletedImg.project_id, {
        title: 'Drone Imagery Deleted',
        description: `Image "${deletedImg.file_name}" was deleted from the project.`,
        type: 'imagery'
      });
    }

    this.save();
    return deletedImg;
  }

  // --- Detected Features ---
  getFeaturesByProjectId(projectId, imageryId = null) {
    this.reload();
    let list = this.data.detectedFeatures.filter(f => f.project_id === projectId);
    if (imageryId) {
      list = list.filter(f => f.imagery_id === imageryId);
    }
    return list;
  }
  setFeatures(projectId, features, imageryId = null) {
    this.reload();
    if (imageryId) {
      this.data.detectedFeatures = this.data.detectedFeatures
        .filter(f => !(f.project_id === projectId && f.imagery_id === imageryId))
        .concat(features);
    } else {
      this.data.detectedFeatures = this.data.detectedFeatures
        .filter(f => f.project_id !== projectId)
        .concat(features);
    }
    if (features && features.length > 0) {
      this.logActivity(projectId, {
        title: 'AI Detection Completed',
        description: `${features.length} features detected from drone imagery.`,
        type: 'detection'
      });
    }
    this.save();
    return features;
  }

  enrichParcelMetadata(p) {
    if (!p) return null;
    const pId = p.parcel_id || p.id;
    const versions = (this.data.parcel_versions || [])
      .filter(v => v.parcel_id === pId || (v.id && v.id.includes(`ver_${pId}_`)))
      .sort((a, b) => (b.version_number || b.version || 1) - (a.version_number || a.version || 1));

    const latestVer = versions.length > 0 ? (versions[0].version_number || versions[0].version || 1) : (p.version || 1);
    p.version = latestVer;
    p.current_version = latestVer;

    // Clean up supporting features of any legacy fictional merge strings
    if (Array.isArray(p.supporting_features)) {
      p.supporting_features = p.supporting_features.filter(f => !f.toLowerCase().includes('merged with'));
    }

    // Source determination based on actual history and persisted flags
    if (p.source && p.source.startsWith('Merged from')) {
      // Valid merge lineage preserved
    } else if (p.source && p.source.startsWith('Split from')) {
      // Valid split lineage preserved
    } else if (p.merge_origin && Array.isArray(p.merge_origin.source_parcel_ids)) {
      p.source = `Merged from ${p.merge_origin.source_parcel_ids.join(' + ')}`;
    } else if (p.split_origin && p.split_origin.original_parcel_id) {
      p.source = `Split from ${p.split_origin.original_parcel_id}`;
    } else if (p.parent_parcel_id && p.parent_parcel_id !== pId) {
      p.source = `Split from ${p.parent_parcel_id}`;
    } else {
      const hasHumanEdit = p.is_human_edited || versions.some(v => v.action === 'Edited' || v.change_type === 'vertex_edit');
      if (hasHumanEdit) {
        p.source = 'Human Edited';
      } else if (!p.source || p.source === 'spatial_reasoning' || p.source === 'Human Verification Split') {
        p.source = 'AI Generated';
      }
    }

    // Perimeter support percentages
    if (p.supported_perimeter_pct == null) {
      p.supported_perimeter_pct = p.supported_edge_pct != null ? p.supported_edge_pct : 48;
    }
    p.unsupported_perimeter_pct = 100 - p.supported_perimeter_pct;

    // Confidence derived from actual evidence
    if (p.confidence == null) {
      p.confidence = Number((0.50 + 0.50 * (p.supported_perimeter_pct / 100)).toFixed(2));
    }

    return p;
  }

  // --- Parcels ---
  getParcelsByProjectId(projectId, imageryId = null) {
    this.reload();
    let list = this.data.parcels.filter(p => p.project_id === projectId && p.status !== 'Deleted');
    if (imageryId) {
      const projectImgs = this.getImageryByProjectId(projectId);
      list = list.filter(p => p.imagery_id === imageryId || (!p.imagery_id && projectImgs.length <= 1));
    }
    return list.map(p => this.enrichParcelMetadata(p));
  }
  getParcelById(parcelId, projectId = null, imageryId = null) {
    this.reload();
    if (!parcelId) return null;
    const reversed = (this.data.parcels || []).slice().reverse();
    let p = null;
    if (projectId && imageryId) {
      p = reversed.find(x => (x.id === parcelId || x.parcel_id === parcelId) && x.project_id === projectId && x.imagery_id === imageryId && x.status !== 'Deleted');
    }
    if (!p && projectId) {
      p = reversed.find(x => (x.id === parcelId || x.parcel_id === parcelId) && x.project_id === projectId && x.status !== 'Deleted');
    }
    if (!p) {
      p = reversed.find(x => (x.id === parcelId || x.parcel_id === parcelId) && x.status !== 'Deleted');
    }
    return p ? this.enrichParcelMetadata(p) : null;
  }

  searchParcels(query, options = {}) {
    this.reload();
    if (!query || typeof query !== 'string') return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const limit = options.limit || 8;
    const includeDemo = options.include_demo !== false;
    const cleanQ = q
      .replace(/^parcel\s*#?/i, '')
      .replace(/^plot\s*#?/i, '')
      .replace(/^survey\s*#?/i, '')
      .trim();

    const results = [];
    const seenIds = new Set();

    // 1. Search real projects and database parcels
    const allParcels = (this.data.parcels || []).filter(p => p.status !== 'Deleted');
    const projectsMap = new Map((this.data.projects || []).map(pr => [pr.id, pr]));

    for (const p of allParcels) {
      const proj = projectsMap.get(p.project_id);
      const isDemo = p.project_id === 'proj_wagholi_demo';

      const pId = (p.parcel_id || p.id || '').toLowerCase();
      const pIdClean = pId.replace(/^pm-?/i, '').replace(/^plot-?/i, '');
      const pStatus = (p.status || p.candidate_status || '').toLowerCase();
      const pSource = (p.source || '').toLowerCase();
      const projName = (proj?.name || '').toLowerCase();
      const projLoc = (proj?.location || '').toLowerCase();
      const projType = (proj?.project_type || '').toLowerCase();
      const features = Array.isArray(p.supporting_features) ? p.supporting_features.join(' ').toLowerCase() : '';
      const comments = (p.comments || p.remarks || p.review?.notes || '').toLowerCase();
      const reviewer = (p.review?.reviewer || '').toLowerCase();

      const isMatch = pId.includes(q) ||
        pIdClean.includes(cleanQ) ||
        pStatus.includes(q) ||
        projName.includes(q) ||
        projLoc.includes(q) ||
        projType.includes(q) ||
        features.includes(q) ||
        comments.includes(q) ||
        reviewer.includes(q);

      if (isMatch) {
        let lat = proj?.coordinates?.[0] || 18.5512;
        let lng = proj?.coordinates?.[1] || 73.9341;
        let boundary = null;
        const geom = p.geo_geometry || p.geometry;
        if (geom && geom.coordinates && geom.coordinates[0] && geom.coordinates[0].length >= 3) {
          const ring = geom.coordinates[0];
          let sumLat = 0, sumLng = 0;
          boundary = [];
          ring.forEach(pt => {
            sumLng += pt[0];
            sumLat += pt[1];
            boundary.push([pt[1], pt[0]]);
          });
          lat = +(sumLat / ring.length).toFixed(5);
          lng = +(sumLng / ring.length).toFixed(5);
        }

        const formattedId = p.parcel_id || p.id;
        if (!seenIds.has(formattedId)) {
          seenIds.add(formattedId);
          const survNum = p.survey_no || (p.supporting_features?.[0] ? p.supporting_features[0] : `Sector ${p.id ? p.id.slice(-4) : '1'}`);
          const locParts = (proj?.location || 'Wagholi, Pune, Maharashtra').split(',').map(s => s.trim());
          const villageName = locParts[0] || 'Wagholi';
          const districtName = locParts[1] || 'Pune';
          const stateName = locParts[2] || 'Maharashtra';
          const areaFormatted = p.area_acres ? `${p.area_acres} acres` : (p.area_sqm ? `${p.area_sqm.toLocaleString()} sqm` : '1.25 acres');

          results.push({
            id: p.id || formattedId,
            parcel_id: formattedId,
            display_name: `Parcel #${formattedId}`,
            parcelNumber: formattedId,
            surveyNumber: survNum,
            survey_no: survNum,
            village: villageName,
            district: districtName,
            state: stateName,
            latitude: lat,
            longitude: lng,
            boundary: boundary,
            location: proj?.location || `${villageName}, ${districtName}, ${stateName}`,
            project_id: p.project_id,
            project_name: proj?.name || 'Active Cadastral Project',
            land_type: proj?.project_type || 'Rural Cadastral Mapping',
            landType: proj?.project_type || 'Rural Cadastral Mapping',
            area_acres: p.area_acres || (p.area_sqm ? +(p.area_sqm * 0.000247105).toFixed(2) : 1.25),
            area_sqm: p.area_sqm || null,
            area: areaFormatted,
            status: p.candidate_status || p.status || 'Verified',
            confidence: p.confidence ? Math.round(p.confidence * 100) + '%' : '90%',
            is_demo: isDemo,
            dataset_type: isDemo ? 'Demo Dataset' : 'Verified Project',
            coordinates: [lat, lng],
            map_url: isDemo 
              ? `map.html?mode=demo&parcel=${encodeURIComponent(p.id)}&lat=${lat}&lng=${lng}`
              : `map.html?project=${encodeURIComponent(p.project_id)}&parcel=${encodeURIComponent(formattedId)}&lat=${lat}&lng=${lng}`
          });
        }
      }
    }

    // Sort: Exact matches first, then parcel number match, then real project data before demo data
    results.sort((a, b) => {
      if (a._isExactMatch && !b._isExactMatch) return -1;
      if (!a._isExactMatch && b._isExactMatch) return 1;

      const aNum = (a.parcelNumber || '').toLowerCase();
      const bNum = (b.parcelNumber || '').toLowerCase();
      if (aNum === cleanQ && bNum !== cleanQ) return -1;
      if (aNum !== cleanQ && bNum === cleanQ) return 1;

      const aSurv = (a.surveyNumber || '').toLowerCase();
      const bSurv = (b.surveyNumber || '').toLowerCase();
      if (aSurv === cleanQ && bSurv !== cleanQ) return -1;
      if (aSurv !== cleanQ && bSurv === cleanQ) return 1;

      if (!a.is_demo && b.is_demo) return -1;
      if (a.is_demo && !b.is_demo) return 1;
      return 0;
    });

    return results;
  }
  setParcels(projectId, parcels, imageryId = null) {
    this.reload();
    if (imageryId) {
      this.data.parcels = this.data.parcels.filter(p => !(p.project_id === projectId && p.imagery_id === imageryId)).concat(parcels);
    } else {
      this.data.parcels = this.data.parcels.filter(p => p.project_id !== projectId).concat(parcels);
    }
    if (parcels && parcels.length > 0) {
      this.logActivity(projectId, {
        title: 'Spatial Reasoning Completed',
        description: `${parcels.length} preliminary parcels inferred from evidence.`,
        type: 'spatial_reasoning'
      });
    }
    this.save();
    return parcels;
  }
  updateParcel(parcelId, updates, projectId = null, imageryId = null) {
    this.reload();
    const p = this.getParcelById(parcelId, projectId, imageryId);
    if (!p) return null;
    Object.assign(p, updates, { updated_at: new Date().toISOString() });
    this.save();
    return p;
  }
  deleteParcel(parcelId, reviewerName = 'Cadastral Surveyor', projectId = null, imageryId = null) {
    this.reload();
    const p = this.getParcelById(parcelId, projectId, imageryId);
    if (!p) return null;
    p.status = 'Deleted';
    p.updated_at = new Date().toISOString();
    this.addParcelVersion({
      parcel_id: p.id || p.parcel_id,
      project_id: p.project_id,
      imagery_id: p.imagery_id,
      geometry: p.geometry,
      edited_by: reviewerName,
      change_type: 'rejected'
    });
    this.save();
    return p;
  }

  // --- Parcel Version History (Requirement 15 & 16) ---
  getParcelVersions(parcelId) {
    this.reload();
    return (this.data.parcel_versions || [])
      .filter(v => v.parcel_id === parcelId || v.id.includes(`ver_${parcelId}_`))
      .sort((a, b) => b.version_number - a.version_number);
  }
  getParcelVersionsByProjectId(projectId) {
    this.reload();
    return (this.data.parcel_versions || [])
      .filter(v => v.project_id === projectId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  getParcelHistory(parcelId) {
    this.reload();
    const parcel = (this.data.parcels || []).find(p => (p.parcel_id || p.id) === parcelId);
    const parentId = parcel?.parent_parcel_id;
    const versions = (this.data.parcel_versions || [])
      .filter(v => v.parcel_id === parcelId || v.id.includes(`ver_${parcelId}_`) || (parentId && v.parcel_id === parentId))
      .sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
    const verifications = this.getVerificationsByParcelId(parcelId);
    return {
      parcel_id: parcelId,
      versions,
      history: versions,
      verifications,
      timeline: [...versions.map(v => ({
        id: v.id,
        type: 'version',
        version: v.version || v.version_number,
        action: v.action,
        operation: v.operation || (v.action ? v.action.toUpperCase() : null),
        parent_parcel_id: v.parent_parcel_id || null,
        child_parcel_ids: v.child_parcel_ids || null,
        split_line: v.split_line || null,
        resulting_geometries: v.resulting_geometries || null,
        edited_by: v.edited_by,
        comments: v.comments || v.remarks || '',
        notes: v.comments || v.remarks || '',
        timestamp: v.timestamp || v.created_at,
        geometry: v.geometry,
        previous_geometry: v.previous_geometry
      })), ...verifications.map(ver => ({
        id: ver.id,
        type: 'verification',
        action: ver.action,
        reviewer_name: ver.reviewer_name,
        comments: ver.comments || ver.remarks || '',
        notes: ver.comments || ver.remarks || '',
        timestamp: ver.timestamp
      }))].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    };
  }
  addParcelVersion({ parcel_id, project_id, imagery_id, geometry, previous_geometry, edited_by, action, change_type, comments, remarks, parent_parcel_id, child_parcel_ids, split_line, resulting_geometries, operation }) {
    if (!this.data.parcel_versions) this.data.parcel_versions = [];
    const prevVersions = this.data.parcel_versions.filter(v => v.parcel_id === parcel_id);
    const nextVersionNum = prevVersions.length > 0
      ? Math.max(...prevVersions.map(v => v.version_number || v.version || 1)) + 1
      : 1;

    // Standard action names matching Requirement 11: Generated, Edited, Split, Merged, Accepted, Rejected, Needs Review
    let standardAction = action;
    if (!standardAction) {
      if (change_type === 'generated') standardAction = 'Generated';
      else if (change_type === 'vertex_edit' || change_type === 'Edited') standardAction = 'Edited';
      else if (change_type === 'split' || change_type === 'Split') standardAction = 'Split';
      else if (change_type === 'merge' || change_type === 'Merged') standardAction = 'Merged';
      else if (change_type === 'accepted' || change_type === 'Accepted') standardAction = 'Accepted';
      else if (change_type === 'rejected' || change_type === 'Rejected') standardAction = 'Rejected';
      else if (change_type === 'needs_review' || change_type === 'review') standardAction = 'Needs Review';
      else standardAction = 'Edited';
    }

    const prevGeom = previous_geometry !== undefined
      ? previous_geometry
      : (prevVersions.length > 0 ? prevVersions[0].geometry : null);

    const now = new Date().toISOString();
    const versionItem = {
      id: `ver_${parcel_id}_v${nextVersionNum}_${Date.now()}`,
      parcel_id,
      project_id: project_id || null,
      imagery_id: imagery_id || null,
      version: nextVersionNum,
      version_number: nextVersionNum,
      geometry,
      previous_geometry: prevGeom,
      parent_parcel_id: parent_parcel_id || null,
      child_parcel_ids: child_parcel_ids || null,
      split_line: split_line || null,
      resulting_geometries: resulting_geometries || null,
      action: standardAction,
      operation: operation || (standardAction ? standardAction.toUpperCase() : null),
      change_type: change_type || standardAction.toLowerCase().replace(/\s+/g, '_'),
      edited_by: edited_by || 'Lead Cadastral Surveyor',
      comments: comments || remarks || '',
      remarks: comments || remarks || '',
      timestamp: now,
      created_at: now
    };
    this.data.parcel_versions.push(versionItem);

    // Synchronize parcel object's active version number and source
    const parcelObj = (this.data.parcels || []).find(p => (p.parcel_id || p.id) === parcel_id);
    if (parcelObj) {
      parcelObj.version = nextVersionNum;
      parcelObj.current_version = nextVersionNum;
      if (standardAction === 'Edited') {
        parcelObj.is_human_edited = true;
        parcelObj.source = 'Human Edited';
      }
    }

    this.save();
    return versionItem;
  }

  // --- Verification ---
  getVerificationsByProjectId(projectId) {
    const parcelIds = new Set(this.getParcelsByProjectId(projectId).map(p => p.parcel_id));
    return this.data.verifications.filter(v => parcelIds.has(v.parcel_id));
  }
  getVerificationsByParcelId(parcelId) {
    return this.data.verifications.filter(v => v.parcel_id === parcelId);
  }
  addVerification(ver) {
    const item = {
      id: ver.id || `ver_${Date.now()}`,
      parcel_id: ver.parcel_id,
      reviewer_id: ver.reviewer_id || 'usr_surveyor',
      reviewer_name: ver.reviewer_name || 'Lead Cadastral Surveyor',
      action: ver.action, // 'Accepted', 'Edited', 'Rejected', 'Needs Review'
      comments: ver.comments || '',
      remarks: ver.comments || '',
      original_geometry: ver.original_geometry,
      edited_geometry: ver.edited_geometry || null,
      timestamp: new Date().toISOString()
    };
    this.data.verifications.push(item);

    // Update parcel status accordingly
    const parcel = this.getParcelById(ver.parcel_id, ver.project_id, ver.imagery_id);
    if (parcel) {
      let changeType = 'vertex_edit';
      if (ver.action === 'Accepted') {
        parcel.status = 'accepted';
        changeType = 'accepted';
      } else if (ver.action === 'Rejected') {
        parcel.status = 'rejected';
        changeType = 'rejected';
      } else if (ver.action === 'Needs Review') {
        parcel.status = 'needs_review';
        changeType = 'needs_review';
      } else if (ver.action === 'Edited') {
        parcel.status = 'accepted';
        changeType = 'vertex_edit';
        if (ver.edited_geometry) {
          parcel.geometry = ver.edited_geometry;
          if (ver.area_sqm) parcel.area_sqm = ver.area_sqm;
          if (ver.area_hectares) parcel.area_hectares = ver.area_hectares;
          if (ver.area_acres) parcel.area_acres = ver.area_acres;
        }
      }
      parcel.comments = ver.comments || parcel.comments || '';
      parcel.remarks = ver.comments || parcel.remarks || '';
      parcel.updated_at = item.timestamp;

      // Maintain parcel_versions (Requirement 11)
      this.addParcelVersion({
        parcel_id: parcel.parcel_id || parcel.id,
        project_id: parcel.project_id,
        imagery_id: parcel.imagery_id,
        geometry: ver.edited_geometry || parcel.geometry,
        edited_by: ver.reviewer_name || 'Lead Cadastral Surveyor',
        action: ver.action,
        change_type: changeType,
        comments: ver.comments || ''
      });

      if (parcel.project_id) {
        this.logActivity(parcel.project_id, {
          title: `Parcel ${parcel.parcel_id || parcel.id} ${ver.action}`,
          description: ver.comments || `Demarcation ${ver.action.toLowerCase()} by ${ver.reviewer_name || 'Lead Cadastral Surveyor'}.`,
          type: ver.action.toLowerCase(),
          user: ver.reviewer_name || 'Lead Cadastral Surveyor'
        });
      }
    }

    this.save();
    return item;
  }

  setParcelStatus(parcelId, status, reviewerName = 'Lead Cadastral Surveyor', comments = '') {
    const parcel = this.getParcelById(parcelId);
    if (!parcel) return null;
    parcel.status = status;
    parcel.updated_at = new Date().toISOString();
    
    let standardAction = 'Edited';
    if (status === 'accepted' || status === 'Human Verified') standardAction = 'Accepted';
    else if (status === 'rejected' || status === 'Rejected') standardAction = 'Rejected';
    else if (status === 'needs_review' || status === 'Needs Review') standardAction = 'Needs Review';

    this.addParcelVersion({
      parcel_id: parcel.id || parcel.parcel_id,
      project_id: parcel.project_id,
      imagery_id: parcel.imagery_id,
      geometry: parcel.geometry,
      edited_by: reviewerName,
      action: standardAction,
      change_type: status.toLowerCase().replace(/\s+/g, '_')
    });

    if (parcel.project_id) {
      this.logActivity(parcel.project_id, {
        title: `Parcel ${parcel.parcel_id || parcel.id} ${standardAction}`,
        description: comments || `Demarcation marked ${status} by ${reviewerName}.`,
        type: status.toLowerCase(),
        user: reviewerName
      });
    }

    this.save();
    return parcel;
  }

  // --- Processing Jobs ---
  getJobsByProjectId(projectId) {
    return this.data.processingJobs.filter(j => j.project_id === projectId);
  }
  getJobById(jobId) {
    return this.data.processingJobs.find(j => j.id === jobId);
  }
  createJob(job) {
    const newJob = {
      id: job.id || `job_${Date.now()}`,
      project_id: job.project_id,
      job_type: job.job_type,
      status: job.status || 'QUEUED',
      progress: job.progress || 0,
      logs: job.logs || [],
      started_at: new Date().toISOString(),
      completed_at: null
    };
    this.data.processingJobs.push(newJob);
    this.save();
    return newJob;
  }
  updateJob(jobId, updates) {
    const j = this.getJobById(jobId);
    if (!j) return null;
    Object.assign(j, updates);
    this.save();
    return j;
  }

  // --- Isolated Demo Dataset Management ---
  resetToDemo() {
    this.reload();
    const cleanSeed = buildCoastalDemoDataset();
    const demoProjId = 'proj_demo_coastal';
    const demoImgId = 'img_demo_coastal';

    // Remove any legacy demo projects (e.g. proj_wagholi_demo, proj_demo_coastal, or any with is_demo === true)
    const demoProjectIds = new Set(
      this.data.projects.filter(p => p.is_demo || p.id === demoProjId || p.id === 'proj_wagholi_demo').map(p => p.id)
    );
    demoProjectIds.add(demoProjId);
    demoProjectIds.add('proj_wagholi_demo');

    // Keep real user projects (!is_demo)
    this.data.projects = this.data.projects.filter(p => !demoProjectIds.has(p.id));
    this.data.imagery = this.data.imagery.filter(img => !demoProjectIds.has(img.project_id) && img.id !== demoImgId && img.id !== 'img_wagholi_ortho');
    this.data.detectedFeatures = this.data.detectedFeatures.filter(f => !demoProjectIds.has(f.project_id));
    this.data.parcels = this.data.parcels.filter(p => !demoProjectIds.has(p.project_id));
    this.data.verifications = (this.data.verifications || []).filter(v => !demoProjectIds.has(v.project_id) && !v.parcel_id?.startsWith('PM-DEMO-') && !v.parcel_id?.startsWith('PM-00'));
    this.data.processingJobs = (this.data.processingJobs || []).filter(j => !demoProjectIds.has(j.project_id));
    this.data.parcel_versions = (this.data.parcel_versions || []).filter(v => !demoProjectIds.has(v.project_id));
    this.data.activities = (this.data.activities || []).filter(a => !demoProjectIds.has(a.project_id));

    // Insert clean Coastal Settlement demo seed at the top
    this.data.projects.unshift(cleanSeed.projects[0]);
    this.data.imagery.unshift(cleanSeed.imagery[0]);
    cleanSeed.detectedFeatures.forEach(f => this.data.detectedFeatures.push(f));
    cleanSeed.parcels.forEach(p => this.data.parcels.push(p));
    cleanSeed.processingJobs.forEach(j => this.data.processingJobs.push(j));
    cleanSeed.parcel_versions.forEach(v => this.data.parcel_versions.push(v));
    cleanSeed.activities.forEach(a => this.data.activities.push(a));

    this.data.users = cleanSeed.users;

    this.save();
    return {
      project: cleanSeed.projects[0],
      imagery: cleanSeed.imagery[0],
      features: cleanSeed.detectedFeatures,
      parcels: cleanSeed.parcels
    };
  }
}

export const db = new Database();
