/**
 * ParcelMap Environment Configuration & Diagnostic Validator
 * 
 * Verifies and validates environment variables for local and production deployments:
 * - DATABASE_URL
 * - API_BASE_URL
 * - STORAGE_URL
 * - AI_SERVICE_URL
 * - AI_SERVICE_KEY
 * - Local ML model configuration
 * 
 * Never exposes secrets in logs or responses.
 */

import fs from 'fs';
import path from 'path';

export class EnvConfig {
  /**
   * Get validated environment configuration status without leaking secrets.
   */
  static getStatus() {
    const cwd = process.cwd();
    const localModelCandidate = path.join(cwd, 'server', 'ml', 'models', 'yolov8n-building-seg.pt');
    const rootModelCandidate = path.join(cwd, 'yolov8n-seg.pt');
    const hasLocalModel = fs.existsSync(localModelCandidate) || fs.existsSync(rootModelCandidate);

    const provider = process.env.DETECTION_PROVIDER || 'ml';
    const isRemote = provider === 'remote' || Boolean(process.env.AI_SERVICE_URL);

    return {
      provider,
      database: {
        configured: true,
        type: process.env.DATABASE_URL ? 'remote' : 'local_json',
        url_configured: Boolean(process.env.DATABASE_URL)
      },
      api: {
        base_url: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}/api`
      },
      storage: {
        url_configured: Boolean(process.env.STORAGE_URL),
        local_dir: path.join(cwd, 'uploads'),
        local_exists: fs.existsSync(path.join(cwd, 'uploads'))
      },
      ai_service: {
        provider,
        is_remote: isRemote,
        url_configured: Boolean(process.env.AI_SERVICE_URL),
        key_configured: Boolean(process.env.AI_SERVICE_KEY),
        local_model_available: hasLocalModel,
        local_model_path: hasLocalModel ? (fs.existsSync(localModelCandidate) ? localModelCandidate : rootModelCandidate) : null
      }
    };
  }

  /**
   * Validate configuration for the requested detection provider.
   * Throws clear human-readable error explaining which configuration is missing.
   */
  static validateDetectionConfig(provider = 'ml') {
    const normalized = (provider || 'ml').toLowerCase();

    if (normalized === 'remote') {
      if (!process.env.AI_SERVICE_URL) {
        throw new Error('Configuration error: AI_SERVICE_URL environment variable is required for remote AI detection service.');
      }
      try {
        new URL(process.env.AI_SERVICE_URL);
      } catch {
        throw new Error('Configuration error: AI_SERVICE_URL is not a valid URL.');
      }
    } else if (normalized === 'ml') {
      const cwd = process.cwd();
      const localCandidate = path.join(cwd, 'server', 'ml', 'models', 'yolov8n-building-seg.pt');
      const rootCandidate = path.join(cwd, 'yolov8n-seg.pt');
      if (!fs.existsSync(localCandidate) && !fs.existsSync(rootCandidate)) {
        throw new Error('The model is currently unreachable: Local YOLOv8n-seg weights file not found on disk.');
      }
    }
    return true;
  }

  /**
   * Redact sensitive tokens and passwords from strings / URLs for safe logging.
   */
  static redactSecret(value) {
    if (!value || typeof value !== 'string') return value;
    return value.replace(/(api[_-]?key|token|password|secret|bearer)\s*[:=]\s*[^\s,;&]+/gi, '$1=[REDACTED]');
  }

  /**
   * Structured diagnostic logger for detection flow (Section 1).
   */
  static logDiagnostic(stage, data = {}) {
    const safeData = { ...data };
    if (safeData.headers) {
      safeData.headers = '[REDACTED]';
    }
    if (safeData.key) {
      safeData.key = '[REDACTED]';
    }

    console.log(`[Diagnostic - ${stage}]`, JSON.stringify(safeData, (key, value) => {
      if (/key|secret|token|password|auth/i.test(key)) return '[REDACTED]';
      return value;
    }, 2));
  }
}
