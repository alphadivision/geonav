// Mapbox utility helpers — map initialization and layer management

import type { Feature, LineString, Point } from 'geojson';
import type { MapStyle } from '@/types';

export const GEORGIA_CENTER: [number, number] = [43.3569, 42.3154];
export const GEORGIA_BOUNDS: [[number, number], [number, number]] = [
  [39.9760, 41.0542],
  [46.7370, 43.5864],
];

export const MAP_STYLE_DARK = 'mapbox://styles/mapbox/navigation-night-v1';
export const MAP_STYLE_STANDARD = 'mapbox://styles/mapbox/navigation-day-v1';
export const MAP_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-streets-v12';
export const MAP_STYLE_STREETS = 'mapbox://styles/mapbox/streets-v12';

export const MAP_STYLES: Record<MapStyle, string> = {
  dark: MAP_STYLE_DARK,
  standard: MAP_STYLE_STANDARD,
  satellite: MAP_STYLE_SATELLITE,
  streets: MAP_STYLE_STREETS,
};

export const DEFAULT_MAP_STYLE: MapStyle = 'dark';

export const ROUTE_SOURCE_ID = 'geonav-route';
export const ROUTE_LAYER_ID = 'geonav-route-line';
export const ROUTE_CASING_LAYER_ID = 'geonav-route-casing';
export const DESTINATION_SOURCE_ID = 'geonav-destination';
export const USER_SOURCE_ID = 'geonav-user-location';

export function buildRouteGeoJSON(
  geometry: LineString
): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry,
  };
}

export function buildPointGeoJSON(
  coordinates: [number, number]
): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Point',
      coordinates,
    },
  };
}

/**
 * Calculate bearing (degrees 0-360) between two GPS coordinates.
 * Used when GPS heading is unavailable.
 */
export function calculateBearing(
  from: [number, number],
  to: [number, number]
): number {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Distance in meters between two GPS coordinates (Haversine).
 */
export function haversineDistance(
  from: [number, number],
  to: [number, number]
): number {
  const R = 6371000;
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Smooth a heading angle using exponential moving average.
 * alpha: 0 = no change, 1 = instant change
 */
export function smoothHeading(prev: number, next: number, alpha: number): number {
  // Handle wrap-around (e.g. 350 -> 10 should go through 360/0, not 180)
  let diff = next - prev;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (prev + alpha * diff + 360) % 360;
}
