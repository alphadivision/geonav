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
  destinationPoint,
} from '@/lib/mapbox';
import { watchPosition, clearWatch } from '@/lib/geolocation';

/// <reference types="@types/google.maps" />
declare const google: typeof globalThis.google;

const MIN_MOVEMENT_FOR_BEARING = 3;
const NAV_ZOOM = 16; // plain "recenter" zoom (no navigation mode)
const NAV_MODE_ZOOM = 18; // closer, more immersive zoom while actively navigating
const NAV_MODE_TILT = 45; // requested where the renderer supports it (see MapCanvas notes)
const NAV_MODE_LOOKAHEAD_M = 55; // how far ahead of the user to bias the camera center

// Continuous per-frame interpolation (runs every animation frame, independent
// of how often GPS actually reports a new fix) — this is what makes the arrow
// and camera glide smoothly instead of jumping once per GPS tick.
const POSITION_LERP_ALPHA = 0.18; // marker position easing toward latest GPS fix
const ARROW_HEADING_LERP_ALPHA = 0.25; // marker rotation easing (snappier)
const CAMERA_BEARING_ALPHA = 0.12; // camera rotation easing (slightly slower, less twitchy)
const ARROW_ICON_UPDATE_THRESHOLD_DEG = 1.5; // skip SVG/blob regen for imperceptible heading deltas
const CAMERA_MOVE_THRESHOLD_M = 0.1; // skip redundant moveCamera calls once converged
const CAMERA_HEADING_THRESHOLD_DEG = 0.1;

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

// Google Maps' image-based Marker `icon` has no native `rotation` support
// (that only exists on vector `Symbol` icons), so heading is baked directly
// into the SVG markup via a <g transform="rotate(...)"> around the arrow only
// — the circular puck background stays visually unaffected by rotation.
const ARROW_SIZE = 44;
const ARROW_CENTER = ARROW_SIZE / 2;
function buildArrowSvg(headingDeg: number): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${ARROW_SIZE}" height="${ARROW_SIZE}" viewBox="0 0 ${ARROW_SIZE} ${ARROW_SIZE}">
  <circle cx="${ARROW_CENTER}" cy="${ARROW_CENTER}" r="20" fill="#121a2e" stroke="#1a2744" stroke-width="1.5"/>
  <circle cx="${ARROW_CENTER}" cy="${ARROW_CENTER}" r="20" fill="none" stroke="#1a73e8" stroke-opacity="0.35" stroke-width="1.5"/>
  <g transform="rotate(${headingDeg} ${ARROW_CENTER} ${ARROW_CENTER})">
    <path d="M22 8 L31 32 L22 26 L13 32 Z" fill="#e63946" stroke="#ffffff" stroke-width="1.75" stroke-linejoin="round"/>
  </g>
</svg>
`;
}

// Shortest signed difference between two angles in degrees, in range (-180, 180].
function angleDiff(from: number, to: number): number {
  let diff = (to - from) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

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
  /** Turn-by-turn navigation camera: closer zoom, forward-biased center so the
   * user renders lower on screen, heading-locked rotation, and (where the
   * renderer supports it) a tilted perspective. Only takes effect while
   * followMode is also true. */
  navigationMode?: boolean;
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
      navigationMode = false,
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
    const userArrowMarkerRef = useRef<google.maps.Marker | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const arrowIconUrlRef = useRef<string | null>(null);
    const lastIconHeadingRef = useRef<number>(0);
    const accuracyCircleRef = useRef<google.maps.Circle | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Route polylines
    const mainRoutePolylineRef = useRef<google.maps.Polyline | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const mainRouteCasingRef = useRef<google.maps.Polyline | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
    const altRoutePolylinesRef = useRef<Array<{ casing: google.maps.Polyline; line: google.maps.Polyline }>>([]); // eslint-disable-line @typescript-eslint/no-explicit-any

    // State refs
    // userLocationRef: latest raw GPS fix (the interpolation "target")
    // renderedPositionRef: continuously-interpolated position actually drawn on screen each frame
    const userLocationRef = useRef<[number, number] | null>(null);
    const renderedPositionRef = useRef<[number, number] | null>(null);
    const hasInitialLocationRef = useRef(false);
    const targetHeadingRef = useRef<number>(0);
    const currentHeadingRef = useRef<number>(0);
    const cameraHeadingRef = useRef<number>(0);
    const animationFrameRef = useRef<number | null>(null);
    const lastCameraStateRef = useRef<{ lat: number; lng: number; heading: number; zoom: number } | null>(null);
    const currentStyleRef = useRef<MapStyle>(mapStyle);
    const followModeRef = useRef(followMode);
    const navigationModeRef = useRef(navigationMode);
    const onFollowDisabledRef = useRef(onFollowDisabled);
    const trafficEnabledRef = useRef(trafficEnabled);
    const onMapTapRef = useRef(onMapTap);
    const onOffRouteRef = useRef(onOffRoute);
    const activeRouteGeometryRef = useRef<Array<[number, number]> | null>(null);
    const lastOffRouteCheckRef = useRef<number>(0);
    const isDraggingRef = useRef(false);
    const isZoomingRef = useRef(false);
    const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

    // Keep refs in sync with props
    followModeRef.current = followMode;
    navigationModeRef.current = navigationMode;
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

    // Regenerate the marker's SVG icon with heading baked in. Only called when
    // the heading has actually moved enough to matter (see updateArrowMarker),
    // so this isn't invoked on every animation frame — avoids blob churn.
    const setArrowIcon = useCallback((headingDeg: number) => {
      const marker = userArrowMarkerRef.current;
      if (!marker) return;

      const svg = buildArrowSvg(Math.round(headingDeg * 10) / 10);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const prevUrl = arrowIconUrlRef.current;

      marker.setIcon({
        url,
        scaledSize: new google.maps.Size(ARROW_SIZE, ARROW_SIZE),
        anchor: new google.maps.Point(ARROW_CENTER, ARROW_CENTER),
      });

      arrowIconUrlRef.current = url;
      if (prevUrl) URL.revokeObjectURL(prevUrl);
    }, []);

    // Moves the user marker and — only when its heading changed meaningfully —
    // regenerates its rotated icon. Called every animation frame with the
    // continuously-interpolated position/heading (see animateFrame below).
    const updateArrowMarker = useCallback((coords: [number, number], heading: number) => {
      const map = mapRef.current;
      if (!map || !isMapReadyRef.current) return;
      const position = { lat: coords[1], lng: coords[0] };

      if (!userArrowMarkerRef.current) {
        userArrowMarkerRef.current = new google.maps.Marker({
          map,
          position,
          zIndex: 10,
          optimized: false,
        });
        setArrowIcon(heading);
        lastIconHeadingRef.current = heading;
        return;
      }

      userArrowMarkerRef.current.setPosition(position);

      if (Math.abs(angleDiff(lastIconHeadingRef.current, heading)) >= ARROW_ICON_UPDATE_THRESHOLD_DEG) {
        setArrowIcon(heading);
        lastIconHeadingRef.current = heading;
      }
    }, [setArrowIcon]);

    // Continuous per-frame loop: eases the rendered position/heading toward the
    // latest real GPS fix (userLocationRef / targetHeadingRef), so the marker
    // and — when follow mode is active — the camera glide smoothly instead of
    // jumping once per GPS update. Runs for the lifetime of the component.
    const animateFrame = useCallback(() => {
      const map = mapRef.current;
      const target = userLocationRef.current;

      if (map && isMapReadyRef.current && target) {
        const current = renderedPositionRef.current ?? target;
        const nextPosition = smoothPosition(current, target, POSITION_LERP_ALPHA);
        renderedPositionRef.current = nextPosition;

        currentHeadingRef.current = currentHeadingRef.current + angleDiff(currentHeadingRef.current, targetHeadingRef.current) * ARROW_HEADING_LERP_ALPHA;
        cameraHeadingRef.current = cameraHeadingRef.current + angleDiff(cameraHeadingRef.current, targetHeadingRef.current) * CAMERA_BEARING_ALPHA;

        updateArrowMarker(nextPosition, currentHeadingRef.current);
        accuracyCircleRef.current?.setCenter({ lat: nextPosition[1], lng: nextPosition[0] });

        if (followModeRef.current) {
          const navMode = navigationModeRef.current;
          const zoom = navMode ? NAV_MODE_ZOOM : NAV_ZOOM;
          // In navigation mode, bias the camera center ahead of the user along
          // their heading — since moveCamera has no native "padding" concept,
          // this is how we get the user/arrow to render lower on screen with
          // the road and destination visible ahead, like a real nav app.
          const center = navMode
            ? destinationPoint(nextPosition, cameraHeadingRef.current, NAV_MODE_LOOKAHEAD_M)
            : nextPosition;
          const tilt = navMode ? NAV_MODE_TILT : 0;

          const last = lastCameraStateRef.current;
          const moved = !last || haversineDistance([last.lng, last.lat], center) > CAMERA_MOVE_THRESHOLD_M;
          const turned = !last || Math.abs(angleDiff(last.heading, cameraHeadingRef.current)) > CAMERA_HEADING_THRESHOLD_DEG;
          const zoomChanged = !last || last.zoom !== zoom;
          if (moved || turned || zoomChanged) {
            map.moveCamera({
              center: { lat: center[1], lng: center[0] },
              heading: cameraHeadingRef.current,
              zoom,
              tilt,
            });
            lastCameraStateRef.current = { lat: center[1], lng: center[0], heading: cameraHeadingRef.current, zoom };
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animateFrame);
    }, [updateArrowMarker]);

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

        // Watch user location. This only records the latest raw fix and derived
        // heading as interpolation *targets* — the actual marker/camera drawing
        // happens continuously in animateFrame (see above), not here, so the
        // display is smooth even though GPS itself only ticks ~1/s.
        watchIdRef.current = watchPosition(
          (location) => {
            onUserLocationUpdate(location);
            const rawCoords: [number, number] = [location.lng, location.lat];
            const prev = userLocationRef.current;

            userLocationRef.current = rawCoords;

            // Heading target: prefer device compass/GPS heading, fall back to
            // bearing derived from movement once it's large enough to be reliable.
            let newHeading: number | null = null;
            if (location.heading != null && !isNaN(location.heading) && location.heading >= 0) {
              newHeading = location.heading;
            } else if (prev !== null) {
              const dist = haversineDistance(prev, rawCoords);
              if (dist >= MIN_MOVEMENT_FOR_BEARING) {
                newHeading = calculateBearing(prev, rawCoords);
              }
            }
            if (newHeading !== null) {
              targetHeadingRef.current = newHeading;
            }

            if (!map || !isMapReadyRef.current) return;

            // Accuracy circle — center is kept in sync every frame by animateFrame
            const position = { lat: rawCoords[1], lng: rawCoords[0] };
            if (!accuracyCircleRef.current) {
              accuracyCircleRef.current = new google.maps.Circle({
                map,
                center: position,
                radius: Math.max(location.accuracy, 20),
                fillColor: '#1a73e8',
                fillOpacity: 0.12,
                strokeColor: '#1a73e8',
                strokeOpacity: 0.35,
                strokeWeight: 1,
                zIndex: 7,
              });
            } else {
              accuracyCircleRef.current.setRadius(Math.max(location.accuracy, 20));
            }

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

            // First-ever fix: if we're not already following, center on it once
            // so the user immediately sees themselves on the map.
            if (!hasInitialLocationRef.current) {
              hasInitialLocationRef.current = true;
              if (!followModeRef.current) {
                map.panTo(position);
                map.setZoom(14);
              }
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
        if (zoomTimeoutRef.current) {
          clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = null;
        }
        if (arrowIconUrlRef.current) {
          URL.revokeObjectURL(arrowIconUrlRef.current);
          arrowIconUrlRef.current = null;
        }
        // Clean up markers
        destinationMarkerRef.current?.setMap(null);
        pinMarkerRef.current?.setMap(null);
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

    // Continuous position/heading interpolation loop — runs for the lifetime
    // of the component, independent of the map-init effect above.
    useEffect(() => {
      animationFrameRef.current = requestAnimationFrame(animateFrame);
      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }, [animateFrame]);

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

        // Places/updates the same red arrow marker used by live GPS tracking —
        // used for the one-off "locate me" fallback fix before watchPosition
        // has produced its own reading yet.
        setUserMarker(coords: [number, number] | null) {
          if (!coords) return;
          userLocationRef.current = coords;
          renderedPositionRef.current = coords;
          updateArrowMarker(coords, currentHeadingRef.current);
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
            const coords = renderedPositionRef.current ?? userLocationRef.current;
            mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
            mapRef.current.setZoom(NAV_ZOOM);
          } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                userLocationRef.current = coords;
                renderedPositionRef.current = coords;
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
          renderedPositionRef.current = coords;
          mapRef.current.panTo({ lat: coords[1], lng: coords[0] });
          mapRef.current.setZoom(NAV_ZOOM);
        },

        setMapStyle(style: MapStyle) {
          applyMapStyleToMap(style);
        },
      }),
      [applyMapStyleToMap, updateArrowMarker]
    );

    return <div ref={containerRef} className="map-container" />;
  }
);

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;