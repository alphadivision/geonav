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
import { getPerformanceMode } from '@/lib/performanceMode';

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
const CAMERA_MOVE_THRESHOLD_M = 0.1; // skip redundant moveCamera calls once converged
const CAMERA_HEADING_THRESHOLD_DEG = 0.1;

// Once position + heading are this close to their targets, the interpolation
// loop stops requesting new animation frames entirely (rather than spinning
// at the display refresh rate forever) — it's woken back up (see kickAnimation)
// the moment a new GPS/heading target actually differs. This is the main
// lever for idle CPU/GPU cost: a car parked with a converged fix burns zero
// rAF cycles instead of running interpolation math 60x/sec indefinitely.
const CONVERGED_POS_EPSILON_M = 0.05;
const CONVERGED_HEADING_EPSILON_DEG = 0.05;

// Tesla's in-car browser has meaningfully less CPU/GPU headroom than a
// desktop — 24fps camera/marker interpolation is still visually smooth for
// panning/rotation but roughly halves the JS work per second versus 60fps.
// Desktop/mobile are untouched (interval 0 = no throttling).
const TESLA_FRAME_INTERVAL_MS = 1000 / 24;

const OFF_ROUTE_THRESHOLD = 80;
const OFF_ROUTE_CHECK_INTERVAL = 5000;

// Route progress trimming: only meaningful during active navigation, and
// only needs to look right, not be pixel-perfect every frame — recomputing
// the closest point on a multi-hundred-vertex polyline every animation frame
// would be pure waste. Once a second is plenty to look smooth to the eye.
const ROUTE_TRIM_INTERVAL_MS = 1000;

// Google Maps map type IDs mapped to our MapStyle keys
const GOOGLE_MAP_TYPE: Record<MapStyle, string> = {
  dark: 'roadmap',
  standard: 'roadmap',
  satellite: 'hybrid',
  streets: 'roadmap',
};

// Real heading-up map ROTATION is a vector-map-only Google Maps feature —
// confirmed against Google's own documentation: classic raster tiles do not
// visually rotate via moveCamera({heading}), regardless of how correctly the
// heading value itself is computed. Vector rendering requires a Map ID
// (created in Google Cloud Console — this can't be done from code). Without
// one configured, we stay on raster (current behavior, no rotation) rather
// than silently watermarking a production deploy with Google's DEMO_MAP_ID.
//
// IMPORTANT: a Map ID and the `styles` array are mutually exclusive — Google
// ignores `styles` whenever a mapId is set, and expects styling to be
// configured against that Map ID in Cloud Console instead (Cloud-based
// styling accepts the exact same JSON style-rule format as DARK_STYLES
// below, so it can be pasted in as-is). See the setup notes in the summary
// this task ends with.
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;
const USE_VECTOR_MAP = !!GOOGLE_MAPS_MAP_ID;

// Google's Map `backgroundColor` option is what actually shows through
// wherever tiles haven't loaded yet — at the map's edges while panning, when
// zoomed out past the available tile set, etc. Left unset, it defaults to a
// light grey/white, which is exactly the "white flash" seen in dark mode.
// Setting this per-style is the correct, supported fix (not a CSS overlay
// hack) — see https://developers.google.com/maps/documentation/javascript/reference/map#MapOptions.backgroundColor
const MAP_BACKGROUND_COLOR: Record<MapStyle, string> = {
  dark: '#0a0a0a',
  standard: '#e9e5dc',
  satellite: '#000000',
  streets: '#e9e5dc',
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

// Vehicle/location marker asset (provided PNG, tip pointing up/north by
// design — a CSS rotate(heading deg) therefore maps directly to compass
// bearing with no offset needed).
const ARROW_ASSET_URL = '/markers/arrow.png';
const ARROW_DISPLAY_SIZE = 40; // on-screen size in px
const ARROW_HALO_SIZE = 54; // circular puck behind the arrow

// Destination pin asset (provided PNG). Anchor is the bottom tip of the
// teardrop shape so it points exactly at the destination coordinate.
const PIN_ASSET_URL = '/markers/pin.png';
const PIN_DISPLAY_WIDTH = 34;
const PIN_DISPLAY_HEIGHT = 34;

// Google Maps' image-based Marker.setIcon() has no native rotation support
// (only vector Symbol icons expose a `rotation` field), and the provided
// arrow is a real raster PNG, not a tiny vector path — regenerating a large
// image blob on every heading change would be real, avoidable memory/CPU
// churn. Instead, the rotating arrow is a lightweight OverlayView: a plain
// DOM element positioned via the map's projection, rotated with a CSS
// transform. The image itself loads once (browser-cached); rotating it after
// that is just a style update — effectively free and GPU-composited.
//
// OverlayView only exists once the Maps JS library has loaded, so this class
// is created lazily (see createArrowOverlayClass, called once inside the
// map-init effect below) rather than declared at module scope.
function createArrowOverlayClass() {
  return class ArrowOverlay extends google.maps.OverlayView {
    private container: HTMLDivElement | null = null;
    private arrowEl: HTMLDivElement | null = null;
    private position: google.maps.LatLngLiteral;
    private heading: number;

    constructor(position: google.maps.LatLngLiteral, heading: number) {
      super();
      this.position = position;
      this.heading = heading;
    }

    onAdd() {
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.width = `${ARROW_HALO_SIZE}px`;
      container.style.height = `${ARROW_HALO_SIZE}px`;
      container.style.pointerEvents = 'none';
      container.style.borderRadius = '50%';
      container.style.background = 'rgba(18,26,46,0.92)';
      container.style.border = '1.5px solid #1a2744';
      container.style.boxShadow = '0 0 0 1.5px rgba(26,115,232,0.35)';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';

      const arrowEl = document.createElement('div');
      arrowEl.style.width = `${ARROW_DISPLAY_SIZE}px`;
      arrowEl.style.height = `${ARROW_DISPLAY_SIZE}px`;
      arrowEl.style.willChange = 'transform';
      arrowEl.style.transformOrigin = '50% 50%';
      arrowEl.style.backgroundImage = `url(${ARROW_ASSET_URL})`;
      arrowEl.style.backgroundSize = 'contain';
      arrowEl.style.backgroundRepeat = 'no-repeat';
      arrowEl.style.backgroundPosition = 'center';

      container.appendChild(arrowEl);
      this.container = container;
      this.arrowEl = arrowEl;
      this.applyHeading();

      this.getPanes()?.overlayLayer.appendChild(container);
    }

    draw() {
      if (!this.container) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;
      this.container.style.left = `${point.x - ARROW_HALO_SIZE / 2}px`;
      this.container.style.top = `${point.y - ARROW_HALO_SIZE / 2}px`;
    }

    onRemove() {
      this.container?.parentNode?.removeChild(this.container);
      this.container = null;
      this.arrowEl = null;
    }

    setPosition(position: google.maps.LatLngLiteral) {
      this.position = position;
      this.draw();
    }

    setHeading(heading: number) {
      this.heading = heading;
      this.applyHeading();
    }

    private applyHeading() {
      if (this.arrowEl) {
        this.arrowEl.style.transform = `rotate(${this.heading}deg)`;
      }
    }
  };
}
type ArrowOverlayInstance = InstanceType<ReturnType<typeof createArrowOverlayClass>>;

// Caches the last known GPS fix so the NEXT session can open the map
// centered near the user at a city-level zoom instead of always starting at
// a whole-country view (GEORGIA_CENTER, zoom 7). The very first-ever visit
// still has no cache and falls back to the country view — trading a fixed,
// one-time cost for never blocking first paint on a live GPS fix (which can
// take several seconds, or never resolve if permission is denied/pending).
const LAST_POSITION_KEY = 'teslanav_last_position_v1';
const LAST_POSITION_CACHE_ZOOM = 13;
const LAST_POSITION_WRITE_INTERVAL_MS = 20000; // avoid writing to localStorage on every GPS tick

function readCachedPosition(): [number, number] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'number' && typeof parsed[1] === 'number') {
      return parsed as [number, number];
    }
  } catch {
    // malformed/unavailable cache — ignore, fall back to the default view
  }
  return null;
}

function writeCachedPosition(coords: [number, number]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_POSITION_KEY, JSON.stringify(coords));
  } catch {
    // storage full/unavailable — non-critical, ignore
  }
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

// Route progress: finds the point on `route` closest to `pos`, then returns
// the route trimmed to start from there — dropping every vertex already
// traveled. Used to make the polyline shrink from behind the vehicle as it
// advances instead of leaving the whole traveled path drawn on the map.
function trimRouteAtPosition(
  route: Array<[number, number]>,
  pos: [number, number]
): Array<[number, number]> {
  if (route.length < 2) return route;

  let bestDist = Infinity;
  let bestIdx = 0;
  let bestProj: [number, number] = route[0];

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let proj: [number, number];
    if (dx === 0 && dy === 0) {
      proj = a;
    } else {
      const t = Math.max(0, Math.min(1, ((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      proj = [a[0] + t * dx, a[1] + t * dy];
    }
    const d = haversineDistance(pos, proj);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
      bestProj = proj;
    }
  }

  return [bestProj, ...route.slice(bestIdx + 1)];
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
    const userArrowMarkerRef = useRef<ArrowOverlayInstance | null>(null);
    const ArrowOverlayClassRef = useRef<ReturnType<typeof createArrowOverlayClass> | null>(null);
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
    const isAnimatingRef = useRef(false);
    const lastFrameTimeRef = useRef(0);
    const isLitePerfModeRef = useRef(false);
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
    const lastRouteTrimRef = useRef<number>(0);
    const lastPositionWriteRef = useRef<number>(0);
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
      map.setOptions({ backgroundColor: MAP_BACKGROUND_COLOR[style] });
      // With a Map ID set, styling is controlled from Cloud Console, not the
      // JS `styles` array (Google ignores it either way) — skip sending it.
      if (!USE_VECTOR_MAP) {
        map.setOptions({ styles: style !== 'satellite' ? MAP_STYLES_CONFIG[style] : [] });
      }
      currentStyleRef.current = style;
    }, []);

    // Moves the user marker overlay and updates its CSS rotation. Called every
    // animation frame with the continuously-interpolated position/heading
    // (see animateFrame below) — cheap either way, since this is just a
    // position/transform update on a persistent DOM node, not an icon/blob
    // regeneration.
    const updateArrowMarker = useCallback((coords: [number, number], heading: number) => {
      const map = mapRef.current;
      if (!map || !isMapReadyRef.current) return;
      const position = { lat: coords[1], lng: coords[0] };

      if (!userArrowMarkerRef.current) {
        if (!ArrowOverlayClassRef.current) return;
        const overlay = new ArrowOverlayClassRef.current(position, heading);
        overlay.setMap(map);
        userArrowMarkerRef.current = overlay;
        return;
      }

      userArrowMarkerRef.current.setPosition(position);
      userArrowMarkerRef.current.setHeading(heading);
    }, []);

    // Per-frame loop: eases the rendered position/heading toward the latest
    // real GPS fix (userLocationRef / targetHeadingRef), so the marker and —
    // when follow mode is active — the camera glide smoothly instead of
    // jumping once per GPS update.
    //
    // Unlike a naive rAF loop, this does NOT run forever: once position and
    // heading have converged to their targets it simply stops requesting new
    // frames (isAnimatingRef -> false), so a parked/stationary session costs
    // zero CPU between GPS fixes instead of spinning at the display refresh
    // rate indefinitely. kickAnimation() (below) wakes it back up whenever a
    // new target actually differs. On Tesla's in-car browser, the real
    // interpolation work is additionally throttled to ~24fps — still smooth
    // for panning/rotation, at roughly half the CPU/GPU cost of 60fps.
    const animateFrame = useCallback((timestamp?: number) => {
      const now = timestamp ?? performance.now();
      if (isLitePerfModeRef.current && now - lastFrameTimeRef.current < TESLA_FRAME_INTERVAL_MS) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
        return;
      }
      lastFrameTimeRef.current = now;

      const map = mapRef.current;
      const target = userLocationRef.current;
      let settled = true;

      if (map && isMapReadyRef.current && target) {
        const current = renderedPositionRef.current ?? target;
        const nextPosition = smoothPosition(current, target, POSITION_LERP_ALPHA);
        renderedPositionRef.current = nextPosition;

        const headingGap = Math.abs(angleDiff(currentHeadingRef.current, targetHeadingRef.current));
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

        // Route progress: trim the traveled section off the back of the
        // route polyline as the vehicle advances, so only the remaining
        // road ahead stays drawn. Only while actually navigating (not just
        // previewing a calculated route), and throttled — this only needs
        // to look right, not be recomputed 60x/sec.
        if (navigationModeRef.current && activeRouteGeometryRef.current && activeRouteGeometryRef.current.length > 1) {
          if (now - lastRouteTrimRef.current > ROUTE_TRIM_INTERVAL_MS) {
            lastRouteTrimRef.current = now;
            const trimmed = trimRouteAtPosition(activeRouteGeometryRef.current, nextPosition);
            if (trimmed.length !== activeRouteGeometryRef.current.length) {
              activeRouteGeometryRef.current = trimmed;
              const path = trimmed.map(([lng, lat]) => ({ lat, lng }));
              mainRouteCasingRef.current?.setPath(path);
              mainRoutePolylineRef.current?.setPath(path);
            }
          }
        }

        const posGap = haversineDistance(nextPosition, target);
        settled = posGap < CONVERGED_POS_EPSILON_M && headingGap < CONVERGED_HEADING_EPSILON_DEG;
      }

      if (settled) {
        isAnimatingRef.current = false;
        animationFrameRef.current = null;
      } else {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      }
    }, [updateArrowMarker]);

    // Wakes the interpolation loop back up if it had settled and stopped.
    // Called whenever a new GPS fix/heading arrives, or follow/navigation
    // mode is (re)enabled — anything that could require a fresh camera move.
    const kickAnimation = useCallback(() => {
      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true;
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      }
    }, [animateFrame]);
    const kickAnimationRef = useRef(kickAnimation);
    kickAnimationRef.current = kickAnimation;

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

      // Only request what's needed for the map to become visible/interactive.
      // 'geometry' is unused anywhere in this app — it was pure dead weight on
      // every load. 'places' (used only by SearchBar's autocomplete, which
      // already has a working non-Places server-side fallback) is loaded
      // AFTER the map is constructed (see below), as its own separate,
      // non-blocking request — calling it in parallel with 'maps' would still
      // bundle both into the same initial fetch, so it has to come later.
      setOptions({
        key: apiKey,
        version: 'weekly',
      });

      let map: google.maps.Map;
      let cleanedUp = false;

      importLibrary('maps').then((mapsLib) => {
        if (cleanedUp || !containerRef.current) return;

        const { Map } = mapsLib as google.maps.MapsLibrary;

        const cachedPosition = readCachedPosition();

        map = new Map(containerRef.current, {
          center: cachedPosition
            ? { lat: cachedPosition[1], lng: cachedPosition[0] }
            : { lat: GEORGIA_CENTER[1], lng: GEORGIA_CENTER[0] },
          zoom: cachedPosition ? LAST_POSITION_CACHE_ZOOM : 7,
          minZoom: 3,
          maxZoom: 20,
          mapTypeId: GOOGLE_MAP_TYPE[mapStyle],
          // styles and mapId are mutually exclusive (Google ignores `styles`
          // whenever mapId is set) — only send one or the other.
          ...(USE_VECTOR_MAP
            ? { mapId: GOOGLE_MAPS_MAP_ID }
            : { styles: MAP_STYLES_CONFIG[mapStyle] }),
          backgroundColor: MAP_BACKGROUND_COLOR[mapStyle],
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          scaleControl: false,
          rotateControl: false,
          // Rotation/tilt should only ever come from our own programmatic
          // moveCamera() calls during navigation, never from a two-finger
          // touch gesture — that would fight with heading-up mode.
          headingInteractionEnabled: false,
          tiltInteractionEnabled: false,
        });

        mapRef.current = map;
        currentStyleRef.current = mapStyle;
        // google.maps.OverlayView only exists now that 'maps' has loaded.
        ArrowOverlayClassRef.current = createArrowOverlayClass();

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

        // Single zoom_changed listener (was two identical subscriptions)
        map.addListener('zoom_changed', () => {
          onZoomChange(Math.round(map.getZoom() ?? 12));
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

        // Load 'places' now that the map itself is already up and interactive
        // — this is a separate, non-blocking request (fired after 'maps' has
        // already resolved, not alongside it) so it never delays first paint.
        // SearchBar also has a working non-Places /api/geocode fallback, so
        // search still functions even in the brief window before this
        // resolves.
        importLibrary('places').catch(() => {
          console.warn('[TSLMAP] Places library failed to load — search will use the server-side geocode fallback.');
        });

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

            // Throttled cache write for next session's initial map view (see
            // readCachedPosition above) — not on every tick, just often
            // enough to stay roughly current.
            const nowTs = Date.now();
            if (nowTs - lastPositionWriteRef.current > LAST_POSITION_WRITE_INTERVAL_MS) {
              lastPositionWriteRef.current = nowTs;
              writeCachedPosition(rawCoords);
            }

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

            kickAnimationRef.current();

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
        // Explicitly detach all listeners from this map instance instead of
        // relying on GC to eventually collect them once nothing references it.
        if (mapRef.current) {
          google.maps.event.clearInstanceListeners(mapRef.current);
        }
        mapRef.current = null;
        isMapReadyRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Resolve the active performance mode once — used by animateFrame to
    // throttle to ~24fps in 'lite' mode. Same getPerformanceMode() the CSS
    // side (data-perf-mode, see NavigationMapClient/tailwind.css) uses, so a
    // manual override affects both consistently.
    useEffect(() => {
      isLitePerfModeRef.current = getPerformanceMode() === 'lite';
    }, []);

    // The interpolation loop is NOT started here — it only runs while there's
    // an actual position/heading gap to animate (see kickAnimation, invoked
    // from the GPS watcher and from follow/navigation-mode changes below).
    // This cleanup just guards against a frame surviving unmount.
    useEffect(() => {
      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        isAnimatingRef.current = false;
      };
    }, []);

    // Re-engage the camera the instant follow/navigation mode turns on, even
    // if no new GPS fix has arrived yet (otherwise the camera would wait for
    // the next GPS tick, up to ~1s, before reacting to "Start Route"/Recenter).
    useEffect(() => {
      if (followMode) kickAnimationRef.current();
    }, [followMode, navigationMode]);

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
                  url: PIN_ASSET_URL,
                  scaledSize: new google.maps.Size(PIN_DISPLAY_WIDTH, PIN_DISPLAY_HEIGHT),
                  anchor: new google.maps.Point(PIN_DISPLAY_WIDTH / 2, Math.round(PIN_DISPLAY_HEIGHT * 0.93)),
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
                  url: PIN_ASSET_URL,
                  scaledSize: new google.maps.Size(PIN_DISPLAY_WIDTH, PIN_DISPLAY_HEIGHT),
                  anchor: new google.maps.Point(PIN_DISPLAY_WIDTH / 2, Math.round(PIN_DISPLAY_HEIGHT * 0.93)),
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