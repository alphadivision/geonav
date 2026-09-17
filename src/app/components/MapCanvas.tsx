'use client';

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import type { UserLocation, MapStyle, RouteAlternative } from '@/types';
import type { Language } from '@/lib/i18n';
import {
  GEORGIA_CENTER,
  calculateBearing,
  haversineDistance,
  smoothHeading,
} from '@/lib/mapbox';
import { watchPosition, clearWatch } from '@/lib/geolocation';

/// <reference types="@types/google.maps" />
declare const google: typeof globalThis.google;

const MIN_MOVEMENT_FOR_BEARING = 3;
const HEADING_SMOOTH_ALPHA = 0.3;
const CAMERA_BEARING_ALPHA = 0.15;
const MIN_CAMERA_MOVE = 2;
const NAV_ZOOM = 16;
// NAV_FOLLOW_DURATION and NAV_RECENTER_DURATION reserved for future animation tuning

const OFF_ROUTE_THRESHOLD = 80;
const OFF_ROUTE_CHECK_INTERVAL = 5000;

// Google Maps map type IDs mapped to our MapStyle keys
const GOOGLE_MAP_TYPE: Record<MapStyle, string> = {
  dark: 'roadmap',
  standard: 'roadmap',
  satellite: 'hybrid',
  streets: 'roadmap',
};

// Dark mode styles for Google Maps — near-black, monochrome, minimal (matches TeslaNav brand style)
const DARK_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#232323' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0c0c0c' }] },
  // Hide POI icons/labels entirely — keeps the map clean and uncluttered
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#242424' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#383838' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8c8c8c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#202020' }] },
  // Hide transit lines/station icons — not useful for driving navigation and adds clutter
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a3a' }] },
];

const STANDARD_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [];

const STREETS_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
];

const MAP_STYLES_CONFIG: Record<MapStyle, Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }>> = {
  dark: DARK_STYLES,
  standard: STANDARD_STYLES,
  satellite: [],
  streets: STREETS_STYLES,
};

const ARROW_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="18" fill="#1a73e8" fill-opacity="0.22" stroke="#1a73e8" stroke-width="1.5" stroke-opacity="0.5"/>
  <polygon points="20,4 28,30 20,24 12,30" fill="#e53935" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="20" cy="24" r="4" fill="#ffffff" stroke="#e53935" stroke-width="2"/>
</svg>
`;

function smoothPosition(
  prev: [number, number] | null,
  next: [number, number],
  alpha: number
): [number, number] {
  if (!prev) return next;
  return [
    prev[0] + alpha * (next[0] - prev[0]),
    prev[1] + alpha * (next[1] - prev[1]),
  ];
}

function distanceToRoute(
  point: [number, number],
  routeCoords: Array<[number, number]>
): number {
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const d = pointToSegmentDistance(point, routeCoords[i], routeCoords[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function pointToSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return haversineDistance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
  return haversineDistance(p, proj);
}

interface MapCanvasProps {
  language: Language;
  mapStyle: MapStyle;
  trafficEnabled: boolean;
  onMapReady: () => void;
  onUserLocationUpdate: (location: UserLocation) => void;
  onLocationError: (type: 'denied' | 'unavailable') => void;
  onZoomChange: (zoom: number) => void;
  followMode: boolean;
  onFollowDisabled: () => void;
  onMapTap?: (coords: [number, number]) => void;
  onOffRoute?: () => void;
}

export interface MapCanvasHandle {
  flyTo: (coords: [number, number], zoom?: number) => void;
  fitRoute: (geometry: { type: string; coordinates: Array<[number, number]> }) => void;
  setRoute: (geometry: { type: string; coordinates: Array<[number, number]> } | null) => void;
  setAlternativeRoutes: (routes: RouteAlternative[], selectedIndex: number) => void;
  selectRoute: (index: number, routes: RouteAlternative[]) => void;
  setDestinationMarker: (coords: [number, number] | null) => void;
  setPinMarker: (coords: [number, number] | null) => void;
  setUserMarker: (coords: [number, number] | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  locateUser: () => void;
  locateUserAt: (coords: [number, number]) => void;
  setMapStyle: (style: MapStyle) => void;
}

const MAX_ALT_ROUTES = 3;

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  (
    {
      language,
      mapStyle,
      trafficEnabled,
      onMapReady,
      onUserLocationUpdate,
      onLocationError,
      onZoomChange,
      followMode,
      onFollowDisabled,
      onMapTap,
      onOffRoute,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const watchIdRef = useRef<number>(-1);
    const isMapReadyRef = useRef(false);

    // Markers
    const destinationMarkerRef = useRef<google.maps.Marker | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const pinMarkerRef = useRef<google.maps.Marker | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const userMarkerRef = useRef<google.maps.Marker | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const userArrowMarkerRef = useRef<google.maps.Marker | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const accuracyCircleRef = useRef<google.maps.Circle | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Route polylines
    const mainRoutePolylineRef = useRef<google.maps.Polyline | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const mainRouteCasingRef = useRef<google.maps.Polyline | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const altRoutePolylinesRef = useRef<Array<{ casing: google.maps.Polyline; line: google.maps.Polyline }>>([]); // eslint-disable-line @typescript-eslint/no-explicit-any

    // State refs
    const userLocationRef = useRef<[number, number] | null>(null);
    const smoothedPositionRef = useRef<[number, number] | null>(null);
    const hasInitialLocationRef = useRef(false);
    const currentHeadingRef = useRef<number>(0);
    const cameraHeadingRef = useRef<number>(0);
    const prevPositionRef = useRef<[number, number] | null>(null);
    const currentStyleRef = useRef<MapStyle>(mapStyle);
    const followModeRef = useRef(followMode);
    const onFollowDisabledRef = useRef(onFollowDisabled);
    const trafficEnabledRef = useRef(trafficEnabled);
    const onMapTapRef = useRef(onMapTap);
    const onOffRouteRef = useRef(onOffRoute);
    const activeRouteGeometryRef = useRef<Array<[number, number]> | null>(null);
    const lastOffRouteCheckRef = useRef<number>(0);
    const isDraggingRef = useRef(false);
    const isZoomingRef = useRef(false);
    const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cameraRafRef = useRef<number | null>(null);
    const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

    // Keep refs in sync with props
    followModeRef.current = followMode;
    onFollowDisabledRef.current = onFollowDisabled;
    trafficEnabledRef.current = trafficEnabled;
    onMapTapRef.current = onMapTap;
    onOffRouteRef.current = onOffRoute;

    const applyTrafficVisibility = useCallback((enabled: boolean) => {
      let map = mapRef.current;
      if (!map) return;
      if (enabled) {
        if (!trafficLayerRef.current) {
          trafficLayerRef.current = new google.maps.TrafficLayer();
        }
        trafficLayerRef.current.setMap(map);
      } else {
        if (trafficLayerRef.current) {
          trafficLayerRef.current.setMap(null);
        }
      }
    }, []);

    const applyMapStyleToMap = useCallback((style: MapStyle) => {
      let map = mapRef.current;
      if (!map) return;
      map.setMapTypeId(GOOGLE_MAP_TYPE[style]);
      if (style !== 'satellite') {
        map.setOptions({ styles: MAP_STYLES_CONFIG[style] });
      } else {
        map.setOptions({ styles: [] });
      }
      currentStyleRef.current = style;
    }, []);

    const updateArrowMarker = useCallback((coords: [number, number], heading: number) => {
      let map = mapRef.current;
      if (!map || !isMapReadyRef.current) return;
      const position = { lat: coords[1], lng: coords[0] };

      if (!userArrowMarkerRef.current) {
        userArrowMarkerRef.current = new google.maps.Marker({
          map,
          position,
          zIndex: 10,
          optimized: false,
        });
      } else {
        userArrowMarkerRef.current.setPosition(position);
      }

      const blob = new Blob([ARROW_SVG], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      userArrowMarkerRef.current.setIcon({
        url,
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 20),
        rotation: heading,
      } as google.maps.Icon & { rotation: number });
    }, []);

    const applyFollowMode = useCallback((coords: [number, number], bearing: number) => {
      let map = mapRef.current;
      if (!map || !followModeRef.current) return;

      if (cameraRafRef.current !== null) {
        cancelAnimationFrame(cameraRafRef.current);
      }

      cameraRafRef.current = requestAnimationFrame(() => {
        cameraRafRef.current = null;
        const m = mapRef.current;
        if (!m || !followModeRef.current) return;

        m.moveCamera({
          center: { lat: coords[1], lng: coords[0] },
          heading: bearing,
          zoom: NAV_ZOOM,
          tilt: 0,
        });
      });
    }, []);

    useEffect(() => {
      if (isMapReadyRef.current) {
        applyMapStyleToMap(mapStyle);
      }
    }, [mapStyle, applyMapStyleToMap]);

    useEffect(() => {
      if (isMapReadyRef.current) {
        applyTrafficVisibility(trafficEnabled);
      }
    }, [trafficEnabled, applyTrafficVisibility]);

    useEffect(() => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

      if (!containerRef.current || !apiKey) {
        console.error('[TSLMAP] Google Maps API key is not available. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.');
        onMapReady();
        return;
      }

      setOptions({
        key: apiKey,
        version: 'weekly',
        libraries: ['places', 'geometry'],
      });

      let map: google.maps.Map;
      let cleanedUp = false;

      Promise.all([
        importLibrary('maps'),
        importLibrary('places'),
        importLibrary('geometry'),
      ]).then(([mapsLib]) => {
        if (cleanedUp || !containerRef.current) return;

        const { Map } = mapsLib as google.maps.MapsLibrary;

        map = new Map(containerRef.current, {
          center: { lat: GEORGIA_CENTER[1], lng: GEORGIA_CENTER[0] },
          zoom: 7,
          minZoom: 3,
          maxZoom: 20,
          mapTypeId: GOOGLE_MAP_TYPE[mapStyle],
          styles: MAP_STYLES_CONFIG[mapStyle],
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          scaleControl: false,
          rotateControl: false,
        });

        mapRef.current = map;
        currentStyleRef.current = mapStyle;

        // Initialize route polylines
        mainRouteCasingRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: '#0d47a1',
          strokeWeight: 12,
          strokeOpacity: 0.9,
          zIndex: 1,
        });
        mainRoutePolylineRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: '#1a73e8',
          strokeWeight: 7,
          strokeOpacity: 1,
          zIndex: 2,
        });

        // Initialize alt route polylines
        for (let i = 0; i < MAX_ALT_ROUTES; i++) {
          const casing = new google.maps.Polyline({
            map,
            path: [],
            strokeColor: '#37474f',
            strokeWeight: 10,
            strokeOpacity: 0.7,
            zIndex: 0,
          });
          const line = new google.maps.Polyline({
            map,
            path: [],
            strokeColor: '#607d8b',
            strokeWeight: 5,
            strokeOpacity: 0.85,
            zIndex: 0,
          });
          altRoutePolylinesRef.current.push({ casing, line });
        }

        // Apply traffic if enabled
        if (trafficEnabledRef.current) {
          applyTrafficVisibility(true);
        }

        map.addListener('zoom_changed', () => {
          onZoomChange(Math.round(map.getZoom() ?? 12));
        });

        // Zoom tracking
        map.addListener('zoom_changed', () => {
          isZoomingRef.current = true;
          if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = setTimeout(() => {
            isZoomingRef.current = false;
          }, 300);
        });

        // Drag detection — disable follow mode on manual pan
        map.addListener('dragstart', () => {
          if (!isZoomingRef.current) {
            isDraggingRef.current = true;
            if (followModeRef.current) {
              onFollowDisabledRef.current();
            }
          }
        });

        map.addListener('dragend', () => {
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 100);
        });

        // Tap-to-navigate
        map.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
          if (e.domEvent) {
            const domE = e.domEvent as MouseEvent | TouchEvent;
            const pos = 'touches' in domE
              ? { x: (domE as TouchEvent).touches[0].clientX, y: (domE as TouchEvent).touches[0].clientY }
              : { x: (domE as MouseEvent).clientX, y: (domE as MouseEvent).clientY };
            dragStartPosRef.current = pos;
          }
        });

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!onMapTapRef.current || !e.latLng) return;
          if (isDraggingRef.current) return;

          const domE = e.domEvent as MouseEvent | undefined;
          if (domE) {
            const target = domE.target as HTMLElement;
            if (target && target.closest('[data-no-map-tap]')) return;

            const start = dragStartPosRef.current;
            if (start) {
              const dx = Math.abs(domE.clientX - start.x);
              const dy = Math.abs(domE.clientY - start.y);
              if (dx > 8 || dy > 8) return;
            }
          }

          const coords: [number, number] = [e.latLng.lng(), e.latLng.lat()];
          onMapTapRef.current(coords);
        });

        isMapReadyRef.current = true;
        onMapReady();

        // Watch user location
        watchIdRef.current = watchPosition(
          (location) => {
            onUserLocationUpdate(location);
            const rawCoords: [number, number] = [location.lng, location.lat];
            const prev = userLocationRef.current;

            const moveDist = prev ? haversineDistance(prev, rawCoords) : Infinity;
            const isSignificantMove = moveDist >= MIN_CAMERA_MOVE;

            userLocationRef.current = rawCoords;

            if (!map || !isMapReadyRef.current) return;

            // Update user dot marker
            const position = { lat: rawCoords[1], lng: rawCoords[0] };
            if (!userMarkerRef.current) {
              userMarkerRef.current = new google.maps.Marker({
                map,
                position,
                zIndex: 8,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: '#1a73e8',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2.5,
                },
              });
            } else {
              userMarkerRef.current.setPosition(position);
            }

            // Update accuracy circle
            if (!accuracyCircleRef.current) {
              accuracyCircleRef.current = new google.maps.Circle({
                map,
                center: position,
                radius: Math.max(location.accuracy, 20),
                fillColor: '#1a73e8',
                fillOpacity: 0.15,
                strokeColor: '#1a73e8',
                strokeOpacity: 0.4,
                strokeWeight: 1,
                zIndex: 7,
              });
            } else {
              accuracyCircleRef.current.setCenter(position);
              accuracyCircleRef.current.setRadius(Math.max(location.accuracy, 20));
            }

            // Heading calculation
            let newHeading: number | null = null;
            if (location.heading != null && !isNaN(location.heading) && location.heading >= 0) {
              newHeading = location.heading;
            }
            if (newHeading === null && prev !== null) {
              const dist = haversineDistance(prev, rawCoords);
              if (dist >= MIN_MOVEMENT_FOR_BEARING) {
                newHeading = calculateBearing(prev, rawCoords);
              }
            }

            if (newHeading !== null) {
              currentHeadingRef.current = smoothHeading(currentHeadingRef.current, newHeading, HEADING_SMOOTH_ALPHA);
              cameraHeadingRef.current = smoothHeading(cameraHeadingRef.current, newHeading, CAMERA_BEARING_ALPHA);
            }

            updateArrowMarker(rawCoords, currentHeadingRef.current);

            if (isSignificantMove) {
              smoothedPositionRef.current = smoothPosition(smoothedPositionRef.current, rawCoords, 0.4);
            }

            const cameraCoords = smoothedPositionRef.current ?? rawCoords;

            // Off-route detection
            if (activeRouteGeometryRef.current && activeRouteGeometryRef.current.length > 0) {
              const now = Date.now();
              if (now - lastOffRouteCheckRef.current > OFF_ROUTE_CHECK_INTERVAL) {
                lastOffRouteCheckRef.current = now;
                const dist = distanceToRoute(rawCoords, activeRouteGeometryRef.current);
                if (dist > OFF_ROUTE_THRESHOLD) {
                  onOffRouteRef.current?.();
                }
              }
            }

            // Camera follow
            if (followModeRef.current) {
              if (isSignificantMove || !smoothedPositionRef.current) {
                applyFollowMode(cameraCoords, cameraHeadingRef.current);
              }
            } else if (!hasInitialLocationRef.current) {
              hasInitialLocationRef.current = true;
              map.panTo({ lat: rawCoords[1], lng: rawCoords[0] });
              map.setZoom(14);
            }

            if (!hasInitialLocationRef.current) {
              hasInitialLocationRef.current = true;
            }
          },
          (error) => {
            if (error.code === 1) {
              onLocationError('denied');
            } else {
              onLocationError('unavailable');
            }
          }
        );
      }).catch((err) => {
        console.error('[TSLMAP] Failed to load Google Maps:', err);
        onMapReady();
      });

      return () => {
        cleanedUp = true;
        clearWatch(watchIdRef.current);
        if (cameraRafRef.current !== null) {
          cancelAnimationFrame(cameraRafRef.current);
          cameraRafRef.current = null;
        }
        if (zoomTimeoutRef.current) {
          clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = null;
        }
        // Clean up markers
        destinationMarkerRef.current?.setMap(null);
        pinMarkerRef.current?.setMap(null);
        userMarkerRef.current?.setMap(null);
        userArrowMarkerRef.current?.setMap(null);
        accuracyCircleRef.current?.setMap(null);
        trafficLayerRef.current?.setMap(null);
        mainRoutePolylineRef.current?.setMap(null);
        mainRouteCasingRef.current?.setMap(null);
        altRoutePolylinesRef.current.forEach(({ casing, line }) => {
          casing.setMap(null);
          line.setMap(null);
        });
        mapRef.current = null;
        isMapReadyRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        flyTo(coords: [number, number], zoom = 15) {
          if (!mapRef.current) return;
          mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
          mapRef.current.setZoom(zoom);
        },

        fitRoute(geometry: { type: string; coordinates: Array<[number, number]> }) {
          if (!mapRef.current) return;
          const coords = geometry.coordinates;
          if (coords.length === 0) return;
          const bounds = new google.maps.LatLngBounds();
          coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
          mapRef.current.fitBounds(bounds, { top: 120, bottom: 220, left: 60, right: 80 });
        },

        setRoute(geometry: { type: string; coordinates: Array<[number, number]> } | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          if (geometry) {
            const path = geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
            mainRouteCasingRef.current?.setPath(path);
            mainRoutePolylineRef.current?.setPath(path);
            activeRouteGeometryRef.current = geometry.coordinates as [number, number][];
          } else {
            mainRouteCasingRef.current?.setPath([]);
            mainRoutePolylineRef.current?.setPath([]);
            activeRouteGeometryRef.current = null;
          }
        },

        setAlternativeRoutes(routes: RouteAlternative[], selectedIndex: number) {
          if (!mapRef.current || !isMapReadyRef.current) return;

          // Clear all alt routes
          altRoutePolylinesRef.current.forEach(({ casing, line }) => {
            casing.setPath([]);
            line.setPath([]);
          });

          let altIdx = 0;
          routes.forEach((route) => {
            if (route.index === selectedIndex) return;
            if (altIdx >= MAX_ALT_ROUTES) return;
            const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
            altRoutePolylinesRef.current[altIdx].casing.setPath(path);
            altRoutePolylinesRef.current[altIdx].line.setPath(path);
            altIdx++;
          });

          const selected = routes.find((r) => r.index === selectedIndex);
          if (selected) {
            const path = selected.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
            mainRouteCasingRef.current?.setPath(path);
            mainRoutePolylineRef.current?.setPath(path);
            activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
          }
        },

        selectRoute(index: number, routes: RouteAlternative[]) {
          if (!mapRef.current || !isMapReadyRef.current) return;

          altRoutePolylinesRef.current.forEach(({ casing, line }) => {
            casing.setPath([]);
            line.setPath([]);
          });

          let altIdx = 0;
          routes.forEach((route) => {
            if (route.index === index) return;
            if (altIdx >= MAX_ALT_ROUTES) return;
            const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
            altRoutePolylinesRef.current[altIdx].casing.setPath(path);
            altRoutePolylinesRef.current[altIdx].line.setPath(path);
            altIdx++;
          });

          const selected = routes.find((r) => r.index === index);
          if (selected) {
            const path = selected.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
            mainRouteCasingRef.current?.setPath(path);
            mainRoutePolylineRef.current?.setPath(path);
            activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
          }
        },

        setDestinationMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          if (coords) {
            const position = { lat: coords[1], lng: coords[0] };
            if (!destinationMarkerRef.current) {
              destinationMarkerRef.current = new google.maps.Marker({
                map: mapRef.current,
                position,
                zIndex: 9,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 12,
                  fillColor: '#e53935',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 3,
                },
              });
            } else {
              destinationMarkerRef.current.setPosition(position);
              destinationMarkerRef.current.setMap(mapRef.current);
            }
          } else {
            destinationMarkerRef.current?.setMap(null);
            destinationMarkerRef.current = null;
          }
        },

        setPinMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          if (coords) {
            const position = { lat: coords[1], lng: coords[0] };
            if (!pinMarkerRef.current) {
              pinMarkerRef.current = new google.maps.Marker({
                map: mapRef.current,
                position,
                zIndex: 9,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 14,
                  fillColor: '#FF6F00',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 3,
                },
              });
            } else {
              pinMarkerRef.current.setPosition(position);
              pinMarkerRef.current.setMap(mapRef.current);
            }
          } else {
            pinMarkerRef.current?.setMap(null);
            pinMarkerRef.current = null;
          }
        },

        setUserMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          if (coords) {
            const position = { lat: coords[1], lng: coords[0] };
            if (!userMarkerRef.current) {
              userMarkerRef.current = new google.maps.Marker({
                map: mapRef.current,
                position,
                zIndex: 8,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: '#1a73e8',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2.5,
                },
              });
            } else {
              userMarkerRef.current.setPosition(position);
            }
          }
        },

        zoomIn() {
          if (!mapRef.current) return;
          mapRef.current.setZoom((mapRef.current.getZoom() ?? 12) + 1);
        },

        zoomOut() {
          if (!mapRef.current) return;
          mapRef.current.setZoom((mapRef.current.getZoom() ?? 12) - 1);
        },

        locateUser() {
          if (!mapRef.current) return;
          if (userLocationRef.current) {
            const coords = smoothedPositionRef.current ?? userLocationRef.current;
            mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
            mapRef.current.setZoom(NAV_ZOOM);
          } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                userLocationRef.current = coords;
                smoothedPositionRef.current = coords;
                if (mapRef.current) {
                  mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
                  mapRef.current.setZoom(NAV_ZOOM);
                }
              },
              () => { /* silently ignore — user may have denied */ },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          }
        },

        locateUserAt(coords: [number, number]) {
          if (!mapRef.current) return;
          userLocationRef.current = coords;
          smoothedPositionRef.current = coords;
          mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
          mapRef.current.setZoom(NAV_ZOOM);
        },

        setMapStyle(style: MapStyle) {
          applyMapStyleToMap(style);
        },
      }),
      [applyMapStyleToMap]
    );

    return <div ref={containerRef} className="map-container" />;
  }
);

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;