/**
 * ParcelMap Workspace Controller
 * Full-Stack GeoTech application engine with Leaflet GIS maps,
 * vertex editing, split/merge tools, undo/redo, and REST API integration.
 */

class ParcelMapWorkspace {
  constructor() {
    // Dynamic Production & Local Backend URL Resolution
    // Supports:
    // 1. URL Query parameter ?api=https://... (great for live testing against any backend)
    // 2. window.__PARCELMAP_API_URL__ (injected global configuration)
    // 3. localStorage.getItem('pm_backend_api_url') (persistent override)
    // 4. import.meta.env.VITE_API_URL (Vite environment variable)
    // 5. file:// protocol fallback to http://localhost:3001
    // 6. Default relative '' with /api (works seamlessly with same-origin and Netlify reverse-proxy)
    let configuredBackend = null;

    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('api')) {
        configuredBackend = urlParams.get('api');
        try { localStorage.setItem('pm_backend_api_url', configuredBackend); } catch (e) {}
      } else if (window.__PARCELMAP_API_URL__) {
        configuredBackend = window.__PARCELMAP_API_URL__;
      } else {
        try { configuredBackend = localStorage.getItem('pm_backend_api_url'); } catch (e) {}
      }
    }

    if (!configuredBackend && typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) {
      configuredBackend = import.meta.env.VITE_API_URL;
    }

    if (configuredBackend) {
      this.backendBase = configuredBackend.replace(/\/api\/?$/, '').replace(/\/$/, '');
      this.apiBase = `${this.backendBase}/api`;
    } else if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      this.backendBase = 'http://localhost:3001';
      this.apiBase = 'http://localhost:3001/api';
    } else {
      this.backendBase = '';
      this.apiBase = '/api';
    }

    this.currentView = 'dashboard';
    this.activeProjectId = localStorage.getItem('pm_active_project_id') || 'proj_wagholi_demo';
    this.selectedImageryId = localStorage.getItem('pm_selected_imagery_id') || null;
    this.detectionFeatureGroup = null;
    this.detectionImageOverlay = null;
    this.project = null;
    this.imagery = [];
    this.features = [];
    this.parcels = [];
    this.verifications = [];
    this.qualityAudit = null;

    // Active Selection & Editing State
    this.selectedParcelId = 'PM-0001';
    this.parcelFilterStatus = 'all';
    this.parcelFilterQuery = '';
    this.finalLayersGroup = null;
    this.finalImageOverlay = null;
    this.finalMeasurementMode = null; // 'distance' | 'area' | null
    this.finalMeasurePoints = [];
    this.finalMeasureLayer = L.layerGroup();
    this.finalSelectedPolygon = null;
    this.qcErrorOverride = false;
    this.editMode = false;
    this.editHistory = [];
    this.historyIndex = -1;
    this.vertexMarkers = [];
    this.midpointMarkers = [];
    this.activeEditingLayer = null;

    this.maps = {
      detection: null,
      reasoning: null,
      parcels: null,
      quality: null,
      verify: null,
      final: null
    };

    // Detection Visualization & Debug State (Step 6B)
    this.detectionOpacity = 0.40;
    this.currentDetectionDebug = null;

    // Layer groups for GIS Quality map
    this.qcLayers = {
      imagery: L.layerGroup(),
      parcels: L.layerGroup(),
      issues: L.layerGroup(),
      roads: L.layerGroup(),
      buildings: L.layerGroup(),
      fields: L.layerGroup(),
      water: L.layerGroup()
    };

    // Layer groups for Verification map
    this.verifyLayers = {
      droneImagery: L.layerGroup(),
      satellite: L.layerGroup(),
      roads: L.layerGroup(),
      buildings: L.layerGroup(),
      boundaries: L.layerGroup(),
      aiParcels: L.layerGroup(),
      verifiedParcels: L.layerGroup(),
      uncertainty: L.layerGroup(),
      editLayer: L.featureGroup()
    };

    this.init();
  }

  async init() {
    this.bindNavigation();
    this.bindModals();
    this.bindEditingTools();
    this.bindDrawerActions();
    this.bindSearch();
    this.bindAiDetectionActions();
    this.bindFinalMapControls();
    this.bindReportActions();

    // Populate top project selector
    await this.populateProjectSelector();

    // Check hash for direct route (e.g. #verify, #quality, #imagery, #map, #report)
    const hash = window.location.hash.replace('#', '');
    if (hash && ['dashboard', 'imagery', 'detection', 'reasoning', 'parcels', 'verify', 'quality', 'map', 'report'].includes(hash)) {
      this.currentView = hash;
    }

    window.addEventListener('hashchange', () => {
      const newHash = window.location.hash.replace('#', '');
      if (newHash && ['dashboard', 'imagery', 'detection', 'reasoning', 'parcels', 'verify', 'quality', 'map', 'report'].includes(newHash)) {
        if (this.currentView !== newHash) {
          this.switchView(newHash);
        }
      }
    });

    await this.loadProjectData(this.activeProjectId);
    this.switchView(this.currentView);
  }

  getImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (this.backendBase) {
      return `${this.backendBase}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    return url;
  }

  /* --------------------------------------------------------------------------
     1. API COMMUNICATION & DATA LOADING
     -------------------------------------------------------------------------- */
  async loadProjectData(projectId) {
    try {
      this.activeProjectId = projectId;
      localStorage.setItem('pm_active_project_id', this.activeProjectId);

      // 1. Project details with auto-recovery if project ID doesn't exist
      const pRes = await fetch(`${this.apiBase}/projects/${projectId}`);
      const pData = await pRes.json();
      if (pData.success && pData.project) {
        this.project = pData.project;
      } else {
        console.warn(`[Workspace] Project '${projectId}' not found. Recovering fallback project...`);
        const allRes = await fetch(`${this.apiBase}/projects`);
        const allData = await allRes.json();
        if (allData.success && allData.projects && allData.projects.length > 0) {
          const fallback = allData.projects.find(p => p.id === 'proj_wagholi_demo') || allData.projects[0];
          this.activeProjectId = fallback.id;
          localStorage.setItem('pm_active_project_id', this.activeProjectId);
          this.project = fallback;
          return this.loadProjectData(fallback.id);
        }
      }

      // 2. Imagery
      const imgRes = await fetch(`${this.apiBase}/projects/${projectId}/imagery`);
      const imgData = await imgRes.json();
      if (imgData.success) {
        this.imagery = imgData.imagery;
        if (this.imagery.length > 0) {
          const exists = this.imagery.some(img => img.id === this.selectedImageryId);
          if (!exists) {
            this.selectedImageryId = this.imagery[this.imagery.length - 1].id;
          }
        } else {
          this.selectedImageryId = null;
        }
        localStorage.setItem('pm_selected_imagery_id', this.selectedImageryId || '');
      }

      // 3. Features (strictly scoped by active imagery if available)
      const fUrl = this.selectedImageryId
        ? `${this.apiBase}/projects/${projectId}/features?imagery_id=${this.selectedImageryId}`
        : `${this.apiBase}/projects/${projectId}/features`;
      const fRes = await fetch(fUrl);
      const fData = await fRes.json();
      if (fData.success) this.features = fData.features;

      // 4. Parcels (strictly scoped by active imagery if available)
      const pUrl = this.selectedImageryId
        ? `${this.apiBase}/projects/${projectId}/parcels?imagery_id=${this.selectedImageryId}`
        : `${this.apiBase}/projects/${projectId}/parcels`;
      const parcRes = await fetch(pUrl);
      const parcData = await parcRes.json();
      if (parcData.success) this.parcels = parcData.parcels;

      // 5. Verifications / Timeline
      const verRes = await fetch(`${this.apiBase}/projects/${projectId}/timeline`);
      const verData = await verRes.json();
      if (verData.success) this.verifications = verData.timeline;

      // 6. Quality Control Audit (Real GIS geometry audit, scoped by imagery if available)
      const qcUrl = this.selectedImageryId
        ? `${this.apiBase}/projects/${projectId}/gis-quality?imagery_id=${this.selectedImageryId}`
        : `${this.apiBase}/projects/${projectId}/gis-quality`;
      const qcRes = await fetch(qcUrl);
      const qcData = await qcRes.json();
      if (qcData.success) {
        this.qualityAudit = qcData;
      } else {
        this.qualityAudit = null;
      }

      // Ensure active selected parcel is valid
      if (this.parcels.length > 0) {
        const hasSelection = this.parcels.some(p => (p.parcel_id || p.id) === this.selectedParcelId);
        if (!hasSelection) {
          this.selectedParcelId = this.parcels[0].parcel_id || this.parcels[0].id;
        }
      }

      this.updateDashboardMetrics();
      this.updateImageryViewUI();
      this.updateDetectionViewUI();
      this.renderProjectsList();
      this.renderVerifyParcelList();
      this.renderSelectedParcelDrawer();
      this.renderQualityControlTable();
      this.renderFinalMapLayers();
      this.renderReportView();

      // Update active map
      if (this.currentView === 'detection') this.renderDetectionMap();
      if (this.currentView === 'reasoning') this.renderReasoningMap();
      if (this.currentView === 'parcels') this.renderParcelsViewUI();
      if (this.currentView === 'quality') {
        this.renderQualityControlTable();
        this.renderQualityMap();
      }
      if (this.currentView === 'verify') {
        this.renderVerifyParcelList();
        this.renderVerifyMapLayers();
      }
      if (this.currentView === 'map') this.renderFinalMapLayers();
    } catch (err) {
      console.error('Failed to load project data:', err);
      this.showToast('Error loading project data from backend API', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     2. NAVIGATION & ROUTING
     -------------------------------------------------------------------------- */
  bindNavigation() {
    document.querySelectorAll('.pm-nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        this.switchView(view);
      });
    });

    document.getElementById('btnStartMappingWorkflow')?.addEventListener('click', () => {
      this.switchView('verify');
    });

    document.getElementById('btnNextToAiDetection')?.addEventListener('click', () => {
      this.switchView('detection');
    });

    document.getElementById('btnProceedToReasoning')?.addEventListener('click', async () => {
      const imageryId = this.selectedImageryId || this.imagery?.[0]?.id;
      if (imageryId && this.features && this.features.length > 0) {
        try {
          const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/spatial-reasoning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imagery_id: imageryId,
              detection_run_id: this.currentDetectionRunId || null,
              detection_ids: this.features.map(f => f.id)
            })
          });
          const data = await res.json();
          if (data.success && data.parcels) {
            this.parcels = data.parcels;
          }
        } catch (e) {
          console.warn('[Spatial Reasoning] Auto-handoff note:', e.message);
        }
      }
      this.switchView('reasoning');
    });

    document.getElementById('btnProceedToParcels')?.addEventListener('click', () => {
      this.switchView('parcels');
    });

    document.getElementById('btnProceedToQuality')?.addEventListener('click', async () => {
      await this.loadProjectData(this.activeProjectId);
      this.switchView('quality');
    });

    document.getElementById('btnProceedToVerification')?.addEventListener('click', () => {
      this.switchView('verify');
    });

    document.getElementById('btnOpenVerificationWorkspace')?.addEventListener('click', () => {
      this.switchView('verify');
    });

    document.getElementById('btnReviewQcIssues')?.addEventListener('click', () => {
      this.reviewQcIssues();
    });

    document.getElementById('btnReviewQcIssuesTop')?.addEventListener('click', () => {
      this.reviewQcIssues();
    });

    document.getElementById('btnFinalizeAndReport')?.addEventListener('click', () => {
      this.finalizeAndNavigateToReport();
    });

    document.getElementById('btnOverrideQcErrors')?.addEventListener('click', () => {
      this.qcErrorOverride = true;
      this.showToast('Critical GIS topology warnings overridden by user.', 'info');
      this.renderFinalMapLayers();
      this.switchView('report');
    });

    document.getElementById('btnLaunchDemo')?.addEventListener('click', async () => {
      await fetch(`${this.apiBase}/demo/reset`, { method: 'POST' });
      this.showToast('Loaded Demo Project: Wagholi East Cadastre', 'success');
      await this.loadProjectData('proj_wagholi_demo');
      this.switchView('verify');
    });

    document.getElementById('btnRunFullPipeline')?.addEventListener('click', () => {
      this.triggerJobPipeline();
    });

    // Spatial Reasoning triggers & toggles
    document.getElementById('btnRunSpatialReasoning')?.addEventListener('click', () => {
      this.triggerSpatialReasoning();
    });

    ['srChkRoads', 'srChkBuildings', 'srChkFields', 'srChkWalls', 'srChkFences', 'srChkWater', 'srChkBoundaries', 'srChkParcels'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.renderReasoningMap();
      });
    });

    // Subpanel switcher in left sidebar (Parcels vs Layers - Requirement 8)
    document.getElementById('tabVerifyParcelsList')?.addEventListener('click', () => {
      document.getElementById('tabVerifyParcelsList')?.classList.add('active');
      document.getElementById('tabVerifyLayersList')?.classList.remove('active');
      const pParcels = document.getElementById('panelVerifyParcels');
      const pLayers = document.getElementById('panelVerifyLayers');
      if (pParcels) pParcels.style.display = 'flex';
      if (pLayers) pLayers.style.display = 'none';
    });

    document.getElementById('tabVerifyLayersList')?.addEventListener('click', () => {
      document.getElementById('tabVerifyLayersList')?.classList.add('active');
      document.getElementById('tabVerifyParcelsList')?.classList.remove('active');
      const pParcels = document.getElementById('panelVerifyParcels');
      const pLayers = document.getElementById('panelVerifyLayers');
      if (pParcels) pParcels.style.display = 'none';
      if (pLayers) pLayers.style.display = 'block';
    });

    // Filter pills in parcel list (Requirement 9)
    document.querySelectorAll('#verifyFilterPills .filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#verifyFilterPills .filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.parcelFilterStatus = btn.dataset.filter || 'all';
        this.renderVerifyParcelList();
      });
    });

    // Search input for parcels (Requirement 13)
    const handleParcelSearch = (query) => {
      const q = (query || '').trim().toLowerCase();
      this.parcelFilterQuery = q;
      this.renderVerifyParcelList();
      if (q.length > 0) {
        const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
        const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
        const match = currentParcels.find(p => (p.parcel_id || p.id).toLowerCase() === q) ||
                      currentParcels.find(p => (p.parcel_id || p.id).toLowerCase().includes(q));
        if (match) {
          this.selectParcel(match.parcel_id || match.id);
        }
      }
    };

    document.getElementById('inputFilterParcelId')?.addEventListener('input', (e) => {
      handleParcelSearch(e.target.value);
    });

    document.getElementById('wsQuickSearch')?.addEventListener('input', (e) => {
      handleParcelSearch(e.target.value);
    });
    document.getElementById('wsQuickSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleParcelSearch(e.target.value);
      }
    });

    // History modal bindings (Requirement 15)
    document.getElementById('btnViewParcelHistory')?.addEventListener('click', () => {
      this.openParcelHistoryModal(this.selectedParcelId);
    });
    document.getElementById('btnQuickViewHistory')?.addEventListener('click', () => {
      this.openParcelHistoryModal(this.selectedParcelId);
    });
    document.getElementById('btnCloseModalHistory')?.addEventListener('click', () => {
      document.getElementById('modalParcelHistory')?.classList.remove('active');
    });
    document.getElementById('btnCloseModalHistoryBtn')?.addEventListener('click', () => {
      document.getElementById('modalParcelHistory')?.classList.remove('active');
    });

    // Layer checkboxes in Verification Workspace
    ['vchkDroneImagery', 'vchkSatellite', 'vchkRoads', 'vchkBuildings', 'vchkBoundaries', 'vchkAiParcels', 'vchkVerifiedParcels', 'vchkUncertainty'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.renderVerifyMapLayers();
      });
    });

    // GIS Quality Map Layer Checkboxes (Requirement 9)
    ['qchkParcels', 'qchkIssues', 'qchkRoads', 'qchkBuildings', 'qchkFields', 'qchkWater'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.renderQualityMap();
      });
    });

    // Final Map Layer Checkboxes (Requirement 18)
    ['fchkAccepted', 'fchkNeedsReview', 'fchkRejected', 'fchkRoads', 'fchkBuildings', 'fchkFields', 'fchkBoundaries', 'fchkSourceImagery'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.renderFinalMapLayers();
      });
    });
  }

  switchView(viewId) {
    this.currentView = viewId;
    window.location.hash = viewId;

    // Update nav tab styling
    document.querySelectorAll('.pm-nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === viewId);
    });

    // Toggle view stages
    document.querySelectorAll('.pm-view-stage').forEach(stage => {
      stage.classList.remove('active');
    });

    const targetStageId = 'view' + viewId.charAt(0).toUpperCase() + viewId.slice(1);
    const targetStage = document.getElementById(targetStageId);
    if (targetStage) {
      targetStage.classList.add('active');
    }

    // Invalidate map size to prevent rendering glitches
    setTimeout(() => {
      this.initMapForView(viewId);
    }, 100);
  }

  /* --------------------------------------------------------------------------
     3. MAP INITIALIZATION PER VIEW
     -------------------------------------------------------------------------- */
  initMapForView(viewId) {
    const center = this.project?.coordinates || [18.5818, 73.9875];
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const width = Number(currentImg?.width) || 4000;
    const height = Number(currentImg?.height) || 3000;

    if (viewId === 'dashboard') {
      this.updateDashboardMetrics();
      this.renderProjectsList();
    } else if (viewId === 'imagery') {
      this.updateImageryViewUI();
    } else if (viewId === 'detection') {
      this.renderDetectionMap();
    } else if (viewId === 'reasoning') {
      this.renderReasoningMap();
    } else if (viewId === 'parcels') {
      this.renderParcelsViewUI();
    } else if (viewId === 'quality') {
      this.renderQualityControlTable();
      this.renderQualityMap();
    } else if (viewId === 'verify') {
      if (this.maps.verify) {
        this.maps.verify.remove();
        this.maps.verify = null;
      }

      if (!isGeoreferenced && currentImg) {
        const bounds = [[0, 0], [height, width]];
        this.maps.verify = L.map('wsGisMap', {
          crs: L.CRS.Simple,
          minZoom: -3,
          maxZoom: 3,
          zoomSnap: 0.25,
          attributionControl: false,
          zoomControl: true
        });
        L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds).addTo(this.maps.verify);
        this.maps.verify.fitBounds(bounds);
      } else {
        this.maps.verify = L.map('wsGisMap', { attributionControl: false, zoomControl: true }).setView(center, 16);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.verify);
        if (currentImg && currentImg.file_url) {
          const delta = 0.003;
          const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
          L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.85 }).addTo(this.maps.verify);
        }
      }

      // Add layer groups
      Object.values(this.verifyLayers).forEach(layer => {
        layer.clearLayers();
        layer.addTo(this.maps.verify);
      });

      this.renderVerifyParcelList();
      this.renderVerifyMapLayers();
    } else if (viewId === 'map') {
      if (this.maps.final) {
        this.maps.final.remove();
        this.maps.final = null;
      }

      const showSourceImagery = document.getElementById('fchkSourceImagery')?.checked ?? true;

      if (!isGeoreferenced && currentImg) {
        const bounds = [[0, 0], [height, width]];
        this.maps.final = L.map('finalMap', {
          crs: L.CRS.Simple,
          minZoom: -3,
          maxZoom: 3,
          zoomSnap: 0.25,
          attributionControl: false,
          zoomControl: false // Using custom floating controls
        });
        this.finalImageOverlay = L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds);
        if (showSourceImagery) this.finalImageOverlay.addTo(this.maps.final);
        this.maps.final.fitBounds(bounds);
      } else {
        this.maps.final = L.map('finalMap', {
          attributionControl: false,
          zoomControl: false // Using custom floating controls
        }).setView(center, 16);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.final);
        if (currentImg && currentImg.file_url) {
          const delta = 0.003;
          const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
          this.finalImageOverlay = L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.85 });
          if (showSourceImagery) this.finalImageOverlay.addTo(this.maps.final);
        }
      }

      this.finalMeasureLayer = L.layerGroup().addTo(this.maps.final);
      this.maps.final.on('click', (e) => this.handleFinalMapMeasureClick(e));

      this.renderFinalMapLayers();
    } else if (viewId === 'report') {
      this.renderReportView();
    }
  }

  /* --------------------------------------------------------------------------
     PROJECT SELECTOR & UI SYNCHRONIZATION
     -------------------------------------------------------------------------- */
  async populateProjectSelector() {
    const sel = document.getElementById('selActiveProject');
    if (!sel) return;
    try {
      const res = await fetch(`${this.apiBase}/projects`);
      const data = await res.json();
      if (data.success && data.projects) {
        sel.innerHTML = data.projects.map(p => 
          `<option value="${p.id}" ${p.id === this.activeProjectId ? 'selected' : ''}>${p.name}</option>`
        ).join('');
      }
    } catch (e) {
      console.warn('Could not populate project selector:', e);
    }

    sel.onchange = async (e) => {
      this.activeProjectId = e.target.value;
      localStorage.setItem('pm_active_project_id', this.activeProjectId);
      this.selectedImageryId = null;
      localStorage.removeItem('pm_selected_imagery_id');
      await this.loadProjectData(this.activeProjectId);
      this.switchView(this.currentView);
    };
  }

  updateImageryViewUI() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const preview = document.getElementById('imgUavPreview');
    const badge = document.getElementById('uavPreviewBadge');
    const cardStatus = document.getElementById('badgeImageryCardStatus');

    if (currentImg) {
      document.getElementById('lblImageryFileName').textContent = currentImg.file_name;
      document.getElementById('lblImageryFileSize').textContent = currentImg.file_size;
      document.getElementById('lblImageryResolution').textContent = currentImg.resolution || '2.8 cm / pixel';
      document.getElementById('lblImageryDimensions').textContent = `${currentImg.width || 4000} x ${currentImg.height || 3000} px`;
      document.getElementById('lblImagerySensor').textContent = currentImg.sensor || 'DJI Zenmuse P1 45MP';
      
      const statusText = currentImg.processing_status === 'DETECTION COMPLETE'
        ? 'Detection Complete'
        : (currentImg.processing_status === 'PROCESSING' ? 'Processing...' : 'Ready for AI Detection');
      document.getElementById('lblImageryStatus').textContent = statusText;
      
      if (cardStatus) {
        cardStatus.textContent = currentImg.processing_status;
        cardStatus.className = 'pm-status-tag ' + (currentImg.processing_status === 'DETECTION COMPLETE' ? 'tag-emerald' : 'tag-amber');
      }

      if (preview) {
        preview.onerror = () => {
          preview.onerror = null;
          preview.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260"><rect fill="%230b0f17" width="600" height="260"/><text fill="%2310b981" font-family="sans-serif" font-weight="bold" font-size="15" x="50%" y="45%" text-anchor="middle" dominant-baseline="middle">🛰️ Drone Orthomosaic Dataset Active</text><text fill="%2394a3b8" font-family="sans-serif" font-size="13" x="50%" y="58%" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(currentImg.file_name)} (${currentImg.file_size})</text></svg>`;
        };
        preview.src = this.getImageUrl(currentImg.file_url);
        preview.alt = currentImg.file_name;
      }
      if (badge) {
        badge.innerHTML = `<strong>${currentImg.file_name}</strong> &bull; ${currentImg.file_size} &bull; Source Imagery Active`;
      }
    } else {
      document.getElementById('lblImageryFileName').textContent = 'No imagery uploaded';
      document.getElementById('lblImageryFileSize').textContent = '-';
      document.getElementById('lblImageryResolution').textContent = '-';
      document.getElementById('lblImageryDimensions').textContent = '-';
      document.getElementById('lblImagerySensor').textContent = '-';
      document.getElementById('lblImageryStatus').textContent = 'Pending Upload';
      if (cardStatus) {
        cardStatus.textContent = 'Pending';
        cardStatus.className = 'pm-status-tag tag-amber';
      }
      if (preview) {
        preview.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260"><rect fill="%230b0f17" width="600" height="260"/><text fill="%2364748b" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">No Imagery Uploaded Yet</text></svg>';
      }
      if (badge) {
        badge.textContent = 'Awaiting Orthomosaic / Image Upload';
      }
    }
  }

  updateDetectionViewUI() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const container = document.getElementById('listProjectImagery');
    const countLabel = document.getElementById('lblImageryCount');

    if (countLabel) {
      countLabel.textContent = `${this.imagery.length} Image${this.imagery.length === 1 ? '' : 's'}`;
    }

    if (container) {
      if (!this.imagery || this.imagery.length === 0) {
        container.innerHTML = `<span style="font-size: 11px; color: var(--text-dim);">No images uploaded yet</span>`;
      } else {
        container.innerHTML = this.imagery.map(img => {
          const isSel = img.id === (currentImg ? currentImg.id : null);
          return `
            <div class="imagery-select-item" data-id="${img.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-radius: 4px; cursor: pointer; background: ${isSel ? 'rgba(16, 185, 129, 0.12)' : 'transparent'}; border: 1px solid ${isSel ? 'var(--accent-emerald)' : 'transparent'};">
              <span style="font-size: 11px; display: flex; align-items: center; gap: 6px; color: ${isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight: ${isSel ? '600' : 'normal'};">
                <span style="color: ${isSel ? 'var(--accent-emerald)' : 'var(--text-dim)'};">${isSel ? '●' : '○'}</span>
                <span style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${img.file_name}</span>
              </span>
              <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-dim);">${img.file_size}</span>
            </div>
          `;
        }).join('');

        container.querySelectorAll('.imagery-select-item').forEach(item => {
          item.addEventListener('click', async () => {
            this.selectedImageryId = item.dataset.id;
            localStorage.setItem('pm_selected_imagery_id', this.selectedImageryId);
            await this.loadProjectData(this.activeProjectId);
            this.updateDetectionViewUI();
            this.renderDetectionMap();
          });
        });
      }
    }

    // Image Information Box (Section 9)
    if (currentImg) {
      document.getElementById('infoImgFile').textContent = currentImg.file_name;
      document.getElementById('infoImgResolution').textContent = currentImg.resolution || `${currentImg.width} × ${currentImg.height} px`;
      document.getElementById('infoImgSize').textContent = currentImg.file_size;
      
      const statusText = currentImg.processing_status === 'DETECTION COMPLETE' 
        ? 'Ready for AI Detection (Detection Complete)' 
        : (currentImg.processing_status === 'PROCESSING' ? 'Processing Detection...' : 'Ready for AI Detection');
      document.getElementById('infoImgStatus').textContent = statusText;
      
      const badgeStatus = document.getElementById('badgeDetectionStatus');
      if (badgeStatus) {
        badgeStatus.textContent = currentImg.processing_status || 'READY';
        badgeStatus.className = 'pm-status-tag ' + (currentImg.processing_status === 'DETECTION COMPLETE' ? 'tag-emerald' : 'tag-amber');
      }

      // Progression strip (Section 19)
      document.getElementById('stepUploaded')?.classList.add('active');
      document.getElementById('stepReady')?.classList.add('active');
      if (currentImg.processing_status === 'PROCESSING') {
        document.getElementById('stepProcessing')?.classList.add('active');
        document.getElementById('stepComplete')?.classList.remove('active');
      } else if (currentImg.processing_status === 'DETECTION COMPLETE') {
        document.getElementById('stepProcessing')?.classList.add('active');
        document.getElementById('stepComplete')?.classList.add('active');
      } else {
        document.getElementById('stepProcessing')?.classList.remove('active');
        document.getElementById('stepComplete')?.classList.remove('active');
      }
    } else {
      document.getElementById('infoImgFile').textContent = 'None';
      document.getElementById('infoImgResolution').textContent = '-';
      document.getElementById('infoImgSize').textContent = '-';
      document.getElementById('infoImgStatus').textContent = 'Awaiting Upload';
      const badgeStatus = document.getElementById('badgeDetectionStatus');
      if (badgeStatus) {
        badgeStatus.textContent = 'PENDING';
        badgeStatus.className = 'pm-status-tag tag-amber';
      }
    }

    // Detected features count & dynamic category confidences (strictly scoped to active image)
    const relevantFeatures = this.features.filter(f => currentImg && f.imagery_id === currentImg.id);
    const totalBadge = document.getElementById('badgeFeatureTotal');
    if (totalBadge) {
      if (relevantFeatures.length === 0) {
        totalBadge.textContent = '0 Features';
        totalBadge.className = 'pm-status-tag tag-amber';
      } else {
        totalBadge.textContent = `${relevantFeatures.length} Total`;
        totalBadge.className = 'pm-status-tag tag-emerald';
      }
    }

    const getAvgConf = (types) => {
      const match = relevantFeatures.filter(f => types.includes(f.detection_type) || types.includes(f.feature_type));
      if (!match.length) return '-';
      const avg = match.reduce((s, f) => s + (f.confidence || 0.8), 0) / match.length;
      return `${Math.round(avg * 100)}% (${match.length})`;
    };

    const elRoads = document.getElementById('lblConfRoads');
    if (elRoads) elRoads.textContent = getAvgConf(['ROAD', 'Road']);

    const elBld = document.getElementById('lblConfBuildings');
    if (elBld) elBld.textContent = getAvgConf(['BUILDING', 'Building']);

    const elWalls = document.getElementById('lblConfWalls');
    if (elWalls) elWalls.textContent = getAvgConf(['WALL', 'Wall']);

    const elFences = document.getElementById('lblConfFences');
    if (elFences) elFences.textContent = getAvgConf(['FENCE', 'Fence']);

    const elFields = document.getElementById('lblConfFieldEdges');
    if (elFields) elFields.textContent = getAvgConf(['FIELD', 'Field Edge']);

    const elWater = document.getElementById('lblConfWater');
    if (elWater) elWater.textContent = getAvgConf(['WATER', 'Water']);
  }

  /* --------------------------------------------------------------------------
     AI DETECTION MAP & SOURCE IMAGERY RENDERING (SECTIONS 8, 10, 11, 13)
     -------------------------------------------------------------------------- */
  renderDetectionMap() {
    const mapDiv = document.getElementById('detectionMap');
    if (!mapDiv) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const banner = document.getElementById('bannerImagePreviewMode');
    const tagSource = document.getElementById('tagDetectionSourceType');

    // Clean up existing detection map if present
    if (this.maps.detection) {
      this.maps.detection.remove();
      this.maps.detection = null;
      this.detectionFeatureGroup = null;
    }

    if (!currentImg) {
      if (banner) banner.style.display = 'none';
      mapDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); gap: 12px; text-align: center; padding: 20px;">
          <div style="font-size: 40px;">🛰️</div>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-primary);">No Drone Imagery Uploaded</div>
          <div style="font-size: 13px; max-width: 360px;">Upload an aerial drone orthomosaic (JPG, PNG, GeoTIFF) in the Drone Imagery tab to run AI detection.</div>
          <button class="btn-pm btn-pm-primary" onclick="window.parcelMapApp.switchView('imagery')">Go to Drone Imagery Upload</button>
        </div>
      `;
      return;
    }

    mapDiv.innerHTML = '';

    const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || 
                            currentImg.file_name.toLowerCase().endsWith('.tiff') || 
                            Boolean(currentImg.metadata?.crs);

    if (banner) {
      banner.style.display = isGeoreferenced ? 'none' : 'flex';
    }
    if (tagSource) {
      tagSource.textContent = isGeoreferenced ? 'Georeferenced Orthomosaic' : 'Uploaded Drone Imagery';
    }

    const width = Number(currentImg.width) || 4000;
    const height = Number(currentImg.height) || 3000;

    if (!isGeoreferenced) {
      // IMAGE PREVIEW MODE (Section 10 & 11) using Leaflet L.CRS.Simple
      // The uploaded image is the actual background!
      const bounds = [[0, 0], [height, width]];
      this.maps.detection = L.map('detectionMap', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 3,
        zoomSnap: 0.25,
        attributionControl: false,
        zoomControl: true
      });

      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds).addTo(this.maps.detection);
      this.maps.detection.fitBounds(bounds);
      this.renderDetectionLayersOnImage(width, height);
    } else {
      // Georeferenced GIS imagery: center on project coordinates
      const center = this.project?.coordinates || [18.5818, 73.9875];
      this.maps.detection = L.map('detectionMap', { attributionControl: false, zoomControl: true }).setView(center, 16);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.detection);
      
      const delta = 0.003;
      const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.9 }).addTo(this.maps.detection);
      this.renderDetectionLayersGeoreferenced();
    }
  }

  renderDetectionLayersOnImage(width, height) {
    if (!this.maps.detection) return;
    if (this.detectionFeatureGroup) {
      this.detectionFeatureGroup.remove();
    }
    this.detectionFeatureGroup = L.featureGroup().addTo(this.maps.detection);

    const relevantFeatures = this.features.filter(f => f.imagery_id === this.selectedImageryId);
    this.updateDetectionConfidenceLabels();
    if (!relevantFeatures.length) return;

    const showRoads = document.getElementById('chkFeatRoads')?.checked ?? true;
    const showBuildings = document.getElementById('chkFeatBuildings')?.checked ?? true;
    const showWalls = document.getElementById('chkFeatWalls')?.checked ?? true;
    const showFences = document.getElementById('chkFeatFences')?.checked ?? true;
    const showFieldEdges = document.getElementById('chkFeatFieldEdges')?.checked ?? true;
    const showVegetation = document.getElementById('chkFeatVegetation')?.checked ?? true;
    const showWater = document.getElementById('chkFeatWater')?.checked ?? true;

    const filterType = document.getElementById('selFilterFeatureType')?.value || 'all';
    const filterConf = document.getElementById('selFilterConfidence')?.value || 'all';

    // Visual stacking hierarchy: water -> fields -> vegetation -> buildings -> walls -> fences -> roads
    const getLayerRank = (f) => {
      const t = (f.type || f.detection_type || '').toLowerCase();
      if (t.includes('water')) return 1;
      if (t.includes('field')) return 2;
      if (t.includes('veg')) return 3;
      if (t.includes('build')) return 4;
      if (t.includes('wall')) return 5;
      if (t.includes('fence')) return 6;
      if (t.includes('road')) return 7;
      return 3;
    };
    const sortedFeatures = [...relevantFeatures].sort((a, b) => getLayerRank(a) - getLayerRank(b));

    sortedFeatures.forEach(f => {
      let isVisible = false;
      const dType = (f.detection_type || f.type || '').toUpperCase();
      const fType = f.feature_type || f.type || '';
      const rawType = (f.type || '').toLowerCase();

      // Feature Type Filter (Step 6A Section 23)
      if (filterType !== 'all') {
        const matches = (rawType === filterType || dType === filterType.toUpperCase() || fType.toLowerCase().includes(filterType));
        if (!matches) return;
      }

      // Confidence Filter (Step 6A Section 23)
      const conf = f.confidence ?? 0.85;
      if (filterConf === 'high' && conf < 0.80) return;
      if (filterConf === 'medium' && (conf < 0.60 || conf >= 0.80)) return;
      if (filterConf === 'low' && (conf < 0.40 || conf >= 0.60)) return;

      if ((dType === 'ROAD' || fType === 'Road' || rawType === 'road') && showRoads) isVisible = true;
      else if ((dType === 'BUILDING' || fType === 'Building' || rawType === 'building') && showBuildings) isVisible = true;
      else if ((dType === 'WALL' || fType === 'Wall' || rawType === 'wall') && showWalls) isVisible = true;
      else if ((dType === 'FENCE' || fType === 'Fence' || rawType === 'fence') && showFences) isVisible = true;
      else if ((dType === 'FIELD' || dType === 'BOUNDARY' || fType === 'Field' || fType === 'Field Edge' || rawType === 'field') && showFieldEdges) isVisible = true;
      else if ((dType === 'VEGETATION' || fType === 'Vegetation' || rawType === 'vegetation') && showVegetation) isVisible = true;
      else if ((dType === 'WATER' || fType === 'Water' || rawType === 'water') && showWater) isVisible = true;

      if (!isVisible) return;

      // Coordinate mapping from image pixels (x, y) to Leaflet CRS.Simple [lat, lng]
      // In Leaflet CRS.Simple: lat = (height - y), lng = x
      let coords = [];
      let rawCoords = f.image_coordinates;
      if (!rawCoords || !rawCoords.length) {
        if (f.geometry && f.geometry.coordinates) {
          rawCoords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
        }
      }
      // Handle nested 3D arrays: [[[x, y], ...]]
      if (rawCoords && Array.isArray(rawCoords[0]) && Array.isArray(rawCoords[0][0])) {
        rawCoords = rawCoords[0];
      }
      if (rawCoords && rawCoords.length) {
        coords = rawCoords.filter(pt => Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number')
                          .map(pt => [height - pt[1], pt[0]]);
      } else if (this.project?.mode === 'demo' && this.selectedImageryId === 'img_wagholi_ortho') {
        const centerLat = this.project?.coordinates?.[0] || 18.5818;
        const centerLng = this.project?.coordinates?.[1] || 73.9875;
        const delta = 0.004;
        const toImgPt = (lng, lat) => {
          const x = Math.round(((lng - (centerLng - delta)) / (delta * 2)) * width);
          const y = Math.round((((centerLat + delta) - lat) / (delta * 2)) * height);
          return [height - y, x];
        };
        const gCoords = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates;
        if (gCoords && gCoords.length) {
          coords = gCoords.map(c => toImgPt(c[0], c[1]));
        }
      }

      if (!coords.length) return;

      const confPercent = Math.round((f.confidence || 0.85) * 100);
      const op = this.detectionOpacity ?? 0.40;
      let shape = null;
      if (dType === 'ROAD' || fType === 'Road' || rawType === 'road') {
        const isHwy = f.sub_type && f.sub_type.includes('Highway');
        shape = L.polyline(coords, {
          color: isHwy ? '#f59e0b' : '#fbbf24',
          weight: isHwy ? 5 : 3.5,
          opacity: Math.min(1.0, op * 2.5),
          lineCap: 'round',
          lineJoin: 'round'
        }).bindTooltip(`🛣️ ${f.name || 'Road'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'BUILDING' || fType === 'Building' || rawType === 'building') {
        shape = L.polygon(coords, {
          color: '#06b6d4',
          weight: 2,
          fillColor: '#0891b2',
          fillOpacity: Math.min(0.85, op * 0.85)
        }).bindTooltip(`🏠 ${f.name || 'Building'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'FIELD' || rawType === 'field' || (f.geometry?.type === 'Polygon' && (fType === 'Field Edge' || dType === 'BOUNDARY'))) {
        shape = L.polygon(coords, {
          color: '#84cc16',
          weight: 1.5,
          fillColor: '#65a30d',
          fillOpacity: op * 0.45
        }).bindTooltip(`🌾 ${f.name || 'Field Parcel'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'WALL' || fType === 'Wall' || rawType === 'wall') {
        shape = L.polyline(coords, {
          color: '#cbd5e1',
          weight: 2.5,
          opacity: Math.min(1.0, op * 2.0)
        }).bindTooltip(`🧱 ${f.name || 'Stone Wall'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'FENCE' || fType === 'Fence' || rawType === 'fence') {
        shape = L.polyline(coords, {
          color: '#ec4899',
          weight: 2,
          dashArray: '5 5',
          opacity: Math.min(1.0, op * 2.0)
        }).bindTooltip(`🚧 ${f.name || 'Fence'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'VEGETATION' || fType === 'Vegetation' || rawType === 'vegetation') {
        shape = L.polygon(coords, {
          color: '#10b981',
          weight: 1.5,
          fillColor: '#059669',
          fillOpacity: op * 0.50
        }).bindTooltip(`🌳 ${f.name || 'Vegetation Canopy'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'BOUNDARY' || fType === 'Field Edge') {
        shape = L.polyline(coords, {
          color: '#84cc16',
          weight: 2,
          opacity: Math.min(1.0, op * 1.8)
        }).bindTooltip(`🌾 ${f.name || 'Field Edge'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'WATER' || fType === 'Water' || rawType === 'water') {
        if (coords.length > 2 && (f.geometry?.type === 'Polygon' || rawType === 'water')) {
          shape = L.polygon(coords, {
            color: '#38bdf8',
            weight: 2,
            fillColor: '#0284c7',
            fillOpacity: op * 0.65
          }).bindTooltip(`💧 ${f.name || 'Water Body'} (${confPercent}%)`, { sticky: true });
        } else {
          shape = L.polyline(coords, {
            color: '#38bdf8',
            weight: 3.5,
            opacity: Math.min(1.0, op * 2.0)
          }).bindTooltip(`💧 ${f.name || 'Water Canal'} (${confPercent}%)`, { sticky: true });
        }
      }

      if (shape) {
        shape.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          this.showDetectionFeatureDetails(f, shape);
        });
        shape.addTo(this.detectionFeatureGroup);
      }
    });
  }

  renderDetectionLayersGeoreferenced() {
    if (!this.maps.detection) return;
    if (this.detectionFeatureGroup) {
      this.detectionFeatureGroup.remove();
    }
    this.detectionFeatureGroup = L.featureGroup().addTo(this.maps.detection);

    const relevantFeatures = this.features.filter(f => f.imagery_id === this.selectedImageryId);
    this.updateDetectionConfidenceLabels();
    if (!relevantFeatures.length) return;

    const showRoads = document.getElementById('chkFeatRoads')?.checked ?? true;
    const showBuildings = document.getElementById('chkFeatBuildings')?.checked ?? true;
    const showWalls = document.getElementById('chkFeatWalls')?.checked ?? true;
    const showFences = document.getElementById('chkFeatFences')?.checked ?? true;
    const showFieldEdges = document.getElementById('chkFeatFieldEdges')?.checked ?? true;
    const showVegetation = document.getElementById('chkFeatVegetation')?.checked ?? true;
    const showWater = document.getElementById('chkFeatWater')?.checked ?? true;

    const filterType = document.getElementById('selFilterFeatureType')?.value || 'all';
    const filterConf = document.getElementById('selFilterConfidence')?.value || 'all';

    relevantFeatures.forEach(f => {
      let isVisible = false;
      const dType = (f.detection_type || f.type || '').toUpperCase();
      const fType = f.feature_type || f.type || '';
      const rawType = (f.type || '').toLowerCase();

      // Feature Type Filter (Step 6A Section 23)
      if (filterType !== 'all') {
        const matches = (rawType === filterType || dType === filterType.toUpperCase() || fType.toLowerCase().includes(filterType));
        if (!matches) return;
      }

      // Confidence Filter (Step 6A Section 23)
      const conf = f.confidence ?? 0.85;
      if (filterConf === 'high' && conf < 0.80) return;
      if (filterConf === 'medium' && (conf < 0.60 || conf >= 0.80)) return;
      if (filterConf === 'low' && (conf < 0.40 || conf >= 0.60)) return;

      if ((dType === 'ROAD' || fType === 'Road' || rawType === 'road') && showRoads) isVisible = true;
      else if ((dType === 'BUILDING' || fType === 'Building' || rawType === 'building') && showBuildings) isVisible = true;
      else if ((dType === 'WALL' || fType === 'Wall' || rawType === 'wall') && showWalls) isVisible = true;
      else if ((dType === 'FENCE' || fType === 'Fence' || rawType === 'fence') && showFences) isVisible = true;
      else if ((dType === 'FIELD' || dType === 'BOUNDARY' || fType === 'Field' || fType === 'Field Edge' || rawType === 'field') && showFieldEdges) isVisible = true;
      else if ((dType === 'VEGETATION' || fType === 'Vegetation' || rawType === 'vegetation') && showVegetation) isVisible = true;
      else if ((dType === 'WATER' || fType === 'Water' || rawType === 'water') && showWater) isVisible = true;

      const geom = f.geo_geometry || f.geometry;
      if (!isVisible || !geom || !geom.coordinates) return;

      const confPercent = Math.round((f.confidence || 0.85) * 100);
      const op = this.detectionOpacity ?? 0.40;
      let shape = null;

      if (dType === 'ROAD' || fType === 'Road' || rawType === 'road') {
        const latlngs = geom.type === 'LineString' ? geom.coordinates.map(c => [c[1], c[0]]) : geom.coordinates[0].map(c => [c[1], c[0]]);
        const isHwy = f.sub_type && f.sub_type.includes('Highway');
        shape = L.polyline(latlngs, {
          color: isHwy ? '#f59e0b' : '#fbbf24',
          weight: isHwy ? 4 : 3,
          opacity: Math.min(1.0, op * 2.2)
        }).bindTooltip(`🛣️ ${f.name || 'Road'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'BUILDING' || fType === 'Building' || rawType === 'building') {
        const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
        shape = L.polygon(latlngs, {
          color: '#06b6d4',
          weight: 1.5,
          fillColor: '#0891b2',
          fillOpacity: op * 0.70
        }).bindTooltip(`🏠 ${f.name || 'Building'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'FIELD' || rawType === 'field' || (geom.type === 'Polygon' && (dType === 'BOUNDARY' || fType === 'Field Edge'))) {
        const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
        shape = L.polygon(latlngs, {
          color: '#84cc16',
          weight: 1.5,
          fillColor: '#65a30d',
          fillOpacity: op * 0.45
        }).bindTooltip(`🌾 ${f.name || 'Field Parcel'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'WALL' || fType === 'Wall' || rawType === 'wall') {
        const latlngs = geom.type === 'LineString' ? geom.coordinates.map(c => [c[1], c[0]]) : geom.coordinates[0].map(c => [c[1], c[0]]);
        shape = L.polyline(latlngs, {
          color: '#cbd5e1',
          weight: 2.5,
          opacity: Math.min(1.0, op * 2.0)
        }).bindTooltip(`🧱 ${f.name || 'Stone Wall'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'FENCE' || fType === 'Fence' || rawType === 'fence') {
        const latlngs = geom.type === 'LineString' ? geom.coordinates.map(c => [c[1], c[0]]) : geom.coordinates[0].map(c => [c[1], c[0]]);
        shape = L.polyline(latlngs, {
          color: '#ec4899',
          weight: 2,
          dashArray: '5 5',
          opacity: Math.min(1.0, op * 2.0)
        }).bindTooltip(`🚧 ${f.name || 'Fence'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'VEGETATION' || fType === 'Vegetation' || rawType === 'vegetation') {
        const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
        shape = L.polygon(latlngs, {
          color: '#10b981',
          weight: 1.5,
          fillColor: '#059669',
          fillOpacity: op * 0.50
        }).bindTooltip(`🌳 ${f.name || 'Vegetation Canopy'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'BOUNDARY' || fType === 'Field Edge') {
        const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
        shape = L.polyline(latlngs, {
          color: '#84cc16',
          weight: 2,
          opacity: Math.min(1.0, op * 1.8)
        }).bindTooltip(`🌾 ${f.name || 'Field Edge'} (${confPercent}%)`, { sticky: true });
      } else if (dType === 'WATER' || fType === 'Water' || rawType === 'water') {
        if (geom.type === 'Polygon') {
          const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
          shape = L.polygon(latlngs, {
            color: '#38bdf8',
            weight: 2,
            fillColor: '#0284c7',
            fillOpacity: op * 0.65
          }).bindTooltip(`💧 ${f.name || 'Water Body'} (${confPercent}%)`, { sticky: true });
        } else {
          const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
          shape = L.polyline(latlngs, {
            color: '#38bdf8',
            weight: 3.5,
            opacity: Math.min(1.0, op * 2.0)
          }).bindTooltip(`💧 ${f.name || 'Water Canal'} (${confPercent}%)`, { sticky: true });
        }
      }

      if (shape) {
        shape.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          this.showDetectionFeatureDetails(f, shape);
        });
        shape.addTo(this.detectionFeatureGroup);
      }
    });
  }

  showDetectionFeatureDetails(f, shapeLayer) {
    const panel = document.getElementById('detectionFeatureDetailsPanel');
    if (!panel) return;

    const rawType = (f.type || f.detection_type || 'feature').toLowerCase();
    const displayName = f.name || `${rawType.charAt(0).toUpperCase() + rawType.slice(1)} ${f.id ? f.id.slice(0, 8) : ''}`;
    const conf = f.confidence ?? 0.85;
    const confPercent = Math.round(conf * 100);

    let confTagClass = 'tag-emerald';
    let confLabel = 'High Confidence';
    if (conf >= 0.80) {
      confTagClass = 'tag-emerald';
      confLabel = 'High Confidence';
    } else if (conf >= 0.60) {
      confTagClass = 'tag-amber';
      confLabel = 'Medium Confidence';
    } else if (conf >= 0.40) {
      confTagClass = 'tag-rose';
      confLabel = 'Low Confidence';
    } else {
      confTagClass = 'tag-slate';
      confLabel = 'Uncertain';
    }

    const geomType = f.geometry?.type || f.geo_geometry?.type || 
      (f.image_coordinates?.length > 2 && (rawType === 'building' || rawType === 'field' || rawType === 'vegetation') ? 'Polygon' : 'LineString');

    const isML = (f.provider || f.properties?.provider || '').toLowerCase() === 'ml';
    const confPrefix = isML ? 'Model Confidence' : 'Evidence Score';

    const catEl = document.getElementById('dfFeatureCategory');
    if (catEl) catEl.textContent = isML ? 'BUILDING (ML INSTANCE SEGMENTATION)' : `${rawType.toUpperCase()} (CV-DERIVED EVIDENCE)`;

    const nameEl = document.getElementById('dfFeatureName');
    if (nameEl) nameEl.textContent = displayName;

    const tagConf = document.getElementById('dfConfidenceTag');
    if (tagConf) {
      tagConf.className = `pm-status-tag ${confTagClass}`;
      tagConf.textContent = `${confPrefix}: ${confPercent}%`;
    }

    const tagGeom = document.getElementById('dfGeometryType');
    if (tagGeom) tagGeom.textContent = geomType;

    const detIdEl = document.getElementById('dfDetectionId');
    if (detIdEl) detIdEl.textContent = f.id || 'N/A';

    const imgIdEl = document.getElementById('dfImageryId');
    if (imgIdEl) imgIdEl.textContent = f.imagery_id || this.selectedImageryId || 'N/A';

    const dimsEl = document.getElementById('dfDimensions');
    if (dimsEl) {
      if (f.properties?.area_image_pixels || f.area_image_pixels) {
        const area = Math.round(f.properties?.area_image_pixels || f.area_image_pixels);
        dimsEl.textContent = `${area.toLocaleString()} px²`;
      } else if (f.properties?.length_pixels || f.length_pixels) {
        const len = Math.round(f.properties?.length_pixels || f.length_pixels);
        dimsEl.textContent = `${len.toLocaleString()} px length`;
      } else if (f.image_coordinates) {
        dimsEl.textContent = `${f.image_coordinates.length} vertices`;
      } else {
        dimsEl.textContent = 'GIS Feature Geometry';
      }
    }

    const coordModeEl = document.getElementById('dfCoordinateMode');
    if (coordModeEl) {
      coordModeEl.textContent = f.coordinate_mode === 'geographic' ? 'Geographic Space (GIS)' : 'Image Space (Pixels)';
    }

    const providerEl = document.getElementById('dfProvider');
    if (providerEl) {
      const prov = (f.provider || f.properties?.provider || 'ml').toLowerCase();
      providerEl.textContent = prov === 'ml' ? 'ML Detection' : (prov === 'opencv_fallback' ? 'OpenCV Fallback' : (prov === 'demo' ? 'Demo Mode' : 'CV-derived Evidence'));
      providerEl.style.color = prov === 'ml' ? 'var(--accent-emerald)' : (prov === 'opencv_fallback' ? 'var(--accent-amber)' : '#f59e0b');
    }

    const modelEl = document.getElementById('dfModel');
    if (modelEl) {
      modelEl.textContent = isML 
        ? (f.model_name || f.properties?.model_name || 'YOLOv8n-seg (Keremberke Aerial Building Model)')
        : (f.properties?.method || f.method || 'Road corridor / contour analysis');
    }

    const sourceEl = document.getElementById('dfSource');
    if (sourceEl) {
      sourceEl.textContent = f.source || f.properties?.source || (isML ? 'Aerial Building Model' : 'OpenCV Land Feature Analyzer');
    }

    const statusEl = document.getElementById('dfStatus');
    if (statusEl) {
      statusEl.textContent = 'Preliminary Evidence';
    }

    const createdEl = document.getElementById('dfCreatedAt');
    if (createdEl) {
      const dt = f.created_at || f.properties?.created_at;
      createdEl.textContent = dt ? new Date(dt).toLocaleTimeString() : 'Current Run';
    }

    const badgesEl = document.getElementById('dfEvidenceBadges');
    if (badgesEl) {
      const evidenceList = f.evidence || f.properties?.evidence || [];
      if (evidenceList.length) {
        badgesEl.innerHTML = evidenceList.map(ev => 
          `<span class="pm-status-tag tag-blue" style="font-size: 10px; text-transform: capitalize;">${String(ev).replace(/_/g, ' ')}</span>`
        ).join('');
      } else {
        badgesEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">Standard spectral signature</span>`;
      }
    }

    panel.style.display = 'block';
  }

  updateDetectionConfidenceLabels() {
    const relevantFeatures = this.features.filter(f => f.imagery_id === this.selectedImageryId);
    const totalBadge = document.getElementById('badgeFeatureTotal');
    if (totalBadge) {
      if (relevantFeatures.length === 0) {
        totalBadge.textContent = '0 Features';
        totalBadge.className = 'pm-status-tag tag-amber';
      } else {
        totalBadge.textContent = `${relevantFeatures.length} Total`;
        totalBadge.className = 'pm-status-tag tag-emerald';
      }
    }
    const classes = {
      Roads: ['road'],
      Buildings: ['building'],
      Walls: ['wall'],
      Fences: ['fence'],
      FieldEdges: ['field', 'boundary'],
      Vegetation: ['vegetation'],
      Water: ['water']
    };

    Object.entries(classes).forEach(([key, matches]) => {
      const matchingFeats = relevantFeatures.filter(f => {
        const t = (f.type || f.detection_type || f.feature_type || '').toLowerCase();
        return matches.some(m => t === m || t.includes(m));
      });
      const labelEl = document.getElementById(`lblConf${key}`);
      if (labelEl) {
        if (matchingFeats.length > 0) {
          const avg = Math.round((matchingFeats.reduce((sum, f) => sum + (f.confidence || 0.8), 0) / matchingFeats.length) * 100);
          const typeWord = key === 'Buildings' ? 'confidence' : 'evidence';
          if (key === 'Water') {
            const bodyCount = matchingFeats.filter(f => (f.sub_type || f.properties?.sub_type || '').toLowerCase().includes('body')).length;
            const canalCount = matchingFeats.filter(f => (f.sub_type || f.properties?.sub_type || '').toLowerCase().includes('canal')).length;
            if (bodyCount > 0 && canalCount === 0) {
              labelEl.textContent = `${bodyCount} Body / 0 Canals (${avg}% ${typeWord})`;
            } else if (canalCount > 0 && bodyCount === 0) {
              labelEl.textContent = `${canalCount} Canals (${avg}% ${typeWord})`;
            } else {
              labelEl.textContent = `${matchingFeats.length} (${avg}% ${typeWord})`;
            }
          } else {
            labelEl.textContent = `${matchingFeats.length} (${avg}% ${typeWord})`;
          }
          labelEl.style.opacity = '1';
          labelEl.style.color = 'inherit';
        } else {
          labelEl.textContent = '0 — No reliable detections';
          labelEl.style.opacity = '0.55';
          labelEl.style.color = 'var(--text-muted)';
        }
      }
    });

    const elMode = document.getElementById('badgeAiMode');
    const elModel = document.getElementById('lblAiModelName');
    const elTag = document.getElementById('lblAiProviderTag');
    if (relevantFeatures.length > 0) {
      const firstFeat = relevantFeatures[0];
      const prov = (firstFeat.provider || firstFeat.properties?.provider || 'ml').toLowerCase();
      if (elMode) {
        elMode.textContent = prov === 'ml' ? 'ML Detection' : (prov === 'opencv_fallback' ? 'OpenCV Fallback' : (prov === 'demo' ? 'Demo Mode' : 'CV Feature Separation'));
      }
      if (elModel) {
        elModel.textContent = firstFeat.model_name || firstFeat.properties?.model_name || (prov === 'ml' ? 'YOLOv8n-seg' : 'OpenCV Land Feature Analyzer');
      }
      if (elTag) {
        elTag.textContent = prov === 'ml' ? 'LOCAL INFERENCE' : (prov === 'opencv_fallback' ? 'FALLBACK ENGINE' : 'PRESENTATION');
      }
    } else {
      if (elMode) elMode.textContent = 'Ready for AI Detection';
      if (elModel) elModel.textContent = 'YOLOv8n-seg + Aerial CV';
      if (elTag) elTag.textContent = 'LOCAL INFERENCE';
    }
  }

  bindAiDetectionActions() {
    // Feature inspector close button
    document.getElementById('btnCloseDetectionFeatureCard')?.addEventListener('click', () => {
      const panel = document.getElementById('detectionFeatureDetailsPanel');
      if (panel) panel.style.display = 'none';
    });

    // Detection Opacity Slider (Step 6B Requirement 16)
    const rngOpacity = document.getElementById('rngDetectionOpacity');
    rngOpacity?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.detectionOpacity = val / 100.0;
      const lbl = document.getElementById('lblDetectionOpacityVal');
      if (lbl) lbl.textContent = `${val}%`;
      const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
      if (currentImg) {
        const width = Number(currentImg.width) || 4000;
        const height = Number(currentImg.height) || 3000;
        const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs);
        if (isGeoreferenced) {
          this.renderDetectionLayersGeoreferenced();
        } else {
          this.renderDetectionLayersOnImage(width, height);
        }
      }
    });

    // Developer Debug Mode Toggle (Step 6B Requirement 24)
    const btnToggleDebug = document.getElementById('btnToggleDebugMode');
    const debugModal = document.getElementById('debugPipelineModal');
    btnToggleDebug?.addEventListener('click', () => {
      if (debugModal) {
        const isShown = debugModal.style.display !== 'none';
        debugModal.style.display = isShown ? 'none' : 'block';
        if (!isShown) this.updateDebugModal();
      }
    });

    const btnCloseDebug = document.getElementById('btnCloseDebugPipelineModal');
    btnCloseDebug?.addEventListener('click', () => {
      if (debugModal) debugModal.style.display = 'none';
    });

    const btnRun = document.getElementById('btnRunAiDetection');
    btnRun?.addEventListener('click', async () => {
      if (!this.activeProjectId) {
        this.showToast('Please select or create a project first', 'error');
        return;
      }
      if (!this.selectedImageryId && (!this.imagery || !this.imagery.length)) {
        this.showToast('No imagery uploaded yet. Please upload drone imagery first.', 'warning');
        this.switchView('imagery');
        return;
      }

      const imageryId = this.selectedImageryId || this.imagery[0].id;
      const currentImg = this.imagery.find(i => i.id === imageryId) || this.imagery[0];

      // Update UI for processing state
      btnRun.disabled = true;
      const textSpan = document.getElementById('btnRunAiDetectionText');
      if (textSpan) textSpan.textContent = 'Running Multi-Class Detection...';
      const badgeStatus = document.getElementById('badgeDetectionStatus');
      if (badgeStatus) {
        badgeStatus.textContent = 'PROCESSING';
        badgeStatus.className = 'pm-status-tag tag-amber';
      }
      document.getElementById('stepProcessing')?.classList.add('active');
      document.getElementById('stepComplete')?.classList.remove('active');
      const detPanel = document.getElementById('detectionFeatureDetailsPanel');
      if (detPanel) detPanel.style.display = 'none';

      // Progressive Stage Progression (Step 6A Section 25)
      const stageEl = document.getElementById('lblDetectionStage');
      if (stageEl) {
        stageEl.style.display = 'block';
        stageEl.style.color = 'var(--accent-emerald)';
        stageEl.textContent = 'Queued';
      }
      const stages = [
        'Preparing Image...',
        'Analyzing Image Tiles...',
        'Running YOLOv8n-seg Instance Segmentation...',
        'Extracting Land Feature Geometry...',
        'Generating Clean GeoJSON...'
      ];
      let sIdx = 0;
      const stageInterval = setInterval(() => {
        if (stageEl && sIdx < stages.length) {
          stageEl.textContent = stages[sIdx++];
        }
      }, 350);

      this.showToast(`[ML Detection Pipeline] Running YOLOv8n-seg & land feature analysis for ${currentImg?.file_name || 'image'}...`, 'info');

      try {
        let res = await fetch(`${this.apiBase}/imagery/${imageryId}/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'ml', provider: 'ml' })
        });

        // Fallback to project endpoint if needed
        if (!res.ok) {
          res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagery_id: imageryId, mode: 'ml', provider: 'ml' })
          });
        }

        const data = await res.json();
        clearInterval(stageInterval);

        if (data.success) {
          if (stageEl) stageEl.textContent = 'Detection Complete';
          this.features = data.features || data.detections || [];
          this.currentDetectionRunId = data.detection_run_id || null;
          this.currentDetectionDebug = data.debug || null;
          this.currentDetectionData = data;
          this.updateDebugModal();
          if (currentImg) currentImg.processing_status = 'DETECTION COMPLETE';

          const elExecTime = document.getElementById('lblAiExecTime');
          if (elExecTime) elExecTime.textContent = `${data.execution_time_ms || 0}ms`;

          const elMode = document.getElementById('badgeAiMode');
          if (elMode) {
            elMode.textContent = data.provider === 'ml' ? 'ML Detection' : (data.provider === 'opencv_fallback' ? 'OpenCV Fallback' : 'Demo Mode');
          }
          const elModel = document.getElementById('lblAiModelName');
          if (elModel) {
            elModel.textContent = data.model || data.model_name || 'YOLOv8n-seg';
          }

          const count = data.features_count ?? this.features.length;
          if (count === 0) {
            this.showToast('No detectable features were found in this image.', 'warning');
            if (badgeStatus) {
              badgeStatus.textContent = 'NO FEATURES FOUND';
              badgeStatus.className = 'pm-status-tag tag-rose';
            }
            const infoStatus = document.getElementById('infoImgStatus');
            if (infoStatus) infoStatus.textContent = 'No detectable features were found in this image.';
            if (stageEl) stageEl.textContent = 'No detectable features found';
          } else {
            const s = data.summary || {};
            const summaryStr = `(Roads: ${s.roads || 0}, Bldgs: ${s.buildings || 0}, Fields: ${s.fields || 0}, Walls: ${s.walls || 0}, Fences: ${s.fences || 0}, Veg: ${s.vegetation || 0}, Water: ${s.water || 0})`;
            this.showToast(`Multi-Class Detection Complete! Found ${count} features ${summaryStr}.`, 'success');

            if (badgeStatus) {
              badgeStatus.textContent = 'DETECTION COMPLETE';
              badgeStatus.className = 'pm-status-tag tag-emerald';
            }
            const infoStatus = document.getElementById('infoImgStatus');
            if (infoStatus) infoStatus.textContent = `Ready for AI Detection (${count} Features Separated)`;
          }

          btnRun.disabled = false;
          if (textSpan) textSpan.textContent = 'Re-run AI Detection';
          document.getElementById('stepComplete')?.classList.add('active');

          // Reload project data to update progress & other views
          await this.loadProjectData(this.activeProjectId);
          this.renderDetectionMap();
          this.updateDetectionConfidenceLabels();
        } else {
          throw new Error(data.error || 'Detection failed on uploaded image');
        }
      } catch (err) {
        clearInterval(stageInterval);
        console.error('Detection failed:', err);
        btnRun.disabled = false;
        if (textSpan) textSpan.textContent = 'Retry Detection';
        if (badgeStatus) {
          badgeStatus.textContent = 'DETECTION FAILED';
          badgeStatus.className = 'pm-status-tag tag-rose';
        }
        if (stageEl) {
          stageEl.textContent = 'Detection Failed';
          stageEl.style.color = 'var(--accent-rose)';
        }
        document.getElementById('stepProcessing')?.classList.add('failed');
        this.showToast(`Detection failed: ${err.message}`, 'error');
      }
    });

    // Feature layer toggles & dropdown filters (all 7 classes + filters)
    ['selFilterFeatureType', 'selFilterConfidence', 'chkFeatRoads', 'chkFeatBuildings', 'chkFeatWalls', 'chkFeatFences', 'chkFeatFieldEdges', 'chkFeatVegetation', 'chkFeatWater'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
        if (currentImg) {
          const width = Number(currentImg.width) || 4000;
          const height = Number(currentImg.height) || 3000;
          const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs);
          if (isGeoreferenced) {
            this.renderDetectionLayersGeoreferenced();
          } else {
            this.renderDetectionLayersOnImage(width, height);
          }
        }
      });
    });
  }

  updateDebugModal() {
    const data = this.currentDetectionData || {};
    const debug = this.currentDetectionDebug || data.debug || {};
    const diag = data.diagnostic_summary || debug.diagnostic_summary || {};
    const rejectionReasons = diag.rejection_reasons || debug.rejection_categories || {};

    const rawCount = diag.raw_candidates ?? ((this.features?.length || 0) + (diag.rejected || debug.rejected_geometry_count || 0));
    const acceptedCount = diag.accepted ?? (this.features?.length || 0);
    const rejectedCount = diag.rejected ?? (debug.rejected_geometry_count || 0);

    const elRaw = document.getElementById('dbgRawCandidatesCount');
    const elAccepted = document.getElementById('dbgAcceptedCount');
    const elRejected = document.getElementById('dbgRejectedTotalCount');

    if (elRaw) elRaw.textContent = rawCount.toLocaleString();
    if (elAccepted) elAccepted.textContent = acceptedCount.toLocaleString();
    if (elRejected) elRejected.textContent = rejectedCount.toLocaleString();

    // Standard 9 Rejection Categories (Step 6B Final Req 8)
    const rejMap = {
      'dbgRejWaterCrossing': rejectionReasons['Water crossing'] || 0,
      'dbgRejUnsupportedLine': rejectionReasons['Unsupported line'] || 0,
      'dbgRejImageEdgeArtifact': rejectionReasons['Image-edge artifact'] || 0,
      'dbgRejInsufficientContinuity': rejectionReasons['Insufficient continuity'] || 0,
      'dbgRejInvalidGeometry': rejectionReasons['Invalid geometry'] || 0,
      'dbgRejDuplicateGeometry': rejectionReasons['Duplicate geometry'] || 0,
      'dbgRejWeakEvidence': rejectionReasons['Weak evidence'] || 0,
      'dbgRejExcessiveSize': rejectionReasons['Excessive size'] || 0,
      'dbgRejDisconnectedFeature': rejectionReasons['Disconnected feature'] || 0,
    };

    Object.entries(rejMap).forEach(([elId, count]) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = count.toLocaleString();
    });

    // Per-Class Raw -> Accepted -> Rejected Diagnostic Breakdown (Step 6B/C Req 13)
    const classData = diag.classes || debug.pipeline_stages?.classes || {};
    const classesList = ['buildings', 'roads', 'fields', 'walls', 'fences', 'vegetation', 'water'];
    const summaryData = data.summary || {};
    const rawStages = debug.pipeline_stages?.stage_1_raw || {};

    classesList.forEach(cls => {
      let info = classData[cls];
      if (!info) {
        const acc = summaryData[cls] ?? (this.features?.filter(f => {
          const t = (f.type || f.detection_type || '').toLowerCase();
          return t.startsWith(cls.slice(0, 4));
        }).length || 0);
        const raw = rawStages[cls] ?? acc;
        info = { raw, accepted: acc, rejected: Math.max(0, raw - acc) };
      }
      const elRaw = document.getElementById(`dbgClassRaw_${cls}`);
      const elAcc = document.getElementById(`dbgClassAcc_${cls}`);
      const elRej = document.getElementById(`dbgClassRej_${cls}`);
      if (elRaw) elRaw.textContent = (info.raw || 0).toLocaleString();
      if (elAcc) elAcc.textContent = `${(info.accepted || 0).toLocaleString()} accepted`;
      if (elRej) elRej.textContent = `${(info.rejected || 0).toLocaleString()} rejected`;
    });

    // Rejection summary & list
    const elSum = document.getElementById('dbgRejectedSummary');
    if (elSum) elSum.textContent = `${rejectedCount.toLocaleString()} rejected`;

    const elList = document.getElementById('dbgRejectedList');
    if (elList) {
      const rejectedList = debug.rejected_detections || [];
      if (rejectedList.length === 0) {
        elList.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">No rejected candidates logged.</span>`;
      } else {
        elList.innerHTML = rejectedList.slice(0, 30).map(r => {
          const cat = r.category || 'Rejected';
          const reason = r.reason || 'Failed geometry / quality checks';
          const cls = r.class ? `[${r.class.toUpperCase()}] ` : '';
          const score = r.score !== undefined ? ` (score: ${r.score})` : '';
          return `<div style="padding: 4px 6px; border-radius: 3px; background: rgba(255,255,255,0.04); border-left: 2px solid #f43f5e; margin-bottom: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #fb7185; font-weight: 700;">${cat}</span>
              <span style="color: var(--text-dim); font-size: 9px;">${cls}${score}</span>
            </div>
            <div style="color: var(--text-secondary); font-size: 9.5px; margin-top: 1px;">${reason}</div>
          </div>`;
        }).join('');
      }
    }

    // Timings
    const timings = debug.timings_ms || {};
    const elMl = document.getElementById('dbgTimingMl');
    const elCv = document.getElementById('dbgTimingCv');
    if (elMl) elMl.textContent = timings.ml_building_inference ? `${timings.ml_building_inference}ms` : '-';
    if (elCv) elCv.textContent = timings.cv_land_features ? `${timings.cv_land_features}ms` : '-';

    // Road network
    const roadStats = debug.road_network || {};
    const elRoadSegs = document.getElementById('dbgRoadSegs');
    const elRoadInters = document.getElementById('dbgRoadInters');
    if (elRoadSegs) elRoadSegs.textContent = roadStats.total_segments !== undefined ? roadStats.total_segments : '-';
    if (elRoadInters) elRoadInters.textContent = roadStats.intersections_detected !== undefined ? roadStats.intersections_detected : '-';
  }

  /* --------------------------------------------------------------------------
     4. VERIFICATION WORKSPACE MAP & LAYERS
     -------------------------------------------------------------------------- */
  renderVerifyMapLayers() {
    if (!this.maps.verify) return;

    // Clear all layer groups
    Object.values(this.verifyLayers).forEach(group => group.clearLayers());

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const height = Number(currentImg?.height) || 3000;
    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

    const showDrone = document.getElementById('vchkDroneImagery')?.checked ?? true;
    const showSatellite = document.getElementById('vchkSatellite')?.checked ?? true;
    const showRoads = document.getElementById('vchkRoads')?.checked ?? true;
    const showBuildings = document.getElementById('vchkBuildings')?.checked ?? true;
    const showBoundaries = document.getElementById('vchkBoundaries')?.checked ?? true;
    const showAiParcels = document.getElementById('vchkAiParcels')?.checked ?? true;
    const showVerifiedParcels = document.getElementById('vchkVerifiedParcels')?.checked ?? true;
    const showUncertainty = document.getElementById('vchkUncertainty')?.checked ?? true;

    // Basemap: High-res satellite (for georeferenced projects)
    if (showSatellite && isGeoreferenced) {
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
        .addTo(this.verifyLayers.satellite);
    }

    // Drone Orthomosaic layer
    if (showDrone && currentImg && currentImg.file_url) {
      if (isGeoreferenced) {
        const center = this.project?.coordinates || [18.5818, 73.9875];
        const delta = 0.0035;
        const droneBounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
        L.imageOverlay(this.getImageUrl(currentImg.file_url), droneBounds, { opacity: 0.85 }).addTo(this.verifyLayers.droneImagery);
        L.rectangle(droneBounds, {
          color: '#10b981',
          weight: 2,
          dashArray: '6 4',
          fillColor: '#10b981',
          fillOpacity: 0.04
        }).addTo(this.verifyLayers.droneImagery);
      }
    }

    // Contextual Features
    const relevantFeatures = this.features.filter(f => currentImg && f.imagery_id === currentImg.id);

    // Detected Roads
    if (showRoads) {
      relevantFeatures.filter(f => f.detection_type === 'ROAD' || f.feature_type === 'Road').forEach(r => {
        const rawCoords = (!isGeoreferenced && r.image_coordinates) ? r.image_coordinates : (r.geo_geometry?.coordinates || r.geometry?.coordinates || []);
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          const isHwy = r.sub_type && r.sub_type.includes('Highway');
          L.polyline(latlngs, {
            color: isHwy ? '#f59e0b' : '#fbbf24',
            weight: isHwy ? 6 : 3.5,
            opacity: 0.85
          }).bindTooltip(`🛣️ ${r.name || 'Road'} (Conf: ${Math.round((r.confidence || 0.8) * 100)}%)`, { sticky: true }).addTo(this.verifyLayers.roads);
        }
      });
    }

    // Detected Buildings
    if (showBuildings) {
      relevantFeatures.filter(f => f.detection_type === 'BUILDING' || f.feature_type === 'Building').forEach(b => {
        const rawCoords = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geo_geometry?.coordinates?.[0] || b.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, {
            color: '#06b6d4',
            weight: 1.8,
            fillColor: '#0891b2',
            fillOpacity: 0.55
          }).bindTooltip(`🏢 Structure (Conf: ${Math.round((b.confidence || 0.8) * 100)}%)`, { sticky: true }).addTo(this.verifyLayers.buildings);
        }
      });
    }

    // Detected Boundaries (Walls, Fences, Field Edges)
    if (showBoundaries) {
      relevantFeatures.filter(f => ['WALL', 'FENCE', 'BOUNDARY', 'Wall', 'Fence', 'Field Edge'].includes(f.detection_type || f.feature_type)).forEach(b => {
        const rawCoords = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geo_geometry?.coordinates || b.geometry?.coordinates || []);
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          const isFence = (b.detection_type === 'FENCE' || b.feature_type === 'Fence');
          const isWall = (b.detection_type === 'WALL' || b.feature_type === 'Wall');
          const color = isWall ? '#e2e8f0' : (isFence ? '#ec4899' : '#84cc16');
          L.polyline(latlngs, {
            color,
            weight: 2.5,
            dashArray: isFence ? '4 4' : null,
            opacity: 0.9
          }).bindTooltip(`${b.feature_type || 'Boundary'} (Conf: ${Math.round((b.confidence || 0.8) * 100)}%)`, { sticky: true }).addTo(this.verifyLayers.boundaries);
        }
      });
    }

    // Parcels: AI Preliminary & Verified (Requirement 10: HIGHLIGHT ONLY SELECTED PARCEL)
    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);

    currentParcels.forEach(parcel => {
      const pId = parcel.parcel_id || parcel.id;
      const isSelected = pId === this.selectedParcelId;
      const isAccepted = parcel.status === 'accepted' || parcel.status === 'Human Verified';
      const isNeedsReview = parcel.status === 'needs_review' || parcel.status === 'Needs Review';
      const isRejected = parcel.status === 'rejected' || parcel.status === 'Rejected';

      // Hide rejected unless actively selected by user
      if (isRejected && !isSelected) return;

      if (isAccepted && !showVerifiedParcels) return;
      if (!isAccepted && !showAiParcels) return;

      const rawCoords = (!isGeoreferenced && parcel.image_coordinates?.[0]) ? parcel.image_coordinates[0] : (parcel.geo_geometry?.coordinates?.[0] || parcel.geometry?.coordinates?.[0] || []);
      if (!rawCoords || rawCoords.length < 3) return;

      const latlngs = rawCoords.map(toLeaflet);

      let strokeColor = '#3b82f6';
      let fillColor = '#1d4ed8';
      let fillOpacity = 0.12;
      let weight = 1.8;

      if (isAccepted) {
        strokeColor = '#10b981';
        fillColor = '#059669';
        fillOpacity = 0.20;
      } else if (isNeedsReview || (parcel.confidence || 0) < 0.60) {
        strokeColor = '#f59e0b';
        fillColor = '#d97706';
        fillOpacity = 0.20;
      }

      if (isRejected) {
        strokeColor = '#f43f5e';
        fillColor = '#be123c';
        fillOpacity = 0.15;
      }

      // REQUIREMENT 10: When a parcel is clicked: Highlight ONLY that parcel.
      if (isSelected) {
        strokeColor = '#38bdf8';
        fillColor = '#0284c7';
        fillOpacity = 0.45;
        weight = 4;
      } else {
        weight = 1.6;
        fillOpacity = Math.min(fillOpacity, 0.10);
      }

      const poly = L.polygon(latlngs, {
        color: strokeColor,
        weight,
        fillColor,
        fillOpacity
      });

      poly.on('click', () => {
        this.selectParcel(pId);
      });

      const areaText = isGeoreferenced ? `${parcel.area_hectares || parcel.area || 0} ha` : (parcel.area_px ? `${parcel.area_px.toLocaleString()} px²` : 'Image-space');
      poly.bindTooltip(`
        <strong>${pId}</strong><br>
        Status: ${parcel.status || 'Preliminary'}<br>
        Area: ${areaText}<br>
        Confidence: ${Math.round((parcel.confidence || 0.8) * 100)}%
      `, { sticky: true });

      if (isAccepted) {
        poly.addTo(this.verifyLayers.verifiedParcels);
      } else {
        poly.addTo(this.verifyLayers.aiParcels);
      }

      // Centroid label badge
      const center = poly.getBounds().getCenter();
      const labelIcon = L.divIcon({
        className: 'parcel-centroid-marker',
        html: `<div style="font-size: 10px; font-family: var(--font-mono); font-weight: 700; color: ${isSelected ? '#38bdf8' : '#fff'}; background: rgba(15, 23, 42, ${isSelected ? '0.95' : '0.8'}); padding: 1px 5px; border-radius: 4px; border: 1px solid ${strokeColor}; white-space: nowrap;">${pId}</div>`,
        iconSize: [40, 16],
        iconAnchor: [20, 8]
      });
      L.marker(center, { icon: labelIcon, interactive: false }).addTo(isAccepted ? this.verifyLayers.verifiedParcels : this.verifyLayers.aiParcels);
    });

    // Uncertainty Flags Layer
    if (showUncertainty) {
      currentParcels.filter(p => (p.confidence || 0) < 0.60 || p.status === 'needs_review' || p.topology_issue).forEach(p => {
        const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0]) ? p.image_coordinates[0] : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const center = toLeaflet(rawCoords[0]);
          L.circleMarker(center, {
            radius: 8,
            color: '#f43f5e',
            fillColor: '#f43f5e',
            fillOpacity: 0.6,
            weight: 2
          }).bindTooltip(`⚠ Review Flag: ${p.parcel_id} (${Math.round((p.confidence || 0.5) * 100)}% Conf)`, { sticky: true }).addTo(this.verifyLayers.uncertainty);
        }
      });
    }

    // Render active vertex editing handles
    if (this.editMode) {
      this.renderVertexHandles();
    }
  }

  /* --------------------------------------------------------------------------
     5. PARCEL LIST (LEFT COLUMN - Requirement 9)
     -------------------------------------------------------------------------- */
  renderVerifyParcelList() {
    const container = document.getElementById('containerVerifyParcelList');
    const countLabel = document.getElementById('lblVerifyParcelCount');
    if (!container) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;

    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);

    // Update real verification summary metrics (Requirement 9)
    const totalCount = currentParcels.length;
    const acceptedCount = currentParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified').length;
    const needsReviewCount = currentParcels.filter(p => p.status === 'needs_review' || p.status === 'Needs Review').length;
    const rejectedCount = currentParcels.filter(p => p.status === 'rejected' || p.status === 'Rejected').length;

    const elTot = document.getElementById('vsumTotal');
    const elAcc = document.getElementById('vsumAccepted');
    const elRev = document.getElementById('vsumNeedsReview');
    const elRej = document.getElementById('vsumRejected');
    if (elTot) elTot.textContent = totalCount;
    if (elAcc) elAcc.textContent = acceptedCount;
    if (elRev) elRev.textContent = needsReviewCount;
    if (elRej) elRej.textContent = rejectedCount;

    const elProjImg = document.getElementById('lblVerifyCurrentProjectImg');
    if (elProjImg) {
      elProjImg.textContent = `${this.project ? this.project.name : 'Active Project'} • ${currentImg ? currentImg.file_name : 'Imagery'}`;
    }

    let filtered = currentParcels.slice();

    if (this.parcelFilterStatus === 'pending') {
      filtered = filtered.filter(p => p.status === 'Pending' || p.status === 'preliminary' || p.status === 'AI Generated' || (!p.status?.includes('Verified') && p.status !== 'accepted' && p.status !== 'rejected' && p.status !== 'needs_review'));
    } else if (this.parcelFilterStatus === 'needs_review') {
      filtered = filtered.filter(p => p.status === 'needs_review' || p.status === 'Needs Review');
    } else if (this.parcelFilterStatus === 'accepted') {
      filtered = filtered.filter(p => p.status === 'accepted' || p.status === 'Human Verified');
    } else if (this.parcelFilterStatus === 'rejected') {
      filtered = filtered.filter(p => p.status === 'rejected' || p.status === 'Rejected');
    } else if (this.parcelFilterStatus === 'low_conf') {
      filtered = filtered.filter(p => (p.confidence || 0) < 0.60);
    }

    if (this.parcelFilterQuery) {
      filtered = filtered.filter(p => (p.parcel_id || p.id).toLowerCase().includes(this.parcelFilterQuery));
    }

    if (countLabel) {
      countLabel.textContent = `${filtered.length} of ${currentParcels.length}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px 10px; font-size: 11px;">No parcels match filter.</div>`;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(p => {
      const pId = p.parcel_id || p.id;
      const isSel = pId === this.selectedParcelId;
      const conf = p.confidence != null ? p.confidence : 0.8;
      const confLevel = conf >= 0.80 ? 'High' : (conf >= 0.60 ? 'Medium' : 'Low');
      const confColor = confLevel === 'High' ? 'var(--accent-emerald)' : (confLevel === 'Medium' ? 'var(--accent-amber)' : '#f43f5e');

      let statusDisplay = 'PRELIMINARY';
      let statusTagClass = 'tag-blue';
      if (p.status === 'accepted' || p.status === 'Human Verified') {
        statusDisplay = 'ACCEPTED';
        statusTagClass = 'tag-emerald';
      } else if (p.status === 'needs_review' || p.status === 'Needs Review') {
        statusDisplay = 'NEEDS_REVIEW';
        statusTagClass = 'tag-amber';
      } else if (p.status === 'rejected' || p.status === 'Rejected') {
        statusDisplay = 'REJECTED';
        statusTagClass = 'tag-rose';
      } else {
        statusDisplay = 'PRELIMINARY';
        statusTagClass = 'tag-blue';
      }

      // Requirement 9: Area (only if georeferenced)
      let areaStr = '';
      if (isGeoreferenced && (p.area_hectares || p.area_sqm)) {
        areaStr = p.area_hectares ? `${p.area_hectares} ha` : `${p.area_sqm} m²`;
      } else if (p.area && isGeoreferenced) {
        areaStr = p.area;
      }

      const card = document.createElement('div');
      card.className = `parcel-list-card ${isSel ? 'selected' : ''}`;
      card.dataset.id = pId;
      card.innerHTML = `
        <div class="parcel-card-top">
          <span style="font-weight: 600; font-family: var(--font-mono); color: var(--text-primary); font-size: 12px;">${pId}</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <span style="font-size: 10px; color: ${confColor}; font-weight: 600;">${confLevel} (${Math.round(conf * 100)}%)</span>
            <span class="pm-status-tag ${statusTagClass}" style="font-size: 9px; padding: 1px 5px;">${statusDisplay}</span>
          </div>
        </div>
        <div class="parcel-card-bottom" style="margin-top: 4px; display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary);">
          <span>${areaStr ? `Area: <strong>${areaStr}</strong>` : '<span style="color: var(--text-dim);">Image-space</span>'}</span>
          <span style="color: var(--text-dim);">${(p.supporting_features || []).slice(0, 2).join(', ') || 'Spatial Reasoning'}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectParcel(pId);
      });

      container.appendChild(card);
    });
  }

  /* --------------------------------------------------------------------------
     6. PARCEL SELECTION & DRAWER (Requirement 2 & 10)
     -------------------------------------------------------------------------- */
  selectParcel(parcelId) {
    this.selectedParcelId = parcelId;
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === parcelId);
    if (!parcel) return;

    if (this.editMode) {
      this.editMode = false;
      this.clearVertexHandles();
    }

    this.renderVerifyParcelList();
    this.renderSelectedParcelDrawer();
    this.renderVerifyMapLayers();

    // Pan map to selected parcel
    if (this.maps.verify && parcel.geometry) {
      const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
      const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
      const height = Number(currentImg?.height) || 3000;
      const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

      const rawCoords = (!isGeoreferenced && parcel.image_coordinates?.[0]) ? parcel.image_coordinates[0] : (parcel.geo_geometry?.coordinates?.[0] || parcel.geometry?.coordinates?.[0] || []);
      if (rawCoords && rawCoords.length >= 3) {
        const latlngs = rawCoords.map(toLeaflet);
        this.maps.verify.flyToBounds(latlngs, { padding: [60, 60], duration: 0.5, maxZoom: 18 });
      }
    }
  }

  renderSelectedParcelDrawer() {
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId) || this.parcels[0];
    if (!parcel) return;

    const pId = parcel.parcel_id || parcel.id;
    const elId = document.getElementById('drwParcelId');
    if (elId) elId.textContent = pId;

    const statusPill = document.getElementById('drwStatusPill');
    if (statusPill) {
      let statusText = 'PRELIMINARY';
      let pillClass = 'tag-blue';
      if (parcel.status === 'accepted' || parcel.status === 'Human Verified') {
        statusText = 'ACCEPTED';
        pillClass = 'tag-emerald';
      } else if (parcel.status === 'needs_review' || parcel.status === 'Needs Review') {
        statusText = 'NEEDS_REVIEW';
        pillClass = 'tag-amber';
      } else if (parcel.status === 'rejected' || parcel.status === 'Rejected') {
        statusText = 'REJECTED';
        pillClass = 'tag-rose';
      } else {
        statusText = 'PRELIMINARY';
        pillClass = 'tag-blue';
      }
      statusPill.textContent = statusText;
      statusPill.className = `pm-status-tag ${pillClass}`;
    }

    // Created from imagery (Requirement 10)
    const currentImg = this.imagery.find(img => img.id === parcel.imagery_id) || this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const imgLabel = document.getElementById('drwCreatedFromImagery');
    if (imgLabel) {
      imgLabel.textContent = `Imagery: ${currentImg ? currentImg.file_name : 'UAV Orthomosaic'}`;
    }

    const projLabel = document.getElementById('drwProjectId');
    if (projLabel) {
      projLabel.textContent = `Project: ${this.project ? this.project.name : this.activeProjectId}`;
    }

    // Confidence badge
    const confBadge = document.getElementById('drwConfidenceBadge');
    if (confBadge) {
      const conf = parcel.confidence != null ? parcel.confidence : 0.8;
      const confLevel = conf >= 0.80 ? 'High' : (conf >= 0.60 ? 'Medium' : 'Low');
      confBadge.textContent = `${confLevel} (${Math.round(conf * 100)}%)`;
      confBadge.style.color = conf >= 0.80 ? 'var(--accent-emerald)' : (conf >= 0.60 ? 'var(--accent-amber)' : '#f43f5e');
    }

    // Source & Quality Status Metadata (Requirement 2)
    const elSource = document.getElementById('drwSource');
    if (elSource) {
      elSource.textContent = parcel.source || 'Spatial Reasoning';
    }

    const elQuality = document.getElementById('drwQualityStatus');
    if (elQuality) {
      if (parcel.status === 'rejected' || parcel.status === 'Rejected') {
        elQuality.textContent = 'Flagged / Excluded';
        elQuality.style.color = '#f43f5e';
      } else if (parcel.topology_issue) {
        elQuality.textContent = parcel.topology_issue;
        elQuality.style.color = '#f59e0b';
      } else {
        elQuality.textContent = 'Topology Valid';
        elQuality.style.color = '#10b981';
      }
    }

    // Area diff display (Requirement 10: only if georeferenced)
    const elAiArea = document.getElementById('drwAiArea');
    const elAiAreaSub = document.getElementById('drwAiAreaSub');
    const elVerArea = document.getElementById('drwVerifiedArea');
    const elVerAreaSub = document.getElementById('drwVerifiedAreaSub');

    if (!isGeoreferenced || (!parcel.area_hectares && !parcel.area_sqm)) {
      if (elAiArea) elAiArea.textContent = 'Unavailable';
      if (elAiAreaSub) elAiAreaSub.textContent = parcel.area_px ? `${parcel.area_px.toLocaleString()} px² (Image-space)` : 'Ungeoreferenced';
      if (elVerArea) elVerArea.textContent = 'Unavailable';
      if (elVerAreaSub) elVerAreaSub.textContent = parcel.area_px ? `${parcel.area_px.toLocaleString()} px²` : 'Ungeoreferenced';
    } else {
      const ha = parcel.area_hectares || (parcel.area_sqm ? (parcel.area_sqm / 10000).toFixed(2) : 0);
      const sqm = parcel.area_sqm || 0;
      const ac = parcel.area_acres || (sqm ? (sqm / 4046.856).toFixed(2) : 0);
      if (elAiArea) elAiArea.textContent = `${ha} ha`;
      if (elAiAreaSub) elAiAreaSub.textContent = `${sqm.toLocaleString()} m² (${ac} ac)`;
      if (elVerArea) elVerArea.textContent = `${ha} ha`;
      if (elVerAreaSub) elVerAreaSub.textContent = `${sqm.toLocaleString()} m² (${ac} ac)`;
    }

    // Supporting features (Requirement 2 & 10: Road, Field Edge, Building, Fence, Wall)
    const featContainer = document.getElementById('drwSupportingFeatures');
    if (featContainer) {
      featContainer.innerHTML = '';
      const feats = parcel.supporting_features && parcel.supporting_features.length ? parcel.supporting_features : ['Field Edge', 'Boundary Evidence'];
      feats.forEach(f => {
        const item = document.createElement('span');
        item.className = 'supporting-tag';
        item.textContent = f;
        featContainer.appendChild(item);
      });
    }

    // Surveyor remarks / notes (Requirement 4)
    const txtComments = document.getElementById('drwReviewComments');
    if (txtComments) {
      txtComments.value = parcel.remarks || parcel.comments || '';
    }

    this.renderDrawerTimeline(pId);
  }

  renderDrawerTimeline(parcelId) {
    const tlContainer = document.getElementById('drwTimelineList');
    if (!tlContainer) return;

    fetch(`${this.apiBase}/parcels/${parcelId}/history`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.history && data.history.length > 0) {
          tlContainer.innerHTML = data.history.slice(0, 4).map(item => `
            <div class="timeline-item">
              <div class="timeline-date">${new Date(item.timestamp || item.created_at).toLocaleString()} &bull; v${item.version || item.version_number || 1} &bull; ${item.edited_by || item.reviewer_name || 'Surveyor'}</div>
              <div class="timeline-msg"><strong>${item.action || item.change_type || 'Updated'}</strong>: ${item.comments || item.notes || 'Geometry verified'}</div>
            </div>
          `).join('');
        } else {
          tlContainer.innerHTML = '<div style="color: var(--text-dim); font-size: 11px;">Initial preliminary boundary &bull; Awaiting human verification</div>';
        }
      })
      .catch(() => {
        tlContainer.innerHTML = '<div style="color: var(--text-dim); font-size: 11px;">Initial preliminary boundary &bull; Awaiting human verification</div>';
      });
  }

  /* --------------------------------------------------------------------------
     7. PARCEL EDITING & VERTEX MANIPULATION (Requirement 11, 16, 17)
     -------------------------------------------------------------------------- */
  bindEditingTools() {
    document.getElementById('toolSelectParcel')?.addEventListener('click', () => {
      this.editMode = false;
      this.clearVertexHandles();
      this.showToast('Select Mode active', 'info');
    });

    document.getElementById('toolEditVertices')?.addEventListener('click', () => {
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (!parcel) return;
      this.editMode = true;
      this.saveHistoryState();
      this.renderVertexHandles();
      this.showToast(`Vertex Editing Mode: Drag white handles to adjust boundaries of ${parcel.parcel_id || parcel.id}`, 'info');
    });

    document.getElementById('toolSplitPolygon')?.addEventListener('click', () => {
      this.splitSelectedParcel();
    });

    document.getElementById('toolMergePolygons')?.addEventListener('click', () => {
      this.mergeSelectedParcel();
    });

    document.getElementById('toolUndo')?.addEventListener('click', () => this.undoEdit());
    document.getElementById('toolRedo')?.addEventListener('click', () => this.redoEdit());

    document.getElementById('btnSaveParcelEdits')?.addEventListener('click', () => this.saveParcelEdits());
  }

  renderVertexHandles() {
    this.clearVertexHandles();
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
    if (!parcel || !this.maps.verify || !parcel.geometry || !parcel.geometry.coordinates) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const height = Number(currentImg?.height) || 3000;

    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];
    const fromLeaflet = (latlng) => !isGeoreferenced ? [latlng.lng, height - latlng.lat] : [latlng.lng, latlng.lat];

    const ring = parcel.geometry.coordinates[0];
    const n = ring.length - 1;

    for (let i = 0; i < n; i++) {
      const coord = ring[i];
      const latlng = toLeaflet(coord);

      const vMarker = L.circleMarker(latlng, {
        radius: 6,
        color: '#ffffff',
        fillColor: '#10b981',
        fillOpacity: 1,
        weight: 2
      }).addTo(this.verifyLayers.editLayer);

      let isDragging = false;

      vMarker.on('mousedown', () => {
        isDragging = true;
        this.maps.verify.dragging.disable();
      });

      this.maps.verify.on('mousemove', (e) => {
        if (!isDragging) return;
        vMarker.setLatLng(e.latlng);

        const newCoord = fromLeaflet(e.latlng);
        ring[i] = newCoord;
        if (i === 0) ring[ring.length - 1] = newCoord; // keep closed ring

        this.recalculateParcelArea(parcel);
        this.renderVerifyMapLayers();
      });

      this.maps.verify.on('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          this.maps.verify.dragging.enable();
          this.saveHistoryState();
        }
      });

      // Right-click to delete vertex (Requirement 11)
      vMarker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        if (ring.length > 4) {
          ring.splice(i, 1);
          if (i === 0) ring[ring.length - 1] = ring[0];
          this.recalculateParcelArea(parcel);
          this.renderVertexHandles();
          this.renderVerifyMapLayers();
          this.saveHistoryState();
          this.showToast(`Deleted vertex #${i + 1}`, 'info');
        } else {
          this.showToast('Polygon must have at least 3 vertices', 'warning');
        }
      });

      this.vertexMarkers.push(vMarker);

      // Midpoint Add-Vertex Handle (Requirement 11)
      const nextCoord = ring[(i + 1) % n];
      const midCoord = [(coord[0] + nextCoord[0]) / 2, (coord[1] + nextCoord[1]) / 2];
      const midLatlng = toLeaflet(midCoord);

      const mMarker = L.circleMarker(midLatlng, {
        radius: 4,
        color: '#38bdf8',
        fillColor: '#0369a1',
        fillOpacity: 0.8,
        weight: 1
      }).addTo(this.verifyLayers.editLayer);

      mMarker.bindTooltip('+ Add vertex', { direction: 'top' });

      mMarker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        ring.splice(i + 1, 0, midCoord);
        this.recalculateParcelArea(parcel);
        this.renderVertexHandles();
        this.renderVerifyMapLayers();
        this.saveHistoryState();
        this.showToast('Added new boundary vertex', 'success');
      });

      this.midpointMarkers.push(mMarker);
    }
  }

  clearVertexHandles() {
    this.verifyLayers.editLayer.clearLayers();
    this.vertexMarkers = [];
    this.midpointMarkers = [];
  }

  recalculateParcelArea(parcel) {
    try {
      const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
      const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;

      if (isGeoreferenced) {
        const feat = turf.feature(parcel.geometry);
        const sqm = Math.round(turf.area(feat));
        parcel.area_sqm = sqm;
        parcel.area_hectares = Number((sqm / 10000).toFixed(2));
        parcel.area_acres = Number((sqm / 4046.856).toFixed(2));

        const verifiedEl = document.getElementById('drwVerifiedArea');
        const verifiedSubEl = document.getElementById('drwVerifiedAreaSub');
        if (verifiedEl) verifiedEl.textContent = `${parcel.area_hectares} ha`;
        if (verifiedSubEl) verifiedSubEl.textContent = `${parcel.area_sqm.toLocaleString()} m² (${parcel.area_acres} ac)`;
      }
    } catch (e) {
      console.warn('Area calculation error:', e);
    }
  }

  saveHistoryState() {
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
    if (!parcel || !parcel.geometry) return;
    const geomCopy = JSON.parse(JSON.stringify(parcel.geometry));
    this.editHistory = this.editHistory.slice(0, this.historyIndex + 1);
    this.editHistory.push(geomCopy);
    this.historyIndex++;
  }

  undoEdit() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (parcel) {
        parcel.geometry = JSON.parse(JSON.stringify(this.editHistory[this.historyIndex]));
        this.recalculateParcelArea(parcel);
        this.renderVertexHandles();
        this.renderVerifyMapLayers();
        this.showToast('Undo performed', 'info');
      }
    }
  }

  redoEdit() {
    if (this.historyIndex < this.editHistory.length - 1) {
      this.historyIndex++;
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (parcel) {
        parcel.geometry = JSON.parse(JSON.stringify(this.editHistory[this.historyIndex]));
        this.recalculateParcelArea(parcel);
        this.renderVertexHandles();
        this.renderVerifyMapLayers();
        this.showToast('Redo performed', 'info');
      }
    }
  }

  /**
   * Requirement 17: Save System
   * 1. Validate geometry with backend POST /api/parcels/:id/validate.
   * 2. Calculate updated area.
   * 3. Create new parcel version.
   * 4. Update current parcel via PUT /api/parcels/:id/geometry.
   * 5. Re-run affected GIS checks.
   * 6. Show "Saved successfully" only after backend confirms success.
   */
  async saveParcelEdits() {
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
    if (!parcel) return;

    try {
      // 1. Validate geometry
      const vRes = await fetch(`${this.apiBase}/parcels/${parcel.parcel_id || parcel.id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: parcel.geometry })
      });
      const vData = await vRes.json();
      if (!vData.valid) {
        this.showToast(`Validation Failed: ${vData.errors.join('; ')}`, 'error');
        return;
      }

      // 2. Save geometry to backend
      const comments = document.getElementById('drwReviewComments')?.value || 'Boundary vertices adjusted and validated by reviewer.';
      const sRes = await fetch(`${this.apiBase}/parcels/${parcel.parcel_id || parcel.id}/geometry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: parcel.geometry,
          comments,
          remarks: comments,
          edited_by: 'Alex Morgan (Lead Surveyor)'
        })
      });
      const sData = await sRes.json();

      if (sData.success) {
        this.editMode = false;
        this.clearVertexHandles();
        this.showToast('Saved successfully', 'success');
        await this.loadProjectData(this.activeProjectId);
      } else {
        this.showToast(sData.error || 'Failed to save parcel boundary changes', 'error');
      }
    } catch (e) {
      this.showToast('Save failed: ' + e.message, 'error');
    }
  }

  /* --------------------------------------------------------------------------
     8. DRAWER ACTIONS: ACCEPT / REJECT / SPLIT / MERGE / HISTORY (Requirement 12, 13, 14, 15)
     -------------------------------------------------------------------------- */
  bindDrawerActions() {
    // ACCEPT (Requirement 4 & 5: status = accepted)
    document.getElementById('btnActionAccept')?.addEventListener('click', async () => {
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (!parcel) return;

      const pId = parcel.parcel_id || parcel.id;
      const comments = document.getElementById('drwReviewComments')?.value || 'Preliminary boundary verified against drone orthomosaic.';
      try {
        const res = await fetch(`${this.apiBase}/parcels/${pId}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments, remarks: comments, reviewer_name: 'Alex Morgan (Lead Surveyor)' })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast(`Parcel ${pId} accepted.`, 'success');
          await this.loadProjectData(this.activeProjectId);
        }
      } catch (e) {
        this.showToast('Error accepting parcel', 'error');
      }
    });

    // EDIT VERTICES (Requirement 3 & 8)
    document.getElementById('btnActionEdit')?.addEventListener('click', () => {
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (!parcel) return;
      this.editMode = true;
      this.saveHistoryState();
      this.renderVertexHandles();
      this.showToast(`Vertex editing enabled for ${parcel.parcel_id || parcel.id}`, 'info');
    });

    // REJECT (Requirement 4 & 7: status = rejected with confirmation & reason)
    document.getElementById('btnActionReject')?.addEventListener('click', async () => {
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (!parcel) return;

      const pId = parcel.parcel_id || parcel.id;
      const currentRemark = document.getElementById('drwReviewComments')?.value || '';
      const reason = prompt(`Reject parcel ${pId}? Enter rejection reason (e.g. Incorrect geometry, Insufficient evidence, Duplicate parcel, Wrong location, Not a parcel):`, currentRemark || 'Insufficient boundary evidence');
      if (reason === null) return; // User cancelled

      const comments = reason.trim() || 'Rejected due to insufficient physical boundary evidence.';
      try {
        const res = await fetch(`${this.apiBase}/parcels/${pId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments, remarks: comments, reviewer_name: 'Alex Morgan (Lead Surveyor)' })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast(`Parcel ${pId} rejected.`, 'warning');
          await this.loadProjectData(this.activeProjectId);
        }
      } catch (e) {
        this.showToast('Error rejecting parcel', 'error');
      }
    });

    // NEEDS REVIEW (Requirement 4 & 6: status = needs_review)
    document.getElementById('btnActionReview')?.addEventListener('click', async () => {
      const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
      if (!parcel) return;

      const pId = parcel.parcel_id || parcel.id;
      const comments = document.getElementById('drwReviewComments')?.value || 'Flagged for field demarcation';
      try {
        const res = await fetch(`${this.apiBase}/parcels/${pId}/needs-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments, remarks: comments, reviewer_name: 'Alex Morgan (Lead Surveyor)' })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast(`Parcel ${pId} marked as Needs Review.`, 'info');
          await this.loadProjectData(this.activeProjectId);
        }
      } catch (e) {
        this.showToast('Error marking parcel for review', 'error');
      }
    });

    // SPLIT PARCEL (Requirement 5 & 9)
    document.getElementById('btnActionSplit')?.addEventListener('click', () => {
      this.splitSelectedParcel();
    });

    // MERGE PARCEL (Requirement 6 & 10)
    document.getElementById('btnActionMerge')?.addEventListener('click', () => {
      this.mergeSelectedParcel();
    });

    // COMPLETE VERIFICATION & FINAL MAP HANDOFF (Requirements 10, 11, 14, 15)
    document.getElementById('btnCompleteVerification')?.addEventListener('click', () => {
      this.showVerificationCompleteModal();
    });

    document.getElementById('btnCloseVerificationCompleteModal')?.addEventListener('click', () => {
      document.getElementById('modalVerificationComplete')?.classList.remove('active');
    });

    document.getElementById('btnHandoffToFinalMap')?.addEventListener('click', () => {
      const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
      const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
      const remainingCount = currentParcels.filter(p => p.status !== 'accepted' && p.status !== 'Human Verified' && p.status !== 'rejected' && p.status !== 'Rejected').length;

      if (remainingCount > 0) {
        this.showToast(`${remainingCount} parcel${remainingCount > 1 ? 's' : ''} still require verification.`, 'warning');
        return;
      }

      document.getElementById('modalVerificationComplete')?.classList.remove('active');
      this.switchView('map');
      this.showToast('✓ Proceeding to Final Map with accepted parcels.', 'success');
    });
  }

  showVerificationCompleteModal() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
    const acceptedCount = currentParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified').length;
    const rejectedCount = currentParcels.filter(p => p.status === 'rejected' || p.status === 'Rejected').length;
    const remainingCount = currentParcels.length - (acceptedCount + rejectedCount);

    const elAcc = document.getElementById('vcompAccepted');
    const elRej = document.getElementById('vcompRejected');
    const elRem = document.getElementById('vcompRemaining');
    if (elAcc) elAcc.textContent = acceptedCount;
    if (elRej) elRej.textContent = rejectedCount;
    if (elRem) elRem.textContent = remainingCount;

    const btnHandoff = document.getElementById('btnHandoffToFinalMap');
    if (remainingCount > 0) {
      this.showToast(`${remainingCount} parcel${remainingCount > 1 ? 's' : ''} still require verification.`, 'warning');
      if (btnHandoff) {
        btnHandoff.disabled = true;
        btnHandoff.style.opacity = '0.5';
        btnHandoff.style.cursor = 'not-allowed';
      }
    } else {
      if (btnHandoff) {
        btnHandoff.disabled = false;
        btnHandoff.style.opacity = '1';
        btnHandoff.style.cursor = 'pointer';
      }
    }

    document.getElementById('modalVerificationComplete')?.classList.add('active');
  }

  async splitSelectedParcel() {
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
    if (!parcel) return;

    try {
      const res = await fetch(`${this.apiBase}/parcels/${parcel.parcel_id || parcel.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_name: 'Alex Morgan (Lead Surveyor)' })
      });
      const data = await res.json();
      if (data.success) {
        const pId = parcel.parcel_id || parcel.id;
        this.showToast(`✂ Parcel ${pId} successfully split into ${pId}-A and ${pId}-B!`, 'success');
        await this.loadProjectData(this.activeProjectId);
        this.selectParcel(`${pId}-A`);
      } else {
        this.showToast(data.error || 'Split failed', 'error');
      }
    } catch (e) {
      this.showToast('Error splitting parcel: ' + e.message, 'error');
    }
  }

  async mergeSelectedParcel() {
    const parcel = this.parcels.find(p => (p.parcel_id || p.id) === this.selectedParcelId);
    if (!parcel) return;

    const candidates = this.parcels.filter(p => (p.parcel_id || p.id) !== (parcel.parcel_id || parcel.id) && p.status !== 'rejected' && p.status !== 'Rejected');
    if (!candidates.length) {
      this.showToast('No neighbor parcels available to merge with', 'warning');
      return;
    }

    const target = candidates[0];
    const pId1 = parcel.parcel_id || parcel.id;
    const pId2 = target.parcel_id || target.id;

    try {
      const res = await fetch(`${this.apiBase}/parcels/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcel_ids: [pId1, pId2],
          reviewer_name: 'Alex Morgan (Lead Surveyor)'
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`⧉ Parcels ${pId1} and ${pId2} successfully merged!`, 'success');
        await this.loadProjectData(this.activeProjectId);
        this.selectParcel(pId1);
      } else {
        this.showToast(data.error || 'Merge failed', 'error');
      }
    } catch (e) {
      this.showToast('Error merging parcels: ' + e.message, 'error');
    }
  }

  async openParcelHistoryModal(parcelId) {
    const modal = document.getElementById('modalParcelHistory');
    const title = document.getElementById('histModalParcelTitle');
    const tbody = document.getElementById('tblParcelHistoryRows');
    if (!modal || !tbody) return;

    if (title) title.textContent = `Parcel History: ${parcelId}`;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 16px;">Loading history...</td></tr>`;
    modal.classList.add('active');

    try {
      const res = await fetch(`${this.apiBase}/parcels/${parcelId}/history`);
      const data = await res.json();
      if (data.success && data.history) {
        if (data.history.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 16px;">No recorded history for ${parcelId}</td></tr>`;
          return;
        }
        tbody.innerHTML = data.history.map(item => `
          <tr>
            <td><strong style="color: var(--accent-emerald);">v${item.version || item.version_number || 1}</strong></td>
            <td><span class="pm-status-tag" style="background: var(--bg-card);">${item.action || item.change_type || 'Edited'}</span></td>
            <td style="font-family: var(--font-mono); font-size: 11px;">${new Date(item.timestamp || item.created_at).toLocaleString()}</td>
            <td>${item.edited_by || item.reviewer_name || 'System'}</td>
            <td>${item.area_display || (item.area_hectares ? `${item.area_hectares} ha` : '-')}</td>
            <td style="color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis;">${item.comments || item.notes || '-'}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #f43f5e; padding: 16px;">Failed to load history: ${e.message}</td></tr>`;
    }
  }

  /* --------------------------------------------------------------------------
     9. GIS QUALITY CONTROL DASHBOARD & MAP (Requirements 1-9, 18, 19, 22, 23, 24)
     -------------------------------------------------------------------------- */
  renderQualityControlTable() {
    const emptyBox = document.getElementById('qcEmptyStateBox');
    const emptyTitle = document.getElementById('qcEmptyStateTitle');
    const emptyDesc = document.getElementById('qcEmptyStateDesc');

    // Requirement 23: Handle missing parcels or validation failure
    if (!this.parcels || this.parcels.length === 0) {
      if (emptyBox) {
        emptyBox.style.display = 'block';
        if (emptyTitle) emptyTitle.textContent = 'No preliminary parcels available for quality review.';
        if (emptyDesc) emptyDesc.textContent = 'Please run Spatial Reasoning on the uploaded drone imagery to generate preliminary parcels.';
      }
    } else if (!this.qualityAudit) {
      if (emptyBox) {
        emptyBox.style.display = 'block';
        if (emptyTitle) emptyTitle.textContent = 'GIS Quality validation failed.';
        if (emptyDesc) emptyDesc.textContent = 'Backend topology audit returned an error or unavailable data.';
      }
    } else {
      if (emptyBox) emptyBox.style.display = 'none';
    }

    if (!this.qualityAudit) return;

    // Actual geometry statistics (Requirement 2 & 18)
    const totalParcels = this.qualityAudit.total_parcels ?? this.parcels.length;
    const validPolygons = this.qualityAudit.valid_polygons_count ?? (this.qualityAudit.summary?.valid_geometry || 0);
    const invalidGeoms = this.qualityAudit.invalid_polygons_count ?? 0;
    const overlaps = this.qualityAudit.overlaps_count ?? (this.qualityAudit.overlaps?.length || 0);
    const gaps = this.qualityAudit.gaps_count ?? (this.qualityAudit.gaps?.length || 0);
    const waterOverlaps = this.qualityAudit.water_overlaps_count ?? (this.qualityAudit.water_overlaps?.length || 0);
    const lowConf = this.qualityAudit.low_confidence_count ?? (this.qualityAudit.low_confidence_parcels?.length || 0);
    const slivers = this.qualityAudit.slivers_count ?? (this.qualityAudit.slivers?.length || 0);
    const readyForReview = this.qualityAudit.ready_for_review_count ?? Math.max(0, totalParcels - invalidGeoms - overlaps - waterOverlaps);

    const elTotal = document.getElementById('qcTotalParcels');
    const elValid = document.getElementById('qcValidPolygons');
    const elInvalid = document.getElementById('qcInvalidGeometries');
    const elOverlaps = document.getElementById('qcOverlaps');
    const elGaps = document.getElementById('qcGaps');
    const elLowConf = document.getElementById('qcLowConfidence');
    const elSlivers = document.getElementById('qcSlivers');
    const elReady = document.getElementById('qcReadyForReview');

    if (elTotal) elTotal.textContent = totalParcels;
    if (elValid) elValid.textContent = validPolygons;
    if (elInvalid) elInvalid.textContent = invalidGeoms;
    if (elOverlaps) elOverlaps.textContent = overlaps;
    if (elGaps) elGaps.textContent = gaps;
    if (elLowConf) elLowConf.textContent = lowConf;
    if (elSlivers) elSlivers.textContent = slivers;
    if (elReady) elReady.textContent = readyForReview;

    // Requirement 18: GIS QUALITY Summary Card Rail
    const elPillValid = document.getElementById('qcPillValid');
    const elPillOvl = document.getElementById('qcPillOverlaps');
    const elPillGaps = document.getElementById('qcPillGaps');
    const elPillWater = document.getElementById('qcPillWaterOverlaps');
    const elPillLow = document.getElementById('qcPillLowConf');
    const elPillSlivers = document.getElementById('qcPillSlivers');
    const elPillNeedsReview = document.getElementById('qcPillNeedsReview');
    const elPillReady = document.getElementById('qcPillReady');

    if (elPillValid) elPillValid.textContent = validPolygons;
    if (elPillOvl) elPillOvl.textContent = overlaps;
    if (elPillGaps) elPillGaps.textContent = gaps;
    if (elPillWater) elPillWater.textContent = waterOverlaps;
    if (elPillLow) elPillLow.textContent = lowConf;
    if (elPillSlivers) elPillSlivers.textContent = slivers;
    if (elPillNeedsReview) elPillNeedsReview.textContent = overlaps + gaps + waterOverlaps + lowConf + invalidGeoms;
    if (elPillReady) elPillReady.textContent = readyForReview;

    const totalIssues = overlaps + gaps + waterOverlaps + slivers + invalidGeoms + lowConf;
    const tagCount = document.getElementById('tagQcIssueCount');
    if (tagCount) {
      tagCount.textContent = `${totalIssues} Issue${totalIssues === 1 ? '' : 's'} Found`;
      tagCount.className = `pm-status-tag ${totalIssues === 0 ? 'tag-emerald' : 'tag-amber'}`;
    }

    // Flagged anomalies table (Requirement 8)
    const tbody = document.getElementById('tblQcIssues');
    if (tbody) {
      tbody.innerHTML = '';
      const issues = [];

      // 1. Invalid geometries
      (this.qualityAudit.invalid_details || this.qualityAudit.invalid_geometries || []).forEach(inv => {
        issues.push({
          type: 'Invalid Geometry',
          typeClass: 'tag-rose',
          parcel: inv.parcel_id || 'Parcel',
          magnitude: inv.reason || 'Geometric topology error',
          severity: 'High',
          severityClass: 'qc-sev-high',
          status: 'Needs Review',
          statusClass: 'tag-rose',
          desc: inv.reason || 'Polygon ring not closed or self-intersecting',
          coords: null,
          primaryParcel: inv.parcel_id
        });
      });

      // 2. Water overlaps
      (this.qualityAudit.water_overlaps || []).forEach(w => {
        issues.push({
          type: 'Water Overlap',
          typeClass: 'tag-blue',
          parcel: w.parcel_id,
          magnitude: w.overlap_area || 'Water intersection',
          severity: w.severity || 'High',
          severityClass: 'qc-sev-high',
          status: w.status || 'Needs Review',
          statusClass: 'tag-amber',
          desc: w.description || 'WATER OVERLAP: Parcel boundary crosses water exclusion mask',
          coords: w.coordinates,
          primaryParcel: w.parcel_id
        });
      });

      // 3. Overlaps
      (this.qualityAudit.overlaps || []).forEach(ovl => {
        issues.push({
          type: 'Overlap',
          typeClass: 'tag-rose',
          parcel: `${ovl.parcel_a} ↔ ${ovl.parcel_b}`,
          magnitude: ovl.area_display || (ovl.overlap_sqm ? `${ovl.overlap_sqm} m²` : (ovl.overlap_px ? `${ovl.overlap_px} px²` : 'Overlap')),
          severity: ovl.severity || 'High',
          severityClass: 'qc-sev-high',
          status: ovl.status || 'Needs Review',
          statusClass: 'tag-amber',
          desc: 'Polygon overlap along adjacent boundary edge',
          coords: ovl.coordinates,
          primaryParcel: ovl.parcel_a
        });
      });

      // 4. Gaps
      (this.qualityAudit.gaps || []).forEach(gap => {
        issues.push({
          type: 'Possible Gap',
          typeClass: 'tag-amber',
          parcel: gap.nearby_parcels ? gap.nearby_parcels.join(' & ') : `${gap.parcel_a} & ${gap.parcel_b}`,
          magnitude: gap.gap_area || (gap.gap_width_meters ? `${gap.gap_width_meters} m void` : 'Void space'),
          severity: gap.severity || 'Medium',
          severityClass: 'qc-sev-med',
          status: gap.status || 'Possible gap — review required',
          statusClass: 'tag-amber',
          desc: gap.description || 'Possible gap — review required (inter-parcel void detected)',
          coords: gap.coordinates,
          primaryParcel: gap.parcel_a || (gap.nearby_parcels ? gap.nearby_parcels[0] : null)
        });
      });

      // 5. Low Confidence
      (this.qualityAudit.low_confidence_parcels || []).forEach(l => {
        issues.push({
          type: 'Low Confidence',
          typeClass: 'tag-rose',
          parcel: l.parcel_id,
          magnitude: `${Math.round((l.confidence || 0.5) * 100)}% Conf`,
          severity: 'Low',
          severityClass: 'qc-sev-med',
          status: l.status || 'Review',
          statusClass: 'tag-amber',
          desc: l.recommendation || 'Weak boundary contrast, field survey review recommended',
          coords: null,
          primaryParcel: l.parcel_id
        });
      });

      // 6. Slivers
      (this.qualityAudit.slivers || []).forEach(slv => {
        issues.push({
          type: 'Sliver',
          typeClass: 'tag-rose',
          parcel: slv.parcel_id,
          magnitude: slv.area_sqm ? `${slv.area_sqm} m²` : (slv.area_px ? `${slv.area_px} px²` : 'Tiny parcel'),
          severity: slv.severity || 'High',
          severityClass: 'qc-sev-high',
          status: slv.status || 'Needs Review',
          statusClass: 'tag-rose',
          desc: slv.reason || 'Sliver polygon below minimum area threshold',
          coords: slv.coordinates,
          primaryParcel: slv.parcel_id
        });
      });

      if (issues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-emerald); padding: 18px;">✓ All ${totalParcels} preliminary parcels are topologically valid with zero detected overlaps or gaps.</td></tr>`;
      } else {
        issues.forEach(iss => {
          const tr = document.createElement('tr');
          tr.className = 'qc-row-clickable';
          tr.innerHTML = `
            <td><span class="pm-status-tag ${iss.typeClass}">${iss.type}</span></td>
            <td><strong style="color: var(--text-primary); font-family: var(--font-mono);">${iss.parcel}</strong></td>
            <td>${iss.magnitude}</td>
            <td><span class="qc-sev-badge ${iss.severityClass}">${iss.severity}</span></td>
            <td><span class="pm-status-tag ${iss.statusClass}">${iss.status}</span></td>
            <td style="color: var(--text-secondary); font-size: 11.5px;">${iss.desc}</td>
            <td style="text-align: right;"><button class="btn-pm btn-pm-secondary" style="font-size: 11px; padding: 2px 8px;">Inspect</button></td>
          `;
          tr.addEventListener('click', () => {
            this.locateIssueOnMap(iss.coords, iss.primaryParcel);
          });
          tbody.appendChild(tr);
        });
      }
    }

    // Repairs Performed Table (Requirement 3)
    const repairsCard = document.getElementById('cardQcRepairs');
    const repairsTbody = document.getElementById('tblQcRepairs');
    const repairsList = this.qualityAudit.repairs_performed || [];

    if (repairsCard && repairsTbody) {
      if (repairsList.length > 0) {
        repairsCard.style.display = 'block';
        document.getElementById('tagQcRepairsCount').textContent = `${repairsList.length} Repaired`;
        repairsTbody.innerHTML = repairsList.map(item => `
          <tr>
            <td><strong style="font-family: var(--font-mono); color: var(--text-primary);">${item.parcel_id}</strong></td>
            <td style="color: var(--text-secondary);">${item.repairs ? item.repairs.join('; ') : 'Safe ring closure applied'}</td>
            <td><span class="pm-status-tag tag-emerald">Repaired &amp; Preserved</span></td>
          </tr>
        `).join('');
      } else {
        repairsCard.style.display = 'none';
      }
    }

    // Low Confidence Parcels (Requirement 7)
    const lowConfCard = document.getElementById('cardLowConfidenceParcels');
    const lowConfTbody = document.getElementById('tblQcLowConfidence');
    const lowConfList = this.qualityAudit.low_confidence_parcels || [];

    if (lowConfCard && lowConfTbody) {
      if (lowConfList.length > 0) {
        lowConfCard.style.display = 'block';
        document.getElementById('tagQcLowConfCount').textContent = `${lowConfList.length} Flagged`;
        lowConfTbody.innerHTML = lowConfList.map(item => `
          <tr class="qc-row-clickable" data-id="${item.parcel_id}">
            <td><strong style="font-family: var(--font-mono); color: var(--text-primary);">${item.parcel_id}</strong></td>
            <td><strong style="color: #f43f5e;">${item.confidence_percent || Math.round((item.confidence || 0.5) * 100)}%</strong></td>
            <td><span class="pm-status-tag tag-amber">${item.status || 'Needs Review'}</span></td>
            <td style="color: var(--text-secondary);">${(item.supporting_features || []).join(', ') || 'Inferred Edge'}</td>
            <td style="color: var(--text-muted); font-size: 11px;">Manual field inspection recommended</td>
            <td style="text-align: right;"><button class="btn-pm btn-pm-secondary" style="font-size: 11px; padding: 2px 8px;">Inspect</button></td>
          </tr>
        `).join('');

        lowConfTbody.querySelectorAll('tr').forEach(tr => {
          tr.addEventListener('click', () => {
            this.locateIssueOnMap(null, tr.dataset.id);
          });
        });
      } else {
        lowConfCard.style.display = 'none';
      }
    }

    this.renderQualityMap();
  }

  /* --------------------------------------------------------------------------
     9.1 GIS QUALITY MAP (Requirement 9)
     -------------------------------------------------------------------------- */
  renderQualityMap() {
    const mapDiv = document.getElementById('qcMap');
    if (!mapDiv) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const noticeEl = document.getElementById('qcCoordinateNotice');

    if (this.maps.quality) {
      this.maps.quality.remove();
      this.maps.quality = null;
    }

    if (!currentImg) {
      mapDiv.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">No drone imagery uploaded.</div>`;
      return;
    }

    const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || 
                            currentImg.file_name.toLowerCase().endsWith('.tiff') || 
                            Boolean(currentImg.metadata?.crs);

    if (noticeEl) {
      noticeEl.textContent = isGeoreferenced ? 'Georeferenced (EPSG:4326)' : 'Image-Space Coordinates';
      noticeEl.className = isGeoreferenced ? 'pm-status-tag tag-emerald' : 'pm-status-tag tag-blue';
    }

    const width = Number(currentImg.width) || 4000;
    const height = Number(currentImg.height) || 3000;
    const center = this.project?.coordinates || [18.5818, 73.9875];
    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

    if (!isGeoreferenced) {
      const bounds = [[0, 0], [height, width]];
      this.maps.quality = L.map('qcMap', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 3,
        zoomSnap: 0.25,
        attributionControl: false,
        zoomControl: true
      });
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds).addTo(this.maps.quality);
      this.maps.quality.fitBounds(bounds);
    } else {
      this.maps.quality = L.map('qcMap', { attributionControl: false, zoomControl: true }).setView(center, 16);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.quality);
      if (currentImg.file_url) {
        const delta = 0.003;
        const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
        L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.85 }).addTo(this.maps.quality);
      }
    }

    // Attach qcLayers to maps.quality
    Object.values(this.qcLayers).forEach(layer => {
      layer.clearLayers();
      layer.addTo(this.maps.quality);
    });

    const showParcels = document.getElementById('qchkParcels')?.checked ?? true;
    const showIssues = document.getElementById('qchkIssues')?.checked ?? true;
    const showRoads = document.getElementById('qchkRoads')?.checked ?? true;
    const showBuildings = document.getElementById('qchkBuildings')?.checked ?? true;
    const showFields = document.getElementById('qchkFields')?.checked ?? true;
    const showWater = document.getElementById('qchkWater')?.checked ?? true;

    // 1. Contextual Features
    const relevantFeatures = this.features.filter(f => f.imagery_id === currentImg.id);

    if (showRoads) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toLowerCase().includes('road')).forEach(r => {
        const raw = (!isGeoreferenced && r.image_coordinates) ? r.image_coordinates : (r.geometry?.coordinates || []);
        if (raw.length >= 2) {
          L.polyline(raw.map(toLeaflet), { color: '#f59e0b', weight: 3, opacity: 0.75 })
            .bindTooltip(`Road: ${r.name || 'Lane'}`, { sticky: true })
            .addTo(this.qcLayers.roads);
        }
      });
    }

    if (showBuildings) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toLowerCase().includes('building')).forEach(b => {
        const raw = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geometry?.coordinates?.[0] || []);
        if (raw.length >= 3) {
          L.polygon(raw.map(toLeaflet), { color: '#06b6d4', weight: 1.5, fillColor: '#0891b2', fillOpacity: 0.35 })
            .bindTooltip('Building footprint', { sticky: true })
            .addTo(this.qcLayers.buildings);
        }
      });
    }

    if (showFields) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toLowerCase().includes('field')).forEach(f => {
        const raw = (!isGeoreferenced && f.image_coordinates) ? f.image_coordinates : (f.geometry?.coordinates?.[0] || f.geometry?.coordinates || []);
        if (raw.length >= 3) {
          L.polygon(raw.map(toLeaflet), { color: '#84cc16', weight: 1.5, fillColor: '#84cc16', fillOpacity: 0.15, dashArray: '3 3' })
            .bindTooltip('Field boundary', { sticky: true })
            .addTo(this.qcLayers.fields);
        }
      });
    }

    if (showWater) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toLowerCase().includes('water')).forEach(w => {
        const raw = (!isGeoreferenced && w.image_coordinates) ? w.image_coordinates : (w.geometry?.coordinates?.[0] || w.geometry?.coordinates || []);
        if (raw.length >= 3) {
          L.polygon(raw.map(toLeaflet), { color: '#0284c7', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.4 })
            .bindTooltip('Water exclusion mask', { sticky: true })
            .addTo(this.qcLayers.water);
        }
      });
    }

    // 2. Preliminary Parcels (Step 8 Section 8 & 9)
    let currentParcels = this.parcels.filter(p => !currentImg || !p.imagery_id || p.imagery_id === currentImg.id);
    if (currentParcels.length === 0 && this.parcels.length > 0) {
      currentParcels = this.parcels;
    }

    if (showParcels) {
      currentParcels.forEach(p => {
        const raw = (!isGeoreferenced && p.image_coordinates?.[0]) ? p.image_coordinates[0] : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);
        if (raw.length >= 3) {
          const pId = p.parcel_id || p.id;
          const isSelected = pId === this.selectedParcelId;
          const conf = p.confidence || 0.85;
          const strokeColor = isSelected ? '#38bdf8' : (conf >= 0.80 ? '#8b5cf6' : (conf >= 0.60 ? '#f59e0b' : '#f43f5e'));

          const poly = L.polygon(raw.map(toLeaflet), {
            color: strokeColor,
            weight: isSelected ? 3.5 : 2,
            fillColor: strokeColor,
            fillOpacity: isSelected ? 0.35 : 0.15
          });

          poly.bindTooltip(`
            <strong>${pId}</strong><br>
            Status: ${p.status || 'Preliminary'}<br>
            Confidence: ${Math.round(conf * 100)}%
          `, { sticky: true });

          poly.on('click', () => {
            this.selectedParcelId = pId;
            this.renderQualityMap();
            this.showToast(`Selected parcel ${pId}`, 'info');
          });

          poly.addTo(this.qcLayers.parcels);
        }
      });
    }

    console.log(`[GIS Quality UI] GIS Quality parcel records: ${this.parcels.length}`);
    console.log(`[GIS Quality UI] GeoJSON parcel features: ${currentParcels.length}`);
    console.log(`[GIS Quality UI] Rendered parcel features: ${this.qcLayers.parcels.getLayers().length}`);

    // 3. Quality Issue Highlights
    if (showIssues && this.qualityAudit) {
      // Overlaps
      (this.qualityAudit.overlaps || []).forEach(ovl => {
        if (ovl.geometry) {
          const raw = ovl.geometry.coordinates?.[0] || [];
          if (raw.length >= 3) {
            L.polygon(raw.map(toLeaflet), {
              color: '#f43f5e',
              weight: 3,
              fillColor: '#f43f5e',
              fillOpacity: 0.6,
              dashArray: '4 4'
            }).bindTooltip(`⚠ Overlap: ${ovl.parcel_a} ↔ ${ovl.parcel_b} (${ovl.area_display || ''})`, { sticky: true }).addTo(this.qcLayers.issues);
          }
        } else if (ovl.coordinates) {
          const latlng = toLeaflet([ovl.coordinates[1], ovl.coordinates[0]]);
          L.circleMarker(latlng, {
            radius: 10,
            color: '#f43f5e',
            fillColor: '#f43f5e',
            fillOpacity: 0.7,
            weight: 2
          }).bindTooltip(`⚠ Overlap: ${ovl.parcel_a} ↔ ${ovl.parcel_b}`, { sticky: true }).addTo(this.qcLayers.issues);
        }
      });

      // Water Overlaps
      (this.qualityAudit.water_overlaps || []).forEach(w => {
        if (w.coordinates) {
          const latlng = toLeaflet(w.coordinates);
          L.circleMarker(latlng, {
            radius: 12,
            color: '#0284c7',
            fillColor: '#38bdf8',
            fillOpacity: 0.8,
            weight: 3
          }).bindTooltip(`💧 WATER OVERLAP: ${w.parcel_id}`, { sticky: true }).addTo(this.qcLayers.issues);
        }
      });

      // Gaps
      (this.qualityAudit.gaps || []).forEach(gap => {
        if (gap.coordinates) {
          const latlng = toLeaflet([gap.coordinates[1], gap.coordinates[0]]);
          L.circleMarker(latlng, {
            radius: 9,
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.7,
            weight: 2
          }).bindTooltip(`⚠ Possible Gap: ${gap.parcel_a} & ${gap.parcel_b}`, { sticky: true }).addTo(this.qcLayers.issues);
        }
      });

      // Slivers
      (this.qualityAudit.slivers || []).forEach(slv => {
        if (slv.coordinates) {
          const latlng = toLeaflet(slv.coordinates);
          L.circleMarker(latlng, {
            radius: 8,
            color: '#fb7185',
            fillColor: '#fb7185',
            fillOpacity: 0.7,
            weight: 2
          }).bindTooltip(`⚠ Sliver: ${slv.parcel_id}`, { sticky: true }).addTo(this.qcLayers.issues);
        }
      });
    }
  }

  locateIssueOnMap(coordinates, parcelId) {
    if (parcelId) {
      this.selectedParcelId = parcelId;
    }

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const height = Number(currentImg?.height) || 3000;
    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

    // If currently on quality view, center on qcMap
    if (this.currentView === 'quality' && this.maps.quality) {
      if (coordinates) {
        const center = toLeaflet(coordinates);
        this.maps.quality.setView(center, isGeoreferenced ? 18 : 0);
      } else if (parcelId) {
        const p = this.parcels.find(x => (x.parcel_id || x.id) === parcelId);
        if (p && p.geometry?.coordinates?.[0]?.[0]) {
          const center = toLeaflet(p.geometry.coordinates[0][0]);
          this.maps.quality.setView(center, isGeoreferenced ? 18 : 0);
        }
      }
      this.renderQualityMap();
      this.showToast(`Inspecting issue on ${parcelId || 'geometry'}`, 'info');
      return;
    }

    // Switch to verify view
    this.switchView('verify');
    if (parcelId) {
      this.selectParcel(parcelId);
    }
    if (this.maps.verify && coordinates) {
      const center = toLeaflet(coordinates);
      this.maps.verify.setView(center, isGeoreferenced ? 18 : 0);

      const pulse = L.circle(center, {
        radius: isGeoreferenced ? 12 : 30,
        color: '#f43f5e',
        fillColor: '#f43f5e',
        fillOpacity: 0.5,
        weight: 3
      }).addTo(this.maps.verify);

      setTimeout(() => {
        this.maps.verify?.removeLayer(pulse);
      }, 5000);
    }
  }

  reviewQcIssues() {
    // Gather all issues in priority order: 1. Invalid geometry, 2. Water overlap, 3. Overlap, 4. Possible gap, 5. Low confidence, 6. Slivers
    const issues = [];
    if (this.qualityAudit) {
      (this.qualityAudit.invalid_details || []).forEach(i => issues.push({ type: 'Invalid Geometry', parcelId: i.parcel_id, coords: null }));
      (this.qualityAudit.water_overlaps || []).forEach(w => issues.push({ type: 'Water Overlap', parcelId: w.parcel_id, coords: w.coordinates }));
      (this.qualityAudit.overlaps || []).forEach(o => issues.push({ type: 'Overlap', parcelId: o.parcel_a, coords: o.coordinates }));
      (this.qualityAudit.gaps || []).forEach(g => issues.push({ type: 'Possible Gap', parcelId: g.parcel_a, coords: g.coordinates }));
      (this.qualityAudit.low_confidence_parcels || []).forEach(l => issues.push({ type: 'Low Confidence', parcelId: l.parcel_id, coords: null }));
      (this.qualityAudit.slivers || []).forEach(s => issues.push({ type: 'Sliver', parcelId: s.parcel_id, coords: s.coordinates }));
    }

    if (issues.length === 0) {
      this.showToast('✓ All preliminary parcels passed GIS Quality checks! Opening Verification Workspace.', 'success');
      this.switchView('verify');
      return;
    }

    if (this.qcReviewIndex === undefined || this.qcReviewIndex >= issues.length) {
      this.qcReviewIndex = 0;
    }

    const currentIssue = issues[this.qcReviewIndex];
    this.qcReviewIndex = (this.qcReviewIndex + 1) % issues.length;

    this.parcelFilterStatus = 'needs_review';
    document.querySelectorAll('#verifyFilterPills .filter-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'needs_review');
    });

    this.switchView('verify');
    if (currentIssue.parcelId) {
      this.selectParcel(currentIssue.parcelId);
      this.showToast(`Issue ${this.qcReviewIndex} of ${issues.length}: [${currentIssue.type}] on ${currentIssue.parcelId} — Inspect & Verify`, 'warning');
    }
  }

  /* --------------------------------------------------------------------------
     9. DETECTION, REASONING & PARCELS DEMO VISUALS
     -------------------------------------------------------------------------- */
  renderDetectionFeaturesOnMap() {
    if (!this.maps.detection) return;
    this.features.forEach(f => {
      if (f.geometry.type === 'LineString') {
        const latlngs = f.geometry.coordinates.map(c => [c[1], c[0]]);
        const color = f.feature_type === 'Road' ? '#f59e0b' : (f.feature_type === 'Wall' ? '#e2e8f0' : '#ec4899');
        L.polyline(latlngs, { color, weight: f.feature_type === 'Road' ? 5 : 3 }).addTo(this.maps.detection);
      } else if (f.geometry.type === 'Polygon') {
        const latlngs = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
        L.polygon(latlngs, { color: '#06b6d4', weight: 2, fillColor: '#0891b2', fillOpacity: 0.6 }).addTo(this.maps.detection);
      }
    });
  }

  async triggerSpatialReasoning() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    if (!currentImg) {
      this.showToast('Please upload an image first.', 'warning');
      return;
    }

    const btn = document.getElementById('btnRunSpatialReasoning');
    const tag = document.getElementById('tagReasoningStatus');
    const stepText = document.getElementById('reasoningStepText');
    const progressBar = document.getElementById('reasoningProgressBar');
    const warningBox = document.getElementById('srWarningBox');

    if (btn) btn.disabled = true;
    if (tag) { tag.textContent = 'PROCESSING'; tag.className = 'pm-status-tag tag-amber'; }
    if (warningBox) warningBox.style.display = 'none';

    // Step-by-step progress display (Step 7 Section 19 Specification)
    const progressSteps = [
      { text: 'Preparing validated detections...', pct: 12 },
      { text: 'Building road network...', pct: 25 },
      { text: 'Applying water exclusion...', pct: 38 },
      { text: 'Analyzing boundary evidence...', pct: 50 },
      { text: 'Identifying land blocks...', pct: 62 },
      { text: 'Generating parcel candidates...', pct: 75 },
      { text: 'Cleaning geometry...', pct: 88 },
      { text: 'Validating parcels...', pct: 96 }
    ];

    let currentStepIdx = 0;
    const interval = setInterval(() => {
      if (currentStepIdx < progressSteps.length) {
        if (stepText) stepText.textContent = progressSteps[currentStepIdx].text;
        if (progressBar) progressBar.style.width = `${progressSteps[currentStepIdx].pct}%`;
        currentStepIdx++;
      }
    }, 150);

    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/spatial-reasoning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagery_id: currentImg.id,
          detection_run_id: this.currentDetectionRunId || null,
          detection_ids: (this.features || []).filter(f => f.imagery_id === currentImg.id).map(f => f.id)
        })
      });
      const data = await res.json();
      clearInterval(interval);

      if (data.success) {
        if (stepText) stepText.textContent = 'Completed';
        if (progressBar) progressBar.style.width = '100%';
        if (tag) { tag.textContent = 'COMPLETED'; tag.className = 'pm-status-tag tag-emerald'; }

        this.parcels = data.candidates || [];

        // Populate Diagnostic Summary Panel (Requirement 16 & 20)
        const summary = data.spatial_reasoning_summary || data.diagnostic_summary || {};
        const elVal = document.getElementById('srDiagValidatedDetections');
        const elRoad = document.getElementById('srDiagRoadNetwork');
        const elBound = document.getElementById('srDiagBoundaryEvidence');
        const elLand = document.getElementById('srDiagLandBlocks');
        const elCand = document.getElementById('srDiagCandidateParcels');
        const elAcc = document.getElementById('srDiagAcceptedParcels');
        const elRev = document.getElementById('srDiagNeedsReview');
        const elRej = document.getElementById('srDiagRejectedParcels');

        if (elVal) elVal.textContent = summary.validated_detections ?? '-';
        if (elRoad) elRoad.textContent = summary.road_network ?? summary.road_network_segments ?? '-';
        if (elBound) elBound.textContent = summary.boundary_evidence ?? summary.boundary_evidence_count ?? '-';
        if (elLand) elLand.textContent = summary.land_blocks ?? data.land_blocks?.total_identified ?? 2;
        if (elCand) elCand.textContent = summary.candidate_parcels ?? '-';
        if (elAcc) elAcc.textContent = summary.accepted_parcels ?? '-';
        if (elRev) elRev.textContent = summary.needs_review ?? summary.review_parcels ?? '-';
        if (elRej) elRej.textContent = summary.rejected_parcels ?? '-';

        // Populate Rejection Reasons Counters (Requirement 16)
        const rejs = summary.rejection_reasons || data.rejection_categories || {};
        const mapRej = {
          'srRejWaterOverlap': 'Water overlap',
          'srRejInvalidGeom': 'Invalid geometry',
          'srRejInsuffEvidence': 'Insufficient evidence',
          'srRejUnsupportedEdge': 'Unsupported edge',
          'srRejHugePolygon': 'Huge polygon',
          'srRejDuplicate': 'Duplicate',
          'srRejDisconnectedGeom': 'Disconnected geometry',
          'srRejWeakBoundary': 'Weak boundary evidence'
        };
        Object.entries(mapRej).forEach(([elemId, catKey]) => {
          const el = document.getElementById(elemId);
          if (el) el.textContent = rejs[catKey] ?? 0;
        });

        if (data.warning) {
          if (warningBox) {
            warningBox.style.display = 'block';
            document.getElementById('srWarningText').textContent = data.warning;
          }
          this.showToast(data.warning, 'warning');
        } else {
          this.showToast(`Spatial reasoning complete: ${data.candidates_count} preliminary parcels generated. Ready for GIS Quality.`, 'success');
        }
        await this.loadProjectData(this.activeProjectId);
        this.renderReasoningMap();
      } else {
        if (tag) { tag.textContent = 'FAILED'; tag.className = 'pm-status-tag tag-rose'; }
        if (stepText) stepText.textContent = 'Failed: ' + (data.error || 'Spatial reasoning error');
        this.showToast(data.error || 'Spatial reasoning failed', 'error');
      }
    } catch (err) {
      clearInterval(interval);
      if (tag) { tag.textContent = 'FAILED'; tag.className = 'pm-status-tag tag-rose'; }
      if (stepText) stepText.textContent = 'Failed: ' + err.message;
      this.showToast('Spatial reasoning request failed: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  renderReasoningMap() {
    const mapDiv = document.getElementById('reasoningMap');
    if (!mapDiv) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const banner = document.getElementById('bannerReasoningPreviewMode');
    const tagMode = document.getElementById('tagReasoningCoordinateMode');

    if (this.maps.reasoning) {
      this.maps.reasoning.remove();
      this.maps.reasoning = null;
      this.reasoningFeatureGroup = null;
    }

    if (!currentImg) {
      if (banner) banner.style.display = 'none';
      mapDiv.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">No drone imagery uploaded.</div>`;
      return;
    }

    const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || 
                            currentImg.file_name.toLowerCase().endsWith('.tiff') || 
                            Boolean(currentImg.metadata?.crs);

    if (banner) banner.style.display = isGeoreferenced ? 'none' : 'flex';
    if (tagMode) tagMode.textContent = isGeoreferenced ? 'Georeferenced GIS Coordinates' : 'Image Coordinates (px)';

    const width = Number(currentImg.width) || 4000;
    const height = Number(currentImg.height) || 3000;

    if (!isGeoreferenced) {
      const bounds = [[0, 0], [height, width]];
      this.maps.reasoning = L.map('reasoningMap', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 3,
        zoomSnap: 0.25,
        attributionControl: false,
        zoomControl: true
      });
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds).addTo(this.maps.reasoning);
      this.maps.reasoning.fitBounds(bounds);
    } else {
      const center = this.project?.coordinates || [18.5818, 73.9875];
      this.maps.reasoning = L.map('reasoningMap', { attributionControl: false, zoomControl: true }).setView(center, 16);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.reasoning);
      const delta = 0.003;
      const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.85 }).addTo(this.maps.reasoning);
    }

    this.renderReasoningLayers(isGeoreferenced, height, width);
    this.updateReasoningStats();
  }

  renderReasoningLayers(isGeoreferenced, height, width) {
    if (!this.maps.reasoning) return;
    if (this.reasoningFeatureGroup) {
      this.reasoningFeatureGroup.remove();
    }
    this.reasoningFeatureGroup = L.featureGroup().addTo(this.maps.reasoning);

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const relevantFeatures = this.features.filter(f => currentImg && f.imagery_id === currentImg.id);

    const showRoads = document.getElementById('srChkRoads')?.checked ?? true;
    const showBuildings = document.getElementById('srChkBuildings')?.checked ?? true;
    const showFields = document.getElementById('srChkFields')?.checked ?? true;
    const showWalls = document.getElementById('srChkWalls')?.checked ?? true;
    const showFences = document.getElementById('srChkFences')?.checked ?? true;
    const showWater = document.getElementById('srChkWater')?.checked ?? true;
    const showBoundaries = document.getElementById('srChkBoundaries')?.checked ?? true;
    const showParcels = document.getElementById('srChkParcels')?.checked ?? true;

    const toLeaflet = (pt) => {
      if (!isGeoreferenced) {
        return [height - pt[1], pt[0]];
      } else {
        return [pt[1], pt[0]];
      }
    };

    // 1. Water Exclusion Mask (cyan / deep blue)
    if (showWater) {
      relevantFeatures.filter(f => (f.detection_type === 'WATER' || f.feature_type === 'Water' || f.feature_type === 'Water Body')).forEach(w => {
        const rawCoords = (!isGeoreferenced && w.image_coordinates) ? w.image_coordinates : (w.geo_geometry?.coordinates?.[0] || w.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, {
            color: '#0284c7',
            weight: 2,
            fillColor: '#0369a1',
            fillOpacity: 0.45,
            dashArray: '3 3'
          })
          .bindTooltip(`🌊 Water Exclusion: ${w.name || 'Water Body'}`, { sticky: true })
          .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 2. Roads (lines)
    if (showRoads) {
      relevantFeatures.filter(f => (f.detection_type === 'ROAD' || f.feature_type === 'Road')).forEach(r => {
        const rawCoords = (!isGeoreferenced && r.image_coordinates) ? r.image_coordinates : (r.geo_geometry?.coordinates || r.geometry?.coordinates || []);
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polyline(latlngs, { color: '#f59e0b', weight: 4, opacity: 0.9 })
            .bindTooltip(`🛣️ ${r.name || 'Road'}`, { sticky: true })
            .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 3. Buildings (polygons)
    if (showBuildings) {
      relevantFeatures.filter(f => (f.detection_type === 'BUILDING' || f.feature_type === 'Building')).forEach(b => {
        const rawCoords = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geo_geometry?.coordinates?.[0] || b.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, { color: '#06b6d4', weight: 2, fillColor: '#0891b2', fillOpacity: 0.5 })
            .bindTooltip(`🏢 Structure`, { sticky: true })
            .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 4. Fields (translucent regions)
    if (showFields) {
      relevantFeatures.filter(f => (f.detection_type === 'FIELD' || f.feature_type === 'Field Edge' || f.feature_type === 'Field')).forEach(fld => {
        const rawCoords = (!isGeoreferenced && fld.image_coordinates) ? fld.image_coordinates : (fld.geo_geometry?.coordinates?.[0] || fld.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, { color: '#84cc16', weight: 1.5, fillColor: '#65a30d', fillOpacity: 0.28 })
            .bindTooltip(`🌱 ${fld.name || 'Field'}`, { sticky: true })
            .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 5. Walls (thin lines)
    if (showWalls || showBoundaries) {
      relevantFeatures.filter(f => (f.detection_type === 'WALL' || f.feature_type === 'Wall')).forEach(b => {
        const rawCoords = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geo_geometry?.coordinates || b.geometry?.coordinates || []);
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polyline(latlngs, { color: '#cbd5e1', weight: 2, opacity: 0.85, dashArray: '4 4' })
            .bindTooltip(`Wall Boundary`, { sticky: true })
            .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 6. Fences (thin lines)
    if (showFences || showBoundaries) {
      relevantFeatures.filter(f => (f.detection_type === 'FENCE' || f.feature_type === 'Fence' || f.detection_type === 'BOUNDARY')).forEach(b => {
        const rawCoords = (!isGeoreferenced && b.image_coordinates) ? b.image_coordinates : (b.geo_geometry?.coordinates || b.geometry?.coordinates || []);
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polyline(latlngs, { color: '#ec4899', weight: 2, opacity: 0.85, dashArray: '2 2' })
            .bindTooltip(`Fence / Demarcation`, { sticky: true })
            .addTo(this.reasoningFeatureGroup);
        }
      });
    }

    // 7. Preliminary Parcels (outlined translucent polygons)
    if (showParcels && this.parcels.length > 0) {
      const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
      currentParcels.forEach(p => {
        const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0]) ? p.image_coordinates[0] : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          const isAccepted = (p.candidate_status === 'ACCEPTED' || p.confidence >= 0.85);
          const color = isAccepted ? '#10b981' : (p.confidence >= 0.70 ? '#f59e0b' : '#f43f5e');

          const poly = L.polygon(latlngs, {
            color,
            weight: 2.5,
            fillColor: color,
            fillOpacity: 0.22
          });

          // Interactive Parcel Popup (Requirement 18)
          const supportingList = (p.supporting_features || []).map(f => `<li>${f}</li>`).join('');
          poly.bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4; min-width: 190px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 4px; margin-bottom: 6px;">
                <strong style="color: ${color}; font-size: 13px;">${p.parcel_id || p.id}</strong>
                <span style="font-size: 10px; background: rgba(16,185,129,0.15); color: ${color}; padding: 1px 5px; border-radius: 3px;">${p.candidate_status || (p.confidence >= 0.85 ? 'ACCEPTED' : 'REVIEW')}</span>
              </div>
              <div style="color: #cbd5e1; margin-bottom: 2px;"><strong>Confidence:</strong> ${Math.round((p.confidence || 0.75) * 100)}% (${p.confidence_label || (p.confidence >= 0.85 ? 'High' : 'Medium')})</div>
              <div style="color: #cbd5e1; margin-bottom: 2px;"><strong>Status:</strong> ${p.candidate_status || p.status || 'preliminary'}</div>
              <div style="color: #cbd5e1; margin-bottom: 2px;"><strong>Geometry source:</strong> ${p.source || 'spatial_reasoning'}</div>
              <div style="color: #cbd5e1; margin-bottom: 2px;"><strong>Area:</strong> ${p.area}</div>
              <div style="font-size: 11px; color: #cbd5e1; font-weight: 600; margin-top: 5px;">Supporting Features:</div>
              <ul style="margin: 2px 0 0 16px; padding: 0; color: #94a3b8; font-size: 11px;">
                ${supportingList || '<li>Inferred Boundary Edge</li>'}
              </ul>
            </div>
          `);

          poly.addTo(this.reasoningFeatureGroup);
        }
      });
    }
  }

  updateReasoningStats() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const relevantFeatures = this.features.filter(f => currentImg && f.imagery_id === currentImg.id);
    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);

    const tag = document.getElementById('tagReasoningStatus');
    const stepText = document.getElementById('reasoningStepText');
    const progressBar = document.getElementById('reasoningProgressBar');

    if (currentParcels.length > 0) {
      if (tag && tag.textContent !== 'PROCESSING') {
        tag.textContent = 'COMPLETED';
        tag.className = 'pm-status-tag tag-emerald';
      }
      if (stepText && !stepText.textContent.includes('...')) stepText.textContent = 'Completed';
      if (progressBar && progressBar.style.width === '0%') progressBar.style.width = '100%';
    } else {
      if (tag && tag.textContent !== 'PROCESSING') {
        tag.textContent = 'NOT_STARTED';
        tag.className = 'pm-status-tag tag-neutral';
      }
      if (stepText && !stepText.textContent.includes('...')) stepText.textContent = 'Ready to Process';
      if (progressBar && progressBar.style.width === '100%') progressBar.style.width = '0%';
    }

    const roadsCount = relevantFeatures.filter(f => f.detection_type === 'ROAD' || f.feature_type === 'Road').length;
    const bldgsCount = relevantFeatures.filter(f => f.detection_type === 'BUILDING' || f.feature_type === 'Building').length;
    const boundsCount = relevantFeatures.filter(f => ['WALL', 'FENCE', 'BOUNDARY', 'Wall', 'Fence', 'Field Edge'].includes(f.detection_type || f.feature_type)).length;

    const elVal = document.getElementById('srDiagValidatedDetections');
    const elRoad = document.getElementById('srDiagRoadNetwork');
    const elBound = document.getElementById('srDiagBoundaryEvidence');
    const elLand = document.getElementById('srDiagLandBlocks');
    const elCand = document.getElementById('srDiagCandidateParcels');
    const elAcc = document.getElementById('srDiagAcceptedParcels');
    const elRev = document.getElementById('srDiagNeedsReview');
    const elRej = document.getElementById('srDiagRejectedParcels');

    if (elVal) elVal.textContent = relevantFeatures.length;
    if (elRoad) elRoad.textContent = roadsCount;
    if (elBound) elBound.textContent = boundsCount;
    if (elLand) elLand.textContent = roadsCount > 0 ? 2 : 1;
    if (elCand) elCand.textContent = currentParcels.length;
    if (elAcc) elAcc.textContent = currentParcels.filter(p => p.candidate_status === 'ACCEPTED' || p.confidence >= 0.85).length;
    if (elRev) elRev.textContent = currentParcels.filter(p => p.candidate_status === 'REVIEW' || (p.confidence < 0.85 && p.confidence >= 0.65)).length;
    if (elRej && (!elRej.textContent || elRej.textContent === '-')) elRej.textContent = '0';
  }

  renderParcelsViewUI() {
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);

    const elCount = document.getElementById('lblGenParcelCount');
    if (elCount) elCount.textContent = `${currentParcels.length} Parcel${currentParcels.length === 1 ? '' : 's'}`;

    const high = currentParcels.filter(p => p.confidence >= 0.85).length;
    const med = currentParcels.filter(p => p.confidence >= 0.70 && p.confidence < 0.85).length;
    const low = currentParcels.filter(p => p.confidence < 0.70).length;

    const elHigh = document.getElementById('cntHighConf');
    const elMed = document.getElementById('cntMedConf');
    const elLow = document.getElementById('cntLowConf');
    if (elHigh) elHigh.textContent = high;
    if (elMed) elMed.textContent = med;
    if (elLow) elLow.textContent = low;

    this.renderParcelsMap();
  }

  renderParcelsMap() {
    const mapDiv = document.getElementById('parcelsMap');
    if (!mapDiv) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    if (this.maps.parcels) {
      this.maps.parcels.remove();
      this.maps.parcels = null;
    }

    if (!currentImg) {
      mapDiv.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">No imagery uploaded.</div>`;
      return;
    }

    const isGeoreferenced = currentImg.file_name.toLowerCase().endsWith('.tif') || 
                            currentImg.file_name.toLowerCase().endsWith('.tiff') || 
                            Boolean(currentImg.metadata?.crs);

    const width = Number(currentImg.width) || 4000;
    const height = Number(currentImg.height) || 3000;

    if (!isGeoreferenced) {
      const bounds = [[0, 0], [height, width]];
      this.maps.parcels = L.map('parcelsMap', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 3,
        zoomSnap: 0.25,
        attributionControl: false,
        zoomControl: true
      });
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds).addTo(this.maps.parcels);
      this.maps.parcels.fitBounds(bounds);
    } else {
      const center = this.project?.coordinates || [18.5818, 73.9875];
      this.maps.parcels = L.map('parcelsMap', { attributionControl: false, zoomControl: true }).setView(center, 16);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.maps.parcels);
      const delta = 0.003;
      const bounds = [[center[0] - delta, center[1] - delta * 1.5], [center[0] + delta, center[1] + delta * 1.5]];
      L.imageOverlay(this.getImageUrl(currentImg.file_url), bounds, { opacity: 0.85 }).addTo(this.maps.parcels);
    }

    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];
    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);

    currentParcels.forEach(p => {
      const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0]) ? p.image_coordinates[0] : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);
      if (rawCoords.length >= 3) {
        const latlngs = rawCoords.map(toLeaflet);
        const color = p.confidence >= 0.85 ? '#10b981' : (p.confidence >= 0.70 ? '#f59e0b' : '#f43f5e');
        L.polygon(latlngs, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.25
        }).bindTooltip(`${p.parcel_id} (${Math.round(p.confidence * 100)}% - ${p.area})`, { sticky: true })
          .addTo(this.maps.parcels);
      }
    });
  }

  renderReasoningGraphOnMap() {
    this.renderReasoningMap();
  }

  renderParcelsConfidenceOnMap() {
    this.renderParcelsMap();
  }

  /* --------------------------------------------------------------------------
     8. FINAL VERIFIED MAP (Step 9: Final Map, Controls, Parcel Display & Exports)
     -------------------------------------------------------------------------- */
  renderFinalMapLayers() {
    if (!this.maps.final) return;

    if (this.finalLayerGroup) {
      try { this.finalLayerGroup.clearLayers(); } catch (e) {}
    }
    this.finalLayerGroup = L.layerGroup().addTo(this.maps.final);

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const height = Number(currentImg?.height) || 3000;
    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
    const acceptedList = currentParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
    const needsReviewList = currentParcels.filter(p => p.status === 'needs_review' || p.status === 'Needs Review');
    const rejectedList = currentParcels.filter(p => p.status === 'rejected' || p.status === 'Rejected');

    const totalPrelim = currentParcels.length;
    const acceptedCount = acceptedList.length;
    const needsReviewCount = needsReviewList.length;
    const rejectedCount = rejectedList.length;
    const verificationPct = totalPrelim > 0 ? Math.round((acceptedCount / totalPrelim) * 100) : 0;
    const gisCriticalCount = (this.qualityAudit?.overlaps_count || 0) + (this.qualityAudit?.invalid_polygons_count || 0);

    // 1. Dynamic Verification Progress (Step 9 Section 6)
    const elVerifyPct = document.getElementById('finalVerifyProgressPct');
    if (elVerifyPct) elVerifyPct.textContent = `${verificationPct}%`;

    const elVerifyFill = document.getElementById('finalVerifyProgressFill');
    if (elVerifyFill) elVerifyFill.style.width = `${verificationPct}%`;

    const elVerifyText = document.getElementById('finalVerifyProgressText');
    if (elVerifyText) elVerifyText.textContent = `${acceptedCount} / ${totalPrelim} parcels verified`;

    // Coordinate Mode Notice (Step 9 Section 23)
    const noticeEl = document.getElementById('finalMapCoordinateNotice');
    const noticeText = document.getElementById('finalMapCoordinateNoticeText');
    if (noticeEl) {
      noticeEl.style.display = 'block';
      if (!isGeoreferenced) {
        noticeEl.className = 'pm-status-tag tag-blue';
        if (noticeText) noticeText.textContent = 'Image-space mode — Real-world area unavailable until imagery is georeferenced.';
      } else {
        noticeEl.className = 'pm-status-tag tag-emerald';
        if (noticeText) noticeText.textContent = 'WGS84 Georeferenced Coordinates';
      }
    }

    // 2. Dynamic Final Map Summary Panel (Step 9 Section 6)
    const elSumVer = document.getElementById('finalSumVerified');
    if (elSumVer) elSumVer.textContent = acceptedCount;

    const elSumVerBadge = document.getElementById('finalSumVerifiedBadge');
    if (elSumVerBadge) elSumVerBadge.textContent = acceptedCount;

    const elSumRev = document.getElementById('finalSumReview');
    if (elSumRev) elSumRev.textContent = needsReviewCount;

    const elSumRej = document.getElementById('finalSumRejected');
    if (elSumRej) elSumRej.textContent = rejectedCount;

    const elSumArea = document.getElementById('finalSumArea');
    if (elSumArea) {
      if (isGeoreferenced) {
        const totalAreaSqm = acceptedList.reduce((acc, p) => acc + (p.area_sqm || 0), 0);
        const totalHa = (totalAreaSqm / 10000).toFixed(2);
        elSumArea.textContent = `${totalHa} ha (${Math.round(totalAreaSqm).toLocaleString()} m²)`;
      } else {
        elSumArea.textContent = 'Area unavailable — imagery is not georeferenced.';
      }
    }

    // 3. Dynamic Status Badge
    let finalStatus = 'PROCESSING';
    let statusClass = 'tag-emerald';
    if (totalPrelim === 0) {
      finalStatus = 'PROCESSING';
      statusClass = 'tag-amber';
    } else if (gisCriticalCount > 0) {
      finalStatus = 'REQUIRES ATTENTION';
      statusClass = 'tag-rose';
    } else if (acceptedCount === totalPrelim && totalPrelim > 0) {
      finalStatus = 'VERIFIED';
      statusClass = 'tag-emerald';
    } else if (needsReviewCount > 0 || (acceptedCount > 0 && acceptedCount < totalPrelim)) {
      finalStatus = 'PARTIALLY VERIFIED';
      statusClass = 'tag-amber';
    } else {
      finalStatus = 'READY FOR REVIEW';
      statusClass = 'tag-blue';
    }

    const badgeStatus = document.getElementById('badgeFinalStatus');
    if (badgeStatus) {
      badgeStatus.textContent = finalStatus;
      badgeStatus.className = `pm-status-tag ${statusClass}`;
    }

    // 4. Layer Visibility Controls (Step 9 Section 8)
    const showAccepted = document.getElementById('fchkAccepted')?.checked ?? true;
    const showRoads = document.getElementById('fchkRoads')?.checked ?? true;
    const showBuildings = document.getElementById('fchkBuildings')?.checked ?? true;
    const showFields = document.getElementById('fchkFields')?.checked ?? true;
    const showWater = document.getElementById('fchkWater')?.checked ?? true;
    const showPreliminary = document.getElementById('fchkPreliminary')?.checked ?? false;
    const showGisIssues = document.getElementById('fchkGisIssues')?.checked ?? false;
    const showSourceImagery = document.getElementById('fchkSourceImagery')?.checked ?? true;

    // Handle Source Imagery overlay toggle
    if (this.finalImageOverlay) {
      if (showSourceImagery) {
        if (!this.maps.final.hasLayer(this.finalImageOverlay)) {
          this.finalImageOverlay.addTo(this.maps.final);
        }
      } else {
        if (this.maps.final.hasLayer(this.finalImageOverlay)) {
          this.finalImageOverlay.remove();
        }
      }
    }

    // 5. Contextual Feature Layers
    const relevantFeatures = this.features.filter(f => currentImg && f.imagery_id === currentImg.id);

    // Water layer
    if (showWater) {
      relevantFeatures.filter(f => {
        const t = (f.detection_type || f.feature_type || f.type || '').toUpperCase();
        return t.includes('WATER') || t.includes('RIVER') || t.includes('CANAL') || t.includes('LAKE');
      }).forEach(w => {
        const rawCoords = w.geometry?.coordinates?.[0] || w.geometry?.coordinates || [];
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, { color: '#0284c7', weight: 2, fillColor: '#0284c7', fillOpacity: 0.35 })
            .bindTooltip('Water Feature', { sticky: true })
            .addTo(this.finalLayerGroup);
        }
      });
    }

    // Roads layer
    if (showRoads) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toUpperCase().includes('ROAD')).forEach(r => {
        const rawCoords = r.geometry?.coordinates || [];
        if (rawCoords.length >= 2) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polyline(latlngs, { color: '#f59e0b', weight: 4, opacity: 0.85 })
            .bindTooltip('Road Feature', { sticky: true })
            .addTo(this.finalLayerGroup);
        }
      });
    }

    // Buildings layer
    if (showBuildings) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toUpperCase().includes('BUILDING')).forEach(b => {
        const rawCoords = b.geometry?.coordinates?.[0] || b.geometry?.coordinates || [];
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, { color: '#06b6d4', weight: 2, fillColor: '#06b6d4', fillOpacity: 0.3 })
            .bindTooltip('Building Structure', { sticky: true })
            .addTo(this.finalLayerGroup);
        }
      });
    }

    // Fields layer
    if (showFields) {
      relevantFeatures.filter(f => (f.detection_type || f.feature_type || '').toUpperCase().includes('FIELD')).forEach(f => {
        const rawCoords = f.geometry?.coordinates?.[0] || f.geometry?.coordinates || [];
        if (rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, { color: '#84cc16', weight: 1.5, fillColor: '#84cc16', fillOpacity: 0.15, dashArray: '3, 3' })
            .bindTooltip('Agricultural Field', { sticky: true })
            .addTo(this.finalLayerGroup);
        }
      });
    }

    // Optional Preliminary Parcels (Step 9 Section 8)
    if (showPreliminary) {
      currentParcels.filter(p => p.status !== 'accepted' && p.status !== 'Human Verified' && p.status !== 'verified').forEach(p => {
        const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0])
          ? p.image_coordinates[0]
          : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);

        if (rawCoords && rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          L.polygon(latlngs, {
            color: '#a855f7',
            weight: 1.5,
            dashArray: '4, 4',
            fillColor: '#a855f7',
            fillOpacity: 0.15
          }).bindTooltip(`${p.parcel_id || p.id} (Preliminary - ${p.status})`, { sticky: true })
            .addTo(this.finalLayerGroup);
        }
      });
    }

    // 6. FINAL VERIFIED PARCELS (Step 9 Section 2, 3, 4) - Strictly only accepted parcels
    if (showAccepted) {
      acceptedList.forEach(p => {
        const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0])
          ? p.image_coordinates[0]
          : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);

        if (rawCoords && rawCoords.length >= 3) {
          const latlngs = rawCoords.map(toLeaflet);
          const poly = L.polygon(latlngs, {
            color: '#10b981',
            weight: 2.8,
            fillColor: '#10b981',
            fillOpacity: 0.32
          });

          const pId = p.parcel_id || p.id;
          
          // Hover Requirement (Step 9 Section 4): Parcel ID + Status: Human Verified
          poly.bindTooltip(`
            <div style="font-family: sans-serif; font-size: 11px;">
              <strong style="color: #10b981; font-size: 12px;">${pId}</strong><br>
              <span style="color: #34d399; font-weight: 600;">Status: Human Verified</span>
            </div>
          `, { sticky: true });

          // Click Requirement (Step 9 Section 4 & 5): Open parcel details
          poly.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            this.showFinalParcelDetails(p);
            this.highlightFinalParcel(p, poly);
          });

          poly.addTo(this.finalLayerGroup);
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     SELECTED PARCEL DETAILS (Step 9 Section 5)
     -------------------------------------------------------------------------- */
  showFinalParcelDetails(parcel) {
    const panel = document.getElementById('finalParcelDetailsPanel');
    if (!panel) return;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;

    const pid = parcel.parcel_id || parcel.id;
    document.getElementById('fdParcelId').textContent = pid;

    const statusEl = document.getElementById('fdParcelStatus');
    const verStatusEl = document.getElementById('fdParcelVerStatus');
    const isAccepted = parcel.status === 'accepted' || parcel.status === 'Human Verified' || parcel.status === 'verified';
    const isReview = parcel.status === 'needs_review' || parcel.status === 'Needs Review';
    const isRejected = parcel.status === 'rejected' || parcel.status === 'Rejected';

    const statusText = isAccepted ? 'Human Verified' : (isRejected ? 'Rejected' : (isReview ? 'Needs Review' : 'Preliminary'));
    const statusColor = isAccepted ? 'tag-emerald' : (isRejected ? 'tag-rose' : 'tag-amber');

    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.className = `pm-status-tag ${statusColor}`;
    }
    if (verStatusEl) {
      verStatusEl.textContent = statusText;
      verStatusEl.style.color = isAccepted ? 'var(--accent-emerald)' : (isRejected ? 'var(--accent-rose)' : 'var(--accent-amber)');
    }

    const areaEl = document.getElementById('fdParcelArea');
    if (areaEl) {
      if (isGeoreferenced && parcel.area_sqm) {
        areaEl.textContent = `${Math.round(parcel.area_sqm).toLocaleString()} m²`;
        areaEl.style.color = 'var(--text-primary)';
      } else {
        areaEl.textContent = 'Real-world area unavailable until imagery is georeferenced.';
        areaEl.style.color = 'var(--text-secondary)';
      }
    }

    const coordsEl = document.getElementById('fdParcelCoords');
    if (coordsEl) {
      coordsEl.textContent = isGeoreferenced ? 'Geographic (WGS84 EPSG:4326)' : 'Image-space coordinates';
    }

    const sourceEl = document.getElementById('fdParcelSource');
    if (sourceEl) {
      sourceEl.textContent = parcel.source || 'Spatial Reasoning';
    }

    const confEl = document.getElementById('fdParcelConfidence');
    if (confEl) {
      confEl.textContent = `${Math.round((parcel.confidence || 0.85) * 100)}%`;
    }

    const geomEl = document.getElementById('fdParcelGeomStatus');
    if (geomEl) {
      geomEl.textContent = 'Valid Polygon';
    }

    const evidenceEl = document.getElementById('fdParcelEvidence');
    if (evidenceEl) {
      if (parcel.supporting_features && parcel.supporting_features.length > 0) {
        evidenceEl.textContent = parcel.supporting_features.join(' + ');
      } else {
        evidenceEl.textContent = 'Road + Field Edge';
      }
    }

    // Bind Generate Parcel Report Button (Step 9 Section 11)
    const reportBtn = document.getElementById('btnGenerateParcelReport');
    if (reportBtn) {
      reportBtn.onclick = () => {
        this.downloadParcelPdf(pid);
      };
    }

    panel.style.display = 'block';
  }

  highlightFinalParcel(parcel, poly) {
    if (this.finalSelectedPolygon && this.finalSelectedPolygon !== poly) {
      this.renderFinalMapLayers();
    }
    this.finalSelectedPolygon = poly;
    poly.setStyle({
      color: '#38bdf8',
      weight: 3.5,
      fillColor: '#38bdf8',
      fillOpacity: 0.45
    });
  }

  /* --------------------------------------------------------------------------
     MAP CONTROLS & MEASUREMENT TOOLS (Step 9 Section 7 & 8)
     -------------------------------------------------------------------------- */
  bindFinalMapControls() {
    // Zoom In / Out
    document.getElementById('btnFinalZoomIn')?.addEventListener('click', () => {
      this.maps.final?.zoomIn();
    });

    document.getElementById('btnFinalZoomOut')?.addEventListener('click', () => {
      this.maps.final?.zoomOut();
    });

    // Fit All Parcels
    document.getElementById('btnFinalFitAll')?.addEventListener('click', () => {
      this.fitAllFinalParcels();
    });

    // Reset View
    document.getElementById('btnFinalResetView')?.addEventListener('click', () => {
      this.fitAllFinalParcels();
    });

    // Fullscreen
    document.getElementById('btnFinalFullscreen')?.addEventListener('click', () => {
      const mapContainer = document.getElementById('finalMap');
      if (!document.fullscreenElement) {
        mapContainer?.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    // Layer checkboxes change event bindings (Step 9 Section 8)
    const layerIds = ['fchkAccepted', 'fchkRoads', 'fchkBuildings', 'fchkFields', 'fchkWater', 'fchkPreliminary', 'fchkGisIssues', 'fchkSourceImagery'];
    layerIds.forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.renderFinalMapLayers();
      });
    });

    // Search Parcel on Final Map (Step 9 Section 7)
    const handleFinalSearch = () => {
      const input = document.getElementById('inputFinalSearchParcel');
      if (!input) return;
      const query = input.value.trim().toUpperCase();
      if (!query) return;

      const parcel = this.parcels.find(p => (p.parcel_id || p.id).toUpperCase() === query || (p.parcel_id || p.id).toUpperCase().includes(query));
      if (!parcel) {
        this.showToast(`Parcel "${query}" not found`, 'warning');
        return;
      }

      this.showFinalParcelDetails(parcel);

      const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
      const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
      const height = Number(currentImg?.height) || 3000;
      const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

      const rawCoords = (!isGeoreferenced && parcel.image_coordinates?.[0])
        ? parcel.image_coordinates[0]
        : (parcel.geo_geometry?.coordinates?.[0] || parcel.geometry?.coordinates?.[0] || []);

      if (rawCoords && rawCoords.length >= 3) {
        const latlngs = rawCoords.map(toLeaflet);
        const bounds = L.latLngBounds(latlngs);
        this.maps.final?.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
        this.showToast(`Found Parcel ${parcel.parcel_id || parcel.id} (Human Verified)`, 'success');
      }
    };

    document.getElementById('btnFinalSearchSubmit')?.addEventListener('click', handleFinalSearch);
    document.getElementById('inputFinalSearchParcel')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleFinalSearch();
    });

    // Measurement Tools (Distance / Area)
    document.getElementById('btnFinalMeasureDistance')?.addEventListener('click', () => {
      this.startFinalMeasurement('distance');
    });

    document.getElementById('btnFinalMeasureArea')?.addEventListener('click', () => {
      this.startFinalMeasurement('area');
    });

    document.getElementById('btnFinalClearMeasurements')?.addEventListener('click', () => {
      this.clearFinalMeasurements();
    });

    document.getElementById('btnCloseMeasureBadge')?.addEventListener('click', () => {
      this.clearFinalMeasurements();
    });

    // Close Details Panel
    document.getElementById('btnCloseParcelDetails')?.addEventListener('click', () => {
      const panel = document.getElementById('finalParcelDetailsPanel');
      if (panel) panel.style.display = 'none';
      if (this.finalSelectedPolygon) {
        this.renderFinalMapLayers();
        this.finalSelectedPolygon = null;
      }
    });

    // Complete Project Button
    document.getElementById('btnCompleteProject')?.addEventListener('click', () => {
      this.promptCompleteProject();
    });

    // Project Completion Modal Handlers
    document.getElementById('btnCloseModalCompletion')?.addEventListener('click', () => {
      document.getElementById('modalProjectCompletion')?.classList.remove('active');
    });

    document.getElementById('btnCompletionCancel')?.addEventListener('click', () => {
      document.getElementById('modalProjectCompletion')?.classList.remove('active');
    });

    document.getElementById('btnCompletionReviewIssues')?.addEventListener('click', () => {
      document.getElementById('modalProjectCompletion')?.classList.remove('active');
      this.switchView('verify');
    });

    document.getElementById('btnCompletionOverride')?.addEventListener('click', async () => {
      document.getElementById('modalProjectCompletion')?.classList.remove('active');
      await this.completeProject(true);
    });

    // Download Project Menu (Step 9 Section 13-15)
    const dropdownBtn = document.getElementById('btnDownloadProjectDropdown');
    const dropdownMenu = document.getElementById('menuDownloadProject');
    dropdownBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdownMenu) {
        dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none';
      }
    });

    document.addEventListener('click', (e) => {
      if (dropdownMenu && !dropdownMenu.contains(e.target) && e.target !== dropdownBtn) {
        dropdownMenu.style.display = 'none';
      }
    });

    document.getElementById('btnDownloadPdf')?.addEventListener('click', () => this.downloadPdfReport());
    document.getElementById('btnDownloadGeoJson')?.addEventListener('click', () => this.downloadGeoJson());
    document.getElementById('btnDownloadCsv')?.addEventListener('click', () => this.downloadCsv());
    document.getElementById('btnDownloadAllZip')?.addEventListener('click', () => this.downloadZipPackage());

    document.getElementById('btnNavToReport')?.addEventListener('click', () => {
      this.switchView('report');
    });
  }

  fitAllFinalParcels() {
    if (!this.maps.final) return;
    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const height = Number(currentImg?.height) || 3000;
    const toLeaflet = (pt) => !isGeoreferenced ? [height - pt[1], pt[0]] : [pt[1], pt[0]];

    const allPoints = [];
    const accepted = this.parcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified');
    const toFit = accepted.length > 0 ? accepted : this.parcels;

    toFit.forEach(p => {
      const rawCoords = (!isGeoreferenced && p.image_coordinates?.[0])
        ? p.image_coordinates[0]
        : (p.geo_geometry?.coordinates?.[0] || p.geometry?.coordinates?.[0] || []);
      if (rawCoords && rawCoords.length > 0) {
        rawCoords.forEach(pt => allPoints.push(toLeaflet(pt)));
      }
    });

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      this.maps.final.fitBounds(bounds, { padding: [30, 30] });
    } else if (!isGeoreferenced && currentImg) {
      const width = Number(currentImg.width) || 4000;
      this.maps.final.fitBounds([[0, 0], [height, width]]);
    } else {
      this.maps.final.setView(this.project?.coordinates || [18.5818, 73.9875], 16);
    }
  }

  startFinalMeasurement(mode) {
    this.clearFinalMeasurements();
    this.finalMeasurementMode = mode;

    document.getElementById('btnFinalMeasureDistance')?.classList.toggle('active', mode === 'distance');
    document.getElementById('btnFinalMeasureArea')?.classList.toggle('active', mode === 'area');

    const badge = document.getElementById('finalMeasureResultBadge');
    const badgeText = document.getElementById('finalMeasureResultText');
    const clearBtn = document.getElementById('btnFinalClearMeasurements');

    if (badge) badge.style.display = 'flex';
    if (badgeText) badgeText.textContent = mode === 'distance' ? 'Click points to measure distance' : 'Click vertices to measure area';
    if (clearBtn) clearBtn.style.display = 'flex';
  }

  handleFinalMapMeasureClick(e) {
    if (!this.finalMeasurementMode || !this.maps.final) return;

    const latlng = e.latlng;
    this.finalMeasurePoints.push(latlng);

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeoreferenced = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : true;
    const badgeText = document.getElementById('finalMeasureResultText');

    L.circleMarker(latlng, { radius: 4, color: '#ffffff', fillColor: '#10b981', fillOpacity: 1 }).addTo(this.finalMeasureLayer);

    if (this.finalMeasurementMode === 'distance') {
      if (this.finalMeasurePoints.length >= 2) {
        L.polyline(this.finalMeasurePoints, { color: '#10b981', weight: 3, dashArray: '4, 4' }).addTo(this.finalMeasureLayer);

        let totalDist = 0;
        for (let i = 0; i < this.finalMeasurePoints.length - 1; i++) {
          const p1 = this.finalMeasurePoints[i];
          const p2 = this.finalMeasurePoints[i + 1];
          if (isGeoreferenced) {
            totalDist += p1.distanceTo(p2);
          } else {
            totalDist += Math.hypot(p2.lat - p1.lat, p2.lng - p1.lng);
          }
        }

        const distStr = isGeoreferenced
          ? (totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`)
          : `${Math.round(totalDist)} px`;

        if (badgeText) badgeText.textContent = `Distance: ${distStr} (${this.finalMeasurePoints.length} points)`;
      }
    } else if (this.finalMeasurementMode === 'area') {
      if (this.finalMeasurePoints.length >= 3) {
        this.finalMeasureLayer.clearLayers();
        this.finalMeasurePoints.forEach(pt => {
          L.circleMarker(pt, { radius: 4, color: '#ffffff', fillColor: '#38bdf8', fillOpacity: 1 }).addTo(this.finalMeasureLayer);
        });

        L.polygon(this.finalMeasurePoints, { color: '#38bdf8', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.25 }).addTo(this.finalMeasureLayer);

        let areaVal = 0;
        if (isGeoreferenced) {
          const pts = this.finalMeasurePoints;
          const numPts = pts.length;
          let total = 0;
          if (numPts > 2) {
            for (let i = 0; i < numPts; i++) {
              const p1 = pts[i];
              const p2 = pts[(i + 1) % numPts];
              total += ((p2.lng - p1.lng) * (Math.PI / 180)) * (2 + Math.sin(p1.lat * (Math.PI / 180)) + Math.sin(p2.lat * (Math.PI / 180)));
            }
            areaVal = Math.abs(total * 6378137.0 * 6378137.0 / 2.0);
          }
        } else {
          const pts = this.finalMeasurePoints;
          let sum = 0;
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            sum += pts[i].lng * pts[j].lat - pts[j].lng * pts[i].lat;
          }
          areaVal = Math.abs(sum / 2);
        }

        const areaStr = isGeoreferenced
          ? (areaVal >= 10000 ? `${(areaVal / 10000).toFixed(2)} ha` : `${Math.round(areaVal)} m²`)
          : `${Math.round(areaVal)} px²`;

        if (badgeText) badgeText.textContent = `Area: ${areaStr}`;
      }
    }
  }

  clearFinalMeasurements() {
    this.finalMeasurementMode = null;
    this.finalMeasurePoints = [];
    this.finalMeasureLayer.clearLayers();

    document.getElementById('btnFinalMeasureDistance')?.classList.remove('active');
    document.getElementById('btnFinalMeasureArea')?.classList.remove('active');
    const badge = document.getElementById('finalMeasureResultBadge');
    if (badge) badge.style.display = 'none';
    const clearBtn = document.getElementById('btnFinalClearMeasurements');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  /* --------------------------------------------------------------------------
     PROJECT COMPLETION CHECK
     -------------------------------------------------------------------------- */
  async promptCompleteProject() {
    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: false })
      });
      const data = await res.json();

      if (data.success) {
        this.showToast('Project marked as Completed!', 'success');
        await this.loadProjectData(this.activeProjectId);
        this.renderFinalMapLayers();
      } else if (data.requires_review) {
        const modal = document.getElementById('modalProjectCompletion');
        const list = document.getElementById('completionIssuesList');
        if (list) {
          list.innerHTML = (data.issues || ['Some parcels require review.']).map(iss => 
            `<li style="padding: 4px 0; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--accent-amber);">⚠</span> ${iss}
            </li>`
          ).join('');
        }
        if (modal) modal.classList.add('active');
      } else {
        this.showToast(data.error || 'Completion check failed', 'error');
      }
    } catch (err) {
      this.showToast('Completion request error', 'error');
    }
  }

  async completeProject(override = true) {
    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(override ? 'Project finalized with surveyor override!' : 'Project marked as Completed!', 'success');
        await this.loadProjectData(this.activeProjectId);
        this.renderFinalMapLayers();
      } else {
        this.showToast(data.error || 'Failed to complete project', 'error');
      }
    } catch (e) {
      this.showToast('Error completing project', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     EXPORTS & REPORT GENERATION (Step 9 Section 10-17)
     -------------------------------------------------------------------------- */
  async captureMapSnapshot() {
    try {
      const mapEl = document.getElementById('finalMap');
      if (!mapEl) return null;
      const canvas = mapEl.querySelector('canvas');
      if (canvas) {
        return canvas.toDataURL('image/png');
      }
    } catch (e) {
      console.warn('Could not capture local canvas:', e);
    }
    return null;
  }

  async downloadPdfReport() {
    this.showToast('Generating official PDF audit dossier...', 'info');
    const snapshot = await this.captureMapSnapshot();
    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          map_snapshot: snapshot,
          imagery_id: this.selectedImageryId || null
        })
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ParcelMap_Project_Report_${this.activeProjectId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('PDF Project Report downloaded successfully!', 'success');
    } catch (e) {
      this.showToast('Report generation failed.', 'error');
    }
  }

  async downloadParcelPdf(parcelId) {
    this.showToast(`Generating official PDF certificate for Parcel ${parcelId}...`, 'info');
    const snapshot = await this.captureMapSnapshot();
    try {
      const res = await fetch(`${this.apiBase}/parcels/${parcelId}/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_snapshot: snapshot })
      });
      if (!res.ok) throw new Error('Parcel PDF export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ParcelMap_Parcel_Report_${parcelId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Parcel Report for ${parcelId} downloaded successfully!`, 'success');
    } catch (e) {
      this.showToast(`Failed to generate Parcel Report for ${parcelId}.`, 'error');
    }
  }

  async downloadGeoJson(scope = 'verified') {
    this.showToast('Exporting valid GeoJSON FeatureCollection...', 'info');
    try {
      const imgQuery = this.selectedImageryId ? `&imagery_id=${encodeURIComponent(this.selectedImageryId)}` : '';
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/export/geojson?scope=${scope}${imgQuery}`);
      if (!res.ok) throw new Error('GeoJSON export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parcels_${this.activeProjectId}.geojson`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('GeoJSON exported successfully!', 'success');
    } catch (e) {
      this.showToast('GeoJSON export failed.', 'error');
    }
  }

  async downloadCsv(scope = 'verified') {
    this.showToast('Exporting Cadastral CSV Register...', 'info');
    try {
      const imgQuery = this.selectedImageryId ? `&imagery_id=${encodeURIComponent(this.selectedImageryId)}` : '';
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/export/csv?scope=${scope}${imgQuery}`);
      if (!res.ok) throw new Error('CSV export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parcels_${this.activeProjectId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('CSV exported successfully!', 'success');
    } catch (e) {
      this.showToast('CSV export failed.', 'error');
    }
  }

  async downloadZipPackage() {
    this.showToast('Packaging full dataset ZIP (PDF + GeoJSON + CSV + README)...', 'info');
    const snapshot = await this.captureMapSnapshot();
    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/export/all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          map_snapshot: snapshot,
          imagery_id: this.selectedImageryId || null
        })
      });
      if (!res.ok) throw new Error('ZIP package failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (this.project?.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `ParcelMap_${safeName}_Dataset.zip`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Full dataset ZIP downloaded successfully!', 'success');
    } catch (e) {
      this.showToast('ZIP export failed.', 'error');
    }
  }

  bindReportActions() {
    document.getElementById('btnGenerateReport')?.addEventListener('click', () => {
      this.generateAndRefreshReport();
    });

    document.getElementById('btnReportDownloadPdf')?.addEventListener('click', () => {
      this.downloadPdfReport();
    });

    document.getElementById('btnReportDownloadGeoJson')?.addEventListener('click', () => {
      this.downloadGeoJson('verified');
    });

    document.getElementById('btnReportDownloadCsv')?.addEventListener('click', () => {
      this.downloadCsv('verified');
    });

    document.getElementById('btnReportDownloadZip')?.addEventListener('click', () => {
      this.downloadZipPackage();
    });

    document.getElementById('btnPrintReport')?.addEventListener('click', () => {
      window.print();
    });
  }

  async generateAndRefreshReport() {
    const statusTag = document.getElementById('repGenerationStatus');
    if (statusTag) {
      statusTag.textContent = 'GENERATING...';
      statusTag.className = 'pm-status-tag tag-amber';
    }

    this.showToast('Generating official cadastral dossier...', 'info');
    try {
      const snapshot = await this.captureMapSnapshot();
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          map_snapshot: snapshot,
          imagery_id: this.selectedImageryId || null
        })
      });
      const data = await res.json();
      if (data.success) {
        if (statusTag) {
          statusTag.textContent = 'COMPLETED';
          statusTag.className = 'pm-status-tag tag-emerald';
        }
        this.renderReportView(data.report);
        this.showToast('Cadastral Report Dossier generated successfully!', 'success');
      } else {
        throw new Error(data.error || 'Server error');
      }
    } catch (e) {
      if (statusTag) {
        statusTag.textContent = 'FAILED';
        statusTag.className = 'pm-status-tag tag-rose';
      }
      this.showToast('Report generation failed.', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     REPORT VIEW RENDERING (Step 9 Section 10-12)
     -------------------------------------------------------------------------- */
  async renderReportView(existingReport = null) {
    try {
      let report = existingReport;
      if (!report) {
        const imgQuery = this.selectedImageryId ? `?imagery_id=${encodeURIComponent(this.selectedImageryId)}` : '';
        const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/report${imgQuery}`);
        const data = await res.json();
        if (data.success) report = data.report;
      }
      if (!report) return;

      const p = report.project;
      const proc = report.processing_summary;
      const par = report.parcel_summary;
      const gis = report.gis_quality;

      // Header & Project Info
      const elDossier = document.getElementById('repDossierNumber');
      if (elDossier) elDossier.textContent = report.report_id;
      const elPid = document.getElementById('repProjectId');
      if (elPid) elPid.textContent = p.id;
      const elPname = document.getElementById('repProjectName');
      if (elPname) elPname.textContent = p.name;
      const elLoc = document.getElementById('repLocation');
      if (elLoc) elLoc.textContent = p.location;
      const elLead = document.getElementById('repLeadSurveyor');
      if (elLead) elLead.textContent = p.created_by;

      const elCdate = document.getElementById('repCreatedDate');
      if (elCdate) elCdate.textContent = new Date(p.created_at).toLocaleDateString('en-GB');
      const elPdate = document.getElementById('repProcessingDate');
      if (elPdate) elPdate.textContent = new Date(report.generated_at).toLocaleDateString('en-GB');

      // Imagery Info
      const elImgFile = document.getElementById('repImageFile');
      if (elImgFile) elImgFile.textContent = report.imagery.file_name;
      const elRes = document.getElementById('repResolution');
      if (elRes) elRes.textContent = report.imagery.resolution || report.imagery.sensor;
      const elCrs = document.getElementById('repCoordSystem');
      if (elCrs) {
        elCrs.textContent = p.is_georeferenced ? 'WGS84 Georeferenced' : 'Image-space coordinates (Non-georeferenced)';
      }

      // Processing Summary
      const elProcImg = document.getElementById('repProcImages');
      if (elProcImg) elProcImg.textContent = proc.images_processed;
      const elProcDet = document.getElementById('repProcDetections');
      if (elProcDet) elProcDet.textContent = proc.ai_detections;
      const elProcRoads = document.getElementById('repProcRoads');
      if (elProcRoads) elProcRoads.textContent = proc.roads_detected;
      const elProcBld = document.getElementById('repProcBuildings');
      if (elProcBld) elProcBld.textContent = proc.buildings_detected;
      const elProcFields = document.getElementById('repProcFields');
      if (elProcFields) elProcFields.textContent = proc.fields_detected;
      const elProcBound = document.getElementById('repProcBoundaries');
      if (elProcBound) elProcBound.textContent = proc.boundaries_detected;

      // Parcel Summary (Strictly Dynamic)
      const elTotalPar = document.getElementById('repSumTotalParcels');
      if (elTotalPar) elTotalPar.textContent = par.total_preliminary_parcels;
      const elVerPar = document.getElementById('repSumVerifiedParcels');
      if (elVerPar) elVerPar.textContent = par.final_verified_parcels ?? par.verified_parcels;
      const elRevPar = document.getElementById('repSumReviewParcels');
      if (elRevPar) elRevPar.textContent = par.needs_review;
      const elRejPar = document.getElementById('repSumRejectedParcels');
      if (elRejPar) elRejPar.textContent = par.rejected_parcels;
      const elProgPct = document.getElementById('repSumProgressPct');
      if (elProgPct) elProgPct.textContent = `${par.verification_percentage}%`;
      const elTotArea = document.getElementById('repSumTotalArea');
      if (elTotArea) {
        elTotArea.textContent = (p.is_georeferenced && par.total_area_hectares)
          ? `${par.total_area_hectares} ha`
          : 'Area unavailable — imagery is not georeferenced.';
      }

      // GIS Quality
      const elGisValid = document.getElementById('repGisValid');
      if (elGisValid) elGisValid.textContent = gis.valid_geometries;
      const elGisOver = document.getElementById('repGisOverlaps');
      if (elGisOver) elGisOver.textContent = gis.overlaps;
      const elGisGaps = document.getElementById('repGisGaps');
      if (elGisGaps) elGisGaps.textContent = gis.possible_gaps;
      const elGisLow = document.getElementById('repGisLowConf');
      if (elGisLow) elGisLow.textContent = gis.low_confidence_parcels;

      // Parcel Register Table (Step 9 Section 10 & 11)
      const tbody = document.getElementById('tblReportParcels');
      if (tbody) {
        tbody.innerHTML = (report.parcels || []).map(parcel => {
          let statusColor = '#059669';
          if (parcel.status.toLowerCase().includes('reject')) statusColor = '#dc2626';
          else if (parcel.status.toLowerCase().includes('review')) statusColor = '#d97706';

          const pid = parcel.parcel_id;
          return `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 6px 8px; font-weight: 700; font-family: var(--font-mono);">${pid}</td>
              <td style="padding: 6px 8px;"><strong style="color: ${statusColor};">${parcel.verification_status || parcel.status.toUpperCase()}</strong></td>
              <td style="padding: 6px 8px;">${parcel.confidence_formatted}</td>
              <td style="padding: 6px 8px; font-size: 10.5px;">${parcel.area}</td>
              <td style="padding: 6px 8px;">${(parcel.supporting_features || []).join(' + ') || 'Boundary Edge'}</td>
              <td style="padding: 6px 8px; color: #64748b;">${parcel.verification_date ? parcel.verification_date.split('T')[0] : 'Verified'}</td>
              <td style="padding: 6px 8px; text-align: right;">
                <button class="btn-pm btn-pm-secondary btn-parcel-report-download" data-pid="${pid}" style="font-size: 10px; padding: 2px 7px;">
                  📄 Report PDF
                </button>
              </td>
            </tr>
          `;
        }).join('');

        tbody.querySelectorAll('.btn-parcel-report-download').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const pid = e.currentTarget.dataset.pid;
            this.downloadParcelPdf(pid);
          });
        });
      }

      // Audit Trail List
      const auditList = document.getElementById('repAuditTrailList');
      if (auditList) {
        const activities = report.activities || [];
        if (activities.length > 0) {
          auditList.innerHTML = activities.map(act => `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 4px 0;">
              <div>
                <strong>${act.title}</strong>
                <span style="color: #64748b; margin-left: 8px;">${act.description}</span>
              </div>
              <span style="color: #94a3b8; font-size: 10px; font-family: var(--font-mono);">${new Date(act.timestamp).toLocaleString('en-GB')}</span>
            </div>
          `).join('');
        } else {
          auditList.innerHTML = `<div style="color: #94a3b8;">No verification events recorded yet.</div>`;
        }
      }

    } catch (err) {
      console.warn('Error rendering report view:', err);
    }
  }

  /* --------------------------------------------------------------------------
     11. SEARCH & AUTOCOMPLETE (STEP 16)
     -------------------------------------------------------------------------- */
  bindSearch() {
    const searchInput = document.getElementById('wsQuickSearch');
    if (!searchInput) return;

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim().toUpperCase();
        const found = this.parcels.find(p => p.parcel_id.toUpperCase() === query || p.parcel_id.includes(query));
        if (found) {
          this.selectParcel(found.parcel_id);
          this.showToast(`Found Parcel ${found.parcel_id}`, 'success');
        } else {
          this.showToast(`No parcel matching "${query}"`, 'warning');
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     12. BACKGROUND JOB PIPELINE MODAL
     -------------------------------------------------------------------------- */
  async triggerJobPipeline() {
    const modal = document.getElementById('modalJobPipeline');
    const logsEl = document.getElementById('consoleJobLogs');
    const fillEl = document.getElementById('barJobFill');
    const progressEl = document.getElementById('lblJobProgress');
    const stepEl = document.getElementById('lblJobStep');
    const closeBtn = document.getElementById('btnCloseJobModal');

    modal.classList.add('active');
    closeBtn.style.display = 'none';
    logsEl.innerHTML = '';

    try {
      const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/pipeline`, { method: 'POST' });
      const data = await res.json();
      const jobId = data.job.id;

      // Poll job progress
      const interval = setInterval(async () => {
        const jRes = await fetch(`${this.apiBase}/jobs/${jobId}`);
        const jData = await jRes.json();
        if (jData.success && jData.job) {
          const j = jData.job;
          fillEl.style.width = `${j.progress}%`;
          progressEl.textContent = `${j.progress}%`;
          logsEl.innerHTML = j.logs.map(l => `<div>${l}</div>`).join('');
          logsEl.scrollTop = logsEl.scrollHeight;

          if (j.status === 'COMPLETED' || j.progress === 100) {
            clearInterval(interval);
            stepEl.textContent = 'Pipeline execution successfully completed!';
            closeBtn.style.display = 'block';
            await this.loadProjectData(this.activeProjectId);
          }
        }
      }, 500);

      closeBtn.onclick = () => {
        modal.classList.remove('active');
        this.switchView('verify');
      };
    } catch (e) {
      stepEl.textContent = 'Pipeline execution failed';
      this.showToast('Pipeline execution error', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     13. MODALS & FORMS
     -------------------------------------------------------------------------- */
  bindModals() {
    const modal = document.getElementById('modalNewProject');
    document.getElementById('btnNewProjectModal')?.addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('btnCloseModalNewProject')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btnCancelNewProject')?.addEventListener('click', () => modal.classList.remove('active'));

    document.getElementById('formCreateProject')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('npName').value.trim();
      const location = document.getElementById('npLocation').value.trim();
      const description = document.getElementById('npDescription').value.trim();
      const lat = parseFloat(document.getElementById('npLat').value) || 18.5818;
      const lng = parseFloat(document.getElementById('npLng').value) || 73.9875;
      const project_type = document.getElementById('npType').value;

      try {
        const res = await fetch(`${this.apiBase}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, location, description, coordinates: [lat, lng], project_type })
        });
        const data = await res.json();
        if (data.success) {
          modal.classList.remove('active');
          this.showToast(`Created project "${data.project.name}"!`, 'success');
          this.activeProjectId = data.project.id;
          localStorage.setItem('pm_active_project_id', this.activeProjectId);
          this.selectedImageryId = null;
          localStorage.removeItem('pm_selected_imagery_id');
          await this.populateProjectSelector();
          await this.loadProjectData(this.activeProjectId);
          this.switchView('imagery');
        }
      } catch (err) {
        this.showToast('Failed to create project', 'error');
      }
    });

    // Unified File Upload & Drag-and-Drop Handling in Imagery view
    const fileInput = document.getElementById('fileUavUpload');
    const dropzone = document.getElementById('uavDropzone');

    const handleFileUpload = async (file) => {
      if (!file) return;

      const validExts = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.jfif', '.webp'];
      const fileExt = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExts.includes(fileExt) && !file.type.startsWith('image/')) {
        this.showToast(`Unsupported format: ${file.name}. Please upload JPG, PNG, WEBP, or GeoTIFF (.tif/.tiff).`, 'error');
        if (fileInput) fileInput.value = '';
        return;
      }

      // Ensure a valid active project exists
      if (!this.activeProjectId) {
        this.activeProjectId = localStorage.getItem('pm_active_project_id') || 'proj_wagholi_demo';
      }

      const processUpload = async (w, h) => {
        const formData = new FormData();
        formData.append('imagery', file);
        formData.append('width', w || 4000);
        formData.append('height', h || 3000);

        this.showToast(`Uploading ${file.name}...`, 'info');
        if (dropzone) {
          dropzone.style.opacity = '0.65';
          dropzone.style.pointerEvents = 'none';
        }

        try {
          const res = await fetch(`${this.apiBase}/projects/${this.activeProjectId}/imagery`, {
            method: 'POST',
            body: formData
          });

          let data;
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch (parseErr) {
            throw new Error(text || `Server returned HTTP ${res.status}`);
          }

          if (res.ok && data.success && data.imagery) {
            this.showToast('Drone imagery uploaded successfully!', 'success');
            this.selectedImageryId = data.imagery.id;
            localStorage.setItem('pm_selected_imagery_id', this.selectedImageryId);
            if (data.project_id && data.project_id !== this.activeProjectId) {
              this.activeProjectId = data.project_id;
              localStorage.setItem('pm_active_project_id', this.activeProjectId);
            }
            await this.loadProjectData(this.activeProjectId);
            this.updateImageryViewUI();
            this.updateDetectionViewUI();
            await this.populateProjectSelector();
          } else {
            const errDetail = data?.error || (res.status === 404 ? `API endpoint not found (HTTP 404 on ${this.apiBase})` : `Server returned HTTP ${res.status}`);
            console.error('[Upload Rejected]:', data);
            this.showToast(`Image upload failed: ${errDetail}`, 'error');
          }
        } catch (err) {
          console.error('[Upload Exception]:', err);
          this.showToast(`Image upload failed: ${err.message || 'Cannot reach API server'}`, 'error');
        } finally {
          if (dropzone) {
            dropzone.style.opacity = '1';
            dropzone.style.pointerEvents = 'auto';
          }
          if (fileInput) fileInput.value = '';
        }
      };

      // Skip browser Image() decoding for GeoTIFFs (browsers cannot decode TIFF natively)
      if (fileExt === '.tif' || fileExt === '.tiff') {
        processUpload(4000, 3000);
        return;
      }

      // Safe dimension extraction with fallback timeout
      let finished = false;
      const objectUrl = URL.createObjectURL(file);
      const tempImg = new Image();

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          URL.revokeObjectURL(objectUrl);
          processUpload(4000, 3000);
        }
      }, 1500);

      tempImg.onload = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          const width = tempImg.naturalWidth || 4000;
          const height = tempImg.naturalHeight || 3000;
          URL.revokeObjectURL(objectUrl);
          processUpload(width, height);
        }
      };

      tempImg.onerror = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          URL.revokeObjectURL(objectUrl);
          processUpload(4000, 3000);
        }
      };

      tempImg.src = objectUrl;
    };

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
      }
    });

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = 'var(--accent-emerald)';
          dropzone.style.background = 'rgba(16, 185, 129, 0.08)';
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = 'var(--border-medium)';
          dropzone.style.background = 'var(--bg-panel)';
        }, false);
      });

      dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handleFileUpload(dt.files[0]);
        }
      }, false);
    }

    document.getElementById('btnLoadDemoImagery')?.addEventListener('click', async () => {
      this.showToast('Loading demo high-resolution Wagholi orthomosaic...', 'info');
      await fetch(`${this.apiBase}/demo/reset`, { method: 'POST' });
      this.activeProjectId = 'proj_wagholi_demo';
      this.selectedImageryId = 'img_wagholi_ortho';
      localStorage.setItem('pm_active_project_id', this.activeProjectId);
      localStorage.setItem('pm_selected_imagery_id', this.selectedImageryId);
      await this.populateProjectSelector();
      await this.loadProjectData(this.activeProjectId);
      this.showToast('Loaded demo high-resolution Wagholi orthomosaic (2.8 cm/px)', 'success');
    });

    // Export GeoJSON
    document.getElementById('btnExportGeoJson')?.addEventListener('click', () => {
      this.downloadGeoJson();
    });
  }

  updateDashboardMetrics() {
    if (!this.project) return;
    document.getElementById('dashProjectName').textContent = this.project.name;
    document.getElementById('dashProjectDesc').textContent = this.project.description;
    document.getElementById('dashOverallProgress').textContent = `${this.project.progress}%`;
    document.getElementById('statFeaturesCount').textContent = this.features.length;

    const currentImg = this.imagery.find(img => img.id === this.selectedImageryId) || this.imagery[0];
    const isGeo = currentImg ? (currentImg.file_name.toLowerCase().endsWith('.tif') || currentImg.file_name.toLowerCase().endsWith('.tiff') || Boolean(currentImg.metadata?.crs)) : false;

    const currentParcels = this.parcels.filter(p => currentImg && p.imagery_id === currentImg.id);
    document.getElementById('statParcelsTotal').textContent = currentParcels.length;

    const verified = currentParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified').length;
    const review = currentParcels.filter(p => p.status === 'needs_review' || p.status === 'Needs Review').length;
    document.getElementById('statParcelsVerified').textContent = verified;
    document.getElementById('statParcelsReview').textContent = review;

    const elArea = document.getElementById('statParcelsArea');
    if (elArea) {
      if (isGeo) {
        const totalAreaSqm = currentParcels.filter(p => p.status === 'accepted' || p.status === 'Human Verified' || p.status === 'verified').reduce((acc, p) => acc + (p.area_sqm || 0), 0);
        elArea.textContent = `${(totalAreaSqm / 10000).toFixed(2)} Hectares`;
      } else {
        elArea.textContent = 'Image-space coordinates';
      }
    }

    if (this.qualityAudit) {
      const totalErrors = (this.qualityAudit.overlaps_count || 0) + (this.qualityAudit.gaps_count || 0) + (this.qualityAudit.slivers_count || 0);
      document.getElementById('statQcErrors').textContent = totalErrors;
    }
  }

  async renderProjectsList() {
    const tbody = document.getElementById('tblProjectsBody');
    if (!tbody) return;

    try {
      const res = await fetch(`${this.apiBase}/projects`);
      const data = await res.json();
      if (!data.success || !data.projects) return;

      tbody.innerHTML = '';

      data.projects.forEach(p => {
        const isDemo = p.id === 'proj_wagholi_demo';
        const isCurrent = p.id === this.activeProjectId;
        const totalParcels = p.preliminary_parcels ?? p.parcels_count ?? (isCurrent ? this.parcels.length : 0);
        const verifiedParcels = p.verified_parcels ?? (isCurrent ? this.parcels.filter(x => x.status === 'accepted' || x.status === 'Human Verified').length : 0);
        const pct = p.verification_pct ?? (totalParcels > 0 ? Math.round((verifiedParcels / totalParcels) * 100) : (p.progress || 0));

        let statusClass = 'tag-emerald';
        const st = (p.final_status || p.status || 'PROCESSING').toUpperCase();
        if (st.includes('ATTENTION') || st.includes('REJECT')) statusClass = 'tag-rose';
        else if (st.includes('REVIEW') || st.includes('PARTIAL')) statusClass = 'tag-amber';
        else if (st.includes('PROCESS')) statusClass = 'tag-blue';

        const tr = document.createElement('tr');
        if (isCurrent) tr.style.background = 'rgba(16, 185, 129, 0.05)';

        tr.innerHTML = `
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong style="color: var(--text-primary); font-weight: 600;">${p.name}</strong>
              ${isDemo ? '<span class="pm-status-tag tag-amber" style="font-size: 9px; padding: 2px 5px;">DEMO PROJECT</span>' : ''}
              ${isCurrent ? '<span class="pm-status-tag tag-emerald" style="font-size: 9px; padding: 2px 5px;">ACTIVE</span>' : ''}
            </div>
            <div style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">ID: ${p.id}</div>
          </td>
          <td style="font-size: 12px; color: var(--text-secondary);">${p.location || 'Unspecified'}</td>
          <td><span class="pm-status-tag ${statusClass}">${st}</span></td>
          <td style="font-size: 12px; color: var(--text-secondary);">${p.created_by || 'Alex Morgan'}</td>
          <td style="font-size: 12px; font-family: var(--font-mono);">${totalParcels} <span style="font-size: 10.5px; color: var(--accent-emerald);">(${verifiedParcels} verified)</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="rail-step-bar" style="width: 70px; height: 4px;"><div class="rail-step-bar-fill" style="width: ${pct}%;"></div></div>
              <span style="font-size: 11px; font-family: var(--font-mono);">${pct}%</span>
            </div>
          </td>
          <td style="text-align: right;">
            <button class="btn-pm ${isCurrent ? 'btn-pm-primary' : 'btn-pm-secondary'}" data-proj-id="${p.id}" style="font-size: 11px; padding: 3px 8px;">
              ${isCurrent ? 'Open Workspace' : 'Switch Project'}
            </button>
          </td>
        `;

        tr.querySelector('button')?.addEventListener('click', async (e) => {
          const projId = e.currentTarget.dataset.projId;
          this.activeProjectId = projId;
          localStorage.setItem('pm_active_project_id', this.activeProjectId);
          this.selectedImageryId = null;
          localStorage.removeItem('pm_selected_imagery_id');
          await this.populateProjectSelector();
          await this.loadProjectData(this.activeProjectId);
          this.showToast(`Switched to project: ${p.name}`, 'info');
          this.switchView('map');
        });

        tbody.appendChild(tr);
      });
    } catch (e) {
      console.warn('Could not load projects list:', e);
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'pm-toast';
    if (type === 'error') toast.style.borderLeftColor = 'var(--accent-rose)';
    if (type === 'warning') toast.style.borderLeftColor = 'var(--accent-amber)';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
  window.parcelApp = new ParcelMapWorkspace();
});
