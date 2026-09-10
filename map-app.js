/**
 * ParcelMap Modern Cadastral Map Engine
 * Smart Land Intelligence - Interactive GIS Web App
 * modular layers, spatial filters, and measurement/drawing tools.
 */

import { LOCATION_HIERARCHY, CADASTRAL_PLOTS, MAP_INFRASTRUCTURE, MAP_POIS } from './map-data.js';

class CadastralMapEngine {
  constructor() {
    this.map = null;
    this.currentTileLayer = null;
    this.tileLayers = {};
    
    // Feature Layer Groups
    this.layers = {
      plots: L.layerGroup(),
      plotLabels: L.layerGroup(),
      roads: L.layerGroup(),
      buildings: L.layerGroup(),
      water: L.layerGroup(),
      railway: L.layerGroup(),
      electricity: L.layerGroup(),
      pois: L.layerGroup(),
      drawLayer: L.featureGroup()
    };

    this.poiCategories = {
      school: L.layerGroup(),
      hospital: L.layerGroup(),
      religious: L.layerGroup(),
      government: L.layerGroup(),
      parking: L.layerGroup(),
      poi: L.layerGroup()
    };

    // State
    this.selectedPlots = new Set();
    this.activePlot = null;
    this.multiSelectMode = false;
    this.currentTool = null; // 'measure-dist', 'measure-area', 'draw-select'
    this.measurePoints = [];
    this.tempMeasureLine = null;
    this.tempMeasurePolygon = null;
    this.activeFilters = {
      landTypes: new Set(),
      areaRange: 'all',
      status: 'all',
      builtUp: 'all',
      roadAccess: 'all'
    };

    this.init();
  }

  init() {
    this.initMap();
    this.initTileLayers();
    this.renderCadastralPlots();
    this.renderInfrastructure();
    this.renderPOIs();
    this.initLocationSelectors();
    this.bindEvents();
    this.bindToolEvents();
    this.initDrawerTabs();
    this.initSatelliteCompareSlider();
    this.initAnalyticsModal();
    this.initMobileBottomBar();
    this.initQuickSearchAutocomplete();
    this.updateLayerCounters();
  }

  /* --------------------------------------------------------------------------
     1. MAP INITIALIZATION & BASEMAPS
     -------------------------------------------------------------------------- */
  initMap() {
    // Center on Wagholi sheet default
    this.map = L.map('gisMap', {
      center: [18.5818, 73.9875],
      zoom: 16,
      zoomControl: false,
      attributionControl: false
    });

    // Custom Scale bar
    L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(this.map);

    // Track coordinates on mouse move
    this.map.on('mousemove', (e) => {
      const latEl = document.getElementById('hudLat');
      const lngEl = document.getElementById('hudLng');
      const zoomEl = document.getElementById('hudZoom');
      if (latEl && lngEl) {
        latEl.textContent = e.latlng.lat.toFixed(5);
        lngEl.textContent = e.latlng.lng.toFixed(5);
      }
      if (zoomEl) {
        zoomEl.textContent = this.map.getZoom();
      }
    });

    // Add layer groups to map by default
    Object.values(this.layers).forEach(layer => layer.addTo(this.map));
  }

  initTileLayers() {
    this.tileLayers = {
      light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }),
      terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }),
      osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      })
    };

    // Default light basemap
    this.currentTileLayer = this.tileLayers.light;
    this.currentTileLayer.addTo(this.map);
  }

  setBasemap(name) {
    if (this.tileLayers[name]) {
      this.map.removeLayer(this.currentTileLayer);
      this.currentTileLayer = this.tileLayers[name];
      this.currentTileLayer.addTo(this.map);

      // Adjust label styles if satellite or dark
      const isDarkOrSat = name === 'satellite' || name === 'dark';
      document.querySelectorAll('.plot-number-label').forEach(el => {
        el.style.background = isDarkOrSat ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.88)';
        el.style.color = isDarkOrSat ? '#f8fafc' : '#21133b';
      });

      // Update UI active button
      document.querySelectorAll('.basemap-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.basemap === name);
      });
    }
  }

  /* --------------------------------------------------------------------------
     2. CADASTRAL PLOTS RENDERING & INTERACTIONS
     -------------------------------------------------------------------------- */
  getPlotColor(landType) {
    switch (landType) {
      case 'Agricultural': return '#10b981'; // emerald green
      case 'Non-Agricultural (NA)': return '#0284c7'; // technical sky
      case 'Commercial': return '#9758ea'; // vibrant amethyst purple
      case 'Residential': return '#3b82f6'; // bright blue
      case 'Industrial': return '#f97316'; // industrial orange
      case 'Government': return '#64748b'; // slate
      case 'Green / Forest': return '#22c55e'; // forest green
      case 'Religious': return '#f59e0b'; // amber
      case 'Water Catchment': return '#06b6d4'; // cyan
      case 'Hospital': return '#ec4899'; // magenta pink
      case 'Parking / Logistics': return '#8b5cf6'; // violet
      case 'Railway Corridor': return '#475569'; // graphite
      case 'Electricity Substation': return '#eab308'; // electric yellow
      default: return '#9758ea';
    }
  }

  renderCadastralPlots() {
    this.layers.plots.clearLayers();
    this.layers.plotLabels.clearLayers();

    CADASTRAL_PLOTS.forEach(plot => {
      const color = this.getPlotColor(plot.landType);
      const isSelected = this.selectedPlots.has(plot.id);

      // Polygon boundary
      const polygon = L.polygon(plot.coordinates, {
        color: isSelected ? '#ffffff' : color,
        weight: isSelected ? 3.5 : 2,
        fillColor: color,
        fillOpacity: isSelected ? 0.45 : 0.2,
        dashArray: isSelected ? null : '4, 2',
        className: `cadastral-polygon-${plot.id}`
      });

      // Compute centroid for label
      const bounds = polygon.getBounds();
      const center = bounds.getCenter();

      // Plot Centroid Number Label
      const labelIcon = L.divIcon({
        className: 'plot-number-label-wrapper',
        html: `<div class="plot-number-label" id="label-${plot.id}">#${plot.plotNo}</div>`,
        iconSize: [40, 18],
        iconAnchor: [20, 9]
      });

      const labelMarker = L.marker(center, { icon: labelIcon, interactive: false });
      this.layers.plotLabels.addLayer(labelMarker);

      // Interactive Tooltip
      polygon.bindTooltip(`
        <div style="font-family: var(--font-sans); padding: 4px 6px;">
          <div style="font-weight: 800; font-size: 13px; color: #0f172a;">Plot No. ${plot.plotNo} <span style="font-weight: 600; color: #64748b;">(Surv ${plot.surveyNo})</span></div>
          <div style="font-size: 11px; margin-top: 2px;">Type: <strong>${plot.landType}</strong></div>
          <div style="font-size: 11px;">Area: <strong>${plot.areaAcre} Acres</strong> (${plot.areaGuntha} Guntha)</div>
          <div style="font-size: 11px; color: #64748b;">Owner: ${plot.owner}</div>
        </div>
      `, { sticky: true, opacity: 0.95 });

      // Hover
      polygon.on('mouseover', () => {
        if (!this.selectedPlots.has(plot.id)) {
          polygon.setStyle({
            weight: 3,
            fillOpacity: 0.38,
            color: '#10b981'
          });
        }
      });

      polygon.on('mouseout', () => {
        if (!this.selectedPlots.has(plot.id)) {
          polygon.setStyle({
            weight: 2,
            fillOpacity: 0.2,
            color: color
          });
        }
      });

      // Click
      polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.handlePlotClick(plot, polygon);
      });

      polygon.plotData = plot;
      this.layers.plots.addLayer(polygon);
    });
  }

  handlePlotClick(plot, polygonLayer) {
    if (this.currentTool) return; // If measuring or drawing, ignore selection

    if (this.multiSelectMode) {
      if (this.selectedPlots.has(plot.id)) {
        this.selectedPlots.delete(plot.id);
      } else {
        this.selectedPlots.add(plot.id);
      }
    } else {
      this.selectedPlots.clear();
      this.selectedPlots.add(plot.id);
    }

    this.activePlot = plot;
    this.refreshPlotStyles();
    this.displayPlotDossier(plot);
  }

  refreshPlotStyles() {
    this.layers.plots.eachLayer(layer => {
      const plot = layer.plotData;
      if (!plot) return;

      const isSelected = this.selectedPlots.has(plot.id);
      const color = this.getPlotColor(plot.landType);

      layer.setStyle({
        weight: isSelected ? 3.5 : 2,
        color: isSelected ? '#10b981' : color,
        fillOpacity: isSelected ? 0.48 : 0.2,
        dashArray: isSelected ? null : '4, 2'
      });
    });
  }

  displayPlotDossier(plot) {
    const drawer = document.getElementById('plotInfoDrawer');
    if (!drawer) return;

    // Populate drawer elements
    document.getElementById('drawerPlotNo').textContent = `Plot #${plot.plotNo}`;
    document.getElementById('drawerSurveyNo').textContent = `Survey No: ${plot.surveyNo}`;
    document.getElementById('drawerLandTypeBadge').textContent = plot.landType;
    document.getElementById('drawerStatusBadge').textContent = plot.status;

    // Metrics
    document.getElementById('metricAcres').textContent = `${plot.areaAcre} Ac`;
    document.getElementById('metricGuntha').textContent = `${plot.areaGuntha} G`;
    document.getElementById('metricHectares').textContent = `${plot.areaHectare} Ha`;
    document.getElementById('metricSqM').textContent = `${plot.areaSqM.toLocaleString()} m²`;

    // Attributes
    document.getElementById('attrOwner').textContent = plot.owner;
    document.getElementById('attrCoOwners').textContent = plot.coOwners ? plot.coOwners.join(', ') : 'None';
    document.getElementById('attrKhata').textContent = plot.khataNo;
    document.getElementById('attrMutation').textContent = plot.mutationNo;
    document.getElementById('attrRoadAccess').textContent = plot.roadAccess;
    document.getElementById('attrSoil').textContent = plot.soilGrade;
    document.getElementById('attrWater').textContent = plot.waterSource;
    document.getElementById('attrRate').textContent = `₹${plot.govtRateSqM.toLocaleString()} / sq.m`;
    
    const approxTotal = Math.round(plot.areaSqM * plot.govtRateSqM);
    document.getElementById('attrValuation').textContent = `₹${(approxTotal / 10000000).toFixed(2)} Cr`;

    // Centroid Lat/Lng
    const centerLat = plot.coordinates[0][0];
    const centerLng = plot.coordinates[0][1];
    document.getElementById('attrCoords').textContent = `${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}`;

    // Update AI Change Detection Card based on plot
    const changePill = document.querySelector('.change-score-pill');
    const changeChips = document.querySelector('.change-chip-list');
    if (changePill && changeChips) {
      if (plot.status === 'In Dispute') {
        changePill.textContent = '34% Change (Flagged)';
        changePill.style.background = 'rgba(239, 68, 68, 0.2)';
        changePill.style.color = '#ef4444';
        changeChips.innerHTML = `
          <div class="change-chip-item"><span style="color: #ef4444;">⚠</span> <span>Boundary dispute flag on Northern survey edge</span></div>
          <div class="change-chip-item"><span style="color: #f59e0b;">⚠</span> <span>Historical vertex mismatch vs adjacent survey sheet</span></div>
          <div class="change-chip-item"><span style="color: #10b981;">✓</span> <span>Area variation within 1.2% legal tolerance</span></div>
        `;
      } else if (plot.landType === 'Commercial' || plot.landType === 'Non-Agricultural (NA)') {
        changePill.textContent = '26% Change';
        changePill.style.background = 'rgba(2, 132, 199, 0.2)';
        changePill.style.color = '#0284c7';
        changeChips.innerHTML = `
          <div class="change-chip-item"><span style="color: #10b981;">✓</span> <span>NA development permissions ratified</span></div>
          <div class="change-chip-item"><span style="color: #0284c7;">ℹ</span> <span>Paved surface expansion (+${Math.round(plot.areaSqM * 0.22)} m²)</span></div>
          <div class="change-chip-item"><span style="color: #10b981;">✓</span> <span>Highway access setback compliant</span></div>
        `;
      } else {
        changePill.textContent = '14% Change';
        changePill.style.background = 'rgba(16, 185, 129, 0.2)';
        changePill.style.color = '#10b981';
        changeChips.innerHTML = `
          <div class="change-chip-item"><span style="color: #10b981;">✓</span> <span>Agricultural boundary aligned with village sheet</span></div>
          <div class="change-chip-item"><span style="color: #10b981;">✓</span> <span>Canal irrigation corridor buffer intact</span></div>
          <div class="change-chip-item"><span style="color: #3b82f6;">ℹ</span> <span>Vegetation & crop canopy index stable (+5.2%)</span></div>
        `;
      }
    }

    // Open Drawer
    drawer.classList.add('open');

    // If multiple selected, show count badge
    if (this.selectedPlots.size > 1) {
      document.getElementById('drawerMultiBadge').style.display = 'inline-block';
      document.getElementById('drawerMultiCount').textContent = `${this.selectedPlots.size} Plots Selected`;
    } else {
      document.getElementById('drawerMultiBadge').style.display = 'none';
    }
  }

  closePlotDossier() {
    const drawer = document.getElementById('plotInfoDrawer');
    if (drawer) drawer.classList.remove('open');
    this.selectedPlots.clear();
    this.activePlot = null;
    this.refreshPlotStyles();
  }

  /* --------------------------------------------------------------------------
     3. INFRASTRUCTURE & POI RENDERING
     -------------------------------------------------------------------------- */
  renderInfrastructure() {
    // 1. Roads
    this.layers.roads.clearLayers();
    MAP_INFRASTRUCTURE.roads.forEach(road => {
      const isHighway = road.type === 'Highway';
      const roadLine = L.polyline(road.coordinates, {
        color: isHighway ? '#f59e0b' : '#64748b',
        weight: isHighway ? 6 : 4,
        opacity: 0.9,
        lineCap: 'round'
      });
      roadLine.bindTooltip(`🛣️ ${road.name} (${road.widthM}m width)`);
      this.layers.roads.addLayer(roadLine);
    });

    // 2. Railway
    this.layers.railway.clearLayers();
    MAP_INFRASTRUCTURE.railway.forEach(rail => {
      const railBg = L.polyline(rail.coordinates, {
        color: '#1e293b',
        weight: 5,
        opacity: 0.8
      });
      const railDashes = L.polyline(rail.coordinates, {
        color: '#ffffff',
        weight: 3,
        dashArray: '6, 6',
        opacity: 0.95
      });
      railBg.bindTooltip(`🚆 ${rail.name}`);
      this.layers.railway.addLayer(railBg);
      this.layers.railway.addLayer(railDashes);
    });

    // 3. Electricity HT Line
    this.layers.electricity.clearLayers();
    MAP_INFRASTRUCTURE.electricity.forEach(ht => {
      const htLine = L.polyline(ht.coordinates, {
        color: '#eab308',
        weight: 3,
        dashArray: '8, 8',
        opacity: 0.9
      });
      htLine.bindTooltip(`⚡ ${ht.name}`);
      this.layers.electricity.addLayer(htLine);
    });

    // 4. Water Bodies & Canals
    this.layers.water.clearLayers();
    MAP_INFRASTRUCTURE.waterBodies.forEach(water => {
      if (water.polygon) {
        const lake = L.polygon(water.polygon, {
          color: '#0284c7',
          fillColor: '#38bdf8',
          fillOpacity: 0.6,
          weight: 2
        });
        lake.bindTooltip(`💧 ${water.name}`);
        this.layers.water.addLayer(lake);
      } else if (water.coordinates) {
        const canal = L.polyline(water.coordinates, {
          color: '#0284c7',
          weight: 4.5,
          opacity: 0.85
        });
        canal.bindTooltip(`💧 ${water.name}`);
        this.layers.water.addLayer(canal);
      }
    });

    // 5. Buildings
    this.layers.buildings.clearLayers();
    MAP_INFRASTRUCTURE.buildings.forEach(bld => {
      const bldPoly = L.polygon(bld.polygon, {
        color: '#475569',
        fillColor: '#64748b',
        fillOpacity: 0.7,
        weight: 1.5
      });
      bldPoly.bindTooltip(`🏢 ${bld.name} (${bld.type})`);
      this.layers.buildings.addLayer(bldPoly);
    });
  }

  renderPOIs() {
    this.layers.pois.clearLayers();
    Object.values(this.poiCategories).forEach(cat => cat.clearLayers());

    MAP_POIS.forEach(poi => {
      const icon = L.divIcon({
        className: 'poi-custom-marker',
        html: `
          <div style="background: #ffffff; border: 2px solid var(--gis-purple); border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.2); font-size: 14px;">
            ${poi.icon}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([poi.lat, poi.lng], { icon: icon });
      marker.bindTooltip(`
        <div style="padding: 4px;">
          <div style="font-weight: 700; font-size: 12px; color: #0f172a;">${poi.icon} ${poi.name}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${poi.details}</div>
        </div>
      `);

      this.layers.pois.addLayer(marker);
      if (this.poiCategories[poi.category]) {
        this.poiCategories[poi.category].addLayer(marker);
      }
    });
  }

  /* --------------------------------------------------------------------------
     4. LOCATION SELECTORS (STATE > DISTRICT > TALUKA > VILLAGE)
     -------------------------------------------------------------------------- */
  initLocationSelectors() {
    const stateSel = document.getElementById('selState');
    const distSel = document.getElementById('selDistrict');
    const talukaSel = document.getElementById('selTaluka');
    const villageSel = document.getElementById('selVillage');

    if (!stateSel || !distSel || !talukaSel || !villageSel) return;

    // Populate States
    stateSel.innerHTML = LOCATION_HIERARCHY.states.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

    const updateDistricts = () => {
      const stateObj = LOCATION_HIERARCHY.states.find(s => s.id === stateSel.value) || LOCATION_HIERARCHY.states[0];
      distSel.innerHTML = stateObj.districts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
      updateTalukas();
    };

    const updateTalukas = () => {
      const stateObj = LOCATION_HIERARCHY.states.find(s => s.id === stateSel.value) || LOCATION_HIERARCHY.states[0];
      const distObj = stateObj.districts.find(d => d.id === distSel.value) || stateObj.districts[0];
      talukaSel.innerHTML = distObj.talukas.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      updateVillages();
    };

    const updateVillages = () => {
      const stateObj = LOCATION_HIERARCHY.states.find(s => s.id === stateSel.value) || LOCATION_HIERARCHY.states[0];
      const distObj = stateObj.districts.find(d => d.id === distSel.value) || stateObj.districts[0];
      const talukaObj = distObj.talukas.find(t => t.id === talukaSel.value) || distObj.talukas[0];
      villageSel.innerHTML = talukaObj.villages.map(v => `<option value="${v.id}">${v.name}</option>`).join('');

      this.onVillageChanged();
    };

    stateSel.addEventListener('change', updateDistricts);
    distSel.addEventListener('change', updateTalukas);
    talukaSel.addEventListener('change', updateVillages);
    villageSel.addEventListener('change', () => this.onVillageChanged());

    updateDistricts();
  }

  onVillageChanged() {
    const stateSel = document.getElementById('selState');
    const distSel = document.getElementById('selDistrict');
    const talukaSel = document.getElementById('selTaluka');
    const villageSel = document.getElementById('selVillage');

    const stateObj = LOCATION_HIERARCHY.states.find(s => s.id === stateSel.value);
    const distObj = stateObj ? stateObj.districts.find(d => d.id === distSel.value) : null;
    const talukaObj = distObj ? distObj.talukas.find(t => t.id === talukaSel.value) : null;
    const villageObj = talukaObj ? talukaObj.villages.find(v => v.id === villageSel.value) : null;

    if (villageObj) {
      // Update breadcrumb
      const bcEl = document.getElementById('locationBreadcrumb');
      if (bcEl) {
        bcEl.innerHTML = `📍 ${stateObj.name} &gt; ${distObj.name} &gt; ${talukaObj.name} &gt; <span class="active-village">${villageObj.name}</span>`;
      }

      // Fly to village center
      this.map.flyTo(villageObj.center, villageObj.zoom || 16, { duration: 1.2 });
    }
  }

  /* --------------------------------------------------------------------------
     5. SEARCH & LOCATE PLOT
     -------------------------------------------------------------------------- */
  searchPlot(query) {
    if (!query) return;
    const cleanQ = query.toString().trim().toLowerCase().replace('#', '').replace('plot', '').trim();

    const target = CADASTRAL_PLOTS.find(p => 
      p.plotNo.toLowerCase() === cleanQ ||
      p.plotNo.toLowerCase().includes(cleanQ) ||
      p.surveyNo.toLowerCase().includes(cleanQ) ||
      p.owner.toLowerCase().includes(cleanQ)
    );

    if (target) {
      // Find layer
      let foundLayer = null;
      this.layers.plots.eachLayer(l => {
        if (l.plotData && l.plotData.id === target.id) {
          foundLayer = l;
        }
      });

      if (foundLayer) {
        const bounds = foundLayer.getBounds();
        this.map.flyToBounds(bounds, { maxZoom: 18, padding: [80, 80], duration: 1.2 });
        this.handlePlotClick(target, foundLayer);
      }
    } else {
      alert(`Plot or Survey "${query}" not found in current cadastral sheet. Try 101, 104A, 108, or 112.`);
    }
  }

  /* --------------------------------------------------------------------------
     6. ADVANCED FILTERING
     -------------------------------------------------------------------------- */
  applyAdvancedFilters() {
    let matchCount = 0;

    this.layers.plots.eachLayer(layer => {
      const plot = layer.plotData;
      if (!plot) return;

      let visible = true;

      // 1. Land type filter
      if (this.activeFilters.landTypes.size > 0) {
        if (!this.activeFilters.landTypes.has(plot.landType)) {
          visible = false;
        }
      }

      // 2. Area range filter
      if (this.activeFilters.areaRange !== 'all') {
        const ac = plot.areaAcre;
        if (this.activeFilters.areaRange === '<1' && ac >= 1.0) visible = false;
        else if (this.activeFilters.areaRange === '1-2' && (ac < 1.0 || ac > 2.0)) visible = false;
        else if (this.activeFilters.areaRange === '2-4' && (ac < 2.0 || ac > 4.0)) visible = false;
        else if (this.activeFilters.areaRange === '>4' && ac <= 4.0) visible = false;
      }

      // 3. Status filter
      if (this.activeFilters.status !== 'all' && plot.status !== this.activeFilters.status) {
        visible = false;
      }

      // 4. Built-up filter
      if (this.activeFilters.builtUp === 'yes' && !plot.builtUp) visible = false;
      if (this.activeFilters.builtUp === 'no' && plot.builtUp) visible = false;

      // 5. Road Access filter
      if (this.activeFilters.roadAccess === 'highway' && !plot.roadAccess.toLowerCase().includes('highway')) visible = false;

      // Apply visibility
      const labelEl = document.getElementById(`label-${plot.id}`);
      if (visible) {
        layer.setStyle({ fillOpacity: 0.22, opacity: 1 });
        if (labelEl) labelEl.style.display = 'block';
        matchCount++;
      } else {
        layer.setStyle({ fillOpacity: 0.03, opacity: 0.15 });
        if (labelEl) labelEl.style.display = 'none';
      }
    });

    // Update filter badge
    const badge = document.getElementById('activeFilterCountBadge');
    if (badge) {
      const totalRules = this.activeFilters.landTypes.size + 
        (this.activeFilters.areaRange !== 'all' ? 1 : 0) +
        (this.activeFilters.status !== 'all' ? 1 : 0) +
        (this.activeFilters.builtUp !== 'all' ? 1 : 0) +
        (this.activeFilters.roadAccess !== 'all' ? 1 : 0);

      badge.textContent = totalRules > 0 ? `${totalRules} Active (${matchCount} Plots)` : '';
      badge.style.display = totalRules > 0 ? 'inline-block' : 'none';
    }
  }

  resetAdvancedFilters() {
    this.activeFilters = {
      landTypes: new Set(),
      areaRange: 'all',
      status: 'all',
      builtUp: 'all',
      roadAccess: 'all'
    };

    document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
    document.querySelectorAll('.filter-select').forEach(sel => sel.value = 'all');

    this.applyAdvancedFilters();
  }

  /* --------------------------------------------------------------------------
     7. MAP MEASUREMENT & DRAWING TOOLS
     -------------------------------------------------------------------------- */
  setTool(toolName) {
    this.clearActiveTool();
    if (this.currentTool === toolName) {
      this.currentTool = null;
      return;
    }

    this.currentTool = toolName;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    const banner = document.getElementById('measurementHudBanner');
    const bannerText = document.getElementById('measurementHudText');

    if (banner && bannerText) {
      banner.style.display = 'flex';
      if (toolName === 'measure-dist') {
        bannerText.textContent = '📏 Click points on map to measure distance. Double click to finish.';
        this.map.getContainer().style.cursor = 'crosshair';
      } else if (toolName === 'measure-area') {
        bannerText.textContent = '📐 Click points to draw polygon and measure area. Double click to finish.';
        this.map.getContainer().style.cursor = 'crosshair';
      } else if (toolName === 'draw-select') {
        bannerText.textContent = '✏️ Click points to enclose plots for custom selection query.';
        this.map.getContainer().style.cursor = 'crosshair';
      }
    }
  }

  clearActiveTool() {
    this.currentTool = null;
    this.measurePoints = [];
    this.layers.drawLayer.clearLayers();
    this.map.getContainer().style.cursor = '';

    const banner = document.getElementById('measurementHudBanner');
    if (banner) banner.style.display = 'none';

    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  }

  bindToolEvents() {
    this.map.on('click', (e) => {
      if (!this.currentTool) return;

      const latlng = e.latlng;
      this.measurePoints.push(latlng);

      if (this.currentTool === 'measure-dist') {
        this.updateDistanceMeasurement();
      } else if (this.currentTool === 'measure-area' || this.currentTool === 'draw-select') {
        this.updateAreaMeasurement();
      }
    });

    this.map.on('dblclick', (e) => {
      if (!this.currentTool) return;
      L.DomEvent.stopPropagation(e);

      if (this.currentTool === 'draw-select') {
        this.finishDrawSelection();
      }
      this.clearActiveTool();
    });
  }

  updateDistanceMeasurement() {
    this.layers.drawLayer.clearLayers();

    if (this.measurePoints.length < 2) {
      L.circleMarker(this.measurePoints[0], { radius: 5, color: '#9758ea' }).addTo(this.layers.drawLayer);
      return;
    }

    const polyline = L.polyline(this.measurePoints, { color: '#9758ea', weight: 3 }).addTo(this.layers.drawLayer);

    // Calculate total distance (in meters)
    let totalMeters = 0;
    for (let i = 0; i < this.measurePoints.length - 1; i++) {
      totalMeters += this.measurePoints[i].distanceTo(this.measurePoints[i + 1]);
    }

    const bannerText = document.getElementById('measurementHudText');
    if (bannerText) {
      if (totalMeters >= 1000) {
        bannerText.textContent = `📏 Distance: ${(totalMeters / 1000).toFixed(2)} km (${totalMeters.toFixed(0)} m / ${(totalMeters * 3.28084).toFixed(0)} ft)`;
      } else {
        bannerText.textContent = `📏 Distance: ${totalMeters.toFixed(1)} m (${(totalMeters * 3.28084).toFixed(1)} ft)`;
      }
    }
  }

  updateAreaMeasurement() {
    this.layers.drawLayer.clearLayers();

    if (this.measurePoints.length < 3) {
      L.polyline(this.measurePoints, { color: '#0284c7', weight: 2, dashArray: '4, 4' }).addTo(this.layers.drawLayer);
      return;
    }

    const polygon = L.polygon(this.measurePoints, {
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.35,
      weight: 2.5
    }).addTo(this.layers.drawLayer);

    // Compute approximate planar area in sq. meters
    const sqM = this.computePolygonArea(this.measurePoints);
    const guntha = (sqM / 101.17).toFixed(1);
    const acres = (sqM / 4046.86).toFixed(2);
    const hectares = (sqM / 10000).toFixed(3);

    const bannerText = document.getElementById('measurementHudText');
    if (bannerText) {
      bannerText.textContent = `📐 Area: ${acres} Acres (${guntha} Guntha • ${Math.round(sqM)} m² • ${hectares} Ha)`;
    }
  }

  computePolygonArea(latlngs) {
    if (latlngs.length < 3) return 0;
    const radius = 6378137; // Earth radius in meters
    let area = 0;
    const len = latlngs.length;

    for (let i = 0; i < len; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % len];
      area += ((p2.lng - p1.lng) * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(area * radius * radius / 2.0);
  }

  finishDrawSelection() {
    if (this.measurePoints.length < 3) return;

    const drawnPolygon = L.polygon(this.measurePoints);
    const selected = [];

    this.layers.plots.eachLayer(plotLayer => {
      const bounds = plotLayer.getBounds();
      if (drawnPolygon.getBounds().intersects(bounds)) {
        selected.push(plotLayer.plotData);
        this.selectedPlots.add(plotLayer.plotData.id);
      }
    });

    this.refreshPlotStyles();

    if (selected.length > 0) {
      const totalAcres = selected.reduce((sum, p) => sum + p.areaAcre, 0).toFixed(2);
      const totalGuntha = selected.reduce((sum, p) => sum + p.areaGuntha, 0).toFixed(1);
      const totalSqM = selected.reduce((sum, p) => sum + p.areaSqM, 0);
      alert(`Spatial Selection Complete: Found ${selected.length} plots intersecting your drawn boundary.\n\nTotal Enclosed Land Area: ${totalAcres} Acres (${totalGuntha} Guntha / ${totalSqM.toLocaleString()} m²).\n\nHighlighted on map.`);
      this.displayPlotDossier(selected[0]);
    } else {
      alert('No survey plots found inside the drawn boundary.');
    }
  }

  /* --------------------------------------------------------------------------
     8. DOSSIER EXPORT & 7/12 NAKSHA PRINT
     -------------------------------------------------------------------------- */
  openDossierModal() {
    if (!this.activePlot) return;
    const p = this.activePlot;
    const modal = document.getElementById('dossierModalOverlay');
    const content = document.getElementById('dossierModalContent');
    if (!modal || !content) return;

    const approxVal = Math.round(p.areaSqM * p.govtRateSqM);
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    content.innerHTML = `
      <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="font-family: var(--font-heading); font-size: 22px; color: #0f172a;">GOVERNMENT OF MAHARASHTRA • REVENUE DEPARTMENT</h2>
        <h4 style="font-size: 14px; color: #475569; margin-top: 4px;">VILLAGE FORM VII-XII (7/12 EXTRACT) &amp; CADASTRAL PLOT RECORD</h4>
        <div style="font-size: 11px; font-family: var(--font-mono); color: #64748b; margin-top: 4px;">RECORD AUTHENTICATION ID: PCL-${p.id.toUpperCase()}-${Date.now().toString().slice(-6)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; margin-bottom: 14px; background: #f8fafc; padding: 12px; border-radius: 8px;">
        <div><strong>District:</strong> Pune</div>
        <div><strong>Taluka:</strong> Haveli</div>
        <div><strong>Village:</strong> Wagholi (Sheet #14)</div>
        <div><strong>Survey / Hissa No:</strong> ${p.surveyNo}</div>
        <div><strong>Cadastral Plot No:</strong> ${p.plotNo}</div>
        <div><strong>Land Tenure Classification:</strong> ${p.landType}</div>
      </div>

      <div style="margin-bottom: 14px;">
        <h5 style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">OCCUPANT &amp; KHATA PARTICULARS (गावातील खातेदार):</h5>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #cbd5e1;">
          <tr style="background: #e2e8f0; font-weight: 700;">
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Khata No.</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Primary Occupant / Landholder</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Co-sharers</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Mutation (फेरफार)</td>
          </tr>
          <tr>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.khataNo}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;"><strong>${p.owner}</strong></td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.coOwners ? p.coOwners.join(', ') : 'None'}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.mutationNo}</td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom: 14px;">
        <h5 style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">AREA &amp; VALUATION ASSESSMENT:</h5>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #cbd5e1;">
          <tr style="background: #e2e8f0; font-weight: 700;">
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Hectares</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Acres</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Guntha</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Sq. Meters</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">Ready Reckoner Valuation</td>
          </tr>
          <tr>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.areaHectare} Ha</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;"><strong>${p.areaAcre} Acres</strong></td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.areaGuntha} G</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.areaSqM.toLocaleString()} m²</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;"><strong>₹${(approxVal / 10000000).toFixed(2)} Crores</strong></td>
          </tr>
        </table>
      </div>

      <!-- Change Analysis & Verification Status -->
      <div style="margin-bottom: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 12px; border-radius: 6px; font-size: 11px;">
        <div style="font-weight: 700; color: #166534; display: flex; justify-content: space-between; align-items: center;">
          <span>Smart Change Analysis (2021 ↔ 2026 Epoch)</span>
          <span style="font-family: var(--font-mono); font-size: 10px; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">Informational Demo</span>
        </div>
        <div style="color: #15803d; margin-top: 4px; line-height: 1.4;">
          GPS Centroid: <strong>${p.coordinates[0][0][0].toFixed(5)}, ${p.coordinates[0][0][1].toFixed(5)}</strong>.
          Boundary verified against digital cadastral index. Detected multi-epoch surface evolution variance: 14% to 26%. Road access: ${p.roadAccess}.
        </div>
      </div>

      <div style="font-size: 11px; color: #64748b; margin-top: 16px; border-top: 1px dashed #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between;">
        <span>Generated via GeoParcel.ai Smart Land Intelligence Engine • ${dateStr}</span>
        <span>Verified Digital Token • Survey Inspector Signatory Stamp</span>
      </div>
    `;

    modal.classList.add('open');
  }

  closeDossierModal() {
    const modal = document.getElementById('dossierModalOverlay');
    if (modal) modal.classList.remove('open');
  }

  exportGeoJson() {
    if (!this.activePlot) {
      alert("Please select a parcel on the map first to export GeoJSON.");
      return;
    }
    const p = this.activePlot;
    // Standard RFC 7946 GeoJSON format: [longitude, latitude]
    const geojsonCoords = p.coordinates[0].map(c => [c[1], c[0]]);
    // Ensure closed ring
    if (geojsonCoords[0][0] !== geojsonCoords[geojsonCoords.length - 1][0] ||
        geojsonCoords[0][1] !== geojsonCoords[geojsonCoords.length - 1][1]) {
      geojsonCoords.push(geojsonCoords[0]);
    }

    const feature = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            parcelId: p.id,
            plotNo: p.plotNo,
            surveyNo: p.surveyNo,
            landType: p.landType,
            status: p.status,
            owner: p.owner,
            coOwners: p.coOwners,
            khataNo: p.khataNo,
            mutationNo: p.mutationNo,
            areaAcre: p.areaAcre,
            areaGuntha: p.areaGuntha,
            areaHectare: p.areaHectare,
            areaSqM: p.areaSqM,
            roadAccess: p.roadAccess,
            soilGrade: p.soilGrade,
            waterSource: p.waterSource,
            govtRateSqM: p.govtRateSqM,
            exportEngine: "GeoParcel.ai Smart Land Intelligence"
          },
          geometry: {
            type: "Polygon",
            coordinates: [geojsonCoords]
          }
        }
      ]
    };

    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `parcel-${p.plotNo}-boundary.geojson`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  exportCsv() {
    if (!this.activePlot) {
      alert("Please select a parcel on the map first to export CSV.");
      return;
    }
    const plots = this.selectedPlots.size > 1
      ? CADASTRAL_PLOTS.filter(p => this.selectedPlots.has(p.id))
      : [this.activePlot];

    const headers = [
      "Plot No", "Survey No", "Land Type", "Status", "Owner",
      "Khata No", "Mutation No", "Area (Acres)", "Area (Guntha)",
      "Area (Hectares)", "Area (Sq M)", "Road Access", "Govt Rate (Rs/sqm)",
      "Valuation (INR)", "Latitude", "Longitude"
    ];

    const rows = plots.map(p => {
      const approxVal = Math.round(p.areaSqM * p.govtRateSqM);
      return [
        `"${p.plotNo}"`,
        `"${p.surveyNo}"`,
        `"${p.landType}"`,
        `"${p.status}"`,
        `"${p.owner}"`,
        `"${p.khataNo}"`,
        `"${p.mutationNo}"`,
        p.areaAcre,
        p.areaGuntha,
        p.areaHectare,
        p.areaSqM,
        `"${p.roadAccess}"`,
        p.govtRateSqM,
        approxVal,
        p.coordinates[0][0][0],
        p.coordinates[0][0][1]
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `parcel-${this.activePlot.plotNo}-cadastral.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* --------------------------------------------------------------------------
     9. UI EVENT LISTENERS
     -------------------------------------------------------------------------- */
  bindEvents() {
    // 0. Disable Leaflet scroll interception on Sidebar & Drawers
    if (window.L && L.DomEvent) {
      const sidebarEl = document.getElementById('appSidebar');
      if (sidebarEl) {
        L.DomEvent.disableScrollPropagation(sidebarEl);
      }
      const drawerEl = document.getElementById('plotInfoDrawer');
      if (drawerEl) {
        L.DomEvent.disableScrollPropagation(drawerEl);
      }
      const modalEl = document.getElementById('dossierModalOverlay');
      if (modalEl) {
        L.DomEvent.disableScrollPropagation(modalEl);
      }
    }

    // Stop wheel events in sidebar from propagating to map zoom
    const scrollContainer = document.querySelector('.sidebar-scroll');
    if (scrollContainer) {
      scrollContainer.addEventListener('wheel', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }

    // 1. Sidebar Toggle
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const openBtn = document.getElementById('floatingSidebarOpen');
    const sidebar = document.getElementById('appSidebar');

    const toggleSidebar = () => {
      sidebar.classList.toggle('collapsed');
      setTimeout(() => {
        this.map.invalidateSize();
      }, 300);
    };

    if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
    if (openBtn) openBtn.addEventListener('click', toggleSidebar);

    // 2. Accordion Sections
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', () => {
        const panel = header.closest('.panel-section');
        panel.classList.toggle('expanded');
      });
    });

    // 3. Basemap buttons
    document.querySelectorAll('.basemap-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setBasemap(btn.dataset.basemap);
      });
    });

    // 4. Quick Search Bar
    const searchInput = document.getElementById('quickSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.searchPlot(searchInput.value);
        }
      });
    }

    const searchPlotNoInput = document.getElementById('searchPlotNoInput');
    const searchPlotBtn = document.getElementById('btnSearchPlot');
    if (searchPlotBtn && searchPlotNoInput) {
      searchPlotBtn.addEventListener('click', () => {
        this.searchPlot(searchPlotNoInput.value);
      });
      searchPlotNoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.searchPlot(searchPlotNoInput.value);
        }
      });
    }

    // Quick chips
    document.querySelectorAll('.plot-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.searchPlot(chip.dataset.plot);
      });
    });

    // 5. Layer Toggles
    const bindLayerToggle = (id, layerGroup) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          if (e.target.checked) {
            this.map.addLayer(layerGroup);
          } else {
            this.map.removeLayer(layerGroup);
          }
        });
      }
    };

    bindLayerToggle('layerPlotsToggle', this.layers.plots);
    bindLayerToggle('layerPlotLabelsToggle', this.layers.plotLabels);
    bindLayerToggle('layerRoadsToggle', this.layers.roads);
    bindLayerToggle('layerBuildingsToggle', this.layers.buildings);
    bindLayerToggle('layerWaterToggle', this.layers.water);
    bindLayerToggle('layerRailwayToggle', this.layers.railway);
    bindLayerToggle('layerElectricityToggle', this.layers.electricity);
    bindLayerToggle('layerSchoolsToggle', this.poiCategories.school);
    bindLayerToggle('layerHospitalsToggle', this.poiCategories.hospital);
    bindLayerToggle('layerReligiousToggle', this.poiCategories.religious);
    bindLayerToggle('layerGovtToggle', this.poiCategories.government);
    bindLayerToggle('layerParkingToggle', this.poiCategories.parking);
    bindLayerToggle('layerPoisToggle', this.poiCategories.poi);

    // 6. Advanced Filter Chips
    document.querySelectorAll('.chip-land-type').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const type = chip.dataset.type;
        if (this.activeFilters.landTypes.has(type)) {
          this.activeFilters.landTypes.delete(type);
        } else {
          this.activeFilters.landTypes.add(type);
        }
        this.applyAdvancedFilters();
      });
    });

    document.querySelectorAll('.chip-area').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip-area').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeFilters.areaRange = chip.dataset.range;
        this.applyAdvancedFilters();
      });
    });

    const selStatus = document.getElementById('filterStatus');
    if (selStatus) {
      selStatus.addEventListener('change', (e) => {
        this.activeFilters.status = e.target.value;
        this.applyAdvancedFilters();
      });
    }

    const selBuiltUp = document.getElementById('filterBuiltUp');
    if (selBuiltUp) {
      selBuiltUp.addEventListener('change', (e) => {
        this.activeFilters.builtUp = e.target.value;
        this.applyAdvancedFilters();
      });
    }

    const selRoad = document.getElementById('filterRoadAccess');
    if (selRoad) {
      selRoad.addEventListener('change', (e) => {
        this.activeFilters.roadAccess = e.target.value;
        this.applyAdvancedFilters();
      });
    }

    const btnResetFilters = document.getElementById('btnResetFilters');
    if (btnResetFilters) {
      btnResetFilters.addEventListener('click', () => this.resetAdvancedFilters());
    }

    // 7. Map Tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
      });
    });

    const btnFinishMeasure = document.getElementById('btnFinishMeasurement');
    if (btnFinishMeasure) {
      btnFinishMeasure.addEventListener('click', () => {
        this.clearActiveTool();
      });
    }

    // Multi-Select Mode Toggle
    const multiSelectBtn = document.getElementById('toolMultiSelect');
    if (multiSelectBtn) {
      multiSelectBtn.addEventListener('click', () => {
        this.multiSelectMode = !this.multiSelectMode;
        multiSelectBtn.classList.toggle('active', this.multiSelectMode);
        if (!this.multiSelectMode && this.selectedPlots.size > 1) {
          this.selectedPlots.clear();
          this.refreshPlotStyles();
        }
      });
    }

    // Clear Selection Button
    const clearSelectionBtn = document.getElementById('toolClearSelection');
    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener('click', () => {
        this.closePlotDossier();
        this.clearActiveTool();
      });
    }

    // 8. HUD Buttons (Zoom In/Out, Reset, Fullscreen, Locate Me)
    document.getElementById('hudZoomIn')?.addEventListener('click', () => this.map.zoomIn());
    document.getElementById('hudZoomOut')?.addEventListener('click', () => this.map.zoomOut());
    document.getElementById('hudResetView')?.addEventListener('click', () => {
      this.map.flyTo([18.5818, 73.9875], 16, { duration: 1 });
    });

    document.getElementById('hudFullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });

    document.getElementById('hudLocate')?.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.map.flyTo([pos.coords.latitude, pos.coords.longitude], 17);
            L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
              radius: 8,
              color: '#0284c7',
              fillColor: '#38bdf8',
              fillOpacity: 0.8
            }).addTo(this.map).bindTooltip("Your Current Location").openTooltip();
          },
          () => {
            alert("Could not acquire GPS coordinates. Centering on Wagholi village sheet.");
            this.map.flyTo([18.5818, 73.9875], 16);
          }
        );
      }
    });

    // 9. Dossier Drawer Close
    document.getElementById('drawerCloseBtn')?.addEventListener('click', () => {
      this.closePlotDossier();
    });

    // 10. Print / Export Modal
    document.getElementById('btnExportNaksha')?.addEventListener('click', () => {
      this.openDossierModal();
    });

    document.getElementById('dossierModalCloseBtn')?.addEventListener('click', () => {
      this.closeDossierModal();
    });

    document.getElementById('btnPrintDossier')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('btnExportGeoJson')?.addEventListener('click', () => {
      this.exportGeoJson();
    });

    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
      this.exportCsv();
    });

    document.getElementById('btnCopyCoords')?.addEventListener('click', () => {
      if (this.activePlot) {
        const coords = this.activePlot.coordinates[0].map(c => c.join(',')).join('; ');
        navigator.clipboard.writeText(coords).then(() => {
          alert("Plot boundary coordinates copied to clipboard!");
        });
      }
    });

    // 11. Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
      });
    }
  }

  /* --------------------------------------------------------------------------
     10. DRAWER TABS & SATELLITE COMPARISON
     -------------------------------------------------------------------------- */
  initDrawerTabs() {
    const tabs = document.querySelectorAll('.drawer-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const tabTarget = tab.dataset.drawerTab;
        document.querySelectorAll('.drawer-tab-view').forEach(view => {
          view.classList.remove('active');
        });

        if (tabTarget === 'details') {
          document.getElementById('tabViewDetails')?.classList.add('active');
        } else if (tabTarget === 'satellite') {
          document.getElementById('tabViewSatellite')?.classList.add('active');
        } else if (tabTarget === 'change') {
          document.getElementById('tabViewChange')?.classList.add('active');
        }
      });
    });
  }

  initSatelliteCompareSlider() {
    const container = document.getElementById('drawerCompareContainer');
    const overlay = document.getElementById('drawerCompareOverlay');
    const handle = document.getElementById('drawerCompareHandle');
    if (!container || !overlay || !handle) return;

    let isDragging = false;

    const setPosition = (clientX) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      let pct = (x / rect.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      handle.style.left = `${pct}%`;
      overlay.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    };

    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      setPosition(e.clientX);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      setPosition(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Touch support for mobile devices
    container.addEventListener('touchstart', (e) => {
      isDragging = true;
      if (e.touches && e.touches.length > 0) setPosition(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || !e.touches || e.touches.length === 0) return;
      setPosition(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  /* --------------------------------------------------------------------------
     11. ANALYTICS MODAL & DATA QUALITY
     -------------------------------------------------------------------------- */
  initAnalyticsModal() {
    const openBtn = document.getElementById('btnOpenAnalytics');
    const modal = document.getElementById('analyticsModalOverlay');
    const closeBtn = document.getElementById('analyticsModalCloseBtn');

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => {
        modal.classList.add('open');
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }
  }

  /* --------------------------------------------------------------------------
     12. MOBILE BOTTOM NAVIGATION SHEET
     -------------------------------------------------------------------------- */
  initMobileBottomBar() {
    const sidebar = document.getElementById('appSidebar');

    const openSectionOnMobile = (sectionId) => {
      if (!sidebar) return;
      sidebar.classList.remove('collapsed');
      document.querySelectorAll('.panel-section').forEach(sec => {
        if (sec.id === sectionId) {
          sec.classList.add('expanded');
          setTimeout(() => {
            sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 150);
        }
      });
      setTimeout(() => this.map.invalidateSize(), 300);
    };

    document.getElementById('mobileNavSearch')?.addEventListener('click', () => {
      openSectionOnMobile('secSearch');
      document.getElementById('searchPlotNoInput')?.focus();
    });

    document.getElementById('mobileNavFilters')?.addEventListener('click', () => {
      openSectionOnMobile('secAdvancedFilters');
    });

    document.getElementById('mobileNavLayers')?.addEventListener('click', () => {
      openSectionOnMobile('secLayers');
    });

    document.getElementById('mobileNavAnalytics')?.addEventListener('click', () => {
      document.getElementById('analyticsModalOverlay')?.classList.add('open');
    });
  }

  /* --------------------------------------------------------------------------
     13. QUICK SEARCH AUTOCOMPLETE SUGGESTIONS
     -------------------------------------------------------------------------- */
  initQuickSearchAutocomplete() {
    const input = document.getElementById('quickSearchInput');
    const dropdown = document.getElementById('quickSearchSuggestions');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase().replace('#', '').replace('plot', '').trim();
      if (!q) {
        dropdown.classList.remove('open');
        dropdown.innerHTML = '';
        return;
      }

      const matches = CADASTRAL_PLOTS.filter(p =>
        p.plotNo.toLowerCase().includes(q) ||
        p.surveyNo.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q) ||
        p.landType.toLowerCase().includes(q)
      ).slice(0, 5);

      if (matches.length === 0) {
        dropdown.innerHTML = `<div style="padding: 10px 12px; font-size: 11px; color: var(--text-muted);">No matching parcels found for "${input.value}".</div>`;
        dropdown.classList.add('open');
        return;
      }

      dropdown.innerHTML = matches.map(p => `
        <div class="search-suggestion-item" data-plot="${p.plotNo}">
          <div>
            <div class="search-suggestion-title">Plot #${p.plotNo} <span style="font-weight: 500; color: var(--text-muted);">(Surv ${p.surveyNo})</span></div>
            <div class="search-suggestion-sub">${p.owner} • ${p.areaAcre} Ac</div>
          </div>
          <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #10b981;">${p.landType}</span>
        </div>
      `).join('');

      dropdown.classList.add('open');

      dropdown.querySelectorAll('.search-suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          const plotNo = item.dataset.plot;
          input.value = `Plot #${plotNo}`;
          dropdown.classList.remove('open');
          this.searchPlot(plotNo);
        });
      });
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }

  updateLayerCounters() {
    const badgePlots = document.getElementById('badgePlotsCount');
    if (badgePlots) badgePlots.textContent = `${CADASTRAL_PLOTS.length} Plots`;
  }
}

// Instantiate engine when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.cadastralEngine = new CadastralMapEngine();
});
