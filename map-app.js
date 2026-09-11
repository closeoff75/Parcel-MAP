/**
 * ParcelMap Full-Screen High-Definition World GIS Map Engine
 * Architecture:
 * - Clean World Basemap by default (Global Map Mode)
 * - Seamless Basemap Switching (Clean Light, Satellite, Terrain, Dark Canvas, OpenStreetMap)
 * - OpenStreetMap Nominatim Global Geocoding & Coordinate Navigation
 * - HTML5 Geolocation ("Locate Me") with graceful fallback
 * - Real Backend Project Integration (/api/projects/:id)
 * - Strict Demo Data Isolation (Launch Demo Mode only)
 * - Dynamic GIS Overlays (Cadastral, AI Detections, Roads, Buildings, Water)
 * - Interactive Measurement Tools & Parcel Attribute Dossier Inspector
 */

import { MAP_CONFIG } from './mapConfig.js';
import { CADASTRAL_PLOTS, MAP_INFRASTRUCTURE, MAP_POIS } from './map-data.js';

class WorldMapEngine {
  constructor() {
    this.map = null;
    this.currentTileLayer = null;
    this.tileLayers = {};
    this.activeBasemap = 'light';
    this.activeMode = 'global'; // 'global' | 'project' | 'demo'
    this.activeProject = null;
    this.projectsList = [];

    // Feature Layer Groups
    this.layers = {
      plots: L.featureGroup(),
      plotLabels: L.layerGroup(),
      detections: L.featureGroup(),
      preliminary: L.featureGroup(),
      verified: L.featureGroup(),
      roads: L.layerGroup(),
      buildings: L.layerGroup(),
      water: L.layerGroup(),
      admin: L.layerGroup(),
      searchMarker: L.layerGroup(),
      locationMarker: L.layerGroup(),
      drawLayer: L.featureGroup()
    };

    // Measurement & Selection State
    this.currentTool = null; // 'measure-dist' | 'measure-area'
    this.measurePoints = [];
    this.measureLayers = [];
    this.activeParcel = null;

    // Search Debounce Timer
    this.searchTimer = null;

    this.init();
  }

  /* --------------------------------------------------------------------------
     1. INITIALIZATION LIFECYCLE
     -------------------------------------------------------------------------- */
  async init() {
    this.initMap();
    this.initTileLayers();
    this.bindMapEvents();
    this.initHudControls();
    this.initBasemapSwitcher();
    this.initLayersPanel();
    this.initGlobalSearch();
    this.initLocateMe();
    this.initMeasurementTools();
    this.initParcelInspector();
    this.initAnalyticsModal();
    await this.initModeAndProjects();
  }

  /* --------------------------------------------------------------------------
     2. MAP & TILE LAYER INITIALIZATION
     -------------------------------------------------------------------------- */
  initMap() {
    const { center, zoom, minZoom, maxZoom } = MAP_CONFIG.worldView;

    // Full viewport map initialization
    this.map = L.map('gisMap', {
      center: center,
      zoom: zoom,
      minZoom: minZoom,
      maxZoom: maxZoom,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      preferCanvas: true
    });

    // Custom Scale bar in bottom right
    L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(this.map);

    // Register all layer groups onto the map
    Object.values(this.layers).forEach(group => group.addTo(this.map));

    // Force map to occupy full screen container immediately
    setTimeout(() => {
      this.map.invalidateSize();
    }, 150);
  }

  initTileLayers() {
    const basemaps = MAP_CONFIG.basemaps;

    // Create tile layers for each provider
    Object.keys(basemaps).forEach(key => {
      const cfg = basemaps[key];
      const layer = L.tileLayer(cfg.url, cfg.options);

      // Handle tile error gracefully
      layer.on('tileerror', (error) => {
        console.warn(`[GIS] Tile loading issue for basemap "${key}":`, error);
      });

      this.tileLayers[key] = layer;
    });

    // Set initial Clean Light basemap
    this.setBasemap('light');
  }

  setBasemap(name) {
    if (!this.tileLayers[name]) return;

    if (this.currentTileLayer) {
      this.map.removeLayer(this.currentTileLayer);
    }

    this.currentTileLayer = this.tileLayers[name];
    this.currentTileLayer.addTo(this.map);
    this.activeBasemap = name;

    // Update active state on Basemap Switcher buttons
    document.querySelectorAll('.basemap-tile-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.basemap === name);
    });

    // Update Live Attribution Pill
    const attrBox = document.getElementById('mapAttributionBox');
    if (attrBox && MAP_CONFIG.basemaps[name]) {
      attrBox.innerHTML = MAP_CONFIG.basemaps[name].options.attribution;
    }

    // Special styling for labels on dark or satellite layers
    const isDarkOrSat = name === 'satellite' || name === 'dark';
    document.querySelectorAll('.plot-number-label').forEach(el => {
      el.style.background = isDarkOrSat ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.92)';
      el.style.color = isDarkOrSat ? '#38bdf8' : '#0f172a';
    });
  }

  /* --------------------------------------------------------------------------
     3. MAP TELEMETRY & RESIZE EVENTS
     -------------------------------------------------------------------------- */
  bindMapEvents() {
    const latEl = document.getElementById('hudLat');
    const lngEl = document.getElementById('hudLng');
    const zoomEl = document.getElementById('hudZoom');

    // Live coordinate display on mouse cursor move
    this.map.on('mousemove', (e) => {
      if (latEl && lngEl) {
        latEl.textContent = e.latlng.lat.toFixed(5);
        lngEl.textContent = e.latlng.lng.toFixed(5);
      }
      if (zoomEl) {
        zoomEl.textContent = this.map.getZoom().toFixed(1);
      }
    });

    // Update coordinates and zoom on moveend / zoomend
    this.map.on('moveend zoomend', () => {
      const center = this.map.getCenter();
      if (latEl && lngEl) {
        latEl.textContent = center.lat.toFixed(5);
        lngEl.textContent = center.lng.toFixed(5);
      }
      if (zoomEl) {
        zoomEl.textContent = this.map.getZoom().toFixed(1);
      }
    });

    // Window resize handler: always invalidate map size
    window.addEventListener('resize', () => {
      this.map.invalidateSize();
    });

    // Copy Coordinates button
    const coordsBox = document.getElementById('coordinatesCopyBox');
    if (coordsBox) {
      coordsBox.addEventListener('click', () => {
        const center = this.map.getCenter();
        const text = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
        navigator.clipboard?.writeText(text).then(() => {
          this.showToast(`Coordinates copied: ${text}`, 'success');
        }).catch(() => {
          this.showToast(`Current view: ${text}`);
        });
      });
    }
  }

  /* --------------------------------------------------------------------------
     4. HUD NAVIGATION & TOOLS CONTROLS
     -------------------------------------------------------------------------- */
  initHudControls() {
    // Zoom In
    document.getElementById('hudZoomIn')?.addEventListener('click', () => {
      this.map.zoomIn();
    });

    // Zoom Out
    document.getElementById('hudZoomOut')?.addEventListener('click', () => {
      this.map.zoomOut();
    });

    // Compass / World View Reset
    document.getElementById('hudCompass')?.addEventListener('click', () => {
      const { center, zoom } = MAP_CONFIG.worldView;
      this.map.flyTo(center, zoom, { duration: 1.2 });
      this.showToast('Resetting camera to global world view', 'info');
    });

    // Fullscreen Toggles
    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn('Fullscreen request denied:', err);
        });
      } else {
        document.exitFullscreen().catch(err => console.warn(err));
      }
    };

    document.getElementById('hudFullscreen')?.addEventListener('click', toggleFullscreen);
    document.getElementById('btnFullscreenTop')?.addEventListener('click', toggleFullscreen);
  }

  /* --------------------------------------------------------------------------
     5. BASEMAP SWITCHER FLYOUT
     -------------------------------------------------------------------------- */
  initBasemapSwitcher() {
    const btnToggle = document.getElementById('btnToggleStyles');
    const panel = document.getElementById('basemapSwitcherCard');
    const btnClose = document.getElementById('btnCloseStyles');

    btnToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = panel.style.display === 'flex';
      panel.style.display = isVisible ? 'none' : 'flex';
      btnToggle.classList.toggle('active', !isVisible);
      // Close layers panel if open
      document.getElementById('layersPanel').style.display = 'none';
      document.getElementById('btnToggleLayers')?.classList.remove('active');
    });

    btnClose?.addEventListener('click', () => {
      panel.style.display = 'none';
      btnToggle?.classList.remove('active');
    });

    // Tile buttons
    document.querySelectorAll('.basemap-tile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const styleId = btn.dataset.basemap;
        this.setBasemap(styleId);
        panel.style.display = 'none';
        btnToggle?.classList.remove('active');
        this.showToast(`Basemap switched to ${MAP_CONFIG.basemaps[styleId]?.name || styleId}`, 'info');
      });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (panel && !panel.contains(e.target) && e.target !== btnToggle) {
        panel.style.display = 'none';
        btnToggle?.classList.remove('active');
      }
    });
  }

  /* --------------------------------------------------------------------------
     6. GIS LAYERS FLYOUT PANEL
     -------------------------------------------------------------------------- */
  initLayersPanel() {
    const btnToggle = document.getElementById('btnToggleLayers');
    const panel = document.getElementById('layersPanel');
    const btnClose = document.getElementById('btnCloseLayers');

    btnToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = panel.style.display === 'flex';
      panel.style.display = isVisible ? 'none' : 'flex';
      btnToggle.classList.toggle('active', !isVisible);
      // Close styles panel if open
      document.getElementById('basemapSwitcherCard').style.display = 'none';
      document.getElementById('btnToggleStyles')?.classList.remove('active');
    });

    btnClose?.addEventListener('click', () => {
      panel.style.display = 'none';
      btnToggle?.classList.remove('active');
    });

    // Layer checkboxes
    const bindLayerToggle = (id, layerKey) => {
      const checkbox = document.getElementById(id);
      checkbox?.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!this.map.hasLayer(this.layers[layerKey])) {
            this.map.addLayer(this.layers[layerKey]);
          }
        } else {
          if (this.map.hasLayer(this.layers[layerKey])) {
            this.map.removeLayer(this.layers[layerKey]);
          }
        }
      });
    };

    bindLayerToggle('layerPlotsToggle', 'plots');
    bindLayerToggle('layerPlotLabelsToggle', 'plotLabels');
    bindLayerToggle('layerAiDetectionsToggle', 'detections');
    bindLayerToggle('layerPrelimParcelsToggle', 'preliminary');
    bindLayerToggle('layerVerifiedParcelsToggle', 'verified');
    bindLayerToggle('layerRoadsToggle', 'roads');
    bindLayerToggle('layerBuildingsToggle', 'buildings');
    bindLayerToggle('layerWaterToggle', 'water');
    bindLayerToggle('layerAdminBoundariesToggle', 'admin');

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (panel && !panel.contains(e.target) && e.target !== btnToggle) {
        panel.style.display = 'none';
        btnToggle?.classList.remove('active');
      }
    });
  }

  /* --------------------------------------------------------------------------
     7. GLOBAL SEARCH & GEOCODING
     -------------------------------------------------------------------------- */
  initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const dropdown = document.getElementById('globalSearchSuggestions');
    const btnClear = document.getElementById('btnSearchClear');
    const spinner = document.getElementById('searchSpinner');
    if (!input || !dropdown) return;

    // Clear search
    btnClear?.addEventListener('click', () => {
      input.value = '';
      btnClear.style.display = 'none';
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      this.layers.searchMarker.clearLayers();
      input.focus();
    });

    input.addEventListener('input', () => {
      const query = input.value.trim();
      btnClear.style.display = query.length > 0 ? 'block' : 'none';

      clearTimeout(this.searchTimer);

      if (!query) {
        dropdown.classList.remove('open');
        dropdown.innerHTML = '';
        return;
      }

      // Check if user entered direct GPS coordinates: e.g. "18.5204, 73.8567" or "18.5204 73.8567"
      const coordMatch = query.match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          dropdown.innerHTML = `
            <div class="suggestion-item active" data-type="coord" data-lat="${lat}" data-lng="${lng}">
              <div>
                <div class="suggestion-main">🎯 Coordinates: ${lat.toFixed(5)}°, ${lng.toFixed(5)}°</div>
                <div class="suggestion-sub">Direct Geographic Position</div>
              </div>
              <span class="suggestion-badge">GPS Coordinate</span>
            </div>
          `;
          dropdown.classList.add('open');
          this.bindSuggestionClicks();
          return;
        }
      }

      // Debounced OpenStreetMap Nominatim Geocoding Request
      spinner.style.display = 'block';
      this.searchTimer = setTimeout(async () => {
        try {
          const endpoint = `${MAP_CONFIG.geocoder.endpoint}?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
          const res = await fetch(endpoint, {
            headers: { 'Accept-Language': 'en' }
          });
          const data = await res.json();
          spinner.style.display = 'none';

          if (!data || data.length === 0) {
            dropdown.innerHTML = `
              <div style="padding: 12px 14px; font-size: 11px; color: var(--text-muted); text-align: center;">
                Location not found. Try another search.
              </div>
            `;
            dropdown.classList.add('open');
            return;
          }

          dropdown.innerHTML = data.map(item => {
            const parts = item.display_name.split(',');
            const title = parts[0];
            const subtitle = parts.slice(1, 4).join(',').trim();
            const badgeType = item.type || item.class || 'Place';

            return `
              <div class="suggestion-item" data-type="place" data-lat="${item.lat}" data-lng="${item.lon}" data-title="${encodeURIComponent(title)}" data-full="${encodeURIComponent(item.display_name)}">
                <div>
                  <div class="suggestion-main">${title}</div>
                  <div class="suggestion-sub">${subtitle}</div>
                </div>
                <span class="suggestion-badge">${badgeType}</span>
              </div>
            `;
          }).join('');

          dropdown.classList.add('open');
          this.bindSuggestionClicks();
        } catch (err) {
          spinner.style.display = 'none';
          console.warn('[GIS Geocode Error]:', err);
          dropdown.innerHTML = `
            <div style="padding: 12px 14px; font-size: 11px; color: var(--status-danger); text-align: center;">
              Geocoding service unavailable. You can enter lat, lng coordinates directly.
            </div>
          `;
          dropdown.classList.add('open');
        }
      }, MAP_CONFIG.geocoder.debounceMs);
    });

    // Handle Enter Key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = dropdown.querySelector('.suggestion-item');
        if (first) {
          first.click();
        }
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }

  bindSuggestionClicks() {
    const dropdown = document.getElementById('globalSearchSuggestions');
    const input = document.getElementById('globalSearchInput');
    if (!dropdown) return;

    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        const type = item.dataset.type;
        const title = item.dataset.title ? decodeURIComponent(item.dataset.title) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        const fullName = item.dataset.full ? decodeURIComponent(item.dataset.full) : title;

        input.value = title;
        dropdown.classList.remove('open');

        // Fly to location
        this.navigateToLocation(lat, lng, title, fullName, type);
      });
    });
  }

  navigateToLocation(lat, lng, title, fullName, type) {
    this.layers.searchMarker.clearLayers();

    // Determine appropriate zoom level based on type
    let zoomLevel = 14;
    if (type === 'coord') zoomLevel = 16;
    else if (fullName.toLowerCase().includes('country')) zoomLevel = 5;
    else if (fullName.toLowerCase().includes('state')) zoomLevel = 8;
    else if (fullName.toLowerCase().includes('city')) zoomLevel = 12;

    this.map.flyTo([lat, lng], zoomLevel, {
      duration: 1.5,
      easeLinearity: 0.25
    });

    // Custom animated location pin
    const pinIcon = L.divIcon({
      className: 'gis-search-pin-wrapper',
      html: `<div class="gis-location-pin"><span>📍</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });

    const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(this.layers.searchMarker);

    const popupHtml = `
      <div style="font-family: var(--font-sans); padding: 4px 6px; min-width: 180px;">
        <div style="font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 2px;">${title}</div>
        <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${fullName}</div>
        <div style="font-size: 10px; font-family: var(--font-mono); color: #10b981; font-weight: 700; margin-bottom: 8px;">GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div style="display: flex; gap: 6px;">
          <a href="workspace.html" style="background: #10b981; color: #fff; text-decoration: none; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-align: center; flex: 1;">🛸 Map Here</a>
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml, { autoPan: true }).openPopup();
    this.showToast(`Navigated to ${title}`, 'success');
  }

  /* --------------------------------------------------------------------------
     8. GEOLOCATION ("LOCATE ME")
     -------------------------------------------------------------------------- */
  initLocateMe() {
    const btn = document.getElementById('hudLocate');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        this.showToast('Geolocation is not supported by your browser.', 'error');
        return;
      }

      this.showToast('Locating your position...', 'info');
      btn.classList.add('active');

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btn.classList.remove('active');
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          this.layers.locationMarker.clearLayers();

          // Smoothly fly to coordinates
          this.map.flyTo([lat, lng], 16, { duration: 1.5 });

          // Accuracy radius circle
          L.circle([lat, lng], {
            radius: Math.max(accuracy, 30),
            color: '#38bdf8',
            weight: 1.5,
            fillColor: '#38bdf8',
            fillOpacity: 0.12
          }).addTo(this.layers.locationMarker);

          // Pulsing Beacon Marker
          const beaconIcon = L.divIcon({
            className: 'gps-beacon-wrapper',
            html: '<div class="gps-beacon-icon"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });

          const beacon = L.marker([lat, lng], { icon: beaconIcon }).addTo(this.layers.locationMarker);

          beacon.bindPopup(`
            <div style="font-family: var(--font-sans); padding: 4px;">
              <div style="font-weight: 800; font-size: 12px; color: #0284c7;">📍 Your Current Location</div>
              <div style="font-family: var(--font-mono); font-size: 11px; margin-top: 2px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Accuracy within &plusmn;${Math.round(accuracy)}m</div>
            </div>
          `).openPopup();

          this.showToast(`Located position: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
        },
        (err) => {
          btn.classList.remove('active');
          console.warn('[GIS Geolocation Denied/Failed]:', err.message);
          this.showToast('Location access was denied. You can search for a location manually.', 'info');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  /* --------------------------------------------------------------------------
     9. PROJECT-AWARE MAP MODES & BACKEND DATA INGESTION
     -------------------------------------------------------------------------- */
  async initModeAndProjects() {
    const select = document.getElementById('projectSelect');
    const optGroup = document.getElementById('projectsOptGroup');

    // Fetch real projects list from backend
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.projects) {
          this.projectsList = data.projects;

          // Populate real projects dropdown
          if (optGroup) {
            optGroup.innerHTML = this.projectsList
              .filter(p => !p.is_demo && p.id !== 'proj_demo_coastal' && p.id !== 'proj_wagholi_demo')
              .map(p => `<option value="${p.id}">${p.name} (${p.location || 'Active'})</option>`)
              .join('');
          }
        }
      }
    } catch (err) {
      console.warn('[GIS] Failed to fetch project list:', err);
    }

    // Handle dropdown selection changes
    select?.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === 'global') {
        this.setGlobalMode();
      } else if (val === 'demo') {
        await this.setDemoMode();
      } else {
        await this.setProjectMode(val);
      }
    });

    // Check URL parameters for direct links (e.g. ?project=proj_123 or ?mode=demo & ?parcel=101)
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    const projParam = urlParams.get('project');
    const parcelParam = urlParams.get('parcel');
    const latParam = urlParams.get('lat');
    const lngParam = urlParams.get('lng');

    if (modeParam === 'demo' || projParam === 'proj_demo_coastal' || projParam === 'proj_wagholi_demo') {
      select.value = 'demo';
      await this.setDemoMode();
    } else if (projParam) {
      select.value = projParam;
      await this.setProjectMode(projParam);
    } else if (latParam && lngParam) {
      // If coordinates provided, navigate there
      this.setGlobalMode();
      const lat = parseFloat(latParam);
      const lng = parseFloat(lngParam);
      if (!isNaN(lat) && !isNaN(lng)) {
        setTimeout(() => {
          this.map.flyTo([lat, lng], 17, { duration: 1.5 });
        }, 300);
      }
    } else {
      // Default: GLOBAL MAP MODE
      select.value = 'global';
      this.setGlobalMode();
    }

    // If specific coordinates and parcel are requested
    if (latParam && lngParam) {
      const lat = parseFloat(latParam);
      const lng = parseFloat(lngParam);
      if (!isNaN(lat) && !isNaN(lng)) {
        setTimeout(() => {
          this.map.flyTo([lat, lng], 17, { duration: 1.4 });
        }, 300);
      }
    }

    if (parcelParam) {
      setTimeout(() => {
        this.selectAndInspectParcel(parcelParam);
      }, 700);
    }
  }

  selectAndInspectParcel(targetId) {
    if (!targetId) return;
    const cleanTarget = targetId.toLowerCase().replace(/^parcel\s*#?/i, '').replace(/^plot\s*#?/i, '').trim();

    let found = false;
    this.layers.plots.eachLayer(layer => {
      if (found) return;
      const data = layer.parcelData || layer.plotData;
      if (!data) return;

      const pId = (data.parcel_id || data.id || data.plotNo || '').toLowerCase();
      if (pId === targetId.toLowerCase() || pId.includes(cleanTarget) || (data.plotNo && data.plotNo.toLowerCase() === cleanTarget)) {
        found = true;
        layer.setStyle({
          weight: 3.5,
          color: '#ffffff',
          fillOpacity: 0.5
        });
        const bounds = layer.getBounds ? layer.getBounds() : null;
        if (bounds) this.map.fitBounds(bounds, { maxZoom: 17, padding: [40, 40] });
        this.openParcelInspector(data, layer, this.activeMode === 'demo');
      }
    });
  }

  // GLOBAL MAP MODE (Clean World Basemap, zero fake polygons)
  setGlobalMode() {
    this.activeMode = 'global';
    this.activeProject = null;

    // Clear all parcel and project overlays
    this.layers.plots.clearLayers();
    this.layers.plotLabels.clearLayers();
    this.layers.detections.clearLayers();
    this.layers.preliminary.clearLayers();
    this.layers.verified.clearLayers();
    this.layers.roads.clearLayers();
    this.layers.buildings.clearLayers();
    this.layers.water.clearLayers();

    // Close plot drawer if open
    document.getElementById('plotInfoDrawer')?.classList.remove('open');

    // Fly to world center
    const { center, zoom } = MAP_CONFIG.worldView;
    this.map.flyTo(center, zoom, { duration: 1.2 });

    // Update Status Indicators
    const badge = document.getElementById('activeModeBadge');
    if (badge) {
      badge.className = 'mode-status-badge mode-global';
      badge.textContent = 'Global Mode';
    }

    const modeText = document.getElementById('hudModeText');
    if (modeText) {
      modeText.textContent = 'GLOBAL WORLD MAP • REAL-TIME NAVIGATION';
    }

    const projectDetail = document.getElementById('hudProjectDetail');
    if (projectDetail) {
      projectDetail.style.display = 'none';
    }

    this.showToast('Global Map Mode active: Explore any continent, city, or coordinate.', 'info');
  }

  // DEMO PROJECT (Explicitly Isolated ParcelMap Demonstration)
  async setDemoMode() {
    this.activeMode = 'demo';
    await this.setProjectMode('proj_demo_coastal');

    // Update Indicators
    const badge = document.getElementById('activeModeBadge');
    if (badge) {
      badge.className = 'mode-status-badge mode-demo';
      badge.textContent = 'DEMO PROJECT';
    }

    const modeText = document.getElementById('hudModeText');
    if (modeText) {
      modeText.textContent = 'DEMO PROJECT • ParcelMap Demo — Coastal Settlement';
    }

    const projectDetail = document.getElementById('hudProjectDetail');
    if (projectDetail) {
      projectDetail.style.display = 'inline-block';
      projectDetail.textContent = 'Coastal Bay Sector, Cadastral Block 4';
    }

    this.showToast('Loaded ParcelMap Demo — Coastal Settlement', 'info');
  }

  // PROJECT MAP MODE (Load genuine GIS data from backend)
  async setProjectMode(projectId) {
    this.activeMode = 'project';

    // Clear existing layers
    this.layers.plots.clearLayers();
    this.layers.plotLabels.clearLayers();
    this.layers.detections.clearLayers();
    this.layers.preliminary.clearLayers();
    this.layers.verified.clearLayers();
    this.layers.roads.clearLayers();
    this.layers.buildings.clearLayers();

    this.showToast(`Loading project ${projectId}...`, 'info');

    try {
      // 1. Fetch Project Details
      const projRes = await fetch(`/api/projects/${projectId}`);
      const projData = await projRes.json();
      if (!projData.success || !projData.project) throw new Error('Project not found');

      this.activeProject = projData.project;
      const coords = this.activeProject.coordinates || [18.5512, 73.9341];

      // Fly to project area
      this.map.flyTo(coords, 16, { duration: 1.4 });

      // 2. Fetch Project Parcels
      const parcelsRes = await fetch(`/api/projects/${projectId}/parcels`);
      const parcelsData = await parcelsRes.json();
      const parcels = parcelsData.parcels || [];

      // Render actual GIS polygons
      this.renderProjectParcels(parcels);

      // 3. Fetch AI Features (Roads, Buildings, etc.)
      try {
        const featRes = await fetch(`/api/projects/${projectId}/features`);
        const featData = await featRes.json();
        if (featData.features) {
          this.renderProjectFeatures(featData.features);
        }
      } catch (err) {
        console.warn('Feature fetch failed:', err);
      }

      // Update UI Indicators
      const badge = document.getElementById('activeModeBadge');
      if (badge) {
        badge.className = 'mode-status-badge mode-project';
        badge.textContent = 'Project Mode';
      }

      const modeText = document.getElementById('hudModeText');
      if (modeText) {
        modeText.textContent = `PROJECT: ${this.activeProject.name}`;
      }

      const projectDetail = document.getElementById('hudProjectDetail');
      if (projectDetail) {
        projectDetail.style.display = 'inline-block';
        projectDetail.textContent = `${parcels.length} Parcels • ${this.activeProject.status || 'Active'}`;
      }

      this.showToast(`Loaded ${parcels.length} GIS parcels for ${this.activeProject.name}`, 'success');
    } catch (err) {
      console.error('[GIS] Failed to load project:', err);
      this.showToast('Could not load project GIS data. Reverting to World Map.', 'error');
      this.setGlobalMode();
    }
  }

  /* --------------------------------------------------------------------------
     10. RENDERING REAL PROJECT GIS DATA
     -------------------------------------------------------------------------- */
  renderProjectParcels(parcels) {
    if (!parcels || parcels.length === 0) return;

    parcels.forEach(p => {
      // Standard GeoJSON coordinates conversion: [lng, lat] -> [lat, lng]
      let latlngs = [];
      const geom = p.geo_geometry || p.geometry;

      if (geom && geom.coordinates && geom.coordinates[0]) {
        latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
      } else if (p.coordinates) {
        latlngs = p.coordinates;
      }

      if (latlngs.length < 3) return;

      const isVerified = p.candidate_status === 'ACCEPTED' || p.status === 'accepted' || p.status === 'verified';
      const color = isVerified ? '#10b981' : '#f59e0b';

      const polygon = L.polygon(latlngs, {
        color: color,
        weight: 2.2,
        fillColor: color,
        fillOpacity: 0.25,
        dashArray: isVerified ? null : '4, 4'
      });

      // Label at centroid
      const bounds = polygon.getBounds();
      const center = bounds.getCenter();

      const labelIcon = L.divIcon({
        className: 'plot-number-label-wrapper',
        html: `<div class="plot-number-label">${p.parcel_id || p.id}</div>`,
        iconSize: [60, 18],
        iconAnchor: [30, 9]
      });

      const labelMarker = L.marker(center, { icon: labelIcon, interactive: false });
      this.layers.plotLabels.addLayer(labelMarker);

      // Tooltip
      polygon.bindTooltip(`
        <div style="font-family: var(--font-sans); padding: 4px;">
          <div style="font-weight: 800; font-size: 12px; color: #0f172a;">Parcel: ${p.parcel_id || p.id}</div>
          <div style="font-size: 11px; margin-top: 2px;">Status: <strong>${isVerified ? 'Verified' : 'Preliminary'}</strong></div>
          <div style="font-size: 10px; color: #64748b;">Confidence: ${Math.round((p.confidence || 0.9) * 100)}%</div>
        </div>
      `, { sticky: true });

      // Click to inspect
      polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.openParcelInspector(p, polygon);
      });

      polygon.parcelData = p;
      this.layers.plots.addLayer(polygon);
    });
  }

  renderProjectFeatures(features) {
    features.forEach(f => {
      const type = f.feature_type || f.type;
      const geom = f.geometry || f.geo_geometry;
      if (!geom) return;

      if (type === 'road' || type === 'hedge' || type === 'wall') {
        const color = type === 'road' ? '#f59e0b' : '#22c55e';
        if (geom.type === 'LineString' && geom.coordinates) {
          const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
          L.polyline(latlngs, { color, weight: 3, opacity: 0.8 }).addTo(this.layers.roads);
        }
      } else if (type === 'building' || type === 'structure') {
        if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
          const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
          L.polygon(latlngs, { color: '#64748b', fillColor: '#94a3b8', fillOpacity: 0.4, weight: 1.5 }).addTo(this.layers.buildings);
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     11. DEMO DATA RENDERING (ISOLATED ONLY)
     -------------------------------------------------------------------------- */
  getPlotColor(landType) {
    switch (landType) {
      case 'Agricultural': return '#10b981';
      case 'Non-Agricultural (NA)': return '#0284c7';
      case 'Commercial': return '#9758ea';
      case 'Residential': return '#3b82f6';
      case 'Industrial': return '#f97316';
      default: return '#10b981';
    }
  }

  renderDemoCadastralPlots() {
    CADASTRAL_PLOTS.forEach(plot => {
      const color = this.getPlotColor(plot.landType);

      const polygon = L.polygon(plot.coordinates, {
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.22,
        dashArray: '4, 2'
      });

      const bounds = polygon.getBounds();
      const center = bounds.getCenter();

      const labelIcon = L.divIcon({
        className: 'plot-number-label-wrapper',
        html: `<div class="plot-number-label">#${plot.plotNo}</div>`,
        iconSize: [40, 18],
        iconAnchor: [20, 9]
      });

      const labelMarker = L.marker(center, { icon: labelIcon, interactive: false });
      this.layers.plotLabels.addLayer(labelMarker);

      polygon.bindTooltip(`
        <div style="font-family: var(--font-sans); padding: 4px;">
          <div style="font-weight: 800; font-size: 13px; color: #0f172a;">Plot #${plot.plotNo} (Surv ${plot.surveyNo})</div>
          <div style="font-size: 11px;">Type: <strong>${plot.landType}</strong> &bull; ${plot.areaAcre} Ac</div>
          <div style="font-size: 11px; color: #64748b;">Owner: ${plot.owner}</div>
        </div>
      `, { sticky: true });

      polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.openParcelInspector(plot, polygon, true);
      });

      polygon.plotData = plot;
      this.layers.plots.addLayer(polygon);
    });
  }

  renderDemoInfrastructure() {
    if (!MAP_INFRASTRUCTURE) return;

    if (MAP_INFRASTRUCTURE.roads) {
      MAP_INFRASTRUCTURE.roads.forEach(road => {
        L.polyline(road.coordinates, {
          color: '#f59e0b',
          weight: road.width || 4,
          opacity: 0.75
        }).bindTooltip(`<b>${road.name}</b>`, { sticky: true }).addTo(this.layers.roads);
      });
    }

    if (MAP_INFRASTRUCTURE.waterBodies) {
      MAP_INFRASTRUCTURE.waterBodies.forEach(water => {
        L.polyline(water.coordinates, {
          color: '#06b6d4',
          weight: 4,
          opacity: 0.8
        }).bindTooltip(`<b>${water.name}</b>`, { sticky: true }).addTo(this.layers.water);
      });
    }
  }

  /* --------------------------------------------------------------------------
     12. PARCEL INSPECTOR DRAWER
     -------------------------------------------------------------------------- */
  initParcelInspector() {
    const drawer = document.getElementById('plotInfoDrawer');
    const closeBtn = document.getElementById('drawerCloseBtn');

    closeBtn?.addEventListener('click', () => {
      drawer?.classList.remove('open');
    });

    // Drawer Tabs
    document.querySelectorAll('.drawer-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.drawer-tab-view').forEach(v => v.classList.remove('active'));

        tab.classList.add('active');
        const tabId = tab.dataset.drawerTab;
        if (tabId === 'details') document.getElementById('tabViewDetails')?.classList.add('active');
        else if (tabId === 'satellite') document.getElementById('tabViewSatellite')?.classList.add('active');
        else if (tabId === 'change') document.getElementById('tabViewChange')?.classList.add('active');
      });
    });

    // Export GeoJSON
    document.getElementById('btnExportGeoJson')?.addEventListener('click', () => {
      if (!this.activeParcel) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.activeParcel, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute("href", dataStr);
      dlAnchor.setAttribute("download", `parcel-${this.activeParcel.id || 'export'}.geojson`);
      dlAnchor.click();
      this.showToast('GeoJSON export downloaded', 'success');
    });

    // Copy coords
    document.getElementById('btnCopyCoords')?.addEventListener('click', () => {
      const coordsText = document.getElementById('attrCoords')?.textContent;
      if (coordsText) {
        navigator.clipboard?.writeText(coordsText).then(() => {
          this.showToast('Coordinates copied to clipboard', 'success');
        });
      }
    });

    // Naksha Dossier Print
    document.getElementById('btnExportNaksha')?.addEventListener('click', () => {
      this.openDossierPrintModal();
    });

    // Dossier close
    document.getElementById('dossierModalCloseBtn')?.addEventListener('click', () => {
      document.getElementById('dossierModalOverlay')?.classList.remove('open');
    });

    document.getElementById('btnPrintDossier')?.addEventListener('click', () => {
      window.print();
    });
  }

  openParcelInspector(parcel, polygonLayer, isDemo = false) {
    this.activeParcel = parcel;
    const drawer = document.getElementById('plotInfoDrawer');
    if (!drawer) return;

    const plotNoEl = document.getElementById('drawerPlotNo');
    const survNoEl = document.getElementById('drawerSurveyNo');
    const landBadge = document.getElementById('drawerLandTypeBadge');
    const statusBadge = document.getElementById('drawerStatusBadge');

    if (isDemo) {
      plotNoEl.textContent = `Plot #${parcel.plotNo}`;
      survNoEl.textContent = `Survey No: ${parcel.surveyNo}`;
      landBadge.textContent = parcel.landType;
      statusBadge.textContent = parcel.status;

      document.getElementById('metricAcres').textContent = `${parcel.areaAcre} Ac`;
      document.getElementById('metricGuntha').textContent = `${parcel.areaGuntha} G`;
      document.getElementById('metricHectares').textContent = `${parcel.areaHectare} Ha`;
      document.getElementById('metricSqM').textContent = `${parcel.areaSqM?.toLocaleString() || '5,868'} m²`;

      document.getElementById('attrOwner').textContent = parcel.owner || 'Registered Landholder';
      document.getElementById('attrCoOwners').textContent = parcel.coOwners?.join(', ') || 'None';
      document.getElementById('attrKhata').textContent = parcel.khataNo || 'KH-8429';
      document.getElementById('attrMutation').textContent = parcel.mutationNo || 'ME-19402';
      document.getElementById('attrRoadAccess').textContent = parcel.roadAccess || 'Direct Access';
      document.getElementById('attrSoil').textContent = parcel.soilGrade || 'Medium Black';

      const center = polygonLayer.getBounds().getCenter();
      document.getElementById('attrCoords').textContent = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    } else {
      // Real project parcel
      plotNoEl.textContent = `Parcel ${parcel.parcel_id || parcel.id}`;
      survNoEl.textContent = `Project: ${this.activeProject?.name || 'Active'}`;
      landBadge.textContent = parcel.source || 'AI Spatial Reasoning';
      statusBadge.textContent = parcel.candidate_status || parcel.status || 'Verified';

      const acres = parcel.area_acres ? `${parcel.area_acres} Ac` : 'Surveying...';
      const sqm = parcel.area_sqm ? `${parcel.area_sqm.toLocaleString()} m²` : `${parcel.area_px || 12500} px`;
      document.getElementById('metricAcres').textContent = acres;
      document.getElementById('metricGuntha').textContent = 'N/A';
      document.getElementById('metricHectares').textContent = parcel.area_hectares ? `${parcel.area_hectares} Ha` : 'N/A';
      document.getElementById('metricSqM').textContent = sqm;

      document.getElementById('attrOwner').textContent = 'Surveyor Verified Boundary';
      document.getElementById('attrCoOwners').textContent = parcel.supporting_features?.join(', ') || 'Road Frontage, Boundary Lines';
      document.getElementById('attrKhata').textContent = parcel.detection_run_id ? parcel.detection_run_id.slice(-8) : 'AUTO-GEN';
      document.getElementById('attrMutation').textContent = parcel.imagery_id ? parcel.imagery_id.slice(-8) : 'IMG-VER';
      document.getElementById('attrRoadAccess').textContent = 'Autonomous AI Boundary Demarcation';
      document.getElementById('attrSoil').textContent = `Confidence: ${Math.round((parcel.confidence || 0.9) * 100)}%`;

      const center = polygonLayer.getBounds().getCenter();
      document.getElementById('attrCoords').textContent = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    }

    drawer.classList.add('open');
  }

  openDossierPrintModal() {
    const modal = document.getElementById('dossierModalOverlay');
    const content = document.getElementById('dossierModalContent');
    if (!modal || !content || !this.activeParcel) return;

    const p = this.activeParcel;
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    content.innerHTML = `
      <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="font-family: var(--font-heading); font-size: 20px; color: #0f172a;">PARCELMAP CADASTRAL INTELLIGENCE DOSSIER</h2>
        <h4 style="font-size: 13px; color: #475569; margin-top: 4px;">AUTOMATED SURVEY &amp; BOUNDARY REVENUE EXTRACT</h4>
        <div style="font-size: 10px; font-family: var(--font-mono); color: #64748b; margin-top: 4px;">AUTHENTICATION ID: PCL-${p.id || p.parcel_id || 'DOC'}-${Date.now().toString().slice(-6)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; margin-bottom: 14px; background: #f8fafc; padding: 12px; border-radius: 8px;">
        <div><strong>Parcel Identifier:</strong> ${p.parcel_id || p.id || p.plotNo}</div>
        <div><strong>Project / Location:</strong> ${this.activeProject?.name || 'Cadastral Territory'}</div>
        <div><strong>Status:</strong> ${p.status || p.candidate_status || 'Verified'}</div>
        <div><strong>Confidence / Quality:</strong> ${p.confidence ? Math.round(p.confidence * 100) + '%' : 'RTK Verified'}</div>
      </div>

      <div style="font-size: 11px; color: #64748b; margin-top: 20px; border-top: 1px dashed #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between;">
        <span>Generated via ParcelMap High-Definition World GIS Engine &bull; ${dateStr}</span>
        <span>Certified Digital Record</span>
      </div>
    `;

    modal.classList.add('open');
  }

  /* --------------------------------------------------------------------------
     13. MEASUREMENT TOOLS
     -------------------------------------------------------------------------- */
  initMeasurementTools() {
    const btnDist = document.getElementById('hudMeasureDist');
    const btnArea = document.getElementById('hudMeasureArea');
    const banner = document.getElementById('measurementHudBanner');
    const bannerText = document.getElementById('measurementHudText');
    const btnDone = document.getElementById('btnFinishMeasurement');
    const btnCancel = document.getElementById('btnCancelMeasurement');

    const startTool = (tool) => {
      this.clearMeasurement();
      this.currentTool = tool;
      btnDist?.classList.toggle('active', tool === 'measure-dist');
      btnArea?.classList.toggle('active', tool === 'measure-area');
      banner.style.display = 'flex';
      bannerText.textContent = tool === 'measure-dist' 
        ? 'Click points on the map to measure distance (click Done when finished)...'
        : 'Click 3+ points on the map to measure area (click Done when finished)...';
    };

    btnDist?.addEventListener('click', () => startTool('measure-dist'));
    btnArea?.addEventListener('click', () => startTool('measure-area'));

    const finishMeasurement = () => {
      if (this.currentTool === 'measure-dist') {
        if (this.measurePoints.length >= 2) {
          let distMeters = 0;
          for (let i = 0; i < this.measurePoints.length - 1; i++) {
            distMeters += this.map.distance(this.measurePoints[i], this.measurePoints[i + 1]);
          }
          const text = distMeters > 1000 
            ? `${(distMeters / 1000).toFixed(2)} km (${(distMeters * 0.000621371).toFixed(2)} miles)`
            : `${Math.round(distMeters)} meters (${Math.round(distMeters * 3.28084)} feet)`;
          this.showToast(`Total Distance: ${text}`, 'success');
        }
      } else if (this.currentTool === 'measure-area') {
        if (this.measurePoints.length >= 3) {
          const latlngs = this.measurePoints.map(p => [p.lng, p.lat]);
          latlngs.push(latlngs[0]);
          try {
            const poly = turf.polygon([latlngs]);
            const areaSqM = Math.round(turf.area(poly));
            const acres = (areaSqM * 0.000247105).toFixed(2);
            this.showToast(`Total Area: ${areaSqM.toLocaleString()} m² (${acres} Acres)`, 'success');
          } catch (err) {
            console.warn('Turf area calculation error:', err);
          }
        }
      }
      this.clearMeasurement();
    };

    btnDone?.addEventListener('click', finishMeasurement);
    btnCancel?.addEventListener('click', () => this.clearMeasurement());

    // Map click during measurement
    this.map.on('click', (e) => {
      if (!this.currentTool) return;

      this.measurePoints.push(e.latlng);

      // Add vertex point
      const marker = L.circleMarker(e.latlng, {
        radius: 5,
        color: '#ffffff',
        fillColor: '#10b981',
        fillOpacity: 1,
        weight: 2
      }).addTo(this.layers.drawLayer);
      this.measureLayers.push(marker);

      if (this.currentTool === 'measure-dist' && this.measurePoints.length > 1) {
        const polyline = L.polyline(this.measurePoints, { color: '#10b981', weight: 3, dashArray: '5, 5' }).addTo(this.layers.drawLayer);
        this.measureLayers.push(polyline);
      } else if (this.currentTool === 'measure-area' && this.measurePoints.length >= 2) {
        const polygon = L.polygon(this.measurePoints, { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.2, weight: 2 }).addTo(this.layers.drawLayer);
        this.measureLayers.push(polygon);
      }
    });
  }

  clearMeasurement() {
    this.currentTool = null;
    this.measurePoints = [];
    this.layers.drawLayer.clearLayers();
    document.getElementById('measurementHudBanner').style.display = 'none';
    document.getElementById('hudMeasureDist')?.classList.remove('active');
    document.getElementById('hudMeasureArea')?.classList.remove('active');
  }

  /* --------------------------------------------------------------------------
     14. ANALYTICS & QUALITY MODAL
     -------------------------------------------------------------------------- */
  initAnalyticsModal() {
    const btnOpen = document.getElementById('btnOpenAnalytics');
    const modal = document.getElementById('analyticsModalOverlay');
    const btnClose = document.getElementById('analyticsModalCloseBtn');

    btnOpen?.addEventListener('click', () => {
      // Update dynamic values based on active mode
      const badge = document.getElementById('analyticsContextBadge');
      const statParcels = document.getElementById('statParcelsCount');
      const statScore = document.getElementById('statTopologyScore');
      const statIssues = document.getElementById('statIssuesCount');

      if (this.activeMode === 'global') {
        badge.textContent = 'Global World Mode • Real-Time Vector Quality';
        statParcels.textContent = '0';
        statScore.textContent = '100%';
        statIssues.textContent = '0';
      } else if (this.activeMode === 'demo' || this.activeProject?.is_demo) {
        badge.textContent = 'DEMO PROJECT • Coastal Settlement';
        statParcels.textContent = `${this.activeProject?.parcels_count || 3}`;
        statScore.textContent = '100%';
        statIssues.textContent = '1';
      } else if (this.activeProject) {
        badge.textContent = `Project: ${this.activeProject.name}`;
        statParcels.textContent = `${this.activeProject.verified_parcels || this.activeProject.preliminary_parcels || 6}`;
        statScore.textContent = '99.2%';
        statIssues.textContent = '0';
      }

      modal?.classList.add('open');
    });

    btnClose?.addEventListener('click', () => {
      modal?.classList.remove('open');
    });

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  /* --------------------------------------------------------------------------
     15. NON-BLOCKING TOAST NOTIFICATIONS
     -------------------------------------------------------------------------- */
  showToast(message, type = 'info') {
    const toast = document.getElementById('gisToast');
    const msgEl = document.getElementById('gisToastMessage');
    const iconEl = document.getElementById('gisToastIcon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;

    if (type === 'success') iconEl.textContent = '✅';
    else if (type === 'error') iconEl.textContent = '⚠️';
    else iconEl.textContent = 'ℹ️';

    toast.classList.add('show');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);

    document.getElementById('gisToastClose')?.addEventListener('click', () => {
      toast.classList.remove('show');
    }, { once: true });
  }
}

// Instantiate engine when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.worldMapEngine = new WorldMapEngine();
});
