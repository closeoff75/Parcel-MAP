/**
 * ParcelMap Backend Entry Point
 */

import { app } from './app.js';

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 ParcelMap GeoTech API Server running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🗺️ Demo Project: http://localhost:${PORT}/api/projects/proj_wagholi_demo`);
  console.log(`📐 Quality Audit: http://localhost:${PORT}/api/projects/proj_wagholi_demo/quality-control`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ [PORT CONFLICT] Port ${PORT} is already in use by another process.`);
    console.error(`👉 Running 'npm run clean' or 'npm run dev' will automatically release ports 3000 and 3001.\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

// Handle termination signals
process.on('SIGINT', () => {
  console.log('\nShutting down ParcelMap API server...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\nShutting down ParcelMap API server...');
  server.close(() => process.exit(0));
});
