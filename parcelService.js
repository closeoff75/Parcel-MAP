/**
 * ParcelMap Cadastral Parcel Service
 * Centralized service abstraction for parcel searching and retrieval.
 * Connects UI components to backend REST API with fallback to local cadastral dataset.
 */

import { CADASTRAL_PLOTS } from './map-data.js';

export class ParcelService {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.localPlots = Array.isArray(CADASTRAL_PLOTS) ? CADASTRAL_PLOTS : [];
  }

  /**
   * Search parcels by query string (parcel number, survey number, village, etc.)
   * @param {string} query 
   * @param {object} options 
   * @returns {Promise<Array<object>>}
   */
  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const cleanQ = query.trim();
    const limit = options.limit || 12;

    try {
      const resp = await fetch(`${this.baseUrl}/api/parcels/search?q=${encodeURIComponent(cleanQ)}&limit=${limit}`, {
        signal: options.signal
      });

      if (!resp.ok) {
        throw new Error(`API responded with HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const rawResults = data.results || data.parcels || [];

      if (rawResults.length > 0) {
        return rawResults.map(p => this.normalizeToActiveParcel(p, { mode: 'search' }));
      }

      // If backend returned empty, check local dataset
      return this.searchLocal(cleanQ, options);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('[ParcelService] API search failed, falling back to local cadastre repository:', err.message);
      return this.searchLocal(cleanQ, options);
    }
  }

  /**
   * Get parcel by unique identifier (ID or parcel number)
   * @param {string} id 
   * @param {object} options 
   * @returns {Promise<object|null>}
   */
  async getById(id, options = {}) {
    if (!id) return null;

    const cleanId = String(id).trim();

    try {
      const resp = await fetch(`${this.baseUrl}/api/parcels/${encodeURIComponent(cleanId)}`, {
        signal: options.signal
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.parcel) {
          return this.normalizeToActiveParcel(data.parcel, { mode: 'search' });
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('[ParcelService] API getById failed, checking local repository:', err.message);
    }

    return this.getByIdLocal(cleanId);
  }

  /**
   * Standardizes any raw backend or cadastral object into the single activeParcel specification
   * @param {object} raw
   * @param {object} context
   * @returns {object}
   */
  normalizeToActiveParcel(raw, context = {}) {
    if (!raw) return null;

    const rawPNum = raw.parcelNumber || (raw.parcel_id ? String(raw.parcel_id).replace(/^Plot\s*#/i, '').replace(/^Parcel\s*#/i, '') : raw.id);
    const pNum = rawPNum ? String(rawPNum).trim() : 'Not available';

    const rawSNum = raw.surveyNumber || (raw.survey_no ? String(raw.survey_no).replace(/^Survey\s*/i, '') : null);
    const sNum = rawSNum ? String(rawSNum).trim() : 'Not available';

    const village = raw.village || raw.location || 'Cadastral Block';
    const district = raw.district || 'Survey Directorate';
    const state = raw.state || 'Survey Division';

    // Latitude & Longitude normalization (Pune ~18.58, 73.98)
    let lat = raw.latitude != null ? Number(raw.latitude) : (raw.coordinates ? Number(raw.coordinates[0]) : null);
    let lng = raw.longitude != null ? Number(raw.longitude) : (raw.coordinates ? Number(raw.coordinates[1]) : null);

    if (lat != null && lng != null) {
      if (lat > 60 && lng < 30) {
        const tmp = lat; lat = lng; lng = tmp;
      }
    }

    // Geometry normalization
    let boundary = raw.boundary;
    let geometry = raw.geometry;

    if (!boundary && geometry) {
      if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
        boundary = geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
      } else if (Array.isArray(geometry)) {
        boundary = geometry;
      }
    }

    // If still no boundary, check if local dataset has coordinates for this plot number
    if ((!boundary || boundary.length < 3) && pNum && pNum !== 'Not available') {
      const cleanUpper = pNum.toUpperCase();
      const match = this.localPlots.find(p => String(p.plotNo).toUpperCase() === cleanUpper);
      if (match && Array.isArray(match.coordinates) && match.coordinates.length >= 3) {
        boundary = match.coordinates;
      }
    }

    if (boundary && Array.isArray(boundary)) {
      boundary = boundary.map(pt => (pt[0] > 60 && pt[1] < 30) ? [pt[1], pt[0]] : pt);
      if (!geometry) {
        // Construct standard GeoJSON Polygon [lng, lat]
        const ring = boundary.map(pt => [pt[1], pt[0]]);
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        geometry = {
          type: 'Polygon',
          coordinates: [ring]
        };
      }
    }

    const area = raw.area || (raw.area_acres ? `${raw.area_acres} acres` : (raw.areaAcre ? `${raw.areaAcre} acres` : 'Not available'));
    const landUse = raw.landUse || raw.landType || raw.land_type || 'Agricultural';
    const status = raw.status || raw.candidate_status || 'Active';
    const confidence = raw.confidence ? (typeof raw.confidence === 'number' ? `${Math.round(raw.confidence * 100)}%` : String(raw.confidence)) : '95%';
    
    const mode = context.mode || (raw.is_demo ? 'demo' : 'search');
    const isDemo = Boolean(raw.is_demo || raw.isDemo);
    const source = mode === 'search' ? 'Parcel Search Result' : (isDemo ? 'Demo Dataset' : 'Verified Cadastral Record');

    return {
      id: raw.id ? String(raw.id) : `parcel-${pNum}`,
      parcelNumber: pNum,
      surveyNumber: sNum,
      village: village,
      district: district,
      state: state,
      latitude: lat,
      longitude: lng,
      geometry: geometry || null,
      boundary: boundary || null,
      area: area,
      landUse: landUse,
      landType: landUse,
      status: status,
      confidence: confidence,
      source: source,
      isDemo: isDemo,
      mode: mode,
      owner: raw.owner || 'Not available',
      map_url: raw.map_url || null,
      project_id: raw.project_id || null
    };
  }

  /**
   * Search local cadastral dataset
   * @param {string} query 
   * @param {object} options 
   * @returns {Array<object>}
   */
  searchLocal(query, options = {}) {
    const q = query.trim().toLowerCase();
    const cleanQ = q
      .replace(/^parcel\s*#?/i, '')
      .replace(/^plot\s*#?/i, '')
      .replace(/^survey\s*#?/i, '')
      .trim();

    const matches = [];

    for (const plot of this.localPlots) {
      const pNo = String(plot.plotNo || '').toLowerCase();
      const sNo = String(plot.surveyNo || '').toLowerCase();
      const owner = String(plot.owner || '').toLowerCase();
      const village = String(plot.village || '').toLowerCase();

      const isExactPlot = pNo === cleanQ;
      const isExactSurv = sNo === cleanQ || sNo === q;

      const isMatch = isExactPlot ||
        isExactSurv ||
        pNo.includes(cleanQ) ||
        sNo.includes(cleanQ) ||
        sNo.replace(/\//g, '').includes(cleanQ) ||
        owner.includes(q) ||
        village.includes(q);

      if (isMatch) {
        let lat = 18.5818, lng = 73.9795;
        if (Array.isArray(plot.coordinates) && plot.coordinates.length > 0) {
          let sumLat = 0, sumLng = 0;
          plot.coordinates.forEach(pt => {
            sumLat += pt[0];
            sumLng += pt[1];
          });
          lat = +(sumLat / plot.coordinates.length).toFixed(5);
          lng = +(sumLng / plot.coordinates.length).toFixed(5);
        }

        matches.push(this.normalizeToActiveParcel({
          ...plot,
          id: plot.id || `plot-${plot.plotNo}`,
          parcelNumber: plot.plotNo,
          surveyNumber: plot.surveyNo,
          latitude: lat,
          longitude: lng,
          boundary: plot.coordinates,
          is_demo: false // Search result mode overrides demo
        }, { mode: 'search' }));
      }
    }

    return matches.slice(0, options.limit || 12);
  }

  /**
   * Get parcel from local dataset by ID or plot number
   * @param {string} id 
   * @returns {object|null}
   */
  getByIdLocal(id) {
    const cleanId = String(id).toLowerCase().replace(/^plot-?/i, '').replace(/^parcel-?/i, '').trim();

    const plot = this.localPlots.find(p => {
      const pId = String(p.id || '').toLowerCase();
      const pNo = String(p.plotNo || '').toLowerCase();
      return pId === cleanId || pNo === cleanId;
    });

    if (!plot) return null;

    let lat = 18.5818, lng = 73.9795;
    if (Array.isArray(plot.coordinates) && plot.coordinates.length > 0) {
      let sumLat = 0, sumLng = 0;
      plot.coordinates.forEach(pt => {
        sumLat += pt[0];
        sumLng += pt[1];
      });
      lat = +(sumLat / plot.coordinates.length).toFixed(5);
      lng = +(sumLng / plot.coordinates.length).toFixed(5);
    }

    return this.normalizeToActiveParcel({
      ...plot,
      id: plot.id || `plot-${plot.plotNo}`,
      parcelNumber: plot.plotNo,
      surveyNumber: plot.surveyNo,
      latitude: lat,
      longitude: lng,
      boundary: plot.coordinates,
      is_demo: false
    }, { mode: 'search' });
  }
}

// Global service instance
export const parcelService = new ParcelService();
if (typeof window !== 'undefined') {
  window.parcelService = parcelService;
}
