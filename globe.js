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

    // Clean any old canvases if re-instantiating
    const oldCanvases = this.container.querySelectorAll('canvas');
    oldCanvases.forEach(c => c.remove());

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
    this.minZoom = 0.85;
    this.maxZoom = 2.55; // this.maxZoom = 2.75; this.maxZoom = 2.05; Safe camera limits: prevents extreme zoom clipping through globe surface (Section 6)
    this.entranceProgress = 0.0;
    this.screenMarkerEl = null;

    // Cadastral Survey Hubs with High-Precision Coordinates (Clean Land & GIS Nodes)
    this.hubs = [
      {
        id: 'pune',
        name: 'Wagholi Cadastre (Sheet #14)',
        region: 'Pune Haveli, Maharashtra, India',
        lat: 18.5793,
        lng: 73.9832,
        isPrimary: true
      },
      {
        id: 'mumbai',
        name: 'Mumbai MMR Land Index',
        region: 'Maharashtra, India',
        lat: 19.0760,
        lng: 72.8777
      },
      {
        id: 'delhi',
        name: 'Delhi NCR Land Registry',
        region: 'New Delhi, India',
        lat: 28.6139,
        lng: 77.2090
      },
      {
        id: 'bengaluru',
        name: 'Bengaluru Tech Corridor',
        region: 'Karnataka, India',
        lat: 12.9716,
        lng: 77.5946
      },
      {
        id: 'london',
        name: 'HM Land Registry (London)',
        region: 'Greater London, United Kingdom',
        lat: 51.5074,
        lng: -0.1278
      },
      {
        id: 'sf',
        name: 'San Francisco Bay Area',
        region: 'California, USA',
        lat: 37.7749,
        lng: -122.4194
      },
      {
        id: 'singapore',
        name: 'Singapore SLA 3D Cadastre',
        region: 'Singapore',
        lat: 1.3521,
        lng: 103.8198
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

    this.autoRotate = true; // Dynamically slowly rotating by default
    this.rotationSpeed = 0.0008; // Smooth, cinematic slow planetary rotation
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };

    // Fly-To Animation & Step 2 Camera State Machine
    this.isFlying = false;
    this.flyStart = { rotY: 0, rotX: 0, zoom: 1.0 };
    this.flyTarget = { rotY: 0, rotX: 0, zoom: 1.0 };
    this.flyProgress = 0;
    this.flyDuration = 140;

    // Camera States: 'IDLE' | 'LOCATING' | 'ARRIVING' | 'LOCATED' | 'ERROR'
    this.cameraState = 'IDLE';
    this.selectedParcel = null;
    this.selectedMarkerGroup = null;
    this.selectedHighlightLine = null;
    this.selectedFillMesh = null;
    this.parcelPickMeshes = [];
    this.hoveredParcel = null;
    this.isFocusMode = false;

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
    this.buildRoamingSatellite();
    this.buildDeepSpace();

    // Event Listeners & UI Binding
    this.bindEvents();
    this.bindUIControls();

    // Trigger initial hub UI update without opening tooltip
    this.selectHub(this.selectedHub, false, false);

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

    // Observe container bounds dynamically
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
          this.handleResize();
        }
      });
      this.resizeObserver.observe(this.container);
    }

    // Bind Screen-Space HTML Map Marker (Section 2 & 3)
    this.screenMarkerEl = document.getElementById('globeScreenParcelMarker');
    this.anchoredMarkerEl = document.getElementById('globeAnchoredParcelMarker');
    if (!this.screenMarkerEl && this.container) {
      this.screenMarkerEl = document.createElement('div');
      this.screenMarkerEl.id = 'globeScreenParcelMarker';
      this.screenMarkerEl.className = 'globe-screen-marker';
      this.screenMarkerEl.style.display = 'none';
      this.screenMarkerEl.innerHTML = `
        <div class="marker-pin-head">
          <span class="marker-pin-glyph">📍</span>
        </div>
        <div class="marker-label-badge">
          <div class="marker-label-title" id="screenMarkerTitle">PARCEL #101</div>
          <div class="marker-label-rule"></div>
          <div class="marker-label-sub" id="screenMarkerSub">Wagholi • Pune</div>
          <div class="marker-label-survey" id="screenMarkerSurvey">Survey 42/1</div>
        </div>
      `;
      this.container.appendChild(this.screenMarkerEl);
    }

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

    // Selected Parcel Highlight Group (Thick glow boundary + translucent fill + pin)
    this.selectedHighlightGroup = new THREE.Group();
    this.globeGroup.add(this.selectedHighlightGroup);

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
    this.parcelPickMeshes = [];

    // Authentically Draped Cadastral Plots (#101, #102, #103, #104A) with metadata
    const plots = [
      {
        id: '101',
        parcel_id: 'Plot #101',
        display_name: 'Parcel #101',
        parcelNumber: '101',
        surveyNumber: '42/1',
        survey_no: 'Survey 42/1',
        village: 'Wagholi',
        district: 'Pune',
        state: 'Maharashtra',
        area: '1.45 acres',
        landType: 'Agricultural',
        latitude: 18.625,
        longitude: 73.967,
        coords: [[18.62, 73.92], [18.66, 73.95], [18.63, 74.02], [18.59, 73.98]],
        color: 0x10b981,
        isDemo: true,
        map_url: 'map.html?mode=demo&parcel=plot-101&lat=18.58185&lng=73.981'
      },
      {
        id: '102',
        parcel_id: 'Plot #102',
        display_name: 'Parcel #102',
        parcelNumber: '102',
        surveyNumber: '42/2',
        survey_no: 'Survey 42/2',
        village: 'Wagholi',
        district: 'Pune',
        state: 'Maharashtra',
        area: '2.10 acres',
        landType: 'Agricultural',
        latitude: 18.588,
        longitude: 74.028,
        coords: [[18.59, 73.98], [18.63, 74.02], [18.58, 74.08], [18.55, 74.03]],
        color: 0x06b6d4,
        isDemo: true,
        map_url: 'map.html?mode=demo&parcel=plot-102&lat=18.582&lng=73.984'
      },
      {
        id: '103',
        parcel_id: 'Plot #103',
        display_name: 'Parcel #103',
        parcelNumber: '103',
        surveyNumber: '43/1',
        survey_no: 'Survey 43/1',
        village: 'Wagholi',
        district: 'Pune',
        state: 'Maharashtra',
        area: '1.80 acres',
        landType: 'Residential Non-Agri',
        latitude: 18.540,
        longitude: 74.080,
        coords: [[18.55, 74.03], [18.58, 74.08], [18.53, 74.13], [18.50, 74.08]],
        color: 0x10b981,
        isDemo: true,
        map_url: 'map.html?mode=demo&parcel=plot-103&lat=18.580&lng=73.986'
      },
      {
        id: '104A',
        parcel_id: 'Plot #104A',
        display_name: 'Parcel #104A',
        parcelNumber: '104A',
        surveyNumber: '43/2A',
        survey_no: 'Survey 43/2A',
        village: 'Wagholi',
        district: 'Pune',
        state: 'Maharashtra',
        area: '3.25 acres',
        landType: 'Industrial Corridor',
        latitude: 18.665,
        longitude: 74.010,
        coords: [[18.66, 73.95], [18.70, 74.00], [18.67, 74.07], [18.63, 74.02]],
        color: 0x38bdf8,
        isDemo: true,
        map_url: 'map.html?mode=demo&parcel=plot-104A&lat=18.58488&lng=73.98835'
      }
    ];

    plots.forEach(plot => {
      // Normal parcels: subtle boundary (Requirement 5)
      const points = plot.coords.map(c => this.latLngToVector3(c[0], c[1], 1.6));
      points.push(points[0]);

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: plot.color,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.45
      });
      const line = new THREE.Line(geo, lineMat);
      this.cadastreGroup.add(line);

      // Normal parcels: low-opacity fill + raycast pick mesh (Requirement 5 & 14)
      const fillPoints = plot.coords.map(c => this.latLngToVector3(c[0], c[1], 1.55));
      const fillGeo = new THREE.BufferGeometry().setFromPoints(fillPoints);
      const indices = [];
      for (let i = 1; i < fillPoints.length - 1; i++) {
        indices.push(0, i, i + 1);
      }
      fillGeo.setIndex(indices);
      fillGeo.computeVertexNormals();

      const fillMat = new THREE.MeshBasicMaterial({
        color: plot.color,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.userData = { parcel: plot };
      this.parcelPickMeshes.push(fillMesh);
      this.cadastreGroup.add(fillMesh);
    });

    this.globeGroup.add(this.cadastreGroup);
  }

  // 3D Diamond Beacon Pins & Active Target Sonar Waves
  buildSurveyBeacons() {
    this.beaconsGroup = new THREE.Group();

    // Dynamic Target Sonar Pulse Ring (Moves to whichever hub is selected)
    const ringGeo = new THREE.RingGeometry(1.2, 3.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    this.activePulseRing = new THREE.Mesh(ringGeo, ringMat);
    const initialPos = this.latLngToVector3(this.selectedHub.lat, this.selectedHub.lng, 1.2);
    this.activePulseRing.position.copy(initialPos);
    this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
    this.beaconsGroup.add(this.activePulseRing);

    // Build Pin for Each Registry Node
    this.hubs.forEach(hub => {
      const surfacePos = this.latLngToVector3(hub.lat, hub.lng, 1.0);
      const pinHeadPos = this.latLngToVector3(hub.lat, hub.lng, hub.isPrimary ? 3.5 : 2.5);

      // 1. Vertical Stalk
      const stalkGeo = new THREE.BufferGeometry().setFromPoints([surfacePos, pinHeadPos]);
      const stalkMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        linewidth: 1.5
      });
      this.beaconsGroup.add(new THREE.Line(stalkGeo, stalkMat));

      // 2. Diamond Head Mesh (Subtle background node)
      // headGeo = new THREE.OctahedronGeometry(hub.isPrimary ? 5.2 : 3.8);
      const headGeo = new THREE.OctahedronGeometry(hub.isPrimary ? 1.4 : 1.0);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        roughness: 0.2
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

  // Clean 3D Globe: Satellite & Radar telemetry clutter removed
  buildSatellitesAndRadar() {
    this.satellitesGroup = new THREE.Group();
    this.scene.add(this.satellitesGroup);
  }

  // Single Roaming Satellite in Low Earth Orbit with Toggle Control
  buildRoamingSatellite() {
    this.roamingSatelliteVisible = true;
    this.roamingOrbitAngle = 0;
    this.roamingOrbitRadius = 246; // Earth is 200, atmosphere is 208
    this.roamingOrbitSpeed = 0.0055;

    // Group for the orbital plane (inclined orbit at ~50° inclination like Sentinel/Landsat)
    this.roamingSatelliteGroup = new THREE.Group();
    this.roamingSatelliteGroup.rotation.x = Math.PI * 0.28; // ~50 deg inclination
    this.roamingSatelliteGroup.rotation.z = Math.PI * 0.15; // orbital node tilt

    // 1. Orbit Trajectory Ring (subtle cyan geodetic path)
    const orbitCurve = new THREE.EllipseCurve(
      0, 0,
      this.roamingOrbitRadius, this.roamingOrbitRadius,
      0, 2 * Math.PI,
      false,
      0
    );
    const orbitPoints = orbitCurve.getPoints(128);
    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(
      orbitPoints.map(p => new THREE.Vector3(p.x, 0, p.y))
    );
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35
    });
    this.roamingOrbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
    this.roamingSatelliteGroup.add(this.roamingOrbitLine);

    // 2. The Roaming Satellite Vehicle Mesh
    this.roamingSatellite = new THREE.Group();

    // Central Chassis (Titanium bus)
    const busGeo = new THREE.BoxGeometry(3.6, 2.6, 4.4);
    const busMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.75,
      roughness: 0.25
    });
    const busMesh = new THREE.Mesh(busGeo, busMat);
    this.roamingSatellite.add(busMesh);

    // Gold Foil Multi-Layer Insulation (MLI) payload module
    const mliGeo = new THREE.BoxGeometry(2.2, 1.8, 2.4);
    const mliMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.15
    });
    const mliMesh = new THREE.Mesh(mliGeo, mliMat);
    mliMesh.position.set(0, 0.6, 1.1);
    this.roamingSatellite.add(mliMesh);

    // Solar Array Panels (Dual wings extending along X axis)
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.3,
      metalness: 0.4,
      roughness: 0.3
    });
    const boomMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.3
    });

    // Left Solar Wing
    const leftBoomGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.8);
    const leftBoom = new THREE.Mesh(leftBoomGeo, boomMat);
    leftBoom.rotation.z = Math.PI / 2;
    leftBoom.position.set(-2.5, 0, 0);
    this.roamingSatellite.add(leftBoom);

    const leftPanelGeo = new THREE.BoxGeometry(7.2, 0.25, 2.6);
    const leftPanel = new THREE.Mesh(leftPanelGeo, panelMat);
    leftPanel.position.set(-7.0, 0, 0);
    this.roamingSatellite.add(leftPanel);

    // Right Solar Wing
    const rightBoom = new THREE.Mesh(leftBoomGeo, boomMat);
    rightBoom.rotation.z = Math.PI / 2;
    rightBoom.position.set(2.5, 0, 0);
    this.roamingSatellite.add(rightBoom);

    const rightPanel = new THREE.Mesh(leftPanelGeo, panelMat);
    rightPanel.position.set(7.0, 0, 0);
    this.roamingSatellite.add(rightPanel);

    // Earth-pointing Sensor / Dish Antenna
    const dishGeo = new THREE.ConeGeometry(1.6, 1.4, 16, 1, true);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.2,
      side: THREE.DoubleSide
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.x = Math.PI; // point downward toward Earth center
    dish.position.set(0, -1.6, 0);
    this.roamingSatellite.add(dish);

    // Optical Cadastre Sensor Lens
    const lensGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.6, 16);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.8
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(0, -1.8, 1.0);
    this.roamingSatellite.add(lens);

    // Telemetry Beacon LED (Subtle pulsing status indicator)
    const beaconGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    this.satelliteBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.satelliteBeacon.position.set(0, 1.6, -1.0);
    this.roamingSatellite.add(this.satelliteBeacon);

    // Initial position on orbit
    const r = this.roamingOrbitRadius;
    this.roamingSatellite.position.set(r, 0, 0);
    this.roamingSatelliteGroup.add(this.roamingSatellite);

    this.scene.add(this.roamingSatelliteGroup);
  }

  // Toggle roaming satellite visibility & orbit path
  toggleRoamingSatellite(forceState) {
    if (typeof forceState === 'boolean') {
      this.roamingSatelliteVisible = forceState;
    } else {
      this.roamingSatelliteVisible = !this.roamingSatelliteVisible;
    }
    if (this.roamingSatelliteGroup) {
      this.roamingSatelliteGroup.visible = this.roamingSatelliteVisible;
    }
    const btn = document.getElementById('globeBtnToggleSatellite');
    if (btn) {
      btn.textContent = this.roamingSatelliteVisible ? '🛰️ Satellite: ON' : '🛰️ Satellite: OFF';
      btn.classList.toggle('active', this.roamingSatelliteVisible);
      btn.setAttribute('aria-pressed', String(this.roamingSatelliteVisible));
    }
    return this.roamingSatelliteVisible;
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

  selectHub(hub, doFly = true, showTooltip = false) {
    if (window.parcelMapState && window.parcelMapState.viewMode !== 'globe') {
      window.parcelMapState.setViewMode('globe');
    }
    this.selectedHub = hub;

    // Clear any active parcel highlight and result card when navigating to a registry hub (Section 13)
    if (this.selectedParcel) {
      this.selectedParcel = null;
      this.clearHighlightGroup();
      this.hideParcelCard();
      if (this.screenMarkerEl) {
        this.screenMarkerEl.style.display = 'none';
      }
      this.setCameraState('IDLE');
      if (window.parcelMapState && window.parcelMapState.selectedParcel) {
        window.parcelMapState.selectedParcel = null;
      }
      window.dispatchEvent(new CustomEvent('parcelmap:cleared'));
    }

    if (this.screenMarkerEl) {
      this.screenMarkerEl.style.display = 'none';
    }
    if (this.anchoredMarkerEl) {
      this.anchoredMarkerEl.style.display = 'none';
    }
    if (this.arcsGroup) {
      this.arcsGroup.visible = true;
    }
    if (this.satellitesGroup) {
      this.satellitesGroup.visible = Boolean(this.layers && this.layers.radar);
    }
    if (this.beaconsGroup) {
      this.beaconsGroup.visible = Boolean(this.layers && this.layers.cadastre);
    }
    if (this.cadastreGroup) {
      this.cadastreGroup.visible = Boolean(this.layers && this.layers.cadastre);
    }
    if (this.beaconMeshes) {
      this.beaconMeshes.forEach(mesh => { mesh.visible = true; });
    }

    // 1. Move Active Sonar Pulse Ring to this exact location on the sphere
    if (this.activePulseRing) {
      this.activePulseRing.visible = true;
      const surfacePos = this.latLngToVector3(hub.lat, hub.lng, 1.2);
      this.activePulseRing.position.copy(surfacePos);
      this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
      this.activePulseRing.scale.set(1.0, 1.0, 1.0);
      this.activePulseRing.material.opacity = 0.7;
    }

    // 2. Update UI Metadata
    this.updateActiveHubUI(hub);

    // 3. Update Coordinates in Top Left HUD
    const coordHud = document.getElementById('globeCoordHud');
    if (coordHud) {
      const latDir = hub.lat >= 0 ? '°N' : '°S';
      const lngDir = hub.lng >= 0 ? '°E' : '°W';
      coordHud.textContent = `GPS: ${Math.abs(hub.lat).toFixed(4)}${latDir}, ${Math.abs(hub.lng).toFixed(4)}${lngDir}`;
    }

    // 4. Update Quick-Jump Chip Active State
    document.querySelectorAll('.quick-jump-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.hub === hub.id);
    });

    // 5. Open Floating Tooltip for Selected Location only if requested
    if (showTooltip) {
      this.displayHubTooltip(hub);
    } else {
      const tooltip = document.getElementById('globeTooltip');
      if (tooltip) tooltip.style.display = 'none';
    }

    // 6. Smooth Cinematic Camera Flight
    if (doFly) {
      this.flyTo(hub.lat, hub.lng, 1.45);
    }
  }

  // Step 2 Camera State Machine Dispatcher
  setCameraState(newState, parcel = this.selectedParcel) {
    this.cameraState = newState;
    window.dispatchEvent(new CustomEvent('parcelmap:camera-state', {
      detail: { state: newState, parcel: parcel }
    }));

    const modeLabel = document.getElementById('globeModeLabel');
    const pNum = parcel?.parcelNumber || (parcel?.parcel_id ? parcel.parcel_id.replace(/^Plot\s*#/i, '') : parcel?.id) || '';
    if (modeLabel) {
      if (newState === 'LOCATING') {
        modeLabel.textContent = `LOCATING PARCEL #${pNum}...`;
      } else if (newState === 'ARRIVING') {
        modeLabel.textContent = `APPROACHING PARCEL #${pNum}...`;
      } else if (newState === 'LOCATED') {
        modeLabel.textContent = `PARCEL #${pNum} LOCATED`;
      } else if (newState === 'ERROR') {
        modeLabel.textContent = `LOCATION UNAVAILABLE`;
      } else {
        modeLabel.textContent = `GLOBAL EARTH • ACTIVE`;
      }
    }
  }

  // Clear Selection Highlights & Markers
  clearHighlightGroup() {
    this.selectedHighlightLine = null;
    this.selectedFillMesh = null;
    this.selectedMarkerGroup = null;

    if (this.screenMarkerEl) {
      this.screenMarkerEl.style.display = 'none';
    }
    if (this.anchoredMarkerEl) {
      this.anchoredMarkerEl.style.display = 'none';
    } else {
      const aEl = document.getElementById('globeAnchoredParcelMarker');
      if (aEl) aEl.style.display = 'none';
    }

    if (this.selectedHighlightGroup) {
      while (this.selectedHighlightGroup.children.length > 0) {
        const obj = this.selectedHighlightGroup.children[0];
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        }
        this.selectedHighlightGroup.remove(obj);
      }
    }
  }

  // Create Professional 3D GIS Text Badge Sprite (Requirement 7)
  createParcelBadgeSprite(pNum) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Group();

    // Dark GeoTech Background Pill
    ctx.fillStyle = 'rgba(10, 16, 27, 0.94)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 64, 16);
    ctx.fill();
    ctx.stroke();

    // Text: 📍 PARCEL #${pNum}
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`📍 PARCEL #${pNum}`, 128, 36);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    // Proportional map pin size: tuned from legacy sprite.scale.set(10.0, 2.8, 1) down to compact (3.6, 1.05, 1)
    sprite.scale.set(3.6, 1.05, 1);
    return sprite;
  }

  // Display Notice for Missing/Invalid Coordinates (Requirements 16 & 17)
  displayUnavailableNotice(parcel) {
    const card = document.getElementById('globeParcelCard');
    if (!card) return;
    const pNum = parcel?.parcelNumber || parcel?.id || 'N/A';
    card.innerHTML = `
      <div class="parcel-card-header">
        <div class="parcel-card-badge-row">
          <span class="parcel-card-icon" style="color:#f59e0b;">⚠️</span>
          <span class="parcel-card-id">PARCEL #${pNum}</span>
          <span class="parcel-card-tag tag-demo" style="background:rgba(239,68,68,0.2);color:#ef4444;border-color:rgba(239,68,68,0.4);">UNAVAILABLE</span>
        </div>
        <button type="button" class="parcel-card-close" id="btnCardClose" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="parcel-card-body">
        <div style="padding:10px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#fca5a5; font-size:0.75rem; line-height:1.5;">
          <strong>Location unavailable:</strong> This parcel does not currently have geographic coordinates.
        </div>
      </div>
      <div class="parcel-card-actions">
        <button type="button" class="btn-card-reset" id="cardBtnReset" style="width:100%;" aria-label="Reset View">
          <span>↺ Reset View</span>
        </button>
      </div>
    `;
    card.classList.add('active');

    const btnClose = card.querySelector('#btnCardClose');
    if (btnClose) btnClose.addEventListener('click', () => this.hideParcelCard());
    const btnReset = card.querySelector('#cardBtnReset');
    if (btnReset) btnReset.addEventListener('click', () => this.resetView());
  }

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Display Cinematic Selected Parcel Information Card (Requirement 8 & 20)
  // Display Selected Parcel Information (Clean Land & GIS: all clutter/fake cards removed)
  displayParcelCard(parcel) {
    this.hideParcelCard();
  }

  hideParcelCard() {
    const card = document.getElementById('globeParcelCard');
    if (card) {
      card.classList.remove('active');
      card.style.display = 'none';
      card.innerHTML = '';
    }
  }

  // Step 4: Open Detailed Parcel Explorer Panel & Activate Parcel Focus Mode
  openParcelExplorer(parcel) {
    if (!parcel) {
      this.closeParcelExplorer();
      return;
    }

    this.isFocusMode = true;
    this.selectedParcel = parcel;

    // 1. Hide compact parcel card
    this.hideParcelCard();

    // 2. Center & Zoom closer in 3D (Focus Mode: zoom 2.15)
    const lat = parcel.latitude != null ? Number(parcel.latitude) : (parcel.coordinates ? Number(parcel.coordinates[0]) : null);
    const lng = parcel.longitude != null ? Number(parcel.longitude) : (parcel.coordinates ? Number(parcel.coordinates[1]) : null);
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      this.flyTo(lat, lng, 2.15, 75);
    }

    // 3. Dim unrelated parcels and emphasize selected parcel
    if (this.cadastreGroup) {
      this.cadastreGroup.children.forEach(child => {
        if (child.isLine && child.material) {
          child.material.opacity = 0.12;
        } else if (child.isMesh && child.material) {
          child.material.opacity = 0.02;
        }
      });
    }
    if (this.selectedHighlightLine && this.selectedHighlightLine.material) {
      this.selectedHighlightLine.material.opacity = 1.0;
      this.selectedHighlightLine.material.color.setHex(0x38bdf8);
    }
    if (this.selectedFillMesh && this.selectedFillMesh.material) {
      this.selectedFillMesh.material.opacity = 0.40;
      this.selectedFillMesh.material.color.setHex(0x10b981);
    }
    if (this.selectedMarkerGroup) {
      this.selectedMarkerGroup.scale.set(1.0, 1.0, 1.0);
      this.selectedMarkerGroup.visible = true;
    }

    // 4. Render Detailed Parcel Explorer Panel
    const explorer = document.getElementById('globeParcelExplorer');
    if (!explorer) return;

    const pNum = parcel.parcelNumber || (parcel.parcel_id ? String(parcel.parcel_id).replace(/^Plot\s*#/i, '').replace(/^Parcel\s*#/i, '') : parcel.id) || 'N/A';
    const sNum = parcel.surveyNumber || parcel.survey_no || 'N/A';
    const village = parcel.village || 'Wagholi';
    const district = parcel.district || 'Pune';
    const state = parcel.state || 'Maharashtra';
    const landType = parcel.landType || parcel.land_type || 'Agricultural';
    const area = parcel.area || (parcel.area_acres ? `${parcel.area_acres} acres` : (parcel.area_sqm ? `${parcel.area_sqm.toLocaleString()} sqm` : 'Area unavailable'));
    const isSearchMode = parcel.mode === 'search' || (window.parcelMapState && window.parcelMapState.mode === 'search');
    const isDemo = !isSearchMode && Boolean(parcel.isDemo || parcel.is_demo);
    
    // Status Badge determination
    let statusBadge = 'PRELIMINARY';
    let statusClass = 'tag-preliminary';
    const rawStatus = String(parcel.status || parcel.candidate_status || '').toLowerCase();
    if (isSearchMode) {
      statusBadge = 'PARCEL SEARCH RESULT';
      statusClass = 'tag-search-result';
    } else if (isDemo) {
      statusBadge = 'DEMO';
      statusClass = 'tag-demo';
    } else if (rawStatus.includes('verified') || parcel.is_verified) {
      statusBadge = 'VERIFIED';
      statusClass = 'tag-verified';
    } else if (rawStatus.includes('review') || rawStatus.includes('needs')) {
      statusBadge = 'NEEDS REVIEW';
      statusClass = 'tag-review';
    } else if (rawStatus.includes('rejected')) {
      statusBadge = 'REJECTED';
      statusClass = 'tag-rejected';
    }

    // Data Source
    let dataSource = 'Demo Dataset';
    if (isSearchMode) {
      dataSource = 'Parcel Search Result (Index Match)';
    } else if (!isDemo) {
      if (parcel.project_id) {
        dataSource = (statusBadge === 'VERIFIED') ? 'Verified Project Parcel' : 'AI Preliminary Parcel';
      } else {
        dataSource = 'Uploaded GIS Data';
      }
    }

    // Legal / Contextual Disclaimer
    let disclaimerText = '';
    if (isSearchMode) {
      disclaimerText = 'Dataset-based parcel visualization & registry record match.';
    } else if (isDemo) {
      disclaimerText = 'Demo dataset — not official cadastral information.';
    } else if (statusBadge === 'VERIFIED') {
      disclaimerText = 'Human verified against high-resolution UAV drone orthomosaic.';
    } else {
      disclaimerText = 'Preliminary AI/GIS interpretation. Requires human verification.';
    }

    // Coordinates display
    const hasValidCoords = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
    const coordsText = hasValidCoords
      ? `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`
      : 'Location coordinates unavailable for this parcel.';

    // Geometry display
    const hasGeometry = Array.isArray(parcel.boundary) && parcel.boundary.length >= 3;
    const geometryText = hasGeometry
      ? `Georeferenced Cadastral Polygon (${parcel.boundary.length} vertices)`
      : 'Parcel geometry unavailable — location marker shown.';

    // Nearby parcels list
    const nearbyPlots = this.getNearbyParcels(pNum);

    // Dynamic actions
    const finalMapUrl = parcel.map_url || `map.html?mode=demo&parcel=plot-${pNum}&lat=${lat || 18.58185}&lng=${lng || 73.981}`;
    const projectUrl = parcel.project_id ? `workspace.html?project=${encodeURIComponent(parcel.project_id)}&parcel=${encodeURIComponent(pNum)}` : null;
    const hasVerification = !isDemo && (parcel.verification_history || statusBadge === 'VERIFIED' || rawStatus.includes('verified'));
    const verificationUrl = hasVerification ? `workspace.html?project=${encodeURIComponent(parcel.project_id || 'proj_wagholi_demo')}#verification` : null;
    const reportUrl = parcel.project_id ? `/api/parcels/${encodeURIComponent(parcel.id)}/report` : null;

    explorer.innerHTML = `
      <div class="explorer-header">
        <div class="explorer-title-group">
          <span class="explorer-icon">📍</span>
          <div class="explorer-heading-wrap">
            <div class="explorer-title">PARCEL #${this.escapeHtml(pNum)}</div>
            <div class="explorer-subtitle">Survey ${this.escapeHtml(sNum)} &bull; ${this.escapeHtml(village)}, ${this.escapeHtml(district)}</div>
          </div>
        </div>
        <div class="explorer-header-actions">
          <span class="explorer-status-badge ${statusClass}">${statusBadge}</span>
          <button type="button" class="explorer-close-btn" id="btnExplorerClose" title="Back to Globe" aria-label="Close Parcel Explorer">&times;</button>
        </div>
      </div>

      <div class="explorer-body">
        <!-- Disclaimer / Data Source Banner -->
        <div class="explorer-disclaimer-box ${isDemo ? 'box-demo' : (statusBadge === 'VERIFIED' ? 'box-verified' : 'box-prelim')}">
          <div class="disclaimer-source"><strong>Source:</strong> ${this.escapeHtml(dataSource)}</div>
          <div class="disclaimer-note">${this.escapeHtml(disclaimerText)}</div>
        </div>

        <!-- Specs Grid -->
        <div class="explorer-section-title">CADASTRAL SPECIFICATIONS</div>
        <div class="explorer-specs-grid">
          <div class="spec-cell">
            <span class="spec-label">SURVEY NUMBER</span>
            <span class="spec-val font-mono">Survey ${this.escapeHtml(sNum)}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">LAND TYPE</span>
            <span class="spec-val">${this.escapeHtml(landType)}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">MEASURED AREA</span>
            <span class="spec-val font-highlight">${this.escapeHtml(area)}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">JURISDICTION</span>
            <span class="spec-val">${this.escapeHtml(district)}, ${this.escapeHtml(state)}</span>
          </div>
        </div>

        <!-- Geographic & Spatial Status -->
        <div class="explorer-section-title">GEOGRAPHIC &amp; SPATIAL DATA</div>
        <div class="explorer-meta-list">
          <div class="meta-row">
            <span class="meta-key">Coordinates:</span>
            <span class="meta-val ${hasValidCoords ? 'font-mono' : 'text-warning'}">${this.escapeHtml(coordsText)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-key">Geometry Status:</span>
            <span class="meta-val ${hasGeometry ? 'text-success' : 'text-warning'}">${this.escapeHtml(geometryText)}</span>
          </div>
          ${parcel.owner ? `
            <div class="meta-row">
              <span class="meta-key">Registered Owner:</span>
              <span class="meta-val">${this.escapeHtml(parcel.owner)}</span>
            </div>
          ` : ''}
          ${parcel.khataNo ? `
            <div class="meta-row">
              <span class="meta-key">Khata / Mutation:</span>
              <span class="meta-val font-mono">${this.escapeHtml(parcel.khataNo)}${parcel.mutationNo ? ' &bull; ' + this.escapeHtml(parcel.mutationNo) : ''}</span>
            </div>
          ` : ''}
          ${parcel.roadAccess ? `
            <div class="meta-row">
              <span class="meta-key">Road Access:</span>
              <span class="meta-val">${this.escapeHtml(parcel.roadAccess)}</span>
            </div>
          ` : ''}
          ${parcel.confidence ? `
            <div class="meta-row">
              <span class="meta-key">AI Confidence:</span>
              <span class="meta-val font-mono">${this.escapeHtml(parcel.confidence)}</span>
            </div>
          ` : ''}
        </div>

        <!-- Quick Actions -->
        <div class="explorer-section-title">QUICK ACTIONS</div>
        <div class="explorer-actions-grid">
          <button type="button" class="btn-explorer-action" id="explorerBtnCenter">
            <span>🎯 Center on Parcel</span>
          </button>
          <button type="button" class="btn-explorer-action" id="explorerBtnCopyCoords" ${!hasValidCoords ? 'disabled' : ''}>
            <span id="copyCoordsText">📋 Copy Coordinates</span>
          </button>
          <a href="${finalMapUrl}" class="btn-explorer-action btn-action-primary" target="_self">
            <span>🗺️ View on Final Map &rarr;</span>
          </a>
          ${projectUrl ? `
            <a href="${projectUrl}" class="btn-explorer-action" target="_self">
              <span>📁 Open Project &rarr;</span>
            </a>
          ` : ''}
          ${verificationUrl ? `
            <a href="${verificationUrl}" class="btn-explorer-action" target="_self">
              <span>✅ View Verification &rarr;</span>
            </a>
          ` : ''}
          ${reportUrl ? `
            <a href="${reportUrl}" class="btn-explorer-action" target="_blank">
              <span>📄 View Report</span>
            </a>
          ` : ''}
        </div>

        <!-- Nearby Parcels Section -->
        ${nearbyPlots.length > 0 ? `
          <div class="explorer-section-title">NEARBY ADJOINING PARCELS</div>
          <div class="explorer-nearby-chips">
            ${nearbyPlots.map(np => `
              <button type="button" class="nearby-chip-btn" data-nearby="${this.escapeHtml(np.parcelNumber)}">
                <span>#${this.escapeHtml(np.parcelNumber)}</span>
                <small>${this.escapeHtml(np.surveyNumber || '')}</small>
              </button>
            `).join('')}
          </div>
        ` : ''}

        <!-- Focus Layer Controls -->
        <div class="explorer-section-title">PARCEL LAYERS</div>
        <div class="explorer-layers-row">
          <button type="button" class="explorer-layer-btn ${this.layers.satellite ? 'active' : ''}" data-layer="satellite">
            <span>🛰️ Satellite</span>
          </button>
          <button type="button" class="explorer-layer-btn ${this.layers.cadastre ? 'active' : ''}" data-layer="cadastre">
            <span>📐 Cadastre</span>
          </button>
          <button type="button" class="explorer-layer-btn ${this.layers.clouds ? 'active' : ''}" data-layer="clouds">
            <span>☁️ Clouds</span>
          </button>
          <button type="button" class="explorer-layer-btn ${this.layers.radar ? 'active' : ''}" data-layer="radar">
            <span>📡 Radar</span>
          </button>
        </div>
      </div>

      <div class="explorer-footer">
        <button type="button" class="btn-explorer-back" id="btnExplorerBack">
          <span>&larr; Back to Globe</span>
        </button>
        <button type="button" class="btn-explorer-reset" id="btnExplorerReset">
          <span>↺ Reset View</span>
        </button>
      </div>
    `;

    explorer.classList.add('active');

    // Wire Listeners inside the panel
    const btnClose = explorer.querySelector('#btnExplorerClose');
    if (btnClose) btnClose.addEventListener('click', () => this.closeParcelExplorer());

    const btnBack = explorer.querySelector('#btnExplorerBack');
    if (btnBack) btnBack.addEventListener('click', () => this.closeParcelExplorer());

    const btnReset = explorer.querySelector('#btnExplorerReset');
    if (btnReset) btnReset.addEventListener('click', () => this.resetView());

    const btnCenter = explorer.querySelector('#explorerBtnCenter');
    if (btnCenter) btnCenter.addEventListener('click', () => this.centerOnParcel());

    const btnCopy = explorer.querySelector('#explorerBtnCopyCoords');
    if (btnCopy && hasValidCoords) {
      btnCopy.addEventListener('click', () => {
        const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            const label = explorer.querySelector('#copyCoordsText');
            if (label) {
              label.textContent = '✓ Copied!';
              setTimeout(() => { label.textContent = '📋 Copy Coordinates'; }, 1800);
            }
          });
        }
      });
    }

    // Nearby Parcel buttons
    explorer.querySelectorAll('.nearby-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nearbyNum = btn.dataset.nearby;
        if (nearbyNum) this.selectNearbyParcel(nearbyNum);
      });
    });

    // Layer toggle buttons
    explorer.querySelectorAll('.explorer-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layerKey = btn.dataset.layer;
        if (layerKey) {
          this.toggleLayer(layerKey);
          btn.classList.toggle('active', this.layers[layerKey]);
        }
      });
    });
  }

  // Close Parcel Explorer & Restore Normal Globe View
  closeParcelExplorer() {
    this.isFocusMode = false;
    const explorer = document.getElementById('globeParcelExplorer');
    if (explorer) {
      explorer.classList.remove('active');
    }

    // Restore standard cadastre styling
    if (this.cadastreGroup) {
      this.cadastreGroup.children.forEach(child => {
        if (child.isLine && child.material) {
          child.material.opacity = 0.45;
        } else if (child.isMesh && child.material) {
          child.material.opacity = 0.08;
        }
      });
    }

    this.hideParcelCard();
  }

  // Re-Center Camera on Selected Parcel
  centerOnParcel() {
    if (!this.selectedParcel) return;
    const lat = this.selectedParcel.latitude != null ? Number(this.selectedParcel.latitude) : (this.selectedParcel.coordinates ? Number(this.selectedParcel.coordinates[0]) : null);
    const lng = this.selectedParcel.longitude != null ? Number(this.selectedParcel.longitude) : (this.selectedParcel.coordinates ? Number(this.selectedParcel.coordinates[1]) : null);
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      this.flyTo(lat, lng, 2.15, 75);
    }
  }

  // Get Nearby/Adjoining Parcels
  getNearbyParcels(pNum) {
    const cleanNum = String(pNum).toUpperCase().replace(/^PLOT\s*#?/i, '').replace(/^PARCEL\s*#?/i, '');
    const knownAdjacencies = {
      '101': [
        { parcelNumber: '102', surveyNumber: '42/2' },
        { parcelNumber: '103', surveyNumber: '43/1' },
        { parcelNumber: '104A', surveyNumber: '43/2A' }
      ],
      '102': [
        { parcelNumber: '101', surveyNumber: '42/1' },
        { parcelNumber: '103', surveyNumber: '43/1' },
        { parcelNumber: '104A', surveyNumber: '43/2A' }
      ],
      '103': [
        { parcelNumber: '101', surveyNumber: '42/1' },
        { parcelNumber: '102', surveyNumber: '42/2' },
        { parcelNumber: '104A', surveyNumber: '43/2A' }
      ],
      '104A': [
        { parcelNumber: '103', surveyNumber: '43/1' },
        { parcelNumber: '104B', surveyNumber: '43/2B' },
        { parcelNumber: '105', surveyNumber: '44/1' },
        { parcelNumber: '101', surveyNumber: '42/1' }
      ],
      '108': [
        { parcelNumber: '107', surveyNumber: '45/1' },
        { parcelNumber: '109', surveyNumber: '46/1' },
        { parcelNumber: '104A', surveyNumber: '43/2A' }
      ]
    };

    if (knownAdjacencies[cleanNum]) {
      return knownAdjacencies[cleanNum];
    }

    return [
      { parcelNumber: '101', surveyNumber: '42/1' },
      { parcelNumber: '102', surveyNumber: '42/2' },
      { parcelNumber: '103', surveyNumber: '43/1' },
      { parcelNumber: '104A', surveyNumber: '43/2A' }
    ].filter(p => p.parcelNumber !== cleanNum).slice(0, 3);
  }

  // Select Nearby Parcel from Explore Panel
  selectNearbyParcel(pNum) {
    // Check if plot is in memory
    let found = null;
    if (this.parcelPickMeshes) {
      for (const mesh of this.parcelPickMeshes) {
        const p = mesh.userData?.parcel;
        if (p && (String(p.parcelNumber) === String(pNum) || String(p.id) === String(pNum))) {
          found = p;
          break;
        }
      }
    }

    if (found) {
      if (window.parcelMapState) {
        window.parcelMapState.setSelectedParcel(found, { scroll: false });
      } else {
        this.selectParcel(found, true);
      }
      this.openParcelExplorer(found);
    } else {
      fetch(`/api/parcels/search?q=${encodeURIComponent(pNum)}&limit=1`)
        .then(r => r.json())
        .then(data => {
          const res = (data.results || data.parcels || [])[0];
          if (res) {
            if (window.parcelMapState) {
              window.parcelMapState.setSelectedParcel(res, { scroll: false });
            } else {
              this.selectParcel(res, true);
            }
            this.openParcelExplorer(res);
          }
        })
        .catch(err => console.warn('Nearby parcel search error:', err));
    }
  }

  // Multi-Stage Cinematic Spherical Fly-To (2-4 seconds with orbital rotation + atmospheric descent)
  flyTo(lat, lng, targetZoom = 1.4, duration = 140) {
    this.isFlying = true;
    this.flyProgress = 0;

    // Check prefers-reduced-motion
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.flyDuration = prefersReducedMotion ? 18 : (duration || 140);

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

  // Select Specific Cadastral Parcel: Highlight Boundary, Center Camera, Show Info Panel (Step 1 & 2)
  selectParcel(parcel, doFly = true) {
    if (!parcel) return;
    this.selectedParcel = parcel;

    const lat = parcel.latitude != null ? Number(parcel.latitude) : (parcel.coordinates ? Number(parcel.coordinates[0]) : null);
    const lng = parcel.longitude != null ? Number(parcel.longitude) : (parcel.coordinates ? Number(parcel.coordinates[1]) : null);
    const isValidCoords = lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    // Clear previous selection highlights & markers immediately (Requirement 13)
    this.clearHighlightGroup();
    this.hideParcelCard();

    if (!isValidCoords) {
      this.setCameraState('ERROR', parcel);
      const coordHud = document.getElementById('globeCoordHud');
      if (coordHud) coordHud.textContent = 'Location coordinates unavailable for this parcel.';
      const nodeSub = document.getElementById('globeNodeSub');
      if (nodeSub) nodeSub.textContent = 'Location coordinates unavailable for this parcel.';
      this.displayUnavailableNotice(parcel);
      this.displayParcelTooltip(parcel, false);
      return;
    }

    // Set initial locating state
    this.setCameraState('LOCATING', parcel);

    // 1. Hide activePulseRing and background registry beacons so only the selected parcel is highlighted (Section 9 & 10)
    if (this.activePulseRing) {
      this.activePulseRing.visible = false;
    }
    if (this.beaconMeshes) {
      this.beaconMeshes.forEach(mesh => {
        mesh.visible = false;
      });
    }

    // Hide obstructive decorative objects during parcel search/selection (Step 3 Sections 1 & 16)
    if (this.arcsGroup) {
      this.arcsGroup.visible = false;
    }
    if (this.satellitesGroup) {
      this.satellitesGroup.visible = false;
    }
    if (this.beaconsGroup) {
      this.beaconsGroup.visible = false;
    }
    if (this.cadastreGroup) {
      this.cadastreGroup.visible = false;
    }

    // 2. Render 3D High-Contrast Boundary Outline (Subtle, Clean - Section 2 & 9)
    let boundaryCoords = parcel.boundary;
    if (!boundaryCoords && parcel.geometry) {
      if (parcel.geometry.type === 'Polygon' && Array.isArray(parcel.geometry.coordinates?.[0])) {
        boundaryCoords = parcel.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
      } else if (Array.isArray(parcel.geometry)) {
        boundaryCoords = parcel.geometry;
      }
    }
    if ((!boundaryCoords || boundaryCoords.length < 3) && parcel.parcelNumber) {
      const knownPlots = {
        '101': [[18.62, 73.92], [18.66, 73.95], [18.63, 74.02], [18.59, 73.98]],
        '102': [[18.59, 73.98], [18.63, 74.02], [18.58, 74.08], [18.55, 74.03]],
        '103': [[18.55, 74.03], [18.58, 74.08], [18.53, 74.13], [18.50, 74.08]],
        '104A': [[18.66, 73.95], [18.70, 74.00], [18.67, 74.07], [18.63, 74.02]]
      };
      const cleanKey = String(parcel.parcelNumber).toUpperCase();
      boundaryCoords = knownPlots[cleanKey];
    }

    if (boundaryCoords && boundaryCoords.length >= 3 && this.selectedHighlightGroup) {
      // 2a. Boundary Line (Subtle Cyan Outline)
      const points = boundaryCoords.map(c => this.latLngToVector3(c[0], c[1], 1.5));
      points.push(points[0]); // close polygon

      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        linewidth: 2.0,
        transparent: true,
        opacity: 0.95
      });
      const highlightLine = new THREE.Line(lineGeo, lineMat);
      this.selectedHighlightLine = highlightLine;
      this.selectedHighlightGroup.add(highlightLine);
    }

    // 2c. Elevated 3D GIS Location Marker Anchor (Stalk + Beacon + 3D Text Badge - Section 7 & 8)
    this.selectedMarkerGroup = new THREE.Group();
    const pinSurface = this.latLngToVector3(lat, lng, 1.2);
    // Pin elevation: tuned from space-view pinHead = this.latLngToVector3(lat, lng, 10.0) to compact 3.6 units
    const pinHead = this.latLngToVector3(lat, lng, 3.6);

    const stalkGeo = new THREE.BufferGeometry().setFromPoints([pinSurface, pinHead]);
    const stalkMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2.0 });
    this.selectedMarkerGroup.add(new THREE.Line(stalkGeo, stalkMat));

    // Professional map pin beacon head: compact 1.1-unit octahedron (tuned from OctahedronGeometry(4.5) to OctahedronGeometry(2.4) to 1.1)
    const headGeo = new THREE.OctahedronGeometry(1.1);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.0,
      roughness: 0.1
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.copy(pinHead);
    this.selectedMarkerGroup.add(headMesh);

    // Dynamic 3D Badge Sprite
    const pNum = parcel.parcelNumber || (parcel.parcel_id ? parcel.parcel_id.replace(/^Plot\s*#/i, '') : parcel.id) || 'N/A';
    const badgeSprite = this.createParcelBadgeSprite(pNum);
    const pinNormal = pinHead.clone().normalize();
    badgeSprite.position.copy(pinHead).add(pinNormal.clone().multiplyScalar(1.5));
    this.selectedMarkerGroup.add(badgeSprite);

    // Marker starts small and scales up during arrival (Requirement 7)
    this.selectedMarkerGroup.scale.set(0.001, 0.001, 0.001);
    this.selectedMarkerGroup.visible = false;
    this.selectedHighlightGroup.add(this.selectedMarkerGroup);

    // 3. Update HUD Elements & Screen Marker (Section 2, 3, 8)
    const sNum = parcel.surveyNumber || parcel.survey_no || 'N/A';
    const village = parcel.village || 'Wagholi';
    const district = parcel.district || 'Pune';
    const area = parcel.area || '1.45 acres';
    const landType = parcel.landType || parcel.land_type || 'Agricultural';

    // Update HTML Screen Map Marker (Section 2, 3, 8)
    const markerTitle = document.getElementById('screenMarkerTitle');
    if (markerTitle) markerTitle.textContent = `PARCEL #${pNum}`;
    const markerSub = document.getElementById('screenMarkerSub');
    if (markerSub) markerSub.textContent = `${village} • ${district}`;
    const markerSurvey = document.getElementById('screenMarkerSurvey');
    if (markerSurvey) markerSurvey.textContent = sNum && sNum !== 'N/A' ? `Survey ${sNum}` : '';

    // Update Anchored Selected Parcel Marker & Popup (Step 3 Sections 2, 5 & 6)
    const cleanSurvey = sNum && sNum !== 'N/A' ? String(sNum).replace(/^Survey\s*/i, '') : '';
    const anchoredIdEl = document.getElementById('anchoredParcelId');
    if (anchoredIdEl) anchoredIdEl.textContent = `PARCEL #${pNum}`;
    const anchoredLocEl = document.getElementById('anchoredLocation');
    if (anchoredLocEl) anchoredLocEl.textContent = `${village} • ${district}`;
    const anchoredSurvEl = document.getElementById('anchoredSurvey');
    if (anchoredSurvEl) anchoredSurvEl.textContent = cleanSurvey ? `Survey ${cleanSurvey}` : '';

    const btnAnchoredExplore = document.getElementById('btnAnchoredExplore');
    if (btnAnchoredExplore) {
      btnAnchoredExplore.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openParcelExplorer(parcel);
      };
    }

    const btnAnchoredClose = document.getElementById('btnAnchoredClose');
    if (btnAnchoredClose) {
      btnAnchoredClose.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.anchoredMarkerEl) this.anchoredMarkerEl.style.display = 'none';
      };
    }

    const titleEl = document.getElementById('globeNodeTitle');
    const subEl = document.getElementById('globeNodeSub');
    const statEl = document.getElementById('globeNodeStat');
    if (titleEl) titleEl.innerHTML = `📍 Selected Parcel #${pNum}`;
    if (subEl) subEl.innerHTML = `Survey ${sNum} &bull; ${village}, ${district}`;
    const isSearchMode = parcel.mode === 'search' || (window.parcelMapState && window.parcelMapState.mode === 'search');
    const badgeText = isSearchMode ? 'Parcel Search Result' : (parcel.isDemo ? 'Demo Dataset' : 'Verified Record');
    if (statEl) statEl.innerHTML = `${landType} &bull; ${area} &bull; ${badgeText}`;

    const coordHud = document.getElementById('globeCoordHud');
    if (coordHud) {
      const latDir = lat >= 0 ? '°N' : '°S';
      const lngDir = lng >= 0 ? '°E' : '°W';
      coordHud.textContent = `GPS: ${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir} • Parcel #${pNum}`;
    }

    // Determine target zoom level based on entity scope (Section 4 & 5: Closer regional detail showing Pune/Wagholi)
    let targetZoom = 2.25; // targetZoom = 2.50; targetZoom = 1.75; targetZoom = 1.65;
    if (parcel.scope === 'state' || parcel.isState) {
      targetZoom = 1.25;
    } else if (parcel.scope === 'district' || parcel.isDistrict) {
      targetZoom = 1.65;
    } else if (parcel.scope === 'village' || parcel.isRegion || parcel.isVillage) {
      targetZoom = 1.95;
    } else {
      targetZoom = 2.25; // targetZoom = 2.50; targetZoom = 1.75; targetZoom = 1.65; // Closer regional view showing Pune/Wagholi
    }

    // 4. Compact parcel tooltip (preserved for backward compatibility with tests)
    this.displayParcelTooltip(parcel, true);

    // 5. Smooth Camera Flight to Parcel Centroid (Step 4 Real Geographic Fly-To)
    // Upgraded from legacy this.flyTo(lat, lng, 1.75) to regional targetZoom = 1.65 (was targetZoom = 2.50)
    if (doFly) {
      this.flyTo(lat, lng, targetZoom, 160);
    } else {
      this.setCameraState('LOCATED', parcel);
      if (this.selectedMarkerGroup) {
        this.selectedMarkerGroup.scale.set(1.0, 1.0, 1.0);
        this.selectedMarkerGroup.visible = true;
      }
      this.displayParcelCard(parcel);
    }
  }

  // Display Information Panel for Searched / Selected Parcel
  displayParcelTooltip(parcel, hasCoords = true) {
    const tooltip = document.getElementById('globeTooltip');
    if (!tooltip) return;
    if (!parcel) {
      tooltip.style.display = 'none';
      return;
    }
    const pNum = parcel.parcelNumber || (parcel.parcel_id ? String(parcel.parcel_id).replace(/^Plot\s*#/i, '') : parcel.id) || '';
    const sNum = parcel.surveyNumber || parcel.survey_no || '';
    const village = parcel.village || 'Wagholi';
    const district = parcel.district || 'Pune';
    const lat = parcel.latitude != null ? Number(parcel.latitude) : (parcel.coordinates ? Number(parcel.coordinates[0]) : null);
    const lng = parcel.longitude != null ? Number(parcel.longitude) : (parcel.coordinates ? Number(parcel.coordinates[1]) : null);
    const latDir = lat != null && lat >= 0 ? '°N' : '°S';
    const lngDir = lng != null && lng >= 0 ? '°E' : '°W';
    const coordsStr = lat != null && lng != null ? `${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir}` : '';

    tooltip.innerHTML = `
      <div style="font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); padding: 8px 12px; text-align: left;">
        <div style="font-weight: 700; color: #ffffff; font-size: 0.95rem; margin-bottom: 3px;">📍 Parcel #${this.escapeHtml(pNum)}</div>
        <div style="font-size: 0.78rem; color: #94a3b8;">${sNum ? `Survey ${this.escapeHtml(sNum)} &bull; ` : ''}${this.escapeHtml(village)}, ${this.escapeHtml(district)}</div>
        ${coordsStr ? `<div style="font-size: 0.74rem; color: #38bdf8; margin-top: 4px; font-family: var(--font-mono, monospace);">${coordsStr}</div>` : ''}
      </div>
    `;
    tooltip.style.display = 'block';
  }

  // Reset / Clear Selected Parcel State
  clearSelectedParcel() {
    this.selectedParcel = null;
    this.clearHighlightGroup();
    this.hideParcelCard();

    if (this.screenMarkerEl) {
      this.screenMarkerEl.style.display = 'none';
    }
    if (this.beaconMeshes) {
      this.beaconMeshes.forEach(mesh => { mesh.visible = true; });
    }
    if (this.anchoredMarkerEl) {
      this.anchoredMarkerEl.style.display = 'none';
    }
    if (this.arcsGroup) {
      this.arcsGroup.visible = true;
    }
    if (this.satellitesGroup) {
      this.satellitesGroup.visible = Boolean(this.layers && this.layers.radar);
    }
    if (this.beaconsGroup) {
      this.beaconsGroup.visible = Boolean(this.layers && this.layers.cadastre);
    }
    if (this.cadastreGroup) {
      this.cadastreGroup.visible = Boolean(this.layers && this.layers.cadastre);
    }

    // Reset pulse ring back to primary hub
    if (this.activePulseRing && this.selectedHub) {
      this.activePulseRing.visible = true;
      const surfacePos = this.latLngToVector3(this.selectedHub.lat, this.selectedHub.lng, 1.2);
      this.activePulseRing.position.copy(surfacePos);
      this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
      this.activePulseRing.scale.set(1.0, 1.0, 1.0);
      this.activePulseRing.material.opacity = 0.7;
      this.activePulseRing.material.color.setHex(0x0ea5e9);
    }

    // Reset HUD
    if (this.selectedHub) {
      this.updateActiveHubUI(this.selectedHub);
    }

    // Hide tooltip
    const tooltip = document.getElementById('globeTooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
    this.setCameraState('IDLE');
  }

  handleResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const rect = this.container.getBoundingClientRect();
    const width = this.container.clientWidth || rect.width || 800;
    const height = this.container.clientHeight || rect.height || 540;
    if (width <= 0 || height <= 0) return;

    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    console.log('[GLOBE_RESIZE] Container dimensions updated:', width, 'x', height);
  }

  resetView() {
    console.log('[GLOBAL_VIEW_ENTER] Entering Clean Global Earth View');
    if (this._isResettingView) return;
    this._isResettingView = true;

    try {
      this.clearSelectedParcel();

      if (window.parcelMapState && window.parcelMapState.viewMode !== 'globe' && window.parcelMapState.viewMode !== 'global') {
        window.parcelMapState.setViewMode('global');
      }

      if (window.parcelHdMapManager && typeof window.parcelHdMapManager.hideMap === 'function') {
        window.parcelHdMapManager.hideMap();
      }

      // Ensure container and canvas are visible and styled
      if (this.container) {
        this.container.style.display = 'block';
        this.container.style.opacity = '1';
        this.container.style.pointerEvents = 'auto';
      }
      if (this.renderer && this.renderer.domElement) {
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.opacity = '1';
      }

      if (this.screenMarkerEl) {
        this.screenMarkerEl.style.display = 'none';
      }
      if (this.beaconMeshes) {
        this.beaconMeshes.forEach(mesh => { mesh.visible = true; });
      }
      if (this.anchoredMarkerEl) {
        this.anchoredMarkerEl.style.display = 'none';
      }
      if (this.arcsGroup) {
        this.arcsGroup.visible = true;
      }
      if (this.satellitesGroup) {
        this.satellitesGroup.visible = false;
      }
      if (this.beaconsGroup) {
        this.beaconsGroup.visible = Boolean(this.layers && this.layers.cadastre);
      }
      if (this.cadastreGroup) {
        this.cadastreGroup.visible = Boolean(this.layers && this.layers.cadastre);
      }

      const tooltip = document.getElementById('globeTooltip');
      if (tooltip) tooltip.style.display = 'none';

      // Update container measurement and resize renderer
      this.handleResize();

      // Reset camera to standard global Earth position
      console.log('[GLOBE_CAMERA_RESET] Restoring global camera & centered Earth');
      this.currentZoom = 1.0;
      this.targetZoom = 1.0;
      this.camera.position.set(0, 0, 480);
      this.camera.lookAt(0, 0, 0);

      // Smooth flight / centering to global view
      const pune = this.hubs[0];
      this.selectedHub = pune;
      if (this.activePulseRing) {
        this.activePulseRing.visible = true;
        const surfacePos = this.latLngToVector3(pune.lat, pune.lng, 1.2);
        this.activePulseRing.position.copy(surfacePos);
        this.activePulseRing.lookAt(new THREE.Vector3(0, 0, 0));
        this.activePulseRing.scale.set(1.0, 1.0, 1.0);
        this.activePulseRing.material.opacity = 0.7;
        this.activePulseRing.material.color.setHex(0x0ea5e9);
      }

      this.updateActiveHubUI(pune);
      this.setCameraState('IDLE');
      this.autoRotate = true;
      const btnToggle = document.getElementById('globeBtnToggleRotate');
      if (btnToggle) btnToggle.textContent = '⏸ Pause';
      this.flyTo(20, 77, 1.0, 60);

      if (window.parcelMapState && window.parcelMapState.selectedParcel) {
        window.parcelMapState.selectedParcel = null;
      }

      // Update chip active states
      document.querySelectorAll('.quick-jump-chip').forEach(chip => {
        if (chip.dataset.hub === 'global') chip.classList.add('active');
        else chip.classList.remove('active');
      });

      console.log('[GLOBE_READY] Global View ready');
    } catch (err) {
      console.error('[GLOBE_ERROR] Error restoring Global View:', err);
    } finally {
      this._isResettingView = false;
    }
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
      if (this.isFlying) return; // Temporarily prevent accidental drag during automatic flight (Section 11)
      this.isDragging = true;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      this.lastPointer = { x: clientX, y: clientY };
    };

    const onPointerMove = (e) => {
      if (this.isFlying) return; // Prevent drag or hover fighting during automatic flight (Section 11)
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
      if (this.isFlying) return; // Prevent wheel fighting during automatic flight (Section 11)
      if (e.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }, { passive: false });

    // Click on Beacon or Parcel to select and inspect (Requirement 14)
    el.addEventListener('click', () => {
      if (this.isFlying) return; // Prevent click selection during flight (Section 11)
      if (this.hoveredParcel) {
        if (window.parcelMapState && typeof window.parcelMapState.setSelectedParcel === 'function') {
          window.parcelMapState.setSelectedParcel(this.hoveredParcel, { scroll: false });
        } else {
          this.selectParcel(this.hoveredParcel, true);
        }
        return;
      }

      if (this.hoveredHub) {
        this.selectHub(this.hoveredHub, true);
      }
    });

    window.addEventListener('resize', () => {
      this.handleResize();
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
          this.selectedParcel = null;
          this.clearHighlightGroup();
          this.hideParcelCard();
          if (this.anchoredMarkerEl) this.anchoredMarkerEl.style.display = 'none';
          if (this.arcsGroup) this.arcsGroup.visible = true;
          if (this.satellitesGroup) this.satellitesGroup.visible = Boolean(this.layers && this.layers.radar);
          if (this.beaconsGroup) this.beaconsGroup.visible = Boolean(this.layers && this.layers.cadastre);
          if (this.cadastreGroup) this.cadastreGroup.visible = Boolean(this.layers && this.layers.cadastre);
          if (this.beaconMeshes) this.beaconMeshes.forEach(mesh => { mesh.visible = true; });
          if (this.activePulseRing) this.activePulseRing.visible = true;
          this.setCameraState('IDLE');
          this.autoRotate = true;
          const btnToggle = document.getElementById('globeBtnToggleRotate');
          if (btnToggle) btnToggle.textContent = '⏸ Pause';
          this.flyTo(20, 77, 1.0);
          this.updateActiveHubUI({
            name: 'Global Satellite Earth',
            region: 'Real Land & Ocean Observations',
            totalRecords: 'NASA Blue Marble Datum'
          });
          const tooltip = document.getElementById('globeTooltip');
          if (tooltip) tooltip.style.display = 'none';
          if (window.parcelMapState && window.parcelMapState.selectedParcel) {
            window.parcelMapState.selectedParcel = null;
          }
          window.dispatchEvent(new CustomEvent('parcelmap:cleared'));
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

    // 5. Reset View (Requirement 12)
    const btnReset = document.getElementById('globeBtnResetView');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.resetView();
      });
    }

    // 6. Roaming Satellite Toggle
    const btnToggleSat = document.getElementById('globeBtnToggleSatellite');
    if (btnToggleSat) {
      btnToggleSat.addEventListener('click', () => {
        this.toggleRoamingSatellite();
      });
    }
  }

  updateActiveHubUI(hub) {
    const title = document.getElementById('globeNodeTitle');
    const sub = document.getElementById('globeNodeSub');
    const stat = document.getElementById('globeNodeStat');

    if (title) title.textContent = `📍 ${hub.name}`;
    if (sub) sub.textContent = `${hub.region}`;
    if (stat) stat.textContent = '';
  }

  // Display Clean Registry Tooltip for Any Hub
  displayHubTooltip(hub) {
    const tooltip = document.getElementById('globeTooltip');
    if (!tooltip) return;

    const latDir = hub.lat >= 0 ? '°N' : '°S';
    const lngDir = hub.lng >= 0 ? '°E' : '°W';

    tooltip.innerHTML = `
      <div style="font-family: var(--font-sans, sans-serif); padding: 4px 6px;">
        <div style="font-weight: 700; color: #ffffff; font-size: 0.82rem; margin-bottom: 2px;">📍 ${this.escapeHtml(hub.name)}</div>
        <div style="font-size: 0.72rem; color: #94a3b8;">${this.escapeHtml(hub.region)}</div>
        <div style="font-size: 0.70rem; color: #38bdf8; margin-top: 3px; font-family: var(--font-mono, monospace);">
          ${Math.abs(hub.lat).toFixed(4)}${latDir}, ${Math.abs(hub.lng).toFixed(4)}${lngDir}
        </div>
      </div>
    `;
    tooltip.style.display = 'block';
  }

  // 3D Raycasting Hover Check (Supports Hubs & Individual Cadastral Parcels - Requirement 14)
  checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 1. Check Cadastral Parcel Meshes
    if (this.parcelPickMeshes && this.parcelPickMeshes.length > 0) {
      const parcelIntersects = this.raycaster.intersectObjects(this.parcelPickMeshes, false);
      if (parcelIntersects.length > 0) {
        this.hoveredParcel = parcelIntersects[0].object.userData.parcel;
        this.hoveredHub = null;
        this.container.style.cursor = 'pointer';
        return;
      }
    }
    this.hoveredParcel = null;

    // 2. Check Registry Hub Beacons
    const intersects = this.raycaster.intersectObjects(this.beaconMeshes, false);
    if (intersects.length > 0) {
      const hub = intersects[0].object.userData.hub;
      this.hoveredHub = hub;
      this.container.style.cursor = 'pointer';
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

    // 1. Multi-Stage Cinematic Camera Fly-To Easing (Earth -> India -> Maharashtra -> Pune -> Wagholi -> Parcel)
    if (this.isFlying) {
      this.flyProgress++;
      const t = Math.min(1.0, this.flyProgress / this.flyDuration);

      // Multi-phase easing: smooth quintic ease-out on rotation
      const rotEase = 1 - Math.pow(1 - t, 4);
      this.globeGroup.rotation.y = this.flyStart.rotY + (this.flyTarget.rotY - this.flyStart.rotY) * rotEase;
      this.globeGroup.rotation.x = this.flyStart.rotX + (this.flyTarget.rotX - this.flyStart.rotX) * rotEase;
      this.targetRotY = this.globeGroup.rotation.y;
      this.targetRotX = this.globeGroup.rotation.x;

      // Realistic progressive multi-stage descent curve:
      // Stage 1 (0 -> 0.22): Planetary / Earth / India orientation
      // Stage 2 (0.22 -> 0.65): Regional descent into Maharashtra & Pune
      // Stage 3 (0.65 -> 1.0): Terminal approach into Wagholi Cadastral Grid & Parcel Centroid
      let currentFlightZoom;
      if (this.flyStart.zoom > 1.4 && Math.abs(this.flyTarget.rotY - this.flyStart.rotY) > 0.08) {
        // High-altitude arc lift when re-routing between zoomed-in parcels
        const arcLift = Math.sin(t * Math.PI) * 0.40;
        const baseZ = this.flyStart.zoom + (this.flyTarget.zoom - this.flyStart.zoom) * (1 - Math.pow(1 - t, 3));
        currentFlightZoom = Math.max(1.15, baseZ - arcLift);
        this.currentZoom = currentFlightZoom;
      } else {
        let zoomEase;
        if (t < 0.22) {
          zoomEase = Math.pow(t / 0.22, 2) * 0.12; // Initial planetary orientation
        } else if (t < 0.65) {
          const midT = (t - 0.22) / 0.43;
          zoomEase = 0.12 + (1 - Math.pow(1 - midT, 2)) * 0.50; // Regional approach (Maharashtra / Pune)
        } else {
          const finalT = (t - 0.65) / 0.35;
          zoomEase = 0.62 + (1 - Math.pow(1 - finalT, 3)) * 0.38; // Terminal descent into Wagholi / Parcel
        }
        this.currentZoom = this.flyStart.zoom + (this.flyTarget.zoom - this.flyStart.zoom) * zoomEase;
        currentFlightZoom = this.currentZoom;
      }

      this.currentZoom = currentFlightZoom;
      this.camera.position.z = 480 / this.currentZoom;
      this.updateZoomHud();

      // Multi-stage Geographic Telemetry HUD & Camera State updates
      const pNum = this.selectedParcel?.parcelNumber || (this.selectedParcel?.parcel_id ? String(this.selectedParcel.parcel_id).replace(/^Plot\s*#/i, '') : this.selectedParcel?.id) || 'N/A';
      const nodeSub = document.getElementById('globeNodeSub');

      if (t < 0.25) {
        if (this.cameraState !== 'LOCATING' && this.selectedParcel) {
          this.setCameraState('LOCATING', this.selectedParcel);
        }
        if (nodeSub) nodeSub.textContent = 'Trajectory: Planetary Orbit • India Region';
      } else if (t < 0.60) {
        if (this.cameraState !== 'LOCATING' && this.selectedParcel) {
          this.setCameraState('LOCATING', this.selectedParcel);
        }
        if (nodeSub) nodeSub.textContent = 'Descent Phase: Maharashtra • Pune District';
      } else if (t < 0.90) {
        if (this.cameraState !== 'ARRIVING' && this.selectedParcel) {
          this.setCameraState('ARRIVING', this.selectedParcel);
        }
        if (nodeSub) nodeSub.textContent = `Approach: Wagholi Sheet #14 • Vectoring #${pNum}`;
        // Location marker smoothly scales in during approach phase (ARRIVING)
        if (this.selectedMarkerGroup) {
          const markerT = (t - 0.55) / 0.45;
          const s = Math.min(1.0, Math.max(0, 1 - Math.pow(1 - Math.max(0, markerT), 3)));
          this.selectedMarkerGroup.scale.set(s, s, s);
          this.selectedMarkerGroup.visible = true;
        }
      }

      if (t >= 1.0) {
        this.isFlying = false;
        if (this.selectedParcel && window.parcelMapState?.searchState !== 'notFound') {
          this.setCameraState('LOCATED', this.selectedParcel);
          if (window.parcelMapState && typeof window.parcelMapState.setSearchState === 'function') {
            if (window.parcelMapState.searchState !== 'notFound') {
              window.parcelMapState.setSearchState('located', this.selectedParcel);
            }
          }
          if (this.selectedMarkerGroup) {
            this.selectedMarkerGroup.scale.set(1.0, 1.0, 1.0);
            this.selectedMarkerGroup.visible = true;
          }
          if (nodeSub) {
            const sNum = this.selectedParcel.surveyNumber || this.selectedParcel.survey_no || 'N/A';
            nodeSub.innerHTML = `Survey ${sNum} &bull; Wagholi, Pune`;
          }
          // Step 3B: Transition from 3D Globe to 2D Map (viewMode: transitioning -> map)
          const arrivingParcel = this.selectedParcel;
          if (window.parcelMapState && typeof window.parcelMapState.setViewMode === 'function') {
            window.parcelMapState.setViewMode('transitioning', arrivingParcel);
            setTimeout(() => {
              if (window.parcelMapState?.searchState === 'notFound') return;
              const current = window.parcelMapState?.selectedParcel || this.selectedParcel;
              if (current && (current.id === arrivingParcel.id || current.parcelNumber === arrivingParcel.parcelNumber)) {
                window.parcelMapState.setViewMode('map', arrivingParcel);
              }
            }, 300);
          } else if (window.parcelHdMapManager && window.parcelMapState?.searchState !== 'notFound') {
            window.parcelHdMapManager.showParcel(arrivingParcel);
          }
        } else {
          this.setCameraState('IDLE');
        }
      }
    } else if (this.isDragging) {
      // 2. Active User Pointer / Touch Dragging
      this.globeGroup.rotation.y = this.targetRotY;
      this.globeGroup.rotation.x = this.targetRotX;
    } else if (Math.abs(this.velocity.x) > 0.0001 || Math.abs(this.velocity.y) > 0.0001) {
      // 3. Post-Drag Inertia Momentum Damping
      this.targetRotY += this.velocity.x;
      this.targetRotX = Math.max(-0.85, Math.min(0.85, this.targetRotX + this.velocity.y));
      this.velocity.x *= 0.94;
      this.velocity.y *= 0.94;

      this.globeGroup.rotation.y += (this.targetRotY - this.globeGroup.rotation.y) * 0.12;
      this.globeGroup.rotation.x += (this.targetRotX - this.globeGroup.rotation.x) * 0.12;
    } else if (this.autoRotate) {
      // 4. Dynamic Slow Rotation
      if (this.selectedParcel && this.cameraState === 'LOCATED') {
        // When focused on an exact parcel: subtle dynamic orbital sway (±0.015 rad)
        // Keeps the parcel centered and clearly readable, while providing a living, dynamic satellite perspective
        this.parcelSwayPhase = (this.parcelSwayPhase || 0) + 0.006;
        const swayY = Math.sin(this.parcelSwayPhase) * 0.015;
        const swayX = Math.cos(this.parcelSwayPhase * 0.8) * 0.008;
        this.globeGroup.rotation.y = this.flyTarget.rotY + swayY;
        this.globeGroup.rotation.x = this.flyTarget.rotX + swayX;
        this.targetRotY = this.globeGroup.rotation.y;
        this.targetRotX = this.globeGroup.rotation.x;
      } else {
        // Planetary dynamic slow rotation
        this.globeGroup.rotation.y += this.rotationSpeed;
        this.targetRotY = this.globeGroup.rotation.y;
      }
    } else {
      // 5. Idle / Paused View - Smooth settling
      this.globeGroup.rotation.y += (this.targetRotY - this.globeGroup.rotation.y) * 0.12;
      this.globeGroup.rotation.x += (this.targetRotX - this.globeGroup.rotation.x) * 0.12;
    }

    // 4. Drifting Cloud Layer
    if (this.cloudsMesh && this.layers.clouds) {
      this.cloudsMesh.rotation.y += 0.00045;
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

    // 5b. Subtle Pulsing Boundary Outline on Selected Parcel (Requirement 6)
    if (this.selectedParcel && this.cameraState === 'LOCATED') {
      const pulse = 0.85 + Math.sin(Date.now() * 0.0035) * 0.15;
      if (this.selectedHighlightLine && this.selectedHighlightLine.material) {
        this.selectedHighlightLine.material.opacity = pulse;
      }
      if (this.selectedFillMesh && this.selectedFillMesh.material) {
        this.selectedFillMesh.material.opacity = 0.25 + pulse * 0.12;
      }

      // Screen-space marker scale stabilization (Section 7: MIN_MARKER_SIZE, MAX_MARKER_SIZE)
      if (this.selectedMarkerGroup) {
        const screenScale = Math.min(1.15, Math.max(0.70, (480 / this.currentZoom) / 290));
        this.selectedMarkerGroup.scale.set(screenScale, screenScale, screenScale);
      }
    }

    // 5c. Real-Time Screen-Space HTML/CSS Map Marker Projection (Section 2 & 3)
    const isGlobeMode = !window.parcelMapState || window.parcelMapState.viewMode === 'globe';
    if (isGlobeMode && this.selectedParcel && (this.cameraState === 'ARRIVING' || this.cameraState === 'LOCATED')) {
      if (!this.screenMarkerEl) {
        this.screenMarkerEl = document.getElementById('globeScreenParcelMarker');
      }
      if (!this.anchoredMarkerEl) {
        this.anchoredMarkerEl = document.getElementById('globeAnchoredParcelMarker');
      }
      if (this.screenMarkerEl) {
        const lat = this.selectedParcel.latitude != null ? Number(this.selectedParcel.latitude) : (this.selectedParcel.coordinates ? Number(this.selectedParcel.coordinates[0]) : null);
        const lng = this.selectedParcel.longitude != null ? Number(this.selectedParcel.longitude) : (this.selectedParcel.coordinates ? Number(this.selectedParcel.coordinates[1]) : null);

        if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
          const worldPos = this.latLngToVector3(lat, lng, 0.4);
          worldPos.applyMatrix4(this.globeGroup.matrixWorld);

          // Check if facing camera (front hemisphere)
          const camDir = this.camera.position.clone().sub(worldPos).normalize();
          const surfaceNorm = worldPos.clone().normalize();
          const isFront = surfaceNorm.dot(camDir) > 0.08;

          if (isFront) {
            const screenV = worldPos.clone().project(this.camera);
            const screenX = (screenV.x * 0.5 + 0.5) * this.width;
            const screenY = (-(screenV.y * 0.5) + 0.5) * this.height;

            this.screenMarkerEl.style.display = 'flex';
            this.screenMarkerEl.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -100%)`;
            this.screenMarkerEl.style.opacity = this.cameraState === 'ARRIVING' ? '0.92' : '1.0';

            // Clean Land Marker: Display only the minimal screen marker (e.g. 📍 Parcel #101)
            this.screenMarkerEl.style.display = 'flex';
            this.screenMarkerEl.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -100%)`;
            this.screenMarkerEl.style.opacity = this.cameraState === 'ARRIVING' ? '0.92' : '1.0';
            if (this.anchoredMarkerEl) {
              this.anchoredMarkerEl.style.display = 'none';
            }
          } else {
            this.screenMarkerEl.style.display = 'none';
            if (this.anchoredMarkerEl) this.anchoredMarkerEl.style.display = 'none';
          }
        } else {
          this.screenMarkerEl.style.display = 'none';
          if (this.anchoredMarkerEl) this.anchoredMarkerEl.style.display = 'none';
        }
      }
    } else {
      if (this.screenMarkerEl) {
        this.screenMarkerEl.style.display = 'none';
      }
      if (this.anchoredMarkerEl) {
        this.anchoredMarkerEl.style.display = 'none';
      }
    }

    // 6. Traveling Photons along Geodetic Arcs
    this.arcPhotons.forEach(item => {
      item.progress = (item.progress + 0.007) % 1.0;
      const pt = item.curve.getPoint(item.progress);
      item.mesh.position.copy(pt);
    });

    // 7. Single Roaming Satellite in Low Earth Orbit
    if (this.roamingSatelliteGroup && this.roamingSatellite && this.roamingSatelliteVisible) {
      this.roamingOrbitAngle += this.roamingOrbitSpeed;
      const r = this.roamingOrbitRadius;
      const x = Math.cos(this.roamingOrbitAngle) * r;
      const z = Math.sin(this.roamingOrbitAngle) * r;
      this.roamingSatellite.position.set(x, 0, z);
      this.roamingSatellite.rotation.y = -this.roamingOrbitAngle + Math.PI / 2;

      // Subtle pulse on satellite telemetry beacon LED
      if (this.satelliteBeacon && this.satelliteBeacon.material) {
        const pulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.5;
        this.satelliteBeacon.material.color.setHex(pulse > 0.4 ? 0x10b981 : 0x047857);
      }
    }

    // 8. Render Frame
    this.renderer.render(this.scene, this.camera);
  }
}

// Immediate Initialization & Global Interface
function initRealSatelliteGlobe() {
  try {
    if (!window.realSatelliteGlobeInstance) {
      console.log('[GLOBE_INIT] Initializing Real Satellite Cadastral Globe...');
      window.realSatelliteGlobeInstance = new RealSatelliteCadastralGlobe('globeCanvasContainer');
      console.log('[GLOBE_READY] Globe initialized');
      if (window._pendingSelectedParcel) {
        setTimeout(() => {
          if (window.realSatelliteGlobeInstance) {
            window.realSatelliteGlobeInstance.selectParcel(window._pendingSelectedParcel);
            window._pendingSelectedParcel = null;
          }
        }, 250);
      }
    }
  } catch (err) {
    console.error('[GLOBE_ERROR] Fatal WebGL/Globe initialization failure:', err);
    const overlay = document.getElementById('globeLoadingOverlay');
    const errInner = document.getElementById('globeErrorInner');
    const inner = document.getElementById('globeLoadingInner');
    if (overlay && errInner) {
      if (inner) inner.style.display = 'none';
      errInner.style.display = 'flex';
      overlay.style.display = 'flex';
    }
  }
}

// Global API Helper for Search -> Globe Connection (Requirement 6 & 8)
window.flyToParcel = function(parcel) {
  if (window.realSatelliteGlobeInstance && typeof window.realSatelliteGlobeInstance.selectParcel === 'function') {
    window.realSatelliteGlobeInstance.selectParcel(parcel);
  } else {
    window._pendingSelectedParcel = parcel;
  }
};

window.addEventListener('parcelmap:selected', (e) => {
  if (e.detail && window.flyToParcel) {
    window.flyToParcel(e.detail);
  }
});

window.addEventListener('parcelmap:cleared', () => {
  if (window.realSatelliteGlobeInstance && !window.realSatelliteGlobeInstance._isResettingView && typeof window.realSatelliteGlobeInstance.clearSelectedParcel === 'function') {
    window.realSatelliteGlobeInstance.clearSelectedParcel();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRealSatelliteGlobe);
} else {
  initRealSatelliteGlobe();
}
