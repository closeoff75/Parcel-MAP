/**
 * ParcelMap Persistent Storage Service
 * 
 * Supports Netlify-native cloud storage via Netlify Blobs ('parcelmap-imagery')
 * and graceful local disk fallback when running locally or during testing.
 * 
 * Key convention:
 *   projects/{project_id}/imagery/{imagery_id}/{filename}
 */

import path from 'path';
import fs from 'fs';
import { getStore } from '@netlify/blobs';

export class StorageService {
  static STORE_NAME = 'parcelmap-imagery';
  static _blobStore = null;

  /**
   * Resolve or initialize the Netlify Blob store if available.
   */
  static getBlobStore() {
    if (this._blobStore) return this._blobStore;

    try {
      // 1. In Netlify Functions runtime, getStore works without explicit credentials
      // 2. In local/external environments, check for NETLIFY_BLOBS_TOKEN / NETLIFY_SITE_ID
      const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

      if (siteID && token) {
        this._blobStore = getStore({
          name: this.STORE_NAME,
          siteID,
          token,
          consistency: 'strong'
        });
      } else {
        // Attempt standard auto-configured store (works in Netlify serverless context)
        this._blobStore = getStore({
          name: this.STORE_NAME,
          consistency: 'strong'
        });
      }
      return this._blobStore;
    } catch (err) {
      // Not in Netlify environment or missing credentials; will fall back to local disk
      return null;
    }
  }

  /**
   * Determine whether Netlify Blobs is active.
   */
  static isNetlifyStorageActive() {
    return Boolean(this.getBlobStore());
  }

  /**
   * Format the standardized storage key.
   */
  static buildStorageKey(projectId, imageryId, filename) {
    const cleanFilename = path.basename(filename || 'image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `projects/${projectId}/imagery/${imageryId}/${cleanFilename}`;
  }

  /**
   * Save an uploaded image to persistent storage.
   */
  static async saveImage({ projectId, imageryId, filename, buffer, mimeType, metadata = {} }) {
    if (!projectId || !imageryId || !filename || !buffer) {
      throw new Error('Missing required parameters for saveImage (projectId, imageryId, filename, buffer)');
    }

    const storageKey = this.buildStorageKey(projectId, imageryId, filename);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const blobStore = this.getBlobStore();

    if (blobStore) {
      try {
        await blobStore.set(storageKey, buf, {
          metadata: {
            projectId,
            imageryId,
            filename,
            mimeType: mimeType || 'image/jpeg',
            fileSize: buf.length,
            ...metadata
          }
        });
        console.log(`[StorageService] Persisted to Netlify Blobs: ${storageKey} (${buf.length} bytes)`);
      } catch (blobErr) {
        console.warn(`[StorageService] Netlify Blobs set failed, falling back to disk: ${blobErr.message}`);
        this._saveToLocalDisk(storageKey, buf);
      }
    } else {
      // Local disk fallback
      this._saveToLocalDisk(storageKey, buf);
      console.log(`[StorageService] Persisted to local disk: ${storageKey} (${buf.length} bytes)`);
    }

    const storageUrl = `/api/imagery/${imageryId}/file`;
    return {
      storage_key: storageKey,
      storage_url: storageUrl,
      file_size: buf.length,
      mime_type: mimeType || 'image/jpeg'
    };
  }

  /**
   * Save to local disk under uploads/ matching the storage key hierarchy.
   */
  static _saveToLocalDisk(storageKey, buffer) {
    const localPath = path.join(process.cwd(), 'uploads', storageKey);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, buffer);
    return localPath;
  }

  /**
   * Retrieve image buffer and metadata by storage key.
   */
  static async getImageBuffer(storageKey) {
    if (!storageKey) return null;

    const blobStore = this.getBlobStore();
    if (blobStore) {
      try {
        const { data, metadata } = await blobStore.getWithMetadata(storageKey, { type: 'arrayBuffer' });
        if (data) {
          return {
            buffer: Buffer.from(data),
            metadata: metadata || {}
          };
        }
      } catch (err) {
        console.warn(`[StorageService] Netlify Blobs get failed: ${err.message}`);
      }
    }

    // Check local disk fallback
    const localCandidates = [
      path.join(process.cwd(), 'uploads', storageKey),
      path.join(process.cwd(), storageKey),
      path.join(process.cwd(), 'uploads', path.basename(storageKey))
    ];

    for (const candidate of localCandidates) {
      if (fs.existsSync(candidate)) {
        const buffer = fs.readFileSync(candidate);
        return {
          buffer,
          metadata: { fileSize: buffer.length }
        };
      }
    }

    return null;
  }

  /**
   * Delete an image from storage by key.
   */
  static async deleteImage(storageKey) {
    if (!storageKey) return false;

    const blobStore = this.getBlobStore();
    if (blobStore) {
      try {
        await blobStore.delete(storageKey);
      } catch (err) {
        console.warn(`[StorageService] Netlify Blobs delete error: ${err.message}`);
      }
    }

    // Also remove local copy if present
    const localCandidates = [
      path.join(process.cwd(), 'uploads', storageKey),
      path.join(process.cwd(), 'uploads', path.basename(storageKey))
    ];
    for (const p of localCandidates) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    }

    return true;
  }

  // ==========================================================================
  // CHUNKED UPLOAD SUPPORT FOR LARGE ORTHOMOSAICS (> 4.5 MB)
  // ==========================================================================

  /**
   * Save a single chunk to the chunk staging store.
   */
  static async saveChunk({ sessionId, chunkIndex, buffer }) {
    const chunkKey = `chunks/${sessionId}/part_${String(chunkIndex).padStart(5, '0')}`;
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const blobStore = this.getBlobStore();

    if (blobStore) {
      try {
        await blobStore.set(chunkKey, buf);
        return { chunkKey, size: buf.length };
      } catch (err) {
        console.warn(`[StorageService] Chunk store to Blobs failed, saving to disk: ${err.message}`);
      }
    }

    // Local disk staging
    const chunkPath = path.join(process.cwd(), 'uploads', 'temp_chunks', sessionId, `part_${String(chunkIndex).padStart(5, '0')}`);
    const dir = path.dirname(chunkPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(chunkPath, buf);
    return { chunkKey, size: buf.length };
  }

  /**
   * Assemble all chunks into the final imagery file.
   */
  static async assembleChunks({ sessionId, totalChunks, projectId, imageryId, filename, mimeType, metadata = {} }) {
    const chunkBuffers = [];
    const blobStore = this.getBlobStore();

    for (let i = 0; i < totalChunks; i++) {
      const chunkKey = `chunks/${sessionId}/part_${String(i).padStart(5, '0')}`;
      let chunkData = null;

      if (blobStore) {
        try {
          const ab = await blobStore.get(chunkKey, { type: 'arrayBuffer' });
          if (ab) chunkData = Buffer.from(ab);
        } catch (e) {}
      }

      if (!chunkData) {
        const localPath = path.join(process.cwd(), 'uploads', 'temp_chunks', sessionId, `part_${String(i).padStart(5, '0')}`);
        if (fs.existsSync(localPath)) {
          chunkData = fs.readFileSync(localPath);
        }
      }

      if (!chunkData) {
        throw new Error(`Missing chunk ${i} of ${totalChunks} for upload session ${sessionId}`);
      }
      chunkBuffers.push(chunkData);
    }

    const fullBuffer = Buffer.concat(chunkBuffers);

    // Save final assembled image
    const result = await this.saveImage({
      projectId,
      imageryId,
      filename,
      buffer: fullBuffer,
      mimeType,
      metadata
    });

    // Cleanup chunks in background
    this._cleanupChunks(sessionId, totalChunks).catch(err => {
      console.warn(`[StorageService] Chunk cleanup warning: ${err.message}`);
    });

    return {
      ...result,
      buffer: fullBuffer
    };
  }

  /**
   * Clean up temporary chunks.
   */
  static async _cleanupChunks(sessionId, totalChunks) {
    const blobStore = this.getBlobStore();
    for (let i = 0; i < totalChunks; i++) {
      const chunkKey = `chunks/${sessionId}/part_${String(i).padStart(5, '0')}`;
      if (blobStore) {
        try { await blobStore.delete(chunkKey); } catch (e) {}
      }
    }
    const localDir = path.join(process.cwd(), 'uploads', 'temp_chunks', sessionId);
    if (fs.existsSync(localDir)) {
      try { fs.rmSync(localDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  /**
   * Ensure an image is accessible as a Buffer or local file for CV/ML processing.
   */
  static async ensureLocalBuffer(imagery) {
    if (!imagery) return null;

    // 1. Try storage_key
    if (imagery.storage_key) {
      const stored = await this.getImageBuffer(imagery.storage_key);
      if (stored && stored.buffer) return stored.buffer;
    }

    // 2. Try file_url candidates
    const candidates = [
      imagery.file_url ? path.join(process.cwd(), imagery.file_url.replace(/^\//, '')) : null,
      imagery.file_url ? path.join(process.cwd(), 'uploads', path.basename(imagery.file_url)) : null,
      imagery.file_name ? path.join(process.cwd(), 'uploads', path.basename(imagery.file_name)) : null
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    }

    return null;
  }
}
