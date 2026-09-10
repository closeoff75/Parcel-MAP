/**
 * ParcelMap Express Server Application
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import apiRoutes from './routes/api.js';

export const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads folder
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'ParcelMap GeoTech Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    capabilities: [
      'Drone Imagery Ingestion (JPG, PNG, GeoTIFF)',
      'AI Feature Detection (Roads, Buildings, Linear Boundaries)',
      'Road-Based Spatial Reasoning',
      'GIS Topology & Quality Control Engine',
      'Human Verification & Boundary Vertex Editing',
      'Cadastral Audit Dossier & Legal Disclaimer Reporting'
    ]
  });
});

// Mount Main REST API
app.use('/api', apiRoutes);

// Serve root static frontend files (workspace.html, workspace.js, etc.)
app.use(express.static(process.cwd()));

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Server Error]:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});
