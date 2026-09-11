/**
 * ParcelMap Centralized Map Configuration
 * Standardized basemap providers, default world view, geocoding endpoints, and attributions.
 */

export const MAP_CONFIG = {
  // Global World View: Shows the world elegantly without distortion or empty margins
  worldView: {
    center: [20.0, 0.0],
    zoom: 2.8,
    minZoom: 2,
    maxZoom: 19
  },

  // Basemap Tile Providers
  basemaps: {
    light: {
      id: 'light',
      name: 'Clean Light',
      description: 'Minimalist high-contrast vector raster basemap by CARTO',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      options: {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
      }
    },
    satellite: {
      id: 'satellite',
      name: 'Satellite',
      description: 'Global high-definition aerial and satellite imagery',
      // High-resolution Esri World Imagery (global, sharp, no API key required for public viewing)
      // If a custom tokenized satellite provider is configured via env, it can be substituted
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS User Community'
      }
    },
    terrain: {
      id: 'terrain',
      name: 'Terrain',
      description: 'Topographic contour and elevation shading map',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey'
      }
    },
    dark: {
      id: 'dark',
      name: 'Dark Canvas',
      description: 'Sleek dark theme basemap optimized for GIS overlays',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      options: {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
      }
    },
    osm: {
      id: 'osm',
      name: 'OpenStreetMap',
      description: 'Standard community-curated OpenStreetMap cartography',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    }
  },

  // Geocoding Configuration (OpenStreetMap Nominatim)
  geocoder: {
    endpoint: 'https://nominatim.openstreetmap.org/search',
    debounceMs: 350,
    limit: 5,
    format: 'json',
    addressdetails: 1
  },

  // Environment Token Configuration
  env: {
    satelliteToken: typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAP_SATELLITE_TOKEN ? import.meta.env.VITE_MAP_SATELLITE_TOKEN : null,
    mapboxToken: typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN ? import.meta.env.VITE_MAPBOX_TOKEN : null
  }
};
