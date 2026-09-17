'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

import type { Language } from '@/lib/i18n';
import type { MapStyle } from '@/types';
import { getStoredLanguage, setStoredLanguage, getTranslations, TRAFFIC_KEY } from '@/lib/i18n';
import { getCurrentPosition } from '@/lib/geolocation';
import { getPerformanceMode, applyPerformanceModeToDocument } from '@/lib/performanceMode';
import type {
  SearchResult,
  RouteInfo,
  RouteAlternative,
  PinDestination,
  UserLocation,
  AppState,
  ErrorType,
  DirectionsResponse,
  TrafficSegment,
  TrafficSpeedCategory,
} from '@/types';
import SearchBar from './SearchBar';
import ZoomControls from './ZoomControls';
import LocationButton from './LocationButton';
import DestinationCard from './DestinationCard';
import ErrorToast from './ErrorToast';
import LoadingOverlay from './LoadingOverlay';
import { getStoredMapStyle, setStoredMapStyle } from './MapStyleSwitcher';

import RouteAlternativesPanel from './RouteAlternativesPanel';
import PinDestinationCard from './PinDestinationCard';
import RecenterButton from './RecenterButton';
import MapControlsPanel from './MapControlsPanel';
import NavigationHUD from './NavigationHUD';
import type { MapCanvasHandle } from './MapCanvas';

declare const google: typeof import('@types/google.maps') extends never
  ? any
  : typeof globalThis extends { google: infer G }
  ? G
  : any;

const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full spinner" />
        <p className="text-muted-foreground text-sm font-medium">TSLMAP</p>
      </div>
    </div>
  ),
});

// Determine road type from route steps
function detectRoadType(route: DirectionsResponse['routes'][0]): RouteAlternative['roadType'] {
  const steps = route.legs?.[0]?.steps ?? [];
  let highwayCount = 0;
  let mainCount = 0;
  let localCount = 0;

  for (const step of steps) {
    const classes = step.intersections?.[0]?.classes ?? [];
    if (classes.includes('motorway') || classes.includes('motorway_link')) {
      highwayCount++;
    } else if (classes.includes('trunk') || classes.includes('primary') || classes.includes('secondary')) {
      mainCount++;
    } else {
      localCount++;
    }
  }

  if (highwayCount > 0 && highwayCount >= mainCount) return 'highway';
  if (mainCount >= localCount) return 'mainRoad';
  return 'localRoad';
}

function buildRouteAlternatives(data: DirectionsResponse): RouteAlternative[] {
  if (!data.routes || data.routes.length === 0) return [];

  // Sort by duration to find fastest
  const sorted = [...data.routes].sort((a, b) => a.duration - b.duration);
  const fastestDuration = sorted[0].duration;

  return data.routes.slice(0, 3).map((route, index) => ({
    index,
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    roadType: detectRoadType(route),
    isFastest: route.duration === fastestDuration,
  }));
}

// Decode Google's encoded polyline format into [lng, lat] coordinate pairs
function decodeEncodedPolyline(encoded: string): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

// Parse Routes API duration string like "165s" to seconds integer
function parseDurSec(durationStr: string): number {
  if (!durationStr) return 0;
  const match = durationStr.match(/^(\d+(?:\.\d+)?)s$/);
  if (match) return Math.round(parseFloat(match[1]));
  return 0;
}

// Converts the Routes API's real `travelAdvisory.speedReadingIntervals` into
// our TrafficSegment[] shape. Per Google's docs the intervals are contiguous
// and cover the whole polyline without overlap, but each interval's start
// index is OPTIONAL and defaults to the previous interval's end (0 for the
// first) — this reconstructs the implied start explicitly so downstream
// rendering never has to guess. Returns undefined (not a fabricated single
// segment) when the API didn't return this data at all.
function buildTrafficSegments(
  intervals: Array<{ startPolylinePointIndex?: number; endPolylinePointIndex: number; speed: TrafficSpeedCategory }> | undefined,
  coordCount: number
): TrafficSegment[] | undefined {
  if (!intervals || intervals.length === 0) return undefined;
  const segments: TrafficSegment[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    const start = interval.startPolylinePointIndex ?? cursor;
    const end = Math.min(interval.endPolylinePointIndex, coordCount - 1);
    if (end > start) {
      segments.push({ startIdx: start, endIdx: end, category: interval.speed });
    }
    cursor = interval.endPolylinePointIndex;
  }
  return segments.length > 0 ? segments : undefined;
}

export default function NavigationMapClient() {
  const [language, setLanguage] = useState<Language>('ka');
  const [appState, setAppState] = useState<AppState>('idle');
  const [selectedDestination, setSelectedDestination] = useState<SearchResult | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternative[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [followMode, setFollowMode] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  // Compass view mode (top-right button): 'headingUp' rotates the map to
  // match the vehicle's heading (only visually rotates on a vector map —
  // see USE_VECTOR_MAP in MapCanvas); 'northUp' keeps the camera fixed at 0.
  const [mapViewMode, setMapViewMode] = useState<'northUp' | 'headingUp'>('headingUp');
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  // Tap-to-navigate state
  const [pinDestination, setPinDestination] = useState<PinDestination | null>(null);
  const [isPinCalculating, setIsPinCalculating] = useState(false);
  const [showReplacePrompt, setShowReplacePrompt] = useState<[number, number] | null>(null);

  const mapRef = useRef<MapCanvasHandle | null>(null);
  // userLocation/mapZoom are updated on every GPS/zoom tick — kept as plain
  // refs (not React state) since nothing in this component's render output
  // depends on their live value, only callbacks that read the latest value
  // on demand. Using useState here would re-render the whole component tree
  // on every GPS fix for no visual benefit.
  const userLocationRef = useRef<UserLocation | null>(null);
  const mapZoomRef = useRef(12);
  const routeAlternativesRef = useRef<RouteAlternative[]>([]);

  // Keep refs in sync
  routeAlternativesRef.current = routeAlternatives;

  // Initialize language, map style, and traffic from localStorage
  useEffect(() => {
    const storedLang = getStoredLanguage();
    setLanguage(storedLang);
    const storedStyle = getStoredMapStyle();
    setMapStyle(storedStyle);
    // Restore traffic preference
    const storedTraffic = localStorage.getItem(TRAFFIC_KEY);
    if (storedTraffic === 'true') setTrafficEnabled(true);

    // Tesla / low-performance mode: sets data-perf-mode on <html> so CSS can
    // drop expensive backdrop-filter blur (see tailwind.css). Runs as early
    // as possible (first effect on mount) so there's no visible "downgrade"
    // flash after the glass panels have already rendered blurred.
    applyPerformanceModeToDocument(getPerformanceMode());
  }, []);

  const t = getTranslations(language);

  const handleLanguageChange = useCallback((lang: Language) => {
    setLanguage(lang);
    setStoredLanguage(lang);
  }, []);

  const handleMapReady = useCallback(() => {
    setIsMapReady(true);
  }, []);

  // MapCanvas's own GPS watcher already tracks the raw fix and drives the
  // arrow marker/camera through its internal interpolation loop — calling
  // setUserMarker() here too would just re-snap that interpolation to the raw
  // position on every single GPS tick (fighting the smoothing) for no
  // benefit, so this only needs to record the latest fix for callbacks that
  // read it on demand (route calculation, off-route recalculation, etc.).
  const handleUserLocationUpdate = useCallback((location: UserLocation) => {
    userLocationRef.current = location;
  }, []);

  const handleLocationError = useCallback(
    (type: 'denied' | 'unavailable') => {
      const msg = type === 'denied' ? t.locationDenied : t.locationUnavailable;
      setErrorType(type === 'denied' ? 'location_denied' : 'location_unavailable');
      setErrorMessage(msg);
    },
    [t]
  );

  // Fetch routes and build alternatives
  // PRIMARY: Call Google Routes API v2 directly from the browser.
  // Browser-restricted API keys work here because the browser sets the real
  // HTTP Referer header automatically — no server-side key needed.
  const fetchRoutes = useCallback(
    async (
      origin: UserLocation,
      destCoords: [number, number]
    ): Promise<RouteAlternative[] | null> => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

      // --- PRIMARY: Direct browser → Routes API call ---
      if (apiKey) {
        try {
          const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
          const requestBody = {
            origin: {
              location: {
                latLng: { latitude: origin.lat, longitude: origin.lng },
              },
            },
            destination: {
              location: {
                latLng: { latitude: destCoords[1], longitude: destCoords[0] },
              },
            },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            computeAlternativeRoutes: true,
            languageCode: 'ka',
            units: 'METRIC',
          };

          console.log('[fetchRoutes] Calling Routes API directly from browser:', requestBody);

          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.travelAdvisory.speedReadingIntervals',
            },
            body: JSON.stringify(requestBody),
          });

          const responseText = await res.text();
          console.log(`[fetchRoutes] Routes API HTTP ${res.status}:`, responseText);

          if (res.ok) {
            const data = JSON.parse(responseText) as {
              routes?: Array<{
                distanceMeters: number;
                duration: string;
                staticDuration?: string;
                polyline: { encodedPolyline: string };
                legs?: Array<{
                  distanceMeters: number;
                  duration: string;
                  steps?: Array<{
                    distanceMeters: number;
                    staticDuration?: string;
                    navigationInstruction?: { instructions: string; maneuver: string };
                    intersections?: Array<{ classes?: string[] }>;
                  }>;
                }>;
                travelAdvisory?: {
                  speedReadingIntervals?: Array<{
                    startPolylinePointIndex?: number;
                    endPolylinePointIndex: number;
                    speed: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';
                  }>;
                };
              }>;
            };

            if (data.routes && data.routes.length > 0) {
              // Decode encoded polyline and build DirectionsResponse shape
              const decoded = data.routes.map((route, idx) => {
                const coords = decodeEncodedPolyline(route.polyline.encodedPolyline);
                const durationSec = parseDurSec(route.duration || route.staticDuration || '0s');
                const leg = route.legs?.[0];
                const steps = (leg?.steps || []).map((step) => ({
                  maneuver: {
                    instruction: step.navigationInstruction?.instructions || '',
                    type: step.navigationInstruction?.maneuver?.toLowerCase() || 'straight',
                  },
                  distance: step.distanceMeters || 0,
                  duration: parseDurSec(step.staticDuration || '0s'),
                  intersections: step.intersections || [{ classes: [] }],
                }));
                const trafficSegments = buildTrafficSegments(route.travelAdvisory?.speedReadingIntervals, coords.length);
                return {
                  index: idx,
                  distance: route.distanceMeters,
                  duration: durationSec,
                  geometry: { type: 'LineString' as const, coordinates: coords },
                  legs: [{
                    distance: leg?.distanceMeters ?? route.distanceMeters,
                    duration: parseDurSec(leg?.duration ?? route.duration ?? '0s'),
                    steps,
                  }],
                  trafficSegments,
                };
              });

              const sorted = [...decoded].sort((a, b) => a.duration - b.duration);
              const fastestDuration = sorted[0].duration;

              const alternatives: RouteAlternative[] = decoded.slice(0, 3).map((route) => ({
                index: route.index,
                distance: route.distance,
                duration: route.duration,
                geometry: route.geometry,
                roadType: detectRoadType(route as DirectionsResponse['routes'][0]),
                isFastest: route.duration === fastestDuration,
                trafficSegments: route.trafficSegments,
              }));

              console.log(`[fetchRoutes] SUCCESS — ${alternatives.length} route(s), first has ${decoded[0].geometry.coordinates.length} coords`);
              return alternatives;
            }
          }

          // If direct call failed, log and fall through to server fallback
          console.warn('[fetchRoutes] Direct Routes API call failed, falling back to server route. Status:', res.status, responseText);
        } catch (directErr) {
          console.warn('[fetchRoutes] Direct call threw error, falling back to server route:', directErr);
        }
      }

      // --- FALLBACK: Server-side /api/directions ---
      console.log('[fetchRoutes] Using server-side /api/directions fallback');
      const params = new URLSearchParams({
        olng: origin.lng.toString(),
        olat: origin.lat.toString(),
        dlng: destCoords[0].toString(),
        dlat: destCoords[1].toString(),
      });

      const res = await fetch(`/api/directions?${params.toString()}`);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server /api/directions HTTP ${res.status}: ${errText}`);
      }

      const data: DirectionsResponse = await res.json();
      if (!data.routes || data.routes.length === 0) throw new Error('No routes returned from server');

      return buildRouteAlternatives(data);
    },
    []
  );

  const handleShowRoute = useCallback(async () => {
    if (!selectedDestination) return;
    const loc = userLocationRef.current;
    if (!loc) {
      setErrorType('location_denied');
      setErrorMessage(t.locationDenied);
      return;
    }

    setAppState('calculatingRoute');

    try {
      const alternatives = await fetchRoutes(loc, selectedDestination.coordinates);
      if (!alternatives || alternatives.length === 0) throw new Error('No routes');

      const fastestIdx = alternatives.find((r) => r.isFastest)?.index ?? 0;
      setRouteAlternatives(alternatives);
      setSelectedRouteIndex(fastestIdx);
      setRouteInfo({
        distance: alternatives[fastestIdx].distance,
        duration: alternatives[fastestIdx].duration,
        geometry: alternatives[fastestIdx].geometry,
      });
      setAppState('routeActive');
      // Show the whole route on the map — the user reviews it and explicitly
      // taps "Start Route" (see handleStartNavigation) before we take over the
      // camera, matching the search → calculate → review → start flow.
      if (mapRef.current) {
        mapRef.current.setAlternativeRoutes(alternatives, fastestIdx);
        mapRef.current.fitRoute(alternatives[fastestIdx].geometry);
      }
    } catch (err) {
      console.error('[route] Error:', err);
      setAppState('destinationSelected');
      setErrorType('route_error');
      setErrorMessage(t.routeError);
    }
  }, [selectedDestination, t, fetchRoutes]);

  // Corner quick-search: selecting a result both sets the destination AND
  // immediately calculates/displays the route (reuses the same fetchRoutes
  // pipeline as handleShowRoute — no second routing system). Uses the result's
  // coordinates directly instead of the (still-stale) selectedDestination
  // state, since state set above hasn't committed yet in this same tick.
  const handleQuickSearchSelect = useCallback(
    async (result: SearchResult) => {
      setSelectedDestination(result);
      setRouteInfo(null);
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setPinDestination(null);
      setShowReplacePrompt(null);

      if (mapRef.current) {
        mapRef.current.setDestinationMarker(result.coordinates);
        mapRef.current.setPinMarker(null);
      }

      const loc = userLocationRef.current;
      if (!loc) {
        setAppState('destinationSelected');
        if (mapRef.current) mapRef.current.flyTo(result.coordinates, 15);
        setErrorType('location_denied');
        setErrorMessage(t.locationDenied);
        return;
      }

      setAppState('calculatingRoute');

      try {
        const alternatives = await fetchRoutes(loc, result.coordinates);
        if (!alternatives || alternatives.length === 0) throw new Error('No routes');

        const fastestIdx = alternatives.find((r) => r.isFastest)?.index ?? 0;
        setRouteAlternatives(alternatives);
        setSelectedRouteIndex(fastestIdx);
        setRouteInfo({
          distance: alternatives[fastestIdx].distance,
          duration: alternatives[fastestIdx].duration,
          geometry: alternatives[fastestIdx].geometry,
        });
        setAppState('routeActive');

        if (mapRef.current) {
          mapRef.current.setAlternativeRoutes(alternatives, fastestIdx);
          mapRef.current.fitRoute(alternatives[fastestIdx].geometry);
        }
      } catch (err) {
        console.error('[quick-search route] Error:', err);
        setAppState('destinationSelected');
        setErrorType('route_error');
        setErrorMessage(t.routeError);
      }
    },
    [fetchRoutes, t]
  );

  const handleSelectRoute = useCallback(
    (index: number) => {
      const alts = routeAlternativesRef.current;
      const route = alts.find((r) => r.index === index);
      if (!route) return;

      setSelectedRouteIndex(index);
      setRouteInfo({
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
      });

      if (mapRef.current) {
        mapRef.current.selectRoute(index, alts);
      }
    },
    []
  );

  const handleClearDestination = useCallback(() => {
    setSelectedDestination(null);
    setRouteInfo(null);
    setRouteAlternatives([]);
    setSelectedRouteIndex(0);
    setAppState('idle');
    setErrorType(null);
    setPinDestination(null);
    setShowReplacePrompt(null);
    setNavigationActive(false);
    setFollowMode(false);
    if (mapRef.current) {
      mapRef.current.setDestinationMarker(null);
      mapRef.current.setPinMarker(null);
      mapRef.current.setRoute(null);
      mapRef.current.setAlternativeRoutes([], 0);
    }
  }, []);

  // Start Route: enters turn-by-turn Navigation Mode on top of the already-
  // calculated route. Reuses the existing follow-camera machinery in
  // MapCanvas (no second tracking/routing system) — navigationMode just tells
  // it to use the closer, forward-biased, tilted nav camera instead of the
  // plain recenter view.
  const handleStartNavigation = useCallback(() => {
    setNavigationActive(true);
    setFollowMode(true);
    if (mapRef.current) mapRef.current.locateUser();
  }, []);

  // Exit Navigation Mode: falls back to the plain route-overview view (route
  // and alternatives stay exactly as calculated — nothing about the route
  // itself changes, only the camera behavior).
  const handleExitNavigation = useCallback(() => {
    setNavigationActive(false);
    setFollowMode(false);
  }, []);

  // Traffic toggle
  const handleTrafficToggle = useCallback(() => {
    setTrafficEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(TRAFFIC_KEY, String(next));
      return next;
    });
  }, []);

  // Tap-to-navigate: handle map tap
  const handleMapTap = useCallback(
    (coords: [number, number]) => {
      // If there's already a destination, offer to replace
      if (selectedDestination || pinDestination) {
        setShowReplacePrompt(coords);
        return;
      }
      // Place pin
      setPinDestination({ coordinates: coords });
      setShowReplacePrompt(null);
      if (mapRef.current) {
        mapRef.current.setPinMarker(coords);
        mapRef.current.flyTo(coords, 15);
      }
    },
    [selectedDestination, pinDestination]
  );

  // Replace destination with new pin
  const handleReplaceWithPin = useCallback(
    (coords: [number, number]) => {
      setSelectedDestination(null);
      setRouteInfo(null);
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setAppState('idle');
      setPinDestination({ coordinates: coords });
      setShowReplacePrompt(null);
      if (mapRef.current) {
        mapRef.current.setDestinationMarker(null);
        mapRef.current.setPinMarker(coords);
        mapRef.current.setRoute(null);
        mapRef.current.setAlternativeRoutes([], 0);
        mapRef.current.flyTo(coords, 15);
      }
    },
    []
  );

  // Navigate to pin
  const handleNavigateToPin = useCallback(async () => {
    if (!pinDestination) return;
    const loc = userLocationRef.current;
    if (!loc) {
      setErrorType('location_denied');
      setErrorMessage(t.locationDenied);
      return;
    }

    setIsPinCalculating(true);

    try {
      const alternatives = await fetchRoutes(loc, pinDestination.coordinates);
      if (!alternatives || alternatives.length === 0) throw new Error('No routes');

      const fastestIdx = alternatives.find((r) => r.isFastest)?.index ?? 0;
      setRouteAlternatives(alternatives);
      setSelectedRouteIndex(fastestIdx);
      setRouteInfo({
        distance: alternatives[fastestIdx].distance,
        duration: alternatives[fastestIdx].duration,
        geometry: alternatives[fastestIdx].geometry,
      });

      const pinResult: SearchResult = {
        id: `pin-${pinDestination.coordinates[0]}-${pinDestination.coordinates[1]}`,
        name: pinDestination.address ?? t.tapDestination,
        address: `${pinDestination.coordinates[1].toFixed(5)}, ${pinDestination.coordinates[0].toFixed(5)}`,
        coordinates: pinDestination.coordinates,
        type: 'pin',
      };
      setSelectedDestination(pinResult);
      setAppState('routeActive');
      setPinDestination(null);

      if (mapRef.current) {
        mapRef.current.setPinMarker(null);
        mapRef.current.setDestinationMarker(pinDestination.coordinates);
        mapRef.current.setAlternativeRoutes(alternatives, fastestIdx);
        mapRef.current.fitRoute(alternatives[fastestIdx].geometry);
      }
    } catch (err) {
      console.error('[pin-route] Error:', err);
      setErrorType('route_error');
      setErrorMessage(t.routeError);
    } finally {
      setIsPinCalculating(false);
    }
  }, [pinDestination, t, fetchRoutes]);

  const handleCancelPin = useCallback(() => {
    setPinDestination(null);
    setShowReplacePrompt(null);
    if (mapRef.current) {
      mapRef.current.setPinMarker(null);
    }
  }, []);

  // Off-route: recalculate
  const handleOffRoute = useCallback(async () => {
    const loc = userLocationRef.current;
    const alts = routeAlternativesRef.current;
    if (!loc || alts.length === 0) return;

    const currentRoute = alts.find((r) => r.index === 0) ?? alts[0];
    const destCoords = currentRoute.geometry.coordinates[
      currentRoute.geometry.coordinates.length - 1
    ] as [number, number];

    try {
      const newAlts = await fetchRoutes(loc, destCoords);
      if (!newAlts || newAlts.length === 0) return;

      const fastestIdx = newAlts.find((r) => r.isFastest)?.index ?? 0;
      setRouteAlternatives(newAlts);
      setSelectedRouteIndex(fastestIdx);
      setRouteInfo({
        distance: newAlts[fastestIdx].distance,
        duration: newAlts[fastestIdx].duration,
        geometry: newAlts[fastestIdx].geometry,
      });

      if (mapRef.current) {
        mapRef.current.setAlternativeRoutes(newAlts, fastestIdx);
      }
    } catch (err) {
      console.error('[off-route] Recalculation failed:', err);
    }
  }, [fetchRoutes]);

  const handleZoomIn = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomIn();
    mapZoomRef.current = Math.min(mapZoomRef.current + 1, 20);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomOut();
    mapZoomRef.current = Math.max(mapZoomRef.current - 1, 1);
  }, []);

  // Zoom level isn't used anywhere in this component's render output — only
  // recorded for callbacks that might want the latest value on demand — so a
  // ref avoids re-rendering the whole tree on every zoom_changed event.
  const handleZoomChange = useCallback((zoom: number) => {
    mapZoomRef.current = zoom;
  }, []);

  // Location button: use the already-tracked watchPosition location immediately,
  // falling back to getCurrentPosition only if no location is known yet.
  const handleLocateMe = useCallback(() => {
    // Primary path: use the location already tracked by watchPosition in MapCanvas.
    // locateUser() reads userLocationRef which is kept up-to-date by the continuous
    // watchPosition watcher — no GPS cold-start, no timeout risk.
    if (mapRef.current) {
      // If we have a known location, center on it right away
      const knownLocation = userLocationRef.current;
      if (knownLocation) {
        mapRef.current.locateUserAt([knownLocation.lng, knownLocation.lat]);
        return;
      }

      // No location yet — try locateUser() which will use whatever MapCanvas has
      mapRef.current.locateUser();
    }

    // Fallback: request a fresh GPS fix only when watchPosition hasn't produced
    // a location yet (e.g. very first app load before any fix arrives).
    if (!navigator.geolocation) {
      console.warn('[GeoNav GPS locate] navigator.geolocation not available');
      return;
    }

    const applyPosition = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy, heading } = position.coords;
      userLocationRef.current = { lat: latitude, lng: longitude, accuracy: accuracy ?? undefined, heading: heading ?? undefined };
      if (mapRef.current) {
        mapRef.current.setUserMarker([longitude, latitude]);
        mapRef.current.locateUserAt([longitude, latitude]);
      }
    };

    // Use low-accuracy first (fast, network-based) to avoid GPS cold-start timeouts
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (err) => {
        console.warn('[GeoNav GPS locate] Fallback getCurrentPosition failed. Code:', err.code, err.message);
        // Last resort: use whatever MapCanvas has
        if (mapRef.current) mapRef.current.locateUser();
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  }, []);

  // Tap the compass: the FIRST press (whenever we're not already following —
  // including the very first tap ever, and any tap after a manual pan
  // disabled follow) always and deterministically activates Heading-Up:
  // resumes follow AND forces the rotating-map mode, regardless of whatever
  // mode was last active. Pressing again while ALREADY following toggles
  // North-Up/Heading-Up — the standard "tap once to recenter, tap again to
  // toggle rotation lock" pattern used by Google Maps/Waze.
  const handleRecenter = useCallback(() => {
    if (followMode) {
      setMapViewMode((mode) => (mode === 'northUp' ? 'headingUp' : 'northUp'));
      return;
    }
    setMapViewMode('headingUp');
    setFollowMode(true);
    if (mapRef.current) mapRef.current.locateUser();
  }, [followMode]);

  const handleDismissError = useCallback(() => {
    setErrorType(null);
    setErrorMessage('');
  }, []);

  // Map style change
  const handleMapStyleChange = useCallback((style: MapStyle) => {
    setMapStyle(style);
    setStoredMapStyle(style);
  }, []);

  // Follow mode disabled by manual drag
  const handleFollowDisabled = useCallback(() => {
    setFollowMode(false);
  }, []);

  const showBottomPanel =
    (appState === 'destinationSelected' || appState === 'calculatingRoute') &&
    selectedDestination &&
    routeAlternatives.length === 0;

  const showRouteAlternatives =
    appState === 'routeActive' && routeAlternatives.length > 0 && selectedDestination && !navigationActive;

  const showNavigationHud =
    navigationActive && appState === 'routeActive' && !!selectedDestination;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background no-select">
      {/* Full-screen map canvas */}
      <div className="map-container">
        <MapCanvas
          ref={mapRef}
          language={language}
          mapStyle={mapStyle}
          trafficEnabled={trafficEnabled}
          onMapReady={handleMapReady}
          onUserLocationUpdate={handleUserLocationUpdate}
          onLocationError={handleLocationError}
          onZoomChange={handleZoomChange}
          followMode={followMode}
          navigationMode={navigationActive}
          mapViewMode={mapViewMode}
          onFollowDisabled={handleFollowDisabled}
          onMapTap={handleMapTap}
          onOffRoute={handleOffRoute}
        />
      </div>

      {/* Top overlay: corner destination search (replaces the old Support badge) + compass. Kept minimal — no large search bar. */}
      <div className="fixed top-0 left-0 right-0 z-panel pointer-events-none">
        <div className="flex items-start justify-between gap-3 p-3 sm:p-4 pointer-events-auto" data-no-map-tap>
          <div className="flex-shrink-0">
            <SearchBar
              language={language}
              t={t}
              onSelectResult={handleQuickSearchSelect}
              disabled={!isMapReady}
              compact
            />
          </div>
          <div className="flex-shrink-0">
            <RecenterButton
              onRecenter={handleRecenter}
              t={t}
              followMode={followMode}
              mapViewMode={mapViewMode}
            />
          </div>
        </div>
      </div>

      {/* Bottom-right: persistent map controls — Settings, Zoom, Locate.
          Always rendered regardless of route/navigation state (never gated
          behind hideBottomLeftChrome-style conditions), matching Zoom/Locate. */}
      <div
        className="fixed right-3 sm:right-4 bottom-4 z-panel flex items-center gap-2"
        data-no-map-tap
      >
        <MapControlsPanel
          language={language}
          onLanguageChange={handleLanguageChange}
          currentStyle={mapStyle}
          onStyleChange={handleMapStyleChange}
          trafficEnabled={trafficEnabled}
          onTrafficToggle={handleTrafficToggle}
          t={t}
        />
        <ZoomControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          t={t}
        />
        <LocationButton
          onLocate={handleLocateMe}
          t={t}
          followMode={followMode}
        />
      </div>

      {/* Replace destination prompt */}
      {showReplacePrompt && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 z-panel bottom-sheet-enter"
          style={{ width: 'min(420px, calc(100vw - 80px))' }}
          data-no-map-tap
        >
          <div
            className="glass-panel mx-3 mb-3 rounded-2xl shadow-2xl shadow-black/70 px-4 py-4"
          >
            <p className="text-sm font-semibold text-white mb-3 text-center">
              {t.replaceDestination}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReplacePrompt(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-muted-foreground bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all"
              >
                {t.cancelPin}
              </button>
              <button
                onClick={() => handleReplaceWithPin(showReplacePrompt)}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30 active:scale-[0.98] transition-all"
              >
                {t.navigateHere}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin destination card */}
      {pinDestination && !showReplacePrompt && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 z-panel bottom-sheet-enter"
          style={{ width: 'min(420px, calc(100vw - 80px))' }}
          data-no-map-tap
        >
          <PinDestinationCard
            pin={pinDestination}
            t={t}
            onNavigate={handleNavigateToPin}
            onCancel={handleCancelPin}
            isCalculating={isPinCalculating}
          />
        </div>
      )}

      {/* Bottom destination / route panel (search-selected destination, pre-route) */}
      {showBottomPanel && (
        <div
          className="fixed bottom-0 left-0 z-panel bottom-sheet-enter"
          style={{ maxWidth: 'min(420px, calc(100vw - 80px))' }}
          data-no-map-tap
        >
          <DestinationCard
            destination={selectedDestination!}
            routeInfo={routeInfo}
            appState={appState}
            language={language}
            t={t}
            onShowRoute={handleShowRoute}
            onClear={handleClearDestination}
          />
        </div>
      )}

      {/* Route alternatives panel */}
      {showRouteAlternatives && (
        <div
          className="fixed bottom-0 left-0 z-panel bottom-sheet-enter"
          style={{ maxWidth: 'min(420px, calc(100vw - 80px))' }}
          data-no-map-tap
        >
          <RouteAlternativesPanel
            routes={routeAlternatives}
            selectedIndex={selectedRouteIndex}
            language={language}
            t={t}
            onSelectRoute={handleSelectRoute}
            onClear={handleClearDestination}
            onStartNavigation={handleStartNavigation}
            destinationName={selectedDestination!.name}
          />
        </div>
      )}

      {/* Navigation Mode HUD — small, always visible, never covers the map */}
      {showNavigationHud && (
        <div
          className="fixed left-3 sm:left-4 bottom-4 z-panel"
          style={{ maxWidth: 'min(360px, calc(100vw - 32px))' }}
          data-no-map-tap
        >
          <NavigationHUD
            destinationName={selectedDestination!.name}
            routeInfo={routeInfo}
            language={language}
            t={t}
            onExit={handleExitNavigation}
          />
        </div>
      )}

      {/* Error toast */}
      {errorType && (
        <ErrorToast
          type={errorType}
          message={errorMessage}
          onDismiss={handleDismissError}
        />
      )}

      {/* Loading overlay */}
      {!isMapReady && <LoadingOverlay t={t} />}
    </div>
  );
}