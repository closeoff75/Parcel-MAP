import fs from 'fs';
import path from 'path';

// Coastal image dimensions (740 x 480)
const WIDTH = 740;
const HEIGHT = 480;

export function buildCoastalDemoDataset() {
  const projectId = 'proj_demo_coastal';
  const imageryId = 'img_demo_coastal';

  // 1. Users (system roles, no fake personal identities)
  const users = [
    {
      id: 'usr_gis_admin',
      name: 'GIS Administrator',
      email: 'admin@parcelmap.ai',
      role: 'Admin',
      department: 'Geospatial Engineering'
    },
    {
      id: 'usr_surveyor',
      name: 'Lead Cadastral Surveyor',
      email: 'surveyor@parcelmap.ai',
      role: 'Surveyor',
      department: 'Cadastral Verification Directorate'
    }
  ];

  // 2. Demo Project (isolated, is_demo = true)
  const project = {
    id: projectId,
    name: 'ParcelMap Demo — Coastal Settlement',
    description: 'AI-assisted parcel mapping demonstration using aerial imagery.',
    location: 'Coastal Bay Sector, Cadastral Block 4',
    coordinates: [18.9220, 72.8347],
    project_type: 'Coastal Cadastral Demonstration',
    created_by: 'ParcelMap System',
    status: 'Demo / Ready',
    progress: 75,
    is_demo: true,
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: new Date().toISOString()
  };

  // 3. Demo Imagery
  const imagery = {
    id: imageryId,
    project_id: projectId,
    file_name: 'coastal_settlement_demo.png',
    file_url: '/uploads/coastal_settlement_demo.png',
    mime_type: 'image/png',
    file_size: '705 KB',
    width: WIDTH,
    height: HEIGHT,
    resolution: '3.5 cm/pixel GSD',
    sensor: 'DJI Zenmuse P1 45MP UAV Orthomosaic',
    flight_altitude: '120m AGL',
    capture_date: '2026-09-01',
    processing_status: 'READY',
    is_demo: true,
    is_georeferenced: false,
    coordinate_mode: 'image-space',
    created_at: '2026-09-01T08:00:00.000Z',
    metadata: {
      crs: 'Image-Space / Local Cadastral Coordinate System',
      coordinate_mode: 'image-space',
      bands: 3,
      demo_dataset: true
    }
  };

  // 4. Detected Features (ML Detection vs CV-derived Evidence strictly distinguished)
  const detectedFeatures = [];
  let featCounter = 1;

  // 4.1 Water Body (CV-derived Shoreline / Spectral Mask)
  const waterCoords = [
    [0, 0], [0, 479], [501, 479], [497, 467], [481, 465], [463, 453],
    [450, 453], [428, 429], [423, 427], [417, 431], [408, 431], [401, 416],
    [405, 406], [405, 394], [415, 387], [423, 373], [431, 369], [432, 361],
    [454, 343], [452, 325], [458, 318], [458, 313], [443, 300], [431, 299],
    [415, 288], [372, 270], [365, 261], [354, 258], [349, 253], [345, 241],
    [332, 235], [332, 224], [324, 221], [317, 210], [322, 193], [302, 177],
    [287, 149], [268, 134], [267, 123], [262, 118], [256, 118], [246, 125],
    [239, 123], [232, 114], [226, 113], [218, 106], [217, 94], [208, 87],
    [150, 70], [133, 68], [123, 60], [114, 60], [104, 43], [85, 37],
    [49, 9], [34, 0], [0, 0]
  ];
  detectedFeatures.push({
    id: `feat_demo_water_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Water Body',
    sub_type: 'Coastal Bay / Ocean',
    name: 'Coastal Bay Water Exclusion Mask',
    confidence: 0.98,
    source: 'CV-derived Evidence (Spectral NDVI & Shoreline Edge Mask)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'Polygon', coordinates: [waterCoords] },
    image_coordinates: [waterCoords],
    created_at: '2026-09-01T08:02:00.000Z'
  });

  // 4.2 Roads (CV-derived Ridge Contrast & Morphological Tracing)
  const road1Coords = [[126, 19], [270, 76], [342, 155], [410, 203], [545, 372]];
  detectedFeatures.push({
    id: `feat_demo_rd_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Road',
    sub_type: 'Paved Corridor',
    name: 'North Coastal Ridge Road',
    confidence: 0.95,
    source: 'CV-derived Evidence (Ridge Contrast & Morphological Tracing)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'LineString', coordinates: road1Coords },
    image_coordinates: road1Coords,
    created_at: '2026-09-01T08:02:05.000Z'
  });

  const road2Coords = [[545, 372], [546, 402], [580, 440], [700, 460]];
  detectedFeatures.push({
    id: `feat_demo_rd_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Road',
    sub_type: 'Access Lane',
    name: 'South Coastal Settlement Lane',
    confidence: 0.92,
    source: 'CV-derived Evidence (Ridge Contrast & Morphological Tracing)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'LineString', coordinates: road2Coords },
    image_coordinates: road2Coords,
    created_at: '2026-09-01T08:02:08.000Z'
  });

  // 4.3 Field Boundaries (CV-derived Edge Contrast)
  const field1Coords = [
    [415, 20], [530, 20], [535, 140], [420, 140], [415, 20]
  ];
  detectedFeatures.push({
    id: `feat_demo_field_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Field',
    sub_type: 'Agricultural Holding',
    name: 'North-East Cultivated Plot',
    confidence: 0.89,
    source: 'CV-derived Evidence (Field Boundary Contrast)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'Polygon', coordinates: [field1Coords] },
    image_coordinates: [field1Coords],
    created_at: '2026-09-01T08:02:10.000Z'
  });

  // 4.4 Walls & Fences (CV-derived Bilateral Contrast)
  const wall1Coords = [[380, 160], [480, 160], [480, 260]];
  detectedFeatures.push({
    id: `feat_demo_wall_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Wall',
    sub_type: 'Stone Compound Barrier',
    name: 'Compound Wall (West Holding)',
    confidence: 0.91,
    source: 'CV-derived Evidence (Bilateral Gradient Contrast)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'LineString', coordinates: wall1Coords },
    image_coordinates: wall1Coords,
    created_at: '2026-09-01T08:02:12.000Z'
  });

  const fence1Coords = [[540, 210], [660, 210], [660, 310]];
  detectedFeatures.push({
    id: `feat_demo_fence_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Fence',
    sub_type: 'Perimeter Fence',
    name: 'Settlement Enclosure Fence',
    confidence: 0.87,
    source: 'CV-derived Evidence (Linear Boundary Filter)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'LineString', coordinates: fence1Coords },
    image_coordinates: fence1Coords,
    created_at: '2026-09-01T08:02:14.000Z'
  });

  // 4.5 Vegetation (CV-derived NDVI Tree Canopy)
  const vegCoords = [
    [280, 50], [350, 40], [360, 95], [310, 105], [280, 80], [280, 50]
  ];
  detectedFeatures.push({
    id: `feat_demo_veg_${featCounter++}`,
    project_id: projectId,
    imagery_id: imageryId,
    feature_type: 'Vegetation',
    sub_type: 'Tree Canopy & Green Buffer',
    name: 'Coastal Green Buffer',
    confidence: 0.88,
    source: 'CV-derived Evidence (NDVI Vegetative Contrast)',
    is_demo: true,
    is_valid: true,
    geometry: { type: 'Polygon', coordinates: [vegCoords] },
    image_coordinates: [vegCoords],
    created_at: '2026-09-01T08:02:16.000Z'
  });

  // 4.6 Buildings (ML Detection: YOLOv8 Instance Segmentation)
  const buildingSeeds = [
    { name: 'Homestead Structure #1', coords: [[665, 275], [695, 275], [695, 295], [665, 295], [665, 275]], conf: 0.88 },
    { name: 'Homestead Structure #2', coords: [[455, 110], [485, 110], [485, 130], [455, 130], [455, 110]], conf: 0.85 },
    { name: 'Farm Storage Outbuilding', coords: [[365, 55], [390, 55], [390, 75], [365, 75], [365, 55]], conf: 0.82 },
    { name: 'Residential House #4', coords: [[555, 285], [585, 285], [585, 310], [555, 310], [555, 285]], conf: 0.84 },
    { name: 'Residential House #5', coords: [[620, 235], [650, 235], [650, 255], [620, 255], [620, 235]], conf: 0.81 },
    { name: 'Settlement Facility #6', coords: [[595, 315], [630, 315], [630, 340], [595, 340], [595, 315]], conf: 0.80 }
  ];

  buildingSeeds.forEach(b => {
    detectedFeatures.push({
      id: `feat_demo_bldg_${featCounter++}`,
      project_id: projectId,
      imagery_id: imageryId,
      feature_type: 'Building',
      sub_type: 'Settlement Footprint',
      name: b.name,
      confidence: b.conf,
      source: 'ML Detection (YOLOv8 Aerial Segmentation)',
      is_demo: true,
      is_valid: true,
      geometry: { type: 'Polygon', coordinates: [b.coords] },
      image_coordinates: [b.coords],
      created_at: '2026-09-01T08:02:18.000Z'
    });
  });

  // 5. Spatially Reasoned Preliminary Parcels
  // Supported by roads, fields, walls, fences, land-block structure (NOT rectangles around buildings)
  const parcels = [
    {
      id: 'PM-DEMO-0001',
      parcel_id: 'PM-DEMO-0001',
      project_id: projectId,
      imagery_id: imageryId,
      detection_run_id: 'run_demo_coastal_01',
      is_demo: true,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [415, 20],
          [530, 20],
          [535, 140],
          [420, 140],
          [350, 150],
          [270, 76],
          [415, 20]
        ]]
      },
      image_coordinates: [[
        [415, 20],
        [530, 20],
        [535, 140],
        [420, 140],
        [350, 150],
        [270, 76],
        [415, 20]
      ]],
      geo_geometry: {
        type: 'Polygon',
        coordinates: [[
          [72.8335, 18.9230],
          [72.8355, 18.9230],
          [72.8356, 18.9215],
          [72.8336, 18.9215],
          [72.8322, 18.9213],
          [72.8308, 18.9223],
          [72.8335, 18.9230]
        ]]
      },
      area: 'Image-space preliminary area',
      area_sqm: null,
      area_hectares: null,
      area_acres: null,
      area_px: 24650,
      confidence: 0.91,
      confidence_label: 'High',
      status: 'preliminary',
      candidate_status: 'ACCEPTED',
      source: 'spatial_reasoning',
      generation_reason: 'Demarcated agricultural field parcel (feat_demo_field_4) within Northern Cadastral Block fronting North Coastal Ridge Road. Contains 1 homestead structure (context only).',
      supporting_evidence: {
        roads: ['feat_demo_rd_2'],
        road_names: ['North Coastal Ridge Road'],
        field_boundaries: ['feat_demo_field_4'],
        field_names: ['North-East Cultivated Plot'],
        walls_fences: ['feat_demo_wall_5'],
        wall_fence_names: ['Compound Wall (West Holding)'],
        buildings: ['feat_demo_bldg_8'],
        building_names: ['Homestead Structure #2 (Context Only)']
      },
      supporting_features: [
        'Road Corridor (North Coastal Ridge Road)',
        'Field Boundary (North-East Cultivated Plot)',
        'Compound Wall (West Holding)',
        'Homestead Structure #2 — Supporting Context'
      ],
      created_at: '2026-09-01T08:05:00.000Z',
      updated_at: '2026-09-01T08:05:00.000Z'
    },
    {
      id: 'PM-DEMO-0002',
      parcel_id: 'PM-DEMO-0002',
      project_id: projectId,
      imagery_id: imageryId,
      detection_run_id: 'run_demo_coastal_01',
      is_demo: true,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [420, 140],
          [535, 140],
          [670, 200],
          [670, 320],
          [545, 372],
          [410, 203],
          [420, 140]
        ]]
      },
      image_coordinates: [[
        [420, 140],
        [535, 140],
        [670, 200],
        [670, 320],
        [545, 372],
        [410, 203],
        [420, 140]
      ]],
      geo_geometry: {
        type: 'Polygon',
        coordinates: [[
          [72.8336, 18.9215],
          [72.8356, 18.9215],
          [72.8378, 18.9205],
          [72.8378, 18.9185],
          [72.8357, 18.9177],
          [72.8334, 18.9204],
          [72.8336, 18.9215]
        ]]
      },
      area: 'Image-space preliminary area',
      area_sqm: null,
      area_hectares: null,
      area_acres: null,
      area_px: 38200,
      confidence: 0.86,
      confidence_label: 'High',
      status: 'preliminary',
      candidate_status: 'ACCEPTED',
      source: 'spatial_reasoning',
      generation_reason: 'Cohesive residential settlement holding demarcated by Settlement Enclosure Fence and North Coastal Ridge Road corridor. Contains 3 settlement structures providing land-use evidence.',
      supporting_evidence: {
        roads: ['feat_demo_rd_2'],
        road_names: ['North Coastal Ridge Road'],
        field_boundaries: [],
        field_names: [],
        walls_fences: ['feat_demo_fence_6'],
        wall_fence_names: ['Settlement Enclosure Fence'],
        buildings: ['feat_demo_bldg_7', 'feat_demo_bldg_10', 'feat_demo_bldg_11'],
        building_names: ['Homestead Structure #1', 'Residential House #4', 'Residential House #5']
      },
      supporting_features: [
        'Road Corridor (North Coastal Ridge Road)',
        'Settlement Enclosure Fence',
        '3 Settlement Structures — Supporting Context'
      ],
      created_at: '2026-09-01T08:05:00.000Z',
      updated_at: '2026-09-01T08:05:00.000Z'
    },
    {
      id: 'PM-DEMO-0003',
      parcel_id: 'PM-DEMO-0003',
      project_id: projectId,
      imagery_id: imageryId,
      detection_run_id: 'run_demo_coastal_01',
      is_demo: true,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [545, 372],
          [670, 320],
          [710, 360],
          [700, 460],
          [580, 440],
          [546, 402],
          [545, 372]
        ]]
      },
      image_coordinates: [[
        [545, 372],
        [670, 320],
        [710, 360],
        [700, 460],
        [580, 440],
        [546, 402],
        [545, 372]
      ]],
      geo_geometry: {
        type: 'Polygon',
        coordinates: [[
          [72.8357, 18.9177],
          [72.8378, 18.9185],
          [72.8385, 18.9178],
          [72.8383, 18.9162],
          [72.8363, 18.9165],
          [72.8357, 18.9171],
          [72.8357, 18.9177]
        ]]
      },
      area: 'Image-space preliminary area',
      area_sqm: null,
      area_hectares: null,
      area_acres: null,
      area_px: 19400,
      confidence: 0.58,
      confidence_label: 'Low',
      status: 'Needs Review',
      candidate_status: 'REVIEW',
      source: 'spatial_reasoning',
      topology_issue: 'Proximity to coastal water exclusion boundary requires surveyor verification',
      generation_reason: 'Coastal settlement holding fronting South Coastal Settlement Lane. Flagged for review due to proximity to coastal water exclusion mask and transitional vegetation boundary.',
      supporting_evidence: {
        roads: ['feat_demo_rd_3'],
        road_names: ['South Coastal Settlement Lane'],
        field_boundaries: [],
        field_names: [],
        walls_fences: [],
        wall_fence_names: [],
        buildings: ['feat_demo_bldg_12'],
        building_names: ['Settlement Facility #6 (Context Only)']
      },
      supporting_features: [
        'Road Corridor (South Coastal Settlement Lane)',
        'Coastal Boundary Review Required',
        'Settlement Facility #6 — Supporting Context'
      ],
      created_at: '2026-09-01T08:05:00.000Z',
      updated_at: '2026-09-01T08:05:00.000Z'
    }
  ];

  // 6. Parcel version history
  const parcel_versions = parcels.map(p => ({
    id: `ver_${p.id}_v1`,
    parcel_id: p.id,
    project_id: projectId,
    imagery_id: imageryId,
    version: 1,
    version_number: 1,
    geometry: p.geometry,
    previous_geometry: null,
    action: 'Generated',
    change_type: 'generated',
    edited_by: 'Spatial Reasoning Engine',
    comments: 'Initial spatially derived parcel boundary',
    remarks: p.generation_reason,
    timestamp: '2026-09-01T08:05:00.000Z',
    created_at: '2026-09-01T08:05:00.000Z'
  }));

  // 7. Processing jobs
  const processingJobs = [
    {
      id: 'job_demo_upload',
      project_id: projectId,
      job_type: 'IMAGERY_INGESTION',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[08:00:01] UAV orthomosaic coastal_settlement_demo.png ingested (705 KB)',
        '[08:00:02] Sensor: DJI Zenmuse P1 45MP UAV Orthomosaic verified',
        '[08:00:03] Ground sampling distance verified: 3.5 cm/px GSD'
      ],
      started_at: '2026-09-01T08:00:00.000Z',
      completed_at: '2026-09-01T08:00:04.000Z'
    },
    {
      id: 'job_demo_detection',
      project_id: projectId,
      job_type: 'AI_DETECTION',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[08:02:00] Initialized AI & Computer Vision Feature Extraction models',
        '[08:02:05] Extracted 2 road corridors via Ridge Contrast & Morphological Tracing',
        '[08:02:08] Identified coastal water exclusion mask via Spectral NDVI shoreline analysis',
        '[08:02:12] Segmented 3 visible boundary markers (field boundaries, walls, fences)',
        '[08:02:16] Detected green vegetative canopy buffers',
        '[08:02:18] YOLOv8 Aerial model extracted 6 building footprints'
      ],
      started_at: '2026-09-01T08:02:00.000Z',
      completed_at: '2026-09-01T08:02:20.000Z'
    },
    {
      id: 'job_demo_reasoning',
      project_id: projectId,
      job_type: 'ROAD_SPATIAL_REASONING',
      status: 'COMPLETED',
      progress: 100,
      logs: [
        '[08:05:00] Building topological road graph and corridor partitions',
        '[08:05:05] Snapping road networks with physical boundary lines (walls, fences, field edges)',
        '[08:05:10] Applying coastal water exclusion mask to avoid water encroachment',
        '[08:05:15] Synthesized 2 cadastral land blocks',
        '[08:05:20] Generated 3 preliminary parcel candidates'
      ],
      started_at: '2026-09-01T08:05:00.000Z',
      completed_at: '2026-09-01T08:05:25.000Z'
    }
  ];

  return {
    users,
    projects: [project],
    imagery: [imagery],
    detectedFeatures,
    parcels,
    verifications: [],
    processingJobs,
    parcel_versions,
    activities: [
      {
        id: 'act_demo_1',
        project_id: projectId,
        title: 'Project Initialized',
        description: 'Coastal settlement cadastral demonstration project initialized.',
        type: 'created',
        user: 'ParcelMap System',
        timestamp: '2026-09-01T08:00:00.000Z'
      },
      {
        id: 'act_demo_2',
        project_id: projectId,
        title: 'Detections Extracted',
        description: 'AI & CV multi-spectral features successfully extracted from UAV imagery.',
        type: 'detection',
        user: 'AI Feature Engine',
        timestamp: '2026-09-01T08:02:20.000Z'
      },
      {
        id: 'act_demo_3',
        project_id: projectId,
        title: 'Spatial Reasoning Completed',
        description: '3 preliminary parcels synthesized from road network and boundary evidence.',
        type: 'reasoning',
        user: 'Spatial Reasoning Engine',
        timestamp: '2026-09-01T08:05:25.000Z'
      }
    ]
  };
}
