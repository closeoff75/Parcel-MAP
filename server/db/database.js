/**
 * ParcelMap Spatially-Aware Database Store
 * Schema implementation for Projects, Imagery, DetectedFeatures, Parcels, Verification, and ProcessingJobs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GISEngine } from '../services/gisEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'parcelmap_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Seed Data for Wagholi East Agricultural & Settlement Zone
function getInitialSeed() {
  const users = [
    { id: 'usr_1', name: 'Dr. Sarah Lin', email: 'sarah.lin@geoparcel.ai', role: 'Admin', department: 'GIS Directorate' },
    { id: 'usr_2', name: 'Alex Morgan', email: 'alex.morgan@geoparcel.ai', role: 'Analyst', department: 'Cadastral Survey' },
    { id: 'usr_3', name: 'Vikram Mehta', email: 'vikram.mehta@geoparcel.ai', role: 'Surveyor', department: 'Field Operations' },
    { id: 'usr_4', name: 'Priya Sharma', email: 'priya.sharma@geoparcel.ai', role: 'Viewer', department: 'Quality & Audit' }
  ];

  const projects = [
    {
      id: 'proj_wagholi_demo',
      name: 'Wagholi East Agricultural & Settlement Zone',
      description: 'Rural parcel boundary demarcation using UAV drone orthomosaic imagery (GSD 2.8 cm/px), AI feature detection, and road-based spatial reasoning.',
      location: 'Wagholi, Pune District, Maharashtra, India',
      coordinates: [18.5818, 73.9875],
      project_type: 'Rural Cadastral Mapping',
      created_by: 'Alex Morgan',
      status: 'Verification',
      progress: 72,
      created_at: new Date('2026-08-28T09:00:00Z').toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  const imagery = [
    {
      id: 'img_wagholi_ortho',
      project_id: 'proj_wagholi_demo',
      file_name: 'wagholi_east_orthomosaic_uav_2026.tif',
      file_url: '/uploads/wagholi_east_ortho.jpg',
      file_size: '342 MB',
      resolution: '2.8 cm/pixel GSD',
      dimensions: '8192 x 6144 px',
      sensor: 'DJI Zenmuse P1 45MP Mechanical Shutter',
      flight_altitude: '120m AGL',
      capture_date: '2026-08-28',
      processing_status: 'Ready',
      metadata: {
        bands: 3,
        crs: 'EPSG:4326',
        overlap_forward: '80%',
        overlap_lateral: '75%',
        ground_control_points: 8
      }
    }
  ];

  // Base coordinates around Wagholi East: lat 18.5818, lng 73.9875
  // Detected Features: Roads, Buildings, Walls, Fences, Field Edges, Water
  const detectedFeatures = [
    // Roads
    {
      id: 'feat_rd_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Road',
      sub_type: 'Primary Highway',
      name: 'Wagholi-Kesnand Main Road (30m)',
      confidence: 0.98,
      source: 'AI Road Segmentation Model v3.2',
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.9830, 18.5845],
          [73.9855, 18.5835],
          [73.9880, 18.5828],
          [73.9910, 18.5820],
          [73.9940, 18.5812]
        ]
      }
    },
    {
      id: 'feat_rd_2',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Road',
      sub_type: 'Secondary Road',
      name: 'Settlement Access Lane North (12m)',
      confidence: 0.95,
      source: 'AI Road Segmentation Model v3.2',
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.9860, 18.5865],
          [73.9862, 18.5848],
          [73.9865, 18.5832]
        ]
      }
    },
    {
      id: 'feat_rd_3',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Road',
      sub_type: 'Secondary Road',
      name: 'Agricultural Canal Corridor Road (10m)',
      confidence: 0.93,
      source: 'AI Road Segmentation Model v3.2',
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.9890, 18.5862],
          [73.9888, 18.5842],
          [73.9885, 18.5826],
          [73.9882, 18.5805]
        ]
      }
    },
    {
      id: 'feat_rd_4',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Road',
      sub_type: 'Field Path',
      name: 'Farm Tractor Access Track',
      confidence: 0.88,
      source: 'AI Path Detector v2.1',
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.9835, 18.5815],
          [73.9860, 18.5810],
          [73.9882, 18.5805]
        ]
      }
    },

    // Buildings & Structures
    {
      id: 'feat_bld_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Building',
      confidence: 0.97,
      source: 'AI Building Footprint Model v4',
      geometry: {
        type: 'Polygon',
        coordinates: [[[73.9842, 18.5838], [73.9847, 18.5838], [73.9847, 18.5834], [73.9842, 18.5834], [73.9842, 18.5838]]]
      }
    },
    {
      id: 'feat_bld_2',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Building',
      confidence: 0.95,
      source: 'AI Building Footprint Model v4',
      geometry: {
        type: 'Polygon',
        coordinates: [[[73.9850, 18.5842], [73.9854, 18.5842], [73.9854, 18.5837], [73.9850, 18.5837], [73.9850, 18.5842]]]
      }
    },
    {
      id: 'feat_bld_3',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Building',
      confidence: 0.94,
      source: 'AI Building Footprint Model v4',
      geometry: {
        type: 'Polygon',
        coordinates: [[[73.9870, 18.5848], [73.9876, 18.5848], [73.9876, 18.5843], [73.9870, 18.5843], [73.9870, 18.5848]]]
      }
    },
    {
      id: 'feat_bld_4',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Building',
      confidence: 0.93,
      source: 'AI Building Footprint Model v4',
      geometry: {
        type: 'Polygon',
        coordinates: [[[73.9898, 18.5839], [73.9904, 18.5839], [73.9904, 18.5834], [73.9898, 18.5834], [73.9898, 18.5839]]]
      }
    },
    {
      id: 'feat_bld_5',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Building',
      confidence: 0.92,
      source: 'AI Building Footprint Model v4',
      geometry: {
        type: 'Polygon',
        coordinates: [[[73.9872, 18.5816], [73.9877, 18.5816], [73.9877, 18.5812], [73.9872, 18.5812], [73.9872, 18.5816]]]
      }
    },

    // Walls
    {
      id: 'feat_wl_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Wall',
      confidence: 0.89,
      source: 'AI Boundary Line Extractor',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9838, 18.5842], [73.9856, 18.5842]]
      }
    },
    {
      id: 'feat_wl_2',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Wall',
      confidence: 0.85,
      source: 'AI Boundary Line Extractor',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9868, 18.5852], [73.9868, 18.5834]]
      }
    },

    // Fences
    {
      id: 'feat_fnc_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Fence',
      confidence: 0.79,
      source: 'AI Boundary Line Extractor',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9878, 18.5855], [73.9898, 18.5852]]
      }
    },
    {
      id: 'feat_fnc_2',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Fence',
      confidence: 0.77,
      source: 'AI Boundary Line Extractor',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9842, 18.5822], [73.9860, 18.5820]]
      }
    },

    // Field Edges
    {
      id: 'feat_fe_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Field Edge',
      confidence: 0.86,
      source: 'AI Multi-Spectral Texture Segmentation',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9858, 18.5858], [73.9882, 18.5854]]
      }
    },
    {
      id: 'feat_fe_2',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Field Edge',
      confidence: 0.84,
      source: 'AI Multi-Spectral Texture Segmentation',
      geometry: {
        type: 'LineString',
        coordinates: [[73.9892, 18.5848], [73.9918, 18.5842]]
      }
    },

    // Water Canal
    {
      id: 'feat_wtr_1',
      project_id: 'proj_wagholi_demo',
      feature_type: 'Water',
      name: 'Mutha Right Bank Sub-Canal',
      confidence: 0.96,
      source: 'AI Hydrology Segmentation',
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.9830, 18.5862],
          [73.9860, 18.5860],
          [73.9895, 18.5856],
          [73.9935, 18.5850]
        ]
      }
    }
  ];

  // Helper to generate coordinates in a grid
  // 24 Parcels covering Wagholi East
  const rawParcels = [
    // ROW 1 (North, above highway)
    { id: 'PM-0001', coords: [[73.9832, 18.5860], [73.9858, 18.5858], [73.9856, 18.5842], [73.9832, 18.5845], [73.9832, 18.5860]], conf: 0.94, status: 'Human Verified', features: ['Road South (Wagholi-Kesnand)', 'Canal North', 'Stone Wall East'], review: { reviewer: 'Alex Morgan', action: 'Accepted', date: '2026-09-02T10:15:00Z', notes: 'Boundaries align perfectly with stone wall and highway shoulder.' } },
    { id: 'PM-0002', coords: [[73.9858, 18.5858], [73.9882, 18.5855], [73.9880, 18.5838], [73.9856, 18.5842], [73.9858, 18.5858]], conf: 0.92, status: 'Human Verified', features: ['Road South', 'Stone Wall West', 'Field Edge North'], review: { reviewer: 'Alex Morgan', action: 'Accepted', date: '2026-09-02T11:00:00Z', notes: 'Confirmed frontage with rural road.' } },
    { id: 'PM-0003', coords: [[73.9882, 18.5855], [73.9910, 18.5852], [73.9908, 18.5834], [73.9880, 18.5838], [73.9882, 18.5855]], conf: 0.91, status: 'Human Verified', features: ['Secondary Road West', 'Fence North', 'Highway South'], review: { reviewer: 'Vikram Mehta', action: 'Accepted', date: '2026-09-03T09:30:00Z', notes: 'Field surveyor verified boundary markers on east hedge.' } },
    { id: 'PM-0004', coords: [[73.9910, 18.5852], [73.9935, 18.5848], [73.9932, 18.5830], [73.9908, 18.5834], [73.9910, 18.5852]], conf: 0.74, status: 'Needs Review', features: ['Fence North', 'Irrigation Channel South', 'Road West (Partial)'], topologyIssue: 'Overlap with PM-0005 along eastern agricultural bund' },
    
    // Slight intentional overlap for QC: PM-0005 encroaches on PM-0004's eastern boundary
    { id: 'PM-0005', coords: [[73.9930, 18.5848], [73.9955, 18.5845], [73.9952, 18.5826], [73.9928, 18.5830], [73.9930, 18.5848]], conf: 0.68, status: 'Needs Review', features: ['Field Edge East', 'Tree Line North', 'Canal Access Track'], topologyIssue: 'Overlap of 0.03 ha with PM-0004' },
    
    // ROW 2 (Highway corridor)
    { id: 'PM-0006', coords: [[73.9832, 18.5845], [73.9856, 18.5842], [73.9854, 18.5828], [73.9830, 18.5830], [73.9832, 18.5845]], conf: 0.96, status: 'Human Verified', features: ['Highway North', 'Settlement Road East', 'Farm Building #1'], review: { reviewer: 'Alex Morgan', action: 'Accepted', date: '2026-09-04T14:20:00Z', notes: 'Residential structure footprint enclosed within perimeter.' } },
    { id: 'PM-0007', coords: [[73.9856, 18.5842], [73.9880, 18.5838], [73.9878, 18.5824], [73.9854, 18.5828], [73.9856, 18.5842]], conf: 0.93, status: 'AI Generated', features: ['Highway North', 'Secondary Road North-South', 'Building #2'] },
    
    // Intentional tiny gap between PM-0008 and PM-0009
    { id: 'PM-0008', coords: [[73.9880, 18.5838], [73.9902, 18.5835], [73.9900, 18.5820], [73.9878, 18.5824], [73.9880, 18.5838]], conf: 0.87, status: 'AI Generated', features: ['Highway North', 'Tractor Track South'], topologyIssue: 'Gap of 1.4m along eastern edge before PM-0009' },
    { id: 'PM-0009', coords: [[73.9905, 18.5835], [73.9928, 18.5830], [73.9925, 18.5816], [73.9903, 18.5820], [73.9905, 18.5835]], conf: 0.89, status: 'AI Generated', features: ['Highway North', 'Tractor Track South'] },
    { id: 'PM-0010', coords: [[73.9928, 18.5830], [73.9952, 18.5826], [73.9948, 18.5810], [73.9925, 18.5816], [73.9928, 18.5830]], conf: 0.85, status: 'AI Generated', features: ['Highway North', 'Field Edge East'] },

    // ROW 3 (Central Agricultural plots)
    { id: 'PM-0011', coords: [[73.9830, 18.5830], [73.9854, 18.5828], [73.9852, 18.5814], [73.9828, 18.5816], [73.9830, 18.5830]], conf: 0.95, status: 'AI Generated', features: ['Field Access Lane East', 'Wire Fence South'] },
    { id: 'PM-0012', coords: [[73.9854, 18.5828], [73.9878, 18.5824], [73.9875, 18.5810], [73.9852, 18.5814], [73.9854, 18.5828]], conf: 0.94, status: 'AI Generated', features: ['Secondary Road West', 'Stone Wall South', 'Building #5'] },
    { id: 'PM-0013', coords: [[73.9878, 18.5824], [73.9900, 18.5820], [73.9898, 18.5806], [73.9875, 18.5810], [73.9878, 18.5824]], conf: 0.92, status: 'AI Generated', features: ['Secondary Road North-South', 'Vegetated Hedgerow East'] },
    { id: 'PM-0014', coords: [[73.9903, 18.5820], [73.9925, 18.5816], [73.9922, 18.5802], [73.9900, 18.5806], [73.9903, 18.5820]], conf: 0.91, status: 'AI Generated', features: ['Tractor Path North', 'Field Edge East'] },
    { id: 'PM-0015', coords: [[73.9925, 18.5816], [73.9948, 18.5810], [73.9945, 18.5796], [73.9922, 18.5802], [73.9925, 18.5816]], conf: 0.88, status: 'AI Generated', features: ['Tree Line East', 'Field Bund South'] },

    // ROW 4 (Southern agricultural tracts)
    { id: 'PM-0016', coords: [[73.9828, 18.5816], [73.9852, 18.5814], [73.9850, 18.5800], [73.9825, 18.5802], [73.9828, 18.5816]], conf: 0.93, status: 'AI Generated', features: ['Wire Fence North', 'Tractor Track South'] },
    { id: 'PM-0017', coords: [[73.9852, 18.5814], [73.9875, 18.5810], [73.9872, 18.5796], [73.9850, 18.5800], [73.9852, 18.5814]], conf: 0.94, status: 'AI Generated', features: ['Tractor Track South', 'Secondary Road West'] },
    { id: 'PM-0018', coords: [[73.9875, 18.5810], [73.9898, 18.5806], [73.9895, 18.5792], [73.9872, 18.5796], [73.9875, 18.5810]], conf: 0.92, status: 'AI Generated', features: ['Access Road North-South', 'Hedgerow East'] },
    { id: 'PM-0019', coords: [[73.9900, 18.5806], [73.9922, 18.5802], [73.9920, 18.5788], [73.9895, 18.5792], [73.9900, 18.5806]], conf: 0.90, status: 'AI Generated', features: ['Agricultural Bund North', 'Irrigation Ditch South'] },
    { id: 'PM-0020', coords: [[73.9922, 18.5802], [73.9945, 18.5796], [73.9942, 18.5782], [73.9920, 18.5788], [73.9922, 18.5802]], conf: 0.86, status: 'AI Generated', features: ['Field Edge South', 'Vegetated Boundary East'] },

    // Additional Settlement & Peripheral plots
    { id: 'PM-0021', coords: [[73.9825, 18.5802], [73.9850, 18.5800], [73.9848, 18.5786], [73.9822, 18.5788], [73.9825, 18.5802]], conf: 0.91, status: 'AI Generated', features: ['Village Boundary Line', 'Canal Branch West'] },
    { id: 'PM-0022', coords: [[73.9850, 18.5800], [73.9872, 18.5796], [73.9870, 18.5782], [73.9848, 18.5786], [73.9850, 18.5800]], conf: 0.93, status: 'AI Generated', features: ['Settlement Track East', 'Farm Compound'] },
    { id: 'PM-0023', coords: [[73.9872, 18.5796], [73.9895, 18.5792], [73.9892, 18.5778], [73.9870, 18.5782], [73.9872, 18.5796]], conf: 0.62, status: 'Needs Review', features: ['Ambiguous Vegetated Hedge', 'Dense Canopy Obscuring Corner'], topologyIssue: 'Low confidence due to tree canopy shadow over southern vertex' },
    
    // Micro-sliver candidate for QC demonstration: PM-0024
    { id: 'PM-0024', coords: [[73.9902, 18.5835], [73.9905, 18.5835], [73.9903, 18.5820], [73.9900, 18.5820], [73.9902, 18.5835]], conf: 0.45, status: 'Rejected', features: ['Sliver artifact along tractor path corridor'], topologyIssue: 'Tiny sliver polygon (< 45 m²) generated by misaligned snap tolerance' }
  ];

  // Calculate polygon areas approximately: 1 deg lat ~ 111,000m, 1 deg lng ~ 105,000m
  const parcels = rawParcels.map(p => {
    let areaSqm = 0;
    const coords = p.coords;
    const n = coords.length;
    for (let i = 0; i < n - 1; i++) {
      const x1 = coords[i][0] * 105000;
      const y1 = coords[i][1] * 111000;
      const x2 = coords[i + 1][0] * 105000;
      const y2 = coords[i + 1][1] * 111000;
      areaSqm += (x1 * y2 - x2 * y1);
    }
    areaSqm = Math.abs(areaSqm / 2);
    const areaHectares = Number((areaSqm / 10000).toFixed(2));
    const areaAcres = Number((areaSqm / 4046.86).toFixed(2));

    return {
      id: p.id,
      project_id: 'proj_wagholi_demo',
      parcel_id: p.id,
      geometry: {
        type: 'Polygon',
        coordinates: [p.coords]
      },
      area_sqm: Math.round(areaSqm),
      area_hectares: areaHectares,
      area_acres: areaAcres,
      confidence: p.conf,
      confidence_label: p.conf >= 0.90 ? 'High' : (p.conf >= 0.70 ? 'Medium' : 'Low'),
      status: p.status,
      supporting_features: p.features,
      source: 'Road-Based Spatial Reasoning v2.4 + AI Feature Fusion',
      topology_issue: p.topologyIssue || null,
      created_at: new Date('2026-08-29T11:00:00Z').toISOString(),
      updated_at: new Date().toISOString()
    };
  });

  const verifications = [
    {
      id: 'ver_1',
      parcel_id: 'PM-0001',
      reviewer_id: 'usr_2',
      reviewer_name: 'Alex Morgan',
      action: 'Accepted',
      comments: 'Preliminary boundaries align with stone wall on the east and highway clearance on south. Verified with ground survey markers.',
      original_geometry: parcels[0].geometry,
      edited_geometry: parcels[0].geometry,
      timestamp: '2026-09-02T10:15:00Z'
    },
    {
      id: 'ver_2',
      parcel_id: 'PM-0002',
      reviewer_id: 'usr_2',
      reviewer_name: 'Alex Morgan',
      action: 'Accepted',
      comments: 'Road frontage matches Cadastral Sheet #14 village access.',
      original_geometry: parcels[1].geometry,
      edited_geometry: parcels[1].geometry,
      timestamp: '2026-09-02T11:00:00Z'
    },
    {
      id: 'ver_3',
      parcel_id: 'PM-0003',
      reviewer_id: 'usr_3',
      reviewer_name: 'Vikram Mehta',
      action: 'Accepted',
      comments: 'Field officer verified stone cairn boundary points.',
      original_geometry: parcels[2].geometry,
      edited_geometry: parcels[2].geometry,
      timestamp: '2026-09-03T09:30:00Z'
    },
    {
      id: 'ver_4',
      parcel_id: 'PM-0006',
      reviewer_id: 'usr_2',
      reviewer_name: 'Alex Morgan',
      action: 'Accepted',
      comments: 'Residential structure enclosed; setback verified.',
      original_geometry: parcels[5].geometry,
      edited_geometry: parcels[5].geometry,
      timestamp: '2026-09-04T14:20:00Z'
    },
    {
      id: 'ver_5',
      parcel_id: 'PM-0024',
      reviewer_id: 'usr_2',
      reviewer_name: 'Alex Morgan',
      action: 'Rejected',
      comments: 'Identified as sliver polygon caused by tractor path tolerance gap. Removed from authoritative verified set.',
      original_geometry: parcels[23].geometry,
      edited_geometry: null,
      timestamp: '2026-09-05T16:00:00Z'
    }
  ];

  const processingJobs = [
    {
      id: 'job_upload_01',
      project_id: 'proj_wagholi_demo',
      job_type: 'IMAGERY_INGESTION',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[09:00:01] UAV orthomosaic wagholi_east_ortho.tif ingested (342 MB)',
        '[09:00:04] Pyramidal tile cache generated (Z12 - Z20)',
        '[09:00:05] Ground sampling distance verified: 2.8 cm/px'
      ],
      started_at: '2026-08-28T09:00:00Z',
      completed_at: '2026-08-28T09:00:06Z'
    },
    {
      id: 'job_detect_02',
      project_id: 'proj_wagholi_demo',
      job_type: 'AI_DETECTION',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[09:05:00] Initialized AI Feature Detection models',
        '[09:05:12] Detected 4 road network segments (confidence avg 94.5%)',
        '[09:05:25] Extracted 5 building footprints',
        '[09:05:38] Segmented 11 visible boundaries (walls, fences, field edges)',
        '[09:05:42] Completed hydrology layer segmentation'
      ],
      started_at: '2026-08-28T09:05:00Z',
      completed_at: '2026-08-28T09:05:45Z'
    },
    {
      id: 'job_reason_03',
      project_id: 'proj_wagholi_demo',
      job_type: 'ROAD_SPATIAL_REASONING',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[09:10:00] Cleaning and snapping road centerline vectors',
        '[09:10:04] Constructed topological road graph with 6 intersections',
        '[09:10:08] Partitioned study area into 5 primary road corridors',
        '[09:10:15] Fused boundary evidence (walls, fences, field bunds)',
        '[09:10:22] Generated 24 preliminary parcel candidates'
      ],
      started_at: '2026-08-28T09:10:00Z',
      completed_at: '2026-08-28T09:10:25Z'
    },
    {
      id: 'job_gis_04',
      project_id: 'proj_wagholi_demo',
      job_type: 'GIS_PROCESSING',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[09:12:00] Performing geometry cleaning and vertex deduplication',
        '[09:12:03] Closed 24 polygon rings',
        '[09:12:06] Executing topology quality control',
        '[09:12:08] Overlap audit: 1 overlap detected (PM-0004 & PM-0005: 0.03 ha)',
        '[09:12:10] Gap audit: 1 gap detected (PM-0008 & PM-0009: 1.4m)',
        '[09:12:11] Sliver audit: 1 sliver candidate flagged (PM-0024: 38 m²)',
        '[09:12:12] Assigned temporary parcel IDs PM-0001 through PM-0024'
      ],
      started_at: '2026-08-28T09:12:00Z',
      completed_at: '2026-08-28T09:12:15Z'
    }
  ];

  return {
    users,
    projects,
    imagery,
    detectedFeatures: detectedFeatures.map(f => ({ ...f, imagery_id: f.imagery_id || 'img_wagholi_ortho' })),
    parcels: parcels.map(p => ({ ...p, imagery_id: p.imagery_id || 'img_wagholi_ortho' })),
    verifications,
    processingJobs,
    parcel_versions: [],
    activities: []
  };
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

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      if (fs.existsSync(DB_FILE)) {
        this.lastMtime = fs.statSync(DB_FILE).mtimeMs;
      }
    } catch (err) {
      console.error('Failed to persist database to disk:', err);
    }
  }

  resetToDemo() {
    this.data = getInitialSeed();
    this.save();
    return this.data;
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
      user: activity.user || 'Alex Morgan (Lead Surveyor)',
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
      coordinates: proj.coordinates || [18.5818, 73.9875],
      project_type: proj.project_type || 'Rural Cadastral Mapping',
      created_by: proj.created_by || 'Alex Morgan',
      status: 'Created',
      progress: 0,
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
    const item = {
      id: img.id || `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      project_id: img.project_id,
      file_name: img.file_name,
      file_url: img.file_url,
      mime_type: img.mime_type || 'image/jpeg',
      file_size: img.file_size || '10 MB',
      width: Number(img.width) || 4000,
      height: Number(img.height) || 3000,
      resolution: img.resolution || '2.8 cm/pixel GSD',
      sensor: img.sensor || 'Drone RGB Sensor',
      flight_altitude: img.flight_altitude || '120m AGL',
      capture_date: img.capture_date || new Date().toISOString().split('T')[0],
      processing_status: img.processing_status || 'READY',
      created_at: img.created_at || new Date().toISOString(),
      metadata: img.metadata || {}
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

  // --- Parcels ---
  getParcelsByProjectId(projectId, imageryId = null) {
    this.reload();
    let list = this.data.parcels.filter(p => p.project_id === projectId && p.status !== 'Deleted');
    if (imageryId) {
      list = list.filter(p => p.imagery_id === imageryId);
    }
    return list;
  }
  getParcelById(parcelId, projectId = null) {
    this.reload();
    if (!parcelId) return null;
    if (projectId) {
      const p = this.data.parcels.find(x => (x.id === parcelId || x.parcel_id === parcelId) && x.project_id === projectId && x.status !== 'Deleted');
      if (p) return p;
    }
    // Search from newest to oldest so newly generated user parcels take precedence
    const p = this.data.parcels.slice().reverse().find(x => (x.id === parcelId || x.parcel_id === parcelId) && x.status !== 'Deleted');
    return p || null;
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
  updateParcel(parcelId, updates, projectId = null) {
    this.reload();
    const p = this.getParcelById(parcelId, projectId);
    if (!p) return null;
    Object.assign(p, updates, { updated_at: new Date().toISOString() });
    this.save();
    return p;
  }
  deleteParcel(parcelId, reviewerName = 'Alex Morgan', projectId = null) {
    this.reload();
    const p = this.getParcelById(parcelId, projectId);
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
    const versions = this.getParcelVersions(parcelId);
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
  addParcelVersion({ parcel_id, project_id, imagery_id, geometry, previous_geometry, edited_by, action, change_type, comments, remarks }) {
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
      action: standardAction,
      change_type: change_type || standardAction.toLowerCase().replace(/\s+/g, '_'),
      edited_by: edited_by || 'Alex Morgan (Lead Surveyor)',
      comments: comments || remarks || '',
      remarks: comments || remarks || '',
      timestamp: now,
      created_at: now
    };
    this.data.parcel_versions.push(versionItem);
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
      reviewer_id: ver.reviewer_id || 'usr_2',
      reviewer_name: ver.reviewer_name || 'Alex Morgan',
      action: ver.action, // 'Accepted', 'Edited', 'Rejected', 'Needs Review'
      comments: ver.comments || '',
      remarks: ver.comments || '',
      original_geometry: ver.original_geometry,
      edited_geometry: ver.edited_geometry || null,
      timestamp: new Date().toISOString()
    };
    this.data.verifications.push(item);

    // Update parcel status accordingly
    const parcel = this.getParcelById(ver.parcel_id);
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
        edited_by: ver.reviewer_name || 'Alex Morgan',
        action: ver.action,
        change_type: changeType,
        comments: ver.comments || ''
      });

      if (parcel.project_id) {
        this.logActivity(parcel.project_id, {
          title: `Parcel ${parcel.parcel_id || parcel.id} ${ver.action}`,
          description: ver.comments || `Demarcation ${ver.action.toLowerCase()} by ${ver.reviewer_name || 'Alex Morgan'}.`,
          type: ver.action.toLowerCase(),
          user: ver.reviewer_name || 'Alex Morgan'
        });
      }
    }

    this.save();
    return item;
  }

  setParcelStatus(parcelId, status, reviewerName = 'Alex Morgan', comments = '') {
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
}

export const db = new Database();
