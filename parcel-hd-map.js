/**
 * ParcelMap / GeoParcel.ai — Step 4 High-Definition 2D Parcel Map Engine
 * 
 * Manages the transition from the 3D Satellite Globe (discovery stage) to the
 * Interactive High-Definition 2D Map (analysis stage).
 * 
 * Key Features:
 * - Real Leaflet 2D GIS map with High-Definition Esri World Imagery tiles
 * - Seamless fallback to CARTO Dark / OpenStreetMap if satellite tiles encounter errors
 * - Prevents zero-size / NaN zoom initialization errors by guaranteeing container visibility and invalidateSize
 * - State E Tile Readiness: Subtle "Loading map…" overlay while tiles fetch, zero empty/dark map exposure
 * - Exact Cadastral Parcel boundary rendering (Primary emerald highlight + animated pulse)
 * - Secondary surrounding cadastral parcel boundaries (Muted styling, interactive hover & click-to-switch)
 * - Dynamic fitBounds with boundary-aware padding
 * - Anchored parcel information card & label with "View Parcel Details →"
 * - Clean disposal of 3D globe screen markers upon 2D map handoff
 * - "Back to Global View" smooth return without page reload
 * - Consecutive in-place searches without jarring resets
 * - Full mobile viewport responsiveness & diagnostics
 */

import { CADASTRAL_PLOTS } from './map-data.js';

export class ParcelHdMapManager {
  constructor() {
    this.container = document.getElementById('parcel2dMapContainer');
    this.mapEl = document.getElementById('parcelHdLeafletMap');
    this.map = null;
    this.currentParcel = null;
    this.isMapVisible = false;
    this.activeBasemap = 'satellite';
    this.tileLayers = {};
    this.currentTileLayer = null;
    this.tileErrorCount = 0;

    // Feature Layer Groups
    this.selectedParcelLayer = null;
    this.surroundingParcelsLayer = null;
    this.markerPopupLayer = null;
    this.selectedPolygon = null;

    this.init();
  }

  /* --------------------------------------------------------------------------
     1. INITIALIZATION & LIFECYCLE
     -------------------------------------------------------------------------- */
  init() {
    if (!this.container || !this.mapEl) return;
    if (typeof L === 'undefined') {
      setTimeout(() => this.init(), 150);
      return;
    }

    // Bind HUD controls early so buttons work
    this.bindHudControls();
    window.parcelHdMapManager = this;
  }

  prepareParcelMap(parcel) {
    if (!this.container) this.container = document.getElementById('parcel2dMapContainer');
    if (!this.mapEl) this.mapEl = document.getElementById('parcelHdLeafletMap');
    if (!this.container || !this.mapEl) return;
    this.container.style.display = 'block';
    void this.container.offsetWidth;
    this.ensureLeafletMapInitialized();
    if (this.map) {
      this.map.invalidateSize(true);
    }
  }

  ensureLeafletMapInitialized() {
    if (this.map) return;
    if (typeof L === 'undefined') return;

    // Default center at Wagholi, Pune
    this.map = L.map('parcelHdLeafletMap', {
      center: [18.5838, 73.9857],
      zoom: 17,
      minZoom: 12,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false
    });

    // Custom compact zoom control in top-right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Scale bar in bottom-left
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(this.map);

    // 1. High-Definition Esri World Satellite Imagery (Default primary basemap)
    this.tileLayers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; High-Definition Satellite Imagery'
      }
    );

    // 2. High-Contrast Dark Street Basemap (Toggle & Fallback option)
    this.tileLayers.street = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; CARTO &copy; OpenStreetMap contributors'
      }
    );

    // 3. OpenStreetMap (Secondary Fallback option)
    this.tileLayers.osm = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }
    );

    // Add default satellite layer
    this.currentTileLayer = this.tileLayers.satellite;
    this.currentTileLayer.addTo(this.map);

    // Error diagnostics on tile layer (Requirement 12)
    this.setupTileErrorHandling();

    // Initialize layer groups
    this.surroundingParcelsLayer = L.featureGroup().addTo(this.map);
    this.selectedParcelLayer = L.featureGroup().addTo(this.map);
    this.markerPopupLayer = L.layerGroup().addTo(this.map);
  }

  setupTileErrorHandling() {
    this.tileErrorCount = 0;

    const handleTileError = () => {
      this.tileErrorCount++;
      if (this.tileErrorCount >= 4) {
        console.warn('Satellite tiles experiencing network errors. Switching to fallback basemap...');
        if (this.activeBasemap === 'satellite') {
          this.toggleBasemap('street');
        } else if (this.activeBasemap === 'street') {
          this.map.removeLayer(this.tileLayers.street);
          this.tileLayers.osm.addTo(this.map);
          this.currentTileLayer = this.tileLayers.osm;
        } else {
          // If all tile sources fail, display diagnostic error card
          const errCard = document.getElementById('mapTileErrorCard');
          if (errCard) errCard.style.display = 'flex';
        }
      }
    };

    this.tileLayers.satellite.on('tileerror', handleTileError);
    this.tileLayers.street.on('tileerror', handleTileError);
  }

  /* --------------------------------------------------------------------------
     2. HUD CONTROLS & INTERACTION BINDINGS
     -------------------------------------------------------------------------- */
  bindHudControls() {
    // "Back to Global View" button
    const btnBack = document.getElementById('btnBackToGlobe');
    if (btnBack) {
      btnBack.onclick = (e) => {
        e.preventDefault();
        this.returnToGlobalView();
      };
    }

    // Basemap toggle button (Satellite / Street)
    const btnToggle = document.getElementById('btnToggleBasemap');
    if (btnToggle) {
      btnToggle.onclick = (e) => {
        e.preventDefault();
        this.toggleBasemap();
      };
    }

    // Recenter button
    const btnCenter = document.getElementById('btnRecenterParcel');
    if (btnCenter) {
      btnCenter.onclick = (e) => {
        e.preventDefault();
        this.recenterSelectedParcel();
      };
    }

    // Retry map button
    const btnRetry = document.getElementById('btnRetryMap');
    if (btnRetry) {
      btnRetry.onclick = (e) => {
        e.preventDefault();
        const errCard = document.getElementById('mapTileErrorCard');
        if (errCard) errCard.style.display = 'none';
        this.tileErrorCount = 0;
        if (this.currentTileLayer) {
          this.currentTileLayer.redraw();
        }
      };
    }

    // Global delegation for popup "View Parcel Details" button
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btnLeafletExplore, .btn-leaflet-explore');
      if (btn) {
        e.preventDefault();
        const target = this.currentParcel || (window.parcelMapState && window.parcelMapState.activeParcel) || (window.parcelMapState && window.parcelMapState.selectedParcel);
        if (window.parcelMapState && typeof window.parcelMapState.openExplorer === 'function') {
          window.parcelMapState.openExplorer(target);
        }
      }
    });
  }

  toggleBasemap(targetMode) {
    if (!this.map) return;
    const iconEl = document.getElementById('basemapToggleIcon');
    const labelEl = document.getElementById('basemapToggleLabel');
    const pillTextEl = document.getElementById('mapHudModeText');

    const nextMode = targetMode || (this.activeBasemap === 'satellite' ? 'street' : 'satellite');

    if (nextMode === 'street') {
      if (this.currentTileLayer) this.map.removeLayer(this.currentTileLayer);
      this.tileLayers.street.addTo(this.map);
      this.currentTileLayer = this.tileLayers.street;
      this.activeBasemap = 'street';
      if (iconEl) iconEl.textContent = '🗺️';
      if (labelEl) labelEl.textContent = 'Street';
      if (pillTextEl) pillTextEl.textContent = 'HD PARCEL ANALYSIS • STREET MAP';
    } else {
      if (this.currentTileLayer) this.map.removeLayer(this.currentTileLayer);
      this.tileLayers.satellite.addTo(this.map);
      this.currentTileLayer = this.tileLayers.satellite;
      this.activeBasemap = 'satellite';
      if (iconEl) iconEl.textContent = '🛰️';
      if (labelEl) labelEl.textContent = 'Satellite';
      if (pillTextEl) pillTextEl.textContent = 'HD PARCEL ANALYSIS • SATELLITE';
    }
  }

  recenterSelectedParcel() {
    if (!this.map || !this.currentParcel) return;
    if (this.selectedPolygon) {
      this.map.fitBounds(this.selectedPolygon.getBounds(), {
        padding: [70, 70],
        maxZoom: 18,
        animate: true,
        duration: 1.0
      });
    } else {
      const lat = this.currentParcel.latitude || (this.currentParcel.coordinates ? this.currentParcel.coordinates[0] : 18.5838);
      const lng = this.currentParcel.longitude || (this.currentParcel.coordinates ? this.currentParcel.coordinates[1] : 73.9857);
      this.map.flyTo([lat, lng], 17, { duration: 1.0 });
    }
  }

  returnToGlobalView() {
    console.log('[GLOBAL_VIEW_ENTER] Returning to Global View from 2D Map');
    if (window.parcelMapState && typeof window.parcelMapState.switchToGlobalGlobe === 'function') {
      window.parcelMapState.switchToGlobalGlobe();
    } else if (window.parcelMapState && typeof window.parcelMapState.clear === 'function') {
      window.parcelMapState.clear();
    } else {
      this.hideMap();
      if (window.realSatelliteGlobeInstance && typeof window.realSatelliteGlobeInstance.resetView === 'function') {
        window.realSatelliteGlobeInstance.resetView();
      }
    }
  }

  /* --------------------------------------------------------------------------
     3. BULLETPROOF PARCEL PRESENTATION & TRANSITION ORCHESTRATION
     -------------------------------------------------------------------------- */
  showParcel(parcel) {
    if (!parcel || window.parcelMapState?.searchState === 'notFound') return;
    this.currentParcel = parcel;

    if (!this.container) this.container = document.getElementById('parcel2dMapContainer');
    if (!this.mapEl) this.mapEl = document.getElementById('parcelHdLeafletMap');
    if (!this.container || !this.mapEl) return;

    // 1. STATE D: Ensure 2D Map container is fully visible in DOM with defined layout dimensions
    this.container.style.display = 'block';
    this.container.style.opacity = '1';
    this.container.style.pointerEvents = 'auto';
    this.isMapVisible = true;
    void this.container.offsetWidth;

    // Step 3B Section 3: Do NOT keep globe on top of map.
    // Globe canvas and decorative elements are completely removed from viewport.
    const globeContainer = document.getElementById('globeCanvasContainer');
    if (globeContainer) globeContainer.style.display = 'none';
    const globeCanvas = document.querySelector('#globeCanvasContainer canvas');
    if (globeCanvas) {
      globeCanvas.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      globeCanvas.style.opacity = '0';
    }
    const typeSwitcher = document.getElementById('globeTypeSwitcher');
    if (typeSwitcher) typeSwitcher.style.display = 'none';
    const quickJumps = document.getElementById('globeQuickJumps');
    if (quickJumps) quickJumps.style.display = 'none';
    const anchored3dMarker = document.getElementById('globeAnchoredParcelMarker');
    if (anchored3dMarker) anchored3dMarker.style.display = 'none';
    const screen3dMarker = document.getElementById('globeScreenParcelMarker');
    if (screen3dMarker) screen3dMarker.style.display = 'none';
    const globeParcelCard = document.getElementById('globeParcelCard');
    if (globeParcelCard) {
      globeParcelCard.style.display = 'none';
      globeParcelCard.classList.remove('active');
    }
    const globeTooltip = document.getElementById('globeTooltip');
    if (globeTooltip) globeTooltip.style.display = 'none';

    // Show subtle loading indicator overlay (State E: Loading map...)
    const loader = document.getElementById('mapTileLoadingIndicator');
    if (loader) loader.style.display = 'flex';
    const errCard = document.getElementById('mapTileErrorCard');
    if (errCard) errCard.style.display = 'none';

    // 2. Initialize Leaflet if not yet initialized
    this.ensureLeafletMapInitialized();
    if (!this.map) return;

    // Inform Leaflet of container dimensions (Requirement 5 & 6)
    this.map.invalidateSize(true);

    const pNum = parcel.parcelNumber || (parcel.parcel_id ? String(parcel.parcel_id).replace(/^Plot\s*#/i, '').replace(/^Parcel\s*#/i, '') : parcel.id) || '101';
    const cleanNum = String(pNum).toUpperCase();

    // 3. Resolve exact geographic coordinates (Requirement 7 & 8)
    let lat = parcel.latitude != null ? Number(parcel.latitude) : (parcel.coordinates ? Number(parcel.coordinates[0]) : null);
    let lng = parcel.longitude != null ? Number(parcel.longitude) : (parcel.coordinates ? Number(parcel.coordinates[1]) : null);

    if (lat != null && lng != null) {
      if (lat > 60 && lng < 30) {
        const tmp = lat; lat = lng; lng = tmp;
      }
    }

    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
      console.warn('Parcel coordinates missing:', parcel);
      if (loader) loader.style.display = 'none';
      if (errCard) {
        const titleEl = document.getElementById('tileErrorTitle');
        const descEl = document.getElementById('tileErrorDesc');
        if (titleEl) titleEl.textContent = 'Location data unavailable for this parcel.';
        if (descEl) descEl.textContent = 'Geographic coordinates could not be resolved from the cadastre registry.';
        errCard.style.display = 'flex';
      }
      return;
    }

    // 4. Resolve real parcel polygon geometry (Requirement 7, 10 & 11)
    let boundary = parcel.boundary;
    if (!boundary && parcel.geometry) {
      if (parcel.geometry.type === 'Polygon' && Array.isArray(parcel.geometry.coordinates?.[0])) {
        boundary = parcel.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
      } else if (Array.isArray(parcel.geometry)) {
        boundary = parcel.geometry;
      }
    }
    if (!boundary || boundary.length < 3) {
      const plotMatch = CADASTRAL_PLOTS.find(p => String(p.plotNo).toUpperCase() === cleanNum);
      if (plotMatch && plotMatch.coordinates && plotMatch.coordinates.length >= 3) {
        boundary = plotMatch.coordinates;
      }
    }
    if (boundary && Array.isArray(boundary)) {
      boundary = boundary.map(pt => (pt[0] > 60 && pt[1] < 30) ? [pt[1], pt[0]] : pt);
    }

    // 5. Clear old layers (Requirement 15: prevent old parcel data, remove previous highlights)
    this.selectedParcelLayer.clearLayers();
    this.surroundingParcelsLayer.clearLayers();
    this.markerPopupLayer.clearLayers();

    // 6. Render surrounding parcels (Secondary / Muted) (Requirement 8)
    CADASTRAL_PLOTS.forEach(plot => {
      const plotNo = String(plot.plotNo).toUpperCase();
      if (plotNo !== cleanNum && plot.coordinates && plot.coordinates.length >= 3) {
        const normCoords = plot.coordinates.map(pt => (pt[0] > 60 && pt[1] < 30) ? [pt[1], pt[0]] : pt);
        const poly = L.polygon(normCoords, {
          color: '#94a3b8',
          weight: 1.2,
          opacity: 0.5,
          fillColor: '#38bdf8',
          fillOpacity: 0.06,
          className: 'surrounding-parcel-polygon'
        });

        poly.on('mouseover', () => {
          poly.setStyle({ color: '#38bdf8', opacity: 0.9, fillOpacity: 0.15 });
        });
        poly.on('mouseout', () => {
          poly.setStyle({ color: '#94a3b8', opacity: 0.5, fillOpacity: 0.06 });
        });

        poly.on('click', () => {
          if (window.parcelMapState && typeof window.parcelMapState.setSelectedParcel === 'function') {
            const formatted = {
              id: plot.id,
              parcelNumber: plot.plotNo,
              surveyNumber: plot.surveyNo,
              village: 'Wagholi',
              district: 'Pune',
              state: 'Maharashtra',
              latitude: normCoords[0][0],
              longitude: normCoords[0][1],
              area: `${plot.areaAcre} acres`,
              boundary: normCoords,
              isDemo: true,
              mode: 'demo'
            };
            window.parcelMapState.setSelectedParcel(formatted, { scroll: false });
          }
        });

        this.surroundingParcelsLayer.addLayer(poly);
      }
    });

    // 7. Render Primary Selected Parcel (Requirement 10 & 11)
    let parcelBounds = null;
    if (boundary && boundary.length >= 3) {
      this.selectedPolygon = L.polygon(boundary, {
        color: '#10b981',
        weight: 3.5,
        opacity: 1.0,
        fillColor: '#10b981',
        fillOpacity: 0.22,
        className: 'selected-parcel-polygon'
      });
      this.selectedParcelLayer.addLayer(this.selectedPolygon);
      parcelBounds = this.selectedPolygon.getBounds();
    } else {
      this.selectedPolygon = null;
      // Requirement 11 & 15: If dataset has no real polygon, show marker and clear message
      const pinMarker = L.circleMarker([lat, lng], {
        radius: 9,
        color: '#10b981',
        weight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.85
      });
      pinMarker.bindTooltip('Parcel boundary unavailable in this dataset. (Parcel boundary geometry unavailable in this dataset.)', { permanent: true, direction: 'top', className: 'geom-unavailable-tooltip' });
      this.selectedParcelLayer.addLayer(pinMarker);
    }

    // 8. Dynamic Camera Navigation & Resize (Requirement 6 & 8)
    requestAnimationFrame(() => {
      this.map.invalidateSize(true);
      if (parcelBounds && parcelBounds.isValid()) {
        this.map.fitBounds(parcelBounds, {
          padding: [80, 80],
          maxZoom: 18,
          duration: 1.8,
          animate: true
        });
      } else {
        this.map.flyTo([lat, lng], 17, {
          duration: 1.8,
          animate: true
        });
      }
    });

    // 9. Anchored Custom Parcel Popup Card (Section 8 & 9)
    const sNum = parcel.surveyNumber || parcel.survey_no || 'Not available';
    const cleanSurvey = String(sNum).replace(/^Survey\s*/i, '');
    const village = parcel.village || 'Not available';
    const district = parcel.district || 'Not available';
    const state = parcel.state || 'Not available';
    const area = parcel.area || (parcel.area_acres ? `${parcel.area_acres} acres` : (parcel.areaAcre ? `${parcel.areaAcre} acres` : 'Not available'));
    const isSearchMode = parcel.mode === 'search' || (window.parcelMapState && window.parcelMapState.mode === 'search');
    const isDemo = !isSearchMode && Boolean(parcel.isDemo || parcel.is_demo);
    const badgeLabel = isSearchMode ? 'PARCEL SEARCH RESULT' : (isDemo ? 'DEMO DATA' : 'VERIFIED');
    const badgeClass = isSearchMode ? 'badge-search-result' : (isDemo ? 'badge-demo' : 'badge-verified');

    const popupHtml = `
      <div class="leaflet-parcel-card">
        <div class="leaflet-card-header">
          <span class="leaflet-pin-icon">📍</span>
          <strong class="leaflet-parcel-title">PARCEL #${escapeHtml(pNum)}</strong>
          <span class="leaflet-badge ${badgeClass}">
            ${badgeLabel}
          </span>
        </div>
        <div class="leaflet-card-body">
          <div class="leaflet-field-row">
            <span class="field-lbl">Survey:</span>
            <span class="field-val-mono">${escapeHtml(cleanSurvey)}</span>
          </div>
          <div class="leaflet-field-row">
            <span class="field-lbl">Village:</span>
            <span class="field-val">${escapeHtml(village)}</span>
          </div>
          <div class="leaflet-field-row">
            <span class="field-lbl">District:</span>
            <span class="field-val">${escapeHtml(district)}</span>
          </div>
          <div class="leaflet-field-row">
            <span class="field-lbl">State:</span>
            <span class="field-val">${escapeHtml(state)}</span>
          </div>
          <div class="leaflet-field-row">
            <span class="field-lbl">Area:</span>
            <span class="field-val">${escapeHtml(area)}</span>
          </div>
        </div>
        <button type="button" class="btn-leaflet-explore" id="btnLeafletExplore">
          <span>View Parcel Details &rarr;</span>
        </button>
      </div>
    `;

    const popupAnchor = boundary && boundary.length >= 3 ? boundary[0] : [lat, lng];
    const customPopup = L.popup({
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
      className: 'leaflet-custom-parcel-popup',
      offset: [0, -10]
    })
      .setLatLng(popupAnchor)
      .setContent(popupHtml);

    this.markerPopupLayer.addLayer(customPopup);

    // Wire explore button inside popup
    setTimeout(() => {
      const btnExp = document.getElementById('btnLeafletExplore');
      if (btnExp) {
        btnExp.onclick = (e) => {
          e.preventDefault();
          const target = this.currentParcel || window.parcelMapState?.activeParcel || parcel;
          if (window.parcelMapState && typeof window.parcelMapState.openExplorer === 'function') {
            window.parcelMapState.openExplorer(target);
          }
        };
      }
    }, 40);

    // 10. Hide loading indicator and set state to parcelLocated (Requirement 14)
    if (this.currentTileLayer) {
      this.currentTileLayer.once('load', () => {
        if (loader) loader.style.display = 'none';
      });
    }
    setTimeout(() => {
      if (loader) loader.style.display = 'none';
    }, 380);

    if (window.parcelMapState && typeof window.parcelMapState.setSearchState === 'function') {
      if (window.parcelMapState.searchState !== 'notFound') {
        window.parcelMapState.setSearchState('parcelLocated', parcel);
      }
      window.parcelMapState.activeMapStage = 'PARCEL_MAP';
      window.parcelMapState.viewMode = 'map';
    }

    // Update URL parameter without reload (Route State - Requirement 17)
    try {
      const url = new URL(window.location);
      url.searchParams.set('parcel', pNum);
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }

  hideMap() {
    if (!this.container) this.container = document.getElementById('parcel2dMapContainer');
    if (this.container) {
      this.container.style.display = 'none';
      this.container.style.opacity = '0';
      this.container.style.pointerEvents = 'none';
    }
    this.isMapVisible = false;

    // Restore 3D Globe container and controls
    const globeContainer = document.getElementById('globeCanvasContainer');
    if (globeContainer) {
      globeContainer.style.display = 'block';
      globeContainer.style.opacity = '1';
    }

    const globeCanvas = document.querySelector('#globeCanvasContainer canvas');
    if (globeCanvas) {
      globeCanvas.style.display = 'block';
      globeCanvas.style.opacity = '1';
    }

    const typeSwitcher = document.getElementById('globeTypeSwitcher');
    if (typeSwitcher) typeSwitcher.style.display = 'flex';
    const quickJumps = document.getElementById('globeQuickJumps');
    if (quickJumps) quickJumps.style.display = 'flex';

    if (this.selectedParcelLayer) this.selectedParcelLayer.clearLayers();
    if (this.surroundingParcelsLayer) this.surroundingParcelsLayer.clearLayers();
    if (this.markerPopupLayer) this.markerPopupLayer.clearLayers();
    this.currentParcel = null;

    if (window.parcelMapState) {
      window.parcelMapState.activeMapStage = 'GLOBAL_GLOBE';
      window.parcelMapState.viewMode = 'globe';
    }

    if (window.realSatelliteGlobeInstance && typeof window.realSatelliteGlobeInstance.handleResize === 'function') {
      window.realSatelliteGlobeInstance.handleResize();
    }

    try {
      const url = new URL(window.location);
      if (url.searchParams.has('parcel')) {
        url.searchParams.delete('parcel');
        window.history.replaceState(null, '', url.toString());
      }
    } catch (e) {}
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ParcelHdMapManager());
} else {
  new ParcelHdMapManager();
}
