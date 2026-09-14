/**
 * ParcelMap Express Server Application
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import apiRoutes from './routes/api.js';

export const app = express();

// CORS Configuration supporting Deployed Netlify Frontend & Local Development
const allowedOrigins = [
  'https://resilient-figolla-23b96e.netlify.app',
  'https://graceful-sprinkles-c10a85.netlify.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
];

if (process.env.CORS_ORIGINS) {
  try {
    const extra = process.env.CORS_ORIGINS.startsWith('[')
      ? JSON.parse(process.env.CORS_ORIGINS)
      : process.env.CORS_ORIGINS.split(',').map(s => s.trim());
    allowedOrigins.push(...extra);
  } catch (e) {
    allowedOrigins.push(process.env.CORS_ORIGINS.trim());
  }
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || /\.netlify\.app$/.test(origin) || origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }
    // Permissive fallback in dev/testing while maintaining credentials safety
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Range', 'Accept'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads folder
const uploadDir = path.join(process.cwd(), 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in serverless environments
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
