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
  }>;
  waypoints: Array<{
    name: string;
    location: [number, number];
  }>;
  code: string;
  message?: string;
}