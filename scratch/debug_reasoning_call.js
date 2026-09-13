import { RoadSpatialReasoningService } from '../server/services/roadSpatialReasoningService.js';
import { db } from '../server/db/database.js';

async function debugRun() {
  const projectId = 'proj_demo_coastal';
  const imagery = db.getImageryByProjectId(projectId)[0];
  const features = db.getFeaturesByProjectId(projectId, imagery.id);

  const roads = features.filter(f => f.feature_type === 'Road');
  const buildings = features.filter(f => f.feature_type === 'Building');
  const walls = features.filter(f => f.feature_type === 'Wall');
  const fences = features.filter(f => f.feature_type === 'Fence');
  const water = features.filter(f => (f.feature_type || '').toLowerCase().includes('water'));

  console.log('roads:', roads.length, 'buildings:', buildings.length, 'walls:', walls.length, 'fences:', fences.length);

  const res = RoadSpatialReasoningService.generateResidentialParcelsFromEvidence({
    projectId,
    imagery,
    detectionRunId: 'run_test',
    isGeoreferenced: false,
    imageWidth: 740,
    imageHeight: 480,
    centerLat: 18.9220,
    centerLng: 72.8347,
    geoDelta: 0.0035,
    roadGraph: { segments: [] },
    landBlocks: [],
    waterRings: water.map(w => w.geometry.coordinates[0]),
    evidence: {
      roads,
      buildings,
      walls,
      fences,
      boundaries: [...walls, ...fences]
    }
  });

  console.log('generateResidentialParcelsFromEvidence result count:', res.length);
}

debugRun().catch(console.error);
