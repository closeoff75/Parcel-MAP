/**
 * ParcelMap Real Satellite Earth & Ocean 3D Planetary Engine
 * 
 * Powered by Three.js WebGL with Authentic NASA Satellite Imagery
 * Features:
 *   - Mathematically Precise Registry Node Alignment (Exact Lat/Lng Centering)
 *   - Real Earth Landmasses & Deep Blue Oceans (NASA Blue Marble 2048x1024)
 *   - Ocean Specular Sunlight Glint Mapping (Oceans reflect light, land is matte)
 *   - Atmospheric Drifting Cloud Layer (Independent rotating cloud sphere)
 *   - Sleek Rayleigh Scattering Atmospheric Fresnel Rim
 *   - Georeferenced Cadastral Parcel Polygons (#101, #102, #103, #104A)
 *   - Operational 3D Satellites (Sentinel-2 & Cartosat-3) with Sweeping Radar Swath
 *   - Curved 3D Geodetic Flight Arcs with Traveling Light Photons
 *   - Interactive 3D Survey Pins with Active Target Sonar Wave Rings
 *   - Exact Spherical Euler Fly-To Camera Navigation & Smooth Inertia Controls
 */

import * as THREE from 'three';

class RealSatelliteCadastralGlobe {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn('RealSatelliteCadastralGlobe: Container not found:', containerId);
      return;
    }

    // Clean container
    this.container.innerHTML = '';

    // Active Layers
    this.layers = {
      satellite: true,
      clouds: true,
      cadastre: true,
      radar: true
    };

    // Camera & Sphere Dimensions
    this.radius = 160;
    this.currentZoom = 1.0;
    this.targetZoom = 1.0;
    this.minZoom = 0.75;
    this.maxZoom = 2.4;
    this.entranceProgress = 0.0;

    // Cadastral Survey Hubs with High-Precision Coordinates
    this.hubs = [
      {
        id: 'pune',
        name: 'Wagholi Cadastre (Sheet #14)',
        region: 'Pune Haveli, Maharashtra, India',
        lat: 18.5793,
        lng: 73.9832,
        parcels: '20 Active Demo Parcels',
        totalRecords: '5,420 Survey Records (Sheet #14)',
        valuation: '₹ 18.4 Cr (₹4,800/sq.ft)',
        resolution: 'Sub-meter RTK (0.05m Accuracy)',
        isPrimary: true
      },
      {
        id: 'mumbai',
        name: 'Mumbai MMR Land Index',
        region: 'Maharashtra, India',
        lat: 19.0760,
        lng: 72.8777,
        parcels: '14,200 Cadastral Records',
        totalRecords: '14,200 Cadastral Records',
        valuation: '₹ 94.2 Cr (High Urban)',
        resolution: 'Urban DGPS Grid'
      },
      {
        id: 'delhi',
        name: 'Delhi NCR Land Registry',
        region: 'New Delhi, India',
        lat: 28.6139,
        lng: 77.2090,
        parcels: '9,800 Land Parcels',
        totalRecords: '9,800 Land Parcels',
        valuation: '₹ 62.8 Cr (Institutional)',
        resolution: 'Digital Revenue Sheet'
      },
      {
        id: 'bengaluru',
        name: 'Bengaluru Tech Corridor',
        region: 'Karnataka, India',
        lat: 12.9716,
        lng: 77.5946,
        parcels: '7,500 Survey Parcels',
        totalRecords: '7,500 Survey Parcels',
        valuation: '₹ 51.0 Cr (IT Park Zone)',
        resolution: 'Bhoomi Cadastre GIS'
      },
      {
        id: 'london',
        name: 'HM Land Registry (London)',
        region: 'Greater London, United Kingdom',
        lat: 51.5074,
        lng: -0.1278,
        parcels: 'Inspire Cadastre Base',
        totalRecords: 'Inspire Cadastre Base (OSGB36)',
        valuation: '£ 88.5M (Metropolitan Core)',
        resolution: 'Ordnance Survey (OSGB36)'
      },
      {
        id: 'sf',
        name: 'San Francisco Bay Area',
        region: 'California, USA',
        lat: 37.7749,
        lng: -122.4194,
        parcels: '11,200 Georeferenced Parcels',
        totalRecords: 'County Assessor Cadastral Grid',
        valuation: '$ 115M (Silicon Valley GIS Datum)',
        resolution: 'NAD83 California State Plane'
      },
      {
        id: 'singapore',
        name: 'Singapore SLA 3D Cadastre',
        region: 'Singapore',
        lat: 1.3521,
        lng: 103.8198,
        parcels: 'SVY21 Digital Twin',
        totalRecords: 'SVY21 Digital Twin',
        valuation: 'S$ 142M (High-Density)',
        resolution: 'High-Density 3D Mesh'
      }
    ];

    // Selected Active Hub
    this.selectedHub = this.hubs[0]; // Wagholi default

    // Calculate Exact Mathematical Startup Angle to Center on Wagholi
    const pInit = this.latLngToVector3(this.selectedHub.lat, this.selectedHub.lng, 0);
    this.rotY = Math.atan2(-pInit.x, pInit.z);
    this.rotX = Math.atan2(pInit.y, Math.hypot(pInit.x, pInit.z));
    this.targetRotY = this.rotY;
    this.targetRotX = this.rotX;

    this.autoRotate = false; // Stay centered on the selected hub initially
    this.rotationSpeed = 0.0022;
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };

    // Fly-To Animation State
    this.isFlying = false;
    this.flyStart = { rotY: 0, rotX: 0, zoom: 1.0 };
    this.flyTarget = { rotY: 0, rotX: 0, zoom: 1.0 };
    this.flyProgress = 0;
    this.flyDuration = 50;

    // Texture Loader
    this.textureLoader = new THREE.TextureLoader();

    // Setup Three.js Pipeline
    this.initThree();
    this.buildRealEarth();
    this.buildAtmosphericClouds();
    this.buildAtmosphereHalo();
    this.buildCadastralParcels();
    this.buildSurveyBeacons();
    this.buildGeodeticArcs();
    this.buildSatellitesAndRadar();
    this.buildDeepSpace();

    // Event Listeners & UI Binding
    this.bindEvents();
    this.bindUIControls();

    // Trigger initial hub UI update
    this.selectHub(this.selectedHub, false);

    // Start Master Render Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // Convert Spherical Coordinates (Lat, Lng) to 3D Cartesian Vector3
  latLngToVector3(lat, lng, radiusOffset = 0) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    const r = this.radius + radiusOffset;

    const x = -(r * Math.sin(phi) * Math.cos(theta));
    const z = (r * Math.sin(phi) * Math.sin(theta));
    const y = (r * Math.cos(phi));

    return new THREE.Vector3(x, y, z);
  }

  // Initialize Three.js Core Rig
  initThree() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || this.container.offsetWidth || 800;
    this.height = rect.height || this.container.offsetHeight || 540;

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(42, this.width / this.height, 1, 3000);
    this.camera.position.set(0, 0, 560);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // 4. Lighting Rig
    // Soft Ambient Light for Global Visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
    this.scene.add(ambientLight);

    // Main Sun Directional Light for Specular Sunlight Glints
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.position.set(380, 180, 420);
    this.scene.add(this.sunLight);

    // Subtle Cyan Rim Backlight for Limb Definition
    const rimLight = new THREE.DirectionalLight(0x06b6d4, 0.8);
    rimLight.position.set(-350, -120, -250);
    this.scene.add(rimLight);

    // 5. Globe Pivot Group (Handles User Drag Rotation)
    this.globeGroup = new THREE.Group();
    this.scene.add(this.globeGroup);

    // Set Initial Mathematically Accurate Centering Rotation
    this.globeGroup.rotation.y = this.rotY;
    this.globeGroup.rotation.x = this.rotX;

    // Raycasting & Interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.beaconMeshes = [];
  }

  // Build the Real Satellite Earth with NASA Imagery & Ocean Specular Glint
  buildRealEarth() {
    const geometry = new THREE.SphereGeometry(this.radius, 64, 64);

    const earthMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.15
    });

    // Load Real NASA Satellite Textures
    this.textureLoader.load(
      '/textures/earth_atmos.jpg',
      (tex) => {
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        earthMat.map = tex;
        earthMat.needsUpdate = true;
      },
      undefined,
      (err) => console.warn('Earth texture loading error:', err)
    );

    // Load Ocean Specular Mask
    this.textureLoader.load(
      '/textures/earth_specular.jpg',
      (specTex) => {
        specTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        earthMat.roughnessMap = specTex;
        earthMat.metalness = 0.35;
        earthMat.needsUpdate = true;
      },
      undefined,
      (err) => console.warn('Specular texture loading error:', err)
    );

    this.earthMesh = new THREE.Mesh(geometry, earthMat);
    this.globeGroup.add(this.earthMesh);
  }

  // Build Atmospheric Drifting Cloud Layer
  buildAtmosphericClouds() {
    const cloudGeo = new THREE.SphereGeometry(this.radius * 1.012, 64, 64);
    const cloudMat = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.textureLoader.load(
      '/textures/earth_clouds.png',
      (cloudTex) => {
        cloudTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        cloudMat.map = cloudTex;
        cloudMat.needsUpdate = true;
      },
      undefined,
      (err) => console.warn('Cloud texture loading error:', err)
    );

    this.cloudsMesh = new THREE.Mesh(cloudGeo, cloudMat);
    this.globeGroup.add(this.cloudsMesh);
  }

  // Build Sleek, Natural Atmospheric Rayleigh Scattering Halo
  buildAtmosphereHalo() {
    const vertexShader = `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec3 vNormal;
      void main() {
        // Natural thin atmospheric rim
        float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.8);
        gl_FragColor = vec4(0.06, 0.58, 0.85, 1.0) * intensity * 1.5;
      }
    `;

    const atmosphereGeo = new THREE.SphereGeometry(this.radius * 1.08, 48, 48);
    const atmosphereMat = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true
    });

    this.atmosphereMesh = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    this.scene.add(this.atmosphereMesh);
  }

  // Draped Cadastral Parcel Boundaries over Pune/Wagholi Sheet #14
  buildCadastralParcels() {
    this.cadastreGroup = new THREE.Group();

    // Authentically Draped Cadastral Plots (#101, #102, #103, #104A)
    const plots = [
      { id: '101', coords: [[18.62, 73.92], [18.66, 73.95], [18.63, 74.02], [18.59, 73.98]], color: 0x10b981 },
      { id: '102', coords: [[18.59, 73.98], [18.63, 74.02], [18.58, 74.08], [18.55, 74.03]], color: 0x06b6d4 },
      { id: '103', coords: [[18.55, 74.03], [18.58, 74.08], [18.53, 74.13], [18.50, 74.08]], color: 0x10b981 },
      { id: '104A', coords: [[18.66, 73.95], [18.70, 74.00], [18.67, 74.07], [18.63, 74.02]], color: 0x38bdf8 }
    ];

    plots.forEach(plot => {
      const points = plot.coords.map(c => this.latLngToVector3(c[0], c[1], 1.6));
      points.push(points[0]);

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: plot.color,
        linewidth: 2.5,
        transparent: true,
        opacity: 0.95
      });
      const line = new THREE.Line(geo, lineMat);
      this.cadastreGroup.add(line);
    });

    this.globeGroup.add(this.cadastreGroup);
  }

  // 3D Diamond Beacon Pins & Active Target Sonar Waves
  buildSurveyBeacons() {
    this.beaconsGroup = new THREE.Group();

    // Dynamic Target Sonar Pulse Ring (Moves to whichever hub is selected)
    const ringGeo = new THREE.RingGeometry(2, 5.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    this.activePulseRing = new THREE.Mesh(ringGeo, ringMat);
    const initialPos = this.latLngToVector3(this.selectedHub.lat, this.selectedHub.lng, 1.2);
    this.activePulseRing.position.copy(initialPos);
    this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
    this.beaconsGroup.add(this.activePulseRing);

    // Build Pin for Each Registry Node
    this.hubs.forEach(hub => {
      const surfacePos = this.latLngToVector3(hub.lat, hub.lng, 1.0);
      const pinHeadPos = this.latLngToVector3(hub.lat, hub.lng, hub.isPrimary ? 18 : 13);

      // 1. Vertical Stalk
      const stalkGeo = new THREE.BufferGeometry().setFromPoints([surfacePos, pinHeadPos]);
      const stalkMat = new THREE.LineBasicMaterial({
        color: hub.isPrimary ? 0x10b981 : 0x06b6d4,
        linewidth: 2.5
      });
      this.beaconsGroup.add(new THREE.Line(stalkGeo, stalkMat));

      // 2. Diamond Head Mesh
      const headGeo = new THREE.OctahedronGeometry(hub.isPrimary ? 5.2 : 3.8);
      const headMat = new THREE.MeshStandardMaterial({
        color: hub.isPrimary ? 0x10b981 : 0x06b6d4,
        emissive: hub.isPrimary ? 0x10b981 : 0x06b6d4,
        emissiveIntensity: 0.9,
        roughness: 0.1
      });
      const headMesh = new THREE.Mesh(headGeo, headMat);
      headMesh.position.copy(pinHeadPos);
      headMesh.userData = { hub: hub };
      this.beaconsGroup.add(headMesh);
      this.beaconMeshes.push(headMesh);
    });

    this.globeGroup.add(this.beaconsGroup);
  }

  // 3D Curved Geodetic Flight Arcs
  buildGeodeticArcs() {
    this.arcsGroup = new THREE.Group();
    const pune = this.hubs[0];
    const p1 = this.latLngToVector3(pune.lat, pune.lng, 1.0);

    const targets = [this.hubs[1], this.hubs[2], this.hubs[3], this.hubs[4], this.hubs[5]];
    this.arcPhotons = [];

    targets.forEach((hub, idx) => {
      const p2 = this.latLngToVector3(hub.lat, hub.lng, 1.0);

      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const dist = p1.distanceTo(p2);
      const arcHeight = Math.min(65, Math.max(28, dist * 0.32));
      mid.setLength(this.radius + arcHeight);

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const points = curve.getPoints(45);
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.38
      });
      this.arcsGroup.add(new THREE.Line(geo, mat));

      // Light Photon
      const photonGeo = new THREE.SphereGeometry(2.5, 12, 12);
      const photonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const photon = new THREE.Mesh(photonGeo, photonMat);
      this.arcsGroup.add(photon);

      this.arcPhotons.push({
        mesh: photon,
        curve: curve,
        progress: (idx * 0.2) % 1.0
      });
    });

    this.globeGroup.add(this.arcsGroup);
  }

  // Operational 3D Satellites & Sweeping Radar Cone
  buildSatellitesAndRadar() {
    this.satellitesGroup = new THREE.Group();

    // 1. Cartosat-3 Satellite with Solar Panels
    this.sat1 = this.createSatelliteMesh(0x06b6d4, 'Cartosat-3');
    this.sat1OrbitRadius = this.radius * 1.38;
    this.sat1Angle = 0;
    this.satellitesGroup.add(this.sat1);

    // 2. Active Radar Scan Cone (Sweeping from satellite to Earth surface)
    const coneGeo = new THREE.ConeGeometry(40, this.radius * 0.38, 32, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, -(this.radius * 0.19));

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide
    });
    this.radarCone = new THREE.Mesh(coneGeo, coneMat);
    this.sat1.add(this.radarCone);

    // 3. Sentinel-2 Satellite (MSI Cadastre)
    this.sat2 = this.createSatelliteMesh(0x10b981, 'Sentinel-2');
    this.sat2OrbitRadius = this.radius * 1.5;
    this.sat2Angle = 2.5;
    this.satellitesGroup.add(this.sat2);

    this.scene.add(this.satellitesGroup);
  }

  createSatelliteMesh(accentColor, label) {
    const group = new THREE.Group();

    const busGeo = new THREE.BoxGeometry(6, 6, 8);
    const busMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.8 });
    const bus = new THREE.Mesh(busGeo, busMat);
    group.add(bus);

    const wingGeo = new THREE.BoxGeometry(16, 0.6, 5);
    const wingMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.2, metalness: 0.6 });

    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-11, 0, 0);
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(11, 0, 0);
    group.add(rightWing);

    return group;
  }

  // Deep Space Starfield
  buildDeepSpace() {
    const starCount = 240;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 2200;
      starPositions[i + 1] = (Math.random() - 0.5) * 2200;
      starPositions[i + 2] = -500 - Math.random() * 800;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: 0.7 });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  // Select Registry Hub: Reposition Sonar Wave Ring & Update HUD
  selectHub(hub, doFly = true) {
    this.selectedHub = hub;

    // 1. Move Active Sonar Pulse Ring to this exact location on the sphere
    if (this.activePulseRing) {
      const surfacePos = this.latLngToVector3(hub.lat, hub.lng, 1.2);
      this.activePulseRing.position.copy(surfacePos);
      this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
      this.activePulseRing.scale.set(1.0, 1.0, 1.0);
      this.activePulseRing.material.opacity = 0.9;
    }

    // 2. Update UI Metadata
    this.updateActiveHubUI(hub);

    // 3. Update Coordinates in Top Left HUD
    const coordHud = document.getElementById('globeCoordHud');
    if (coordHud) {
      const latDir = hub.lat >= 0 ? '°N' : '°S';
      const lngDir = hub.lng >= 0 ? '°E' : '°W';
      coordHud.textContent = `GPS: ${Math.abs(hub.lat).toFixed(4)}${latDir}, ${Math.abs(hub.lng).toFixed(4)}${lngDir} • RTK WGS84`;
    }

    // 4. Update Quick-Jump Chip Active State
    document.querySelectorAll('.quick-jump-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.hub === hub.id);
    });

    // 5. Open Floating Tooltip for Selected Location
    this.displayHubTooltip(hub);

    // 6. Smooth Cinematic Camera Flight
    if (doFly) {
      this.flyTo(hub.lat, hub.lng, 1.45);
    }
  }

  // Mathematically Accurate Spherical Fly-To (Guarantees Dead Center Alignment)
  flyTo(lat, lng, targetZoom = 1.4) {
    this.autoRotate = false;
    this.isFlying = true;
    this.flyProgress = 0;

    // 1. Get exact 3D position of target on unrotated sphere
    const p = this.latLngToVector3(lat, lng, 0);

    // 2. Calculate exact target rotation angles to center P at (0, 0, +R)
    const targetY = Math.atan2(-p.x, p.z);
    const zPrime = Math.hypot(p.x, p.z);
    const targetX = Math.atan2(p.y, zPrime);

    // 3. Shortest angular path around Y
    let currentY = this.globeGroup.rotation.y;
    let deltaY = (targetY - currentY) % (Math.PI * 2);
    if (deltaY > Math.PI) deltaY -= Math.PI * 2;
    if (deltaY < -Math.PI) deltaY += Math.PI * 2;

    this.flyStart = {
      rotY: currentY,
      rotX: this.globeGroup.rotation.x,
      zoom: this.currentZoom
    };

    this.flyTarget = {
      rotY: currentY + deltaY,
      rotX: targetX,
      zoom: targetZoom
    };
  }

  zoomIn() {
    this.setZoom(Math.min(this.maxZoom, this.currentZoom + 0.25));
  }

  zoomOut() {
    this.setZoom(Math.max(this.minZoom, this.currentZoom - 0.25));
  }

  setZoom(val) {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, val));
    this.currentZoom = this.targetZoom;
    this.camera.position.z = 480 / this.currentZoom;
    this.updateZoomHud();
  }

  updateZoomHud() {
    const hud = document.getElementById('globeZoomHud');
    if (hud) {
      hud.textContent = `ZOOM: ${this.currentZoom.toFixed(1)}x • Real Satellite Earth`;
    }
  }

  // Layer Toggles
  toggleLayer(layerKey) {
    this.layers[layerKey] = !this.layers[layerKey];

    if (layerKey === 'satellite') {
      this.earthMesh.visible = this.layers.satellite;
    } else if (layerKey === 'clouds') {
      this.cloudsMesh.visible = this.layers.clouds;
    } else if (layerKey === 'cadastre') {
      this.cadastreGroup.visible = this.layers.cadastre;
      this.beaconsGroup.visible = this.layers.cadastre;
    } else if (layerKey === 'radar') {
      this.satellitesGroup.visible = this.layers.radar;
    }

    document.querySelectorAll('.globe-type-btn').forEach(btn => {
      if (btn.dataset.type === layerKey) {
        btn.classList.toggle('active', this.layers[layerKey]);
      }
    });
  }

  // Pointer & Touch Drag Events
  bindEvents() {
    const el = this.container;

    const onPointerDown = (e) => {
      this.isDragging = true;
      this.autoRotate = false;
      this.isFlying = false;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      this.lastPointer = { x: clientX, y: clientY };
    };

    const onPointerMove = (e) => {
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

      if (this.isDragging) {
        const dx = clientX - this.lastPointer.x;
        const dy = clientY - this.lastPointer.y;

        this.targetRotY += dx * 0.0055;
        this.targetRotX = Math.max(-0.85, Math.min(0.85, this.targetRotX + dy * 0.0055));

        this.velocity = { x: dx * 0.0055, y: dy * 0.0055 };
        this.lastPointer = { x: clientX, y: clientY };
      }

      // 3D Raycasting on Beacons
      const rect = el.getBoundingClientRect();
      this.mouse.x = ((clientX - rect.left) / this.width) * 2 - 1;
      this.mouse.y = -((clientY - rect.top) / this.height) * 2 + 1;

      this.checkHover();
    };

    const onPointerUp = () => {
      this.isDragging = false;
    };

    el.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    el.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);

    // Mouse Wheel Zoom
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }, { passive: false });

    // Click on Beacon to select and inspect
    el.addEventListener('click', () => {
      if (this.hoveredHub) {
        this.selectHub(this.hoveredHub, true);
      }
    });

    window.addEventListener('resize', () => {
      const rect = this.container.getBoundingClientRect();
      this.width = rect.width || this.container.offsetWidth || 800;
      this.height = rect.height || this.container.offsetHeight || 540;
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);
    });
  }

  // Bind UI Controls
  bindUIControls() {
    // 1. Layer Toggles
    document.querySelectorAll('.globe-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (type) this.toggleLayer(type);
      });
    });

    // 2. Quick Fly-To Destination Chips
    document.querySelectorAll('.quick-jump-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const hubId = chip.dataset.hub;
        if (hubId === 'global') {
          document.querySelectorAll('.quick-jump-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.flyTo(20, 77, 1.0);
          this.updateActiveHubUI({
            name: 'Global Satellite Earth',
            region: 'Real Land & Ocean Observations',
            totalRecords: 'NASA Blue Marble Datum'
          });
          const tooltip = document.getElementById('globeTooltip');
          if (tooltip) tooltip.style.display = 'none';
          return;
        }

        const hub = this.hubs.find(h => h.id === hubId);
        if (hub) {
          this.selectHub(hub, true);
        }
      });
    });

    // 3. Zoom Controls
    const btnZoomIn = document.getElementById('globeBtnZoomIn');
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => this.zoomIn());

    const btnZoomOut = document.getElementById('globeBtnZoomOut');
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => this.zoomOut());

    // 4. Play / Pause
    const btnToggle = document.getElementById('globeBtnToggleRotate');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        this.autoRotate = !this.autoRotate;
        btnToggle.textContent = this.autoRotate ? '⏸ Pause' : '▶ Rotate';
      });
    }

    // 5. Reset View
    const btnReset = document.getElementById('globeBtnResetView');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.selectHub(this.hubs[0], true);
      });
    }
  }

  updateActiveHubUI(hub) {
    const title = document.getElementById('globeNodeTitle');
    const sub = document.getElementById('globeNodeSub');
    const stat = document.getElementById('globeNodeStat');

    if (title) title.textContent = `📍 ${hub.name}`;
    if (sub) sub.textContent = `${hub.region}`;
    if (stat) stat.textContent = `${hub.totalRecords || hub.parcels}`;
  }

  // Display Rich Holographic Tooltip for Any Hub
  displayHubTooltip(hub) {
    const tooltip = document.getElementById('globeTooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
        <strong style="color:#ffffff; font-size:0.85rem;">📍 ${hub.name}</strong>
        <span style="font-size:0.65rem; padding:2px 6px; border-radius:4px; background:rgba(16,185,129,0.25); color:#10b981; font-weight:700;">${hub.isPrimary ? 'ACTIVE DEMO' : 'SELECTED NODE'}</span>
      </div>
      <div style="font-size:0.72rem; color:#94a3b8; line-height:1.4;">${hub.region}</div>
      <div style="margin: 6px 0; padding: 6px; background: rgba(15,23,42,0.65); border-radius: 4px; border: 1px solid rgba(255,255,255,0.08); font-size:0.7rem;">
        <div style="display:flex; justify-content:space-between; color:#e2e8f0; margin-bottom:3px;">
          <span>GPS Coordinates:</span>
          <strong style="color:#38bdf8;">${hub.lat.toFixed(4)}°N, ${Math.abs(hub.lng).toFixed(4)}°${hub.lng >= 0 ? 'E' : 'W'}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; color:#e2e8f0; margin-bottom:3px;">
          <span>Cadastral Records:</span>
          <strong style="color:#10b981;">${hub.parcels}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; color:#e2e8f0;">
          <span>Estimated Valuation:</span>
          <strong style="color:#fbbf24;">${hub.valuation}</strong>
        </div>
      </div>
      <div style="font-size:0.7rem; display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
        <span style="color:#10b981; font-weight:600;">Accuracy: ${hub.resolution}</span>
        <a href="map.html" style="color:#38bdf8; text-decoration:underline; font-weight:700;">Inspect Cadastre &rarr;</a>
      </div>
    `;
    tooltip.style.display = 'block';
  }

  // 3D Raycasting Hover Check
  checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.beaconMeshes, false);

    if (intersects.length > 0) {
      const hub = intersects[0].object.userData.hub;
      this.hoveredHub = hub;
      this.container.style.cursor = 'pointer';
      this.displayHubTooltip(hub);
    } else {
      this.hoveredHub = null;
      this.container.style.cursor = this.isDragging ? 'grabbing' : 'grab';
    }
  }

  // Master Three.js Animation Loop
  animate() {
    requestAnimationFrame(this.animate);

    // 0. Smooth Initial Camera Entrance Dolly (Gigabrain Ease)
    if (!this.isFlying && this.entranceProgress < 1.0) {
      this.entranceProgress += 0.016;
      if (this.entranceProgress >= 1.0) this.entranceProgress = 1.0;
      const t = this.entranceProgress;
      const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const targetCamZ = 480 / this.currentZoom;
      this.camera.position.z = 560 - (560 - targetCamZ) * ease;
    }

    // 1. Camera Fly-To Easing
    if (this.isFlying) {
      this.flyProgress++;
      const t = Math.min(1.0, this.flyProgress / this.flyDuration);
      const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

      this.globeGroup.rotation.y = this.flyStart.rotY + (this.flyTarget.rotY - this.flyStart.rotY) * ease;
      this.globeGroup.rotation.x = this.flyStart.rotX + (this.flyTarget.rotX - this.flyStart.rotX) * ease;
      this.targetRotY = this.globeGroup.rotation.y;
      this.targetRotX = this.globeGroup.rotation.x;

      this.currentZoom = this.flyStart.zoom + (this.flyTarget.zoom - this.flyStart.zoom) * ease;
      this.camera.position.z = 480 / this.currentZoom;
      this.updateZoomHud();

      if (t >= 1.0) {
        this.isFlying = false;
      }
    } else if (this.autoRotate) {
      // 2. Idle Planetary Rotation
      this.globeGroup.rotation.y += this.rotationSpeed;
      this.targetRotY = this.globeGroup.rotation.y;
    } else if (!this.isDragging) {
      // 3. Inertia Momentum Damping
      this.targetRotY += this.velocity.x;
      this.targetRotX = Math.max(-0.85, Math.min(0.85, this.targetRotX + this.velocity.y));
      this.velocity.x *= 0.94;
      this.velocity.y *= 0.94;

      this.globeGroup.rotation.y += (this.targetRotY - this.globeGroup.rotation.y) * 0.12;
      this.globeGroup.rotation.x += (this.targetRotX - this.globeGroup.rotation.x) * 0.12;
    } else {
      this.globeGroup.rotation.y = this.targetRotY;
      this.globeGroup.rotation.x = this.targetRotX;
    }

    // 4. Drifting Cloud Layer
    if (this.cloudsMesh && this.layers.clouds) {
      this.cloudsMesh.rotation.y += 0.00035;
    }

    // 5. Active Target Sonar Wave Ring on Selected Node
    if (this.activePulseRing) {
      this.activePulseRing.scale.addScalar(0.025);
      this.activePulseRing.material.opacity = Math.max(0, 1.0 - (this.activePulseRing.scale.x - 1.0) / 1.8);
      if (this.activePulseRing.scale.x > 2.8) {
        this.activePulseRing.scale.set(1.0, 1.0, 1.0);
        this.activePulseRing.material.opacity = 0.9;
      }
    }

    // 6. Traveling Photons along Geodetic Arcs
    this.arcPhotons.forEach(item => {
      item.progress = (item.progress + 0.007) % 1.0;
      const pt = item.curve.getPoint(item.progress);
      item.mesh.position.copy(pt);
    });

    // 7. Orbiting Satellites & Radar Beam Swaths
    this.sat1Angle += 0.012;
    this.sat1.position.set(
      Math.cos(this.sat1Angle) * this.sat1OrbitRadius,
      Math.sin(this.sat1Angle) * this.sat1OrbitRadius * 0.45,
      Math.sin(this.sat1Angle) * this.sat1OrbitRadius * 0.88
    );
    this.sat1.lookAt(new THREE.Vector3(0, 0, 0));

    this.sat2Angle += 0.015;
    this.sat2.position.set(
      Math.cos(this.sat2Angle) * this.sat2OrbitRadius * 0.85,
      Math.sin(this.sat2Angle) * this.sat2OrbitRadius * -0.5,
      Math.sin(this.sat2Angle) * this.sat2OrbitRadius
    );
    this.sat2.lookAt(new THREE.Vector3(0, 0, 0));

    // 8. Render Frame
    this.renderer.render(this.scene, this.camera);
  }
}

// Immediate Initialization
function initRealSatelliteGlobe() {
  if (!window.realSatelliteGlobeInstance) {
    window.realSatelliteGlobeInstance = new RealSatelliteCadastralGlobe('globeCanvasContainer');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRealSatelliteGlobe);
} else {
  initRealSatelliteGlobe();
}
