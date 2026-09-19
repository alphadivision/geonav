export interface SearchResult {
  id: string;
  name: string;
  address: string;
  coordinates: [number, number]; // [lng, lat]
  type: string;
  category?: string;
}

export interface RouteInfo {
  distance: number; // meters
  duration: number; // seconds
  geometry: {
    type: string;
    coordinates: Array<[number, number]>;
  };
}

export type TrafficSpeedCategory = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

// A contiguous run of the route's coordinate array sharing one traffic
// condition, as reported by the Routes API's per-route
// `travelAdvisory.speedReadingIntervals` (real, segment-level traffic data —
// see NavigationMapClient's fetchRoutes). startIdx/endIdx are inclusive
// indices into RouteAlternative.geometry.coordinates, and adjacent segments
// share their boundary point so the route can be rendered as multiple
// colored polylines with no visual gap between them.
export interface TrafficSegment {
  startIdx: number;
  endIdx: number;
  category: TrafficSpeedCategory;
}

export interface RouteAlternative {
  index: number;
  distance: number; // meters
  duration: number; // seconds
  geometry: {
    type: string;
    coordinates: Array<[number, number]>;
  };
  roadType: 'highway' | 'mainRoad' | 'localRoad';
  isFastest: boolean;
  // Only populated when the Routes API returns real segment-level traffic
  // data for this route. Absent (not faked) when unavailable, e.g. from the
  // legacy server-side /api/directions fallback.
  trafficSegments?: TrafficSegment[];
}

// A single EV charging station returned by /api/charging-stations (a thin
// proxy over Google Places API (New) Nearby Search). Only fetched while the
// Chargers toggle is on — see MapCanvas's charger marker logic.
export interface ChargingStation {
  id: string;
  name: string;
  address?: string;
  coordinates: [number, number]; // [lng, lat]
  isTeslaSupercharger: boolean;
  connectorCount?: number;
  rating?: number;
  openNow?: boolean;
}

export interface PinDestination {
  coordinates: [number, number]; // [lng, lat]
  address?: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  heading?: number | null;
}

export type MapStyle = 'dark' | 'standard' | 'satellite' | 'streets';

export type AppState =
  | 'idle' | 'searching' | 'destinationSelected' | 'calculatingRoute' | 'routeActive' | 'error';

export type ErrorType =
  | 'location_denied' | 'location_unavailable' | 'search_error' | 'route_error' | 'network_error' | 'map_error'
  | null;

export interface GeocodingFeature {
  id: string;
  type: string;
  place_name: string;
  place_name_ka?: string;
  text: string;
  text_ka?: string;
  properties: {
    category?: string;
    maki?: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  context?: Array<{
    id: string;
    text: string;
    text_ka?: string;
  }>;
}

export interface DirectionsResponse {
  routes: Array<{
    distance: number;
    duration: number;
    geometry: {
      type: string;
      coordinates: Array<[number, number]>;
    };
    legs: Array<{
      distance: number;
      duration: number;
      steps: Array<{
        maneuver: {
          instruction: string;
          type: string;
        };
        distance: number;
        duration: number;
        intersections?: Array<{
          classes?: string[];
        }>;
      }>;
    }>;
    // Only populated when the Routes API returned real segment-level traffic
    // data for this route (see buildTrafficSegments in src/lib/traffic.ts).
    trafficSegments?: TrafficSegment[];
  }>;
  waypoints: Array<{
    name: string;
    location: [number, number];
  }>;
  code: string;
  message?: string;
}