import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { db } from '../server/db/database.js';

async function render() {
  const projectId = 'proj_1789117650907';
  const imageryId = 'img_1789142537501_t33b';
  const parcels = db.getParcelsByProjectId(projectId, imageryId);
  const detections = db.getFeaturesByProjectId(projectId, imageryId);

  console.log(`Rendering ${parcels.length} parcels and ${detections.length} detections...`);

  const imagePath = path.join(process.cwd(), 'uploads', 'uav_1789142537371_2njj45.png');
  const buffer = fs.readFileSync(imagePath);

  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  console.log(`Image dimensions: ${width}x${height}`);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (width * y + x) << 2;
    const alpha = a / 255;
    data[idx] = Math.round(r * alpha + data[idx] * (1 - alpha));
    data[idx + 1] = Math.round(g * alpha + data[idx + 1] * (1 - alpha));
    data[idx + 2] = Math.round(b * alpha + data[idx + 2] * (1 - alpha));
  }

  function drawThickLine(x0, y0, x1, y1, r, g, b, thickness = 3) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;

    const half = Math.floor(thickness / 2);

    while (true) {
      for (let ox = -half; ox <= half; ox++) {
        for (let oy = -half; oy <= half; oy++) {
          setPixel(cx + ox, cy + oy, r, g, b, 255);
        }
      }
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  function drawDisk(cx, cy, radius, r, g, b) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          setPixel(cx + dx, cy + dy, r, g, b, 255);
        }
      }
    }
  }

  // Draw Roads (translucent blue)
  const roads = detections.filter(d => d.detection_type === 'ROAD' || d.feature_type === 'Road');
  roads.forEach(road => {
    const coords = road.geometry?.coordinates || [];
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      drawThickLine(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), 59, 130, 246, 5);
    }
  });

  // Draw Parcels
  parcels.forEach((p, idx) => {
    const coords = p.geometry?.coordinates?.[0] || [];
    if (!coords || coords.length === 0) return;

    const isAccepted = p.status === 'accepted' || p.candidate_status === 'ACCEPTED';
    // Emerald green for accepted, Amber orange for review
    const color = isAccepted ? [16, 185, 129] : [245, 158, 11];

    // Draw boundary line
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      drawThickLine(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), color[0], color[1], color[2], 4);
    }

    // Draw vertex handles on each vertex
    coords.forEach(([vx, vy], vIdx) => {
      // White disk with cyan border for vertex handles
      drawDisk(Math.round(vx), Math.round(vy), 5, 255, 255, 255);
      drawDisk(Math.round(vx), Math.round(vy), 3, 14, 165, 233);
    });

    // Draw anchor building outline in magenta
    const bldgs = (p.supporting_evidence?.buildings || []).map(bId => detections.find(d => d.id === bId)).filter(Boolean);
    bldgs.forEach(bldg => {
      const bCoords = bldg.geometry?.coordinates?.[0] || [];
      for (let i = 0; i < bCoords.length - 1; i++) {
        const [x0, y0] = bCoords[i];
        const [x1, y1] = bCoords[i + 1];
        drawThickLine(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), 236, 72, 153, 3);
      }
    });

    // Draw parcel centroid badge
    let cx = 0, cy = 0;
    coords.forEach(([x, y]) => { cx += x; cy += y; });
    cx = Math.round(cx / coords.length);
    cy = Math.round(cy / coords.length);

    drawDisk(cx, cy, 10, color[0], color[1], color[2]);
    drawDisk(cx, cy, 5, 255, 255, 255);
  });

  const outBuffer = PNG.sync.write(png);
  const outPath = 'C:\\Users\\princ\\.gemini\\antigravity-ide\\brain\\7f3d80fa-c0b6-44b1-b1b1-0f35461f2e75\\verification_workflow_verified.png';
  fs.writeFileSync(outPath, outBuffer);
  console.log(`Verification render saved successfully to ${outPath}`);
}

render().catch(console.error);
