# GeoParcel.ai

**Smart Land Intelligence & GIS Parcel Platform**

A full-stack web application for interactive cadastral mapping, AI-powered land feature detection, road-based spatial reasoning, and human-in-the-loop parcel verification. Built with Vite, Leaflet.js, Three.js, and Express.js.

## Features

- **Interactive Cadastral Map** — Explore land parcels with boundaries, roads, buildings, water bodies, and POIs using Leaflet.js with multiple basemap options
- **Parcel Search & Filtering** — Search by plot number, survey number, owner name, or location with cascading state/district/taluka/village filters
- **AI Feature Detection** — YOLOv8n-seg based detection of roads, buildings, stone walls, fences, field edges, vegetation, and water canals from drone imagery
- **Road-Based Spatial Reasoning** — Uses detected road network as reference to infer preliminary parcel boundaries
- **GIS Quality Control** — Automated topology checks for gaps, overlaps, and sliver artifacts
- **Human Verification Workspace** — Surveyors can review, edit vertices, split/merge boundaries, and sign off verified maps
- **3D Cadastral Globe** — Three.js powered interactive globe with NASA satellite imagery, atmospheric clouds, and georeferenced parcel overlays
- **Satellite Comparison** — Interactive slider to compare multi-epoch aerial imagery (2021 vs 2026)
- **Change Detection Analytics** — AI-identified construction, vegetation, and land-use changes with confidence scores
- **Measurement Tools** — Distance, area, and draw-query tools on the map
- **Export Capabilities** — GeoJSON, CSV, PDF reports, and parcel coordinate export
- **Multi-Page Platform** — Landing page, map explorer, workspace, platform architecture, GIS layers, parcel intelligence, enterprise API docs, and industry solutions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6.2 |
| Frontend Maps | Leaflet.js 1.9 |
| 3D Globe | Three.js 0.185 |
| Spatial Analysis | Turf.js 7.2 |
| Backend | Express.js 4.21 |
| File Uploads | Multer |
| PDF Generation | PDFKit |
| Image Processing | PNG.js, JPEG.js |
| Fonts | Plus Jakarta Sans, JetBrains Mono |

## Project Structure

```
├── index.html              # Landing page with hero, search, 3D globe, workflow
├── map.html                # Main interactive cadastral map explorer
├── workspace.html          # AI detection → spatial reasoning → verification pipeline
├── platform.html           # Platform architecture & benchmarks
├── layers.html             # Interactive GIS layer stacker
├── intelligence.html       # Parcel intelligence dossier viewer
├── enterprise.html         # API documentation & sandbox
├── solutions.html          # Industry solutions & ROI calculator
├── login.html              # Authentication page
├── map-app.js              # CadastralMapEngine class (Leaflet)
├── map-data.js             # Cadastral plot data, location hierarchy, infrastructure
├── globe.js                # Three.js 3D satellite globe engine
├── workspace.js            # Workspace pipeline logic
├── gis-theme.css           # Shared design system & theme tokens
├── workspace.css           # Workspace-specific styles
├── map.css                 # Map explorer styles
├── vite.config.js          # Vite config with multi-page build & API proxy
├── server/
│   └── index.js            # Express API server (port 3001)
├── scripts/                # Utility scripts (port cleanup)
├── test_assets/            # Drone imagery samples for testing
├── uploads/                # User-uploaded UAV imagery
├── data/                   # Dataset files
├── public/                 # Static assets
└── package.json
```

## Getting Started

### Prerequisites

- Node.js >= 18
- npm

### Install

```bash
npm install
```

### Development

Runs both Vite dev server (port 3000) and Express API server (port 3001) concurrently:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

### Individual Servers

```bash
# Frontend only (Vite)
npm run dev:frontend

# Backend only (Express API)
npm run server
```

### Build

```bash
npm run build
npm run preview
```

### Tests

```bash
npm test
```

## API Server

The Express backend runs on port 3001 with the following endpoints:

- `GET /api/health` — Health check
- `GET /api/projects/:id` — Project data
- `GET /api/projects/:id/quality-control` — GIS quality audit
- `POST /api/upload` — Upload drone imagery (multipart/form-data)

Vite proxies `/api` and `/uploads` requests to the backend automatically.

## Pages

| Page | Description |
|------|-------------|
| `index.html` | Marketing landing page with 3D globe, workflow steps, feature cards |
| `map.html` | Interactive Leaflet map with 20 cadastral parcels, layers, filters, tools |
| `workspace.html` | 7-stage AI pipeline: Drone Imagery → Detection → Reasoning → Quality → Verify → Map → Report |
| `platform.html` | Distributed architecture specs and benchmark comparisons |
| `layers.html` | Interactive layer stacker (orthoimagery, LiDAR, FEMA, zoning, parcels) |
| `intelligence.html` | Parcel dossier viewer with chain-of-title, zoning, environmental screening |
| `enterprise.html` | API sandbox with cURL/Python/Node/Go code samples |
| `solutions.html` | Industry workflows for surveyors, brokers, energy developers, municipal GIS |
| `login.html` | Auth page with SSO options and demo access |

## Demo Dataset

The default dataset is the **Wagholi East Agricultural & Settlement Zone** (Pune District, Maharashtra) featuring:

- 20 cadastral parcels with full attribute records
- UAV orthomosaic imagery (2.8 cm/px GSD)
- Agricultural, NA, commercial, residential, industrial, and government land types
- Road network, buildings, water canals, railway, electricity lines, and POIs
- 7/12 cadastral records with owner names, survey numbers, and mutation entries

## License

Private project. All rights reserved.
