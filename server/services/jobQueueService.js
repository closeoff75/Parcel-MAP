/**
 * ParcelMap Processing Job System
 * Manages asynchronous / simulated background processing pipelines:
 * UPLOAD -> QUEUED -> PROCESSING -> AI DETECTION -> SPATIAL REASONING -> GIS PROCESSING -> COMPLETED
 */

import { db } from '../db/database.js';
import { AIDetectionService } from './aiDetectionService.js';
import { RoadSpatialReasoningService } from './roadSpatialReasoningService.js';
import { GISEngine } from './gisEngine.js';

export class JobQueueService {
  /**
   * Starts a complete end-to-end processing pipeline job.
   */
  static async startFullPipeline(projectId, triggerCallback = null) {
    const job = db.createJob({
      project_id: projectId,
      job_type: 'FULL_PARCEL_PIPELINE',
      status: 'QUEUED',
      progress: 5,
      logs: [
        `[${new Date().toLocaleTimeString()}] Pipeline queued for project ${projectId}`,
        `[${new Date().toLocaleTimeString()}] Validating UAV imagery metadata...`
      ]
    });

    // Run pipeline asynchronously so it doesn't block the caller
    setTimeout(async () => {
      try {
        // Step 1: Processing
        this.appendLog(job.id, 'Ingesting drone imagery orthomosaic (GSD 2.8 cm/px)...', 20, 'PROCESSING');

        // Step 2: AI Detection
        this.appendLog(job.id, 'Executing AI feature detection (roads, buildings, walls, field edges)...', 40, 'AI_DETECTION');
        await AIDetectionService.runDetection(projectId);

        // Step 3: Road-Based Spatial Reasoning
        this.appendLog(job.id, 'Constructing road network topological graph & partitioning corridors...', 65, 'SPATIAL_REASONING');
        await RoadSpatialReasoningService.runSpatialReasoning(projectId);

        // Step 4: GIS Processing & Quality Audit
        this.appendLog(job.id, 'Running GIS topology validation (gap, overlap, sliver detection)...', 85, 'GIS_PROCESSING');
        const parcels = db.getParcelsByProjectId(projectId);
        const audit = GISEngine.auditTopology(parcels);

        // Step 5: Completed
        this.appendLog(
          job.id,
          `Pipeline complete! ${parcels.length} preliminary parcels generated. ${audit.overlaps_count} overlaps, ${audit.gaps_count} gaps identified for verification.`,
          100,
          'COMPLETED'
        );

        db.updateProject(projectId, {
          status: 'Verification',
          progress: 72
        });

        if (triggerCallback) triggerCallback(null, job);
      } catch (err) {
        this.appendLog(job.id, `Pipeline failed: ${err.message}`, 100, 'FAILED');
        if (triggerCallback) triggerCallback(err, job);
      }
    }, 800);

    return job;
  }

  static appendLog(jobId, message, progress, status) {
    const job = db.getJobById(jobId);
    if (!job) return;
    const time = new Date().toLocaleTimeString();
    const logs = job.logs || [];
    logs.push(`[${time}] ${message}`);
    db.updateJob(jobId, {
      progress: progress !== undefined ? progress : job.progress,
      status: status || job.status,
      logs,
      completed_at: status === 'COMPLETED' || status === 'FAILED' ? new Date().toISOString() : null
    });
  }
}
