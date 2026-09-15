'use client';

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { UserLocation, MapStyle, RouteAlternative } from '@/types';
import type { Language } from '@/lib/i18n';
import type { GeoJSON } from 'geojson';
import {
  GEORGIA_CENTER,
  MAP_STYLES,
  DEFAULT_MAP_STYLE,
  ROUTE_SOURCE_ID,
  ROUTE_LAYER_ID,
  ROUTE_CASING_LAYER_ID,
  buildRouteGeoJSON,
  buildPointGeoJSON,
  calculateBearing,
  haversineDistance,
  smoothHeading,
} from '@/lib/mapbox';
import { watchPosition, clearWatch } from '@/lib/geolocation';

const MAPBOX_PUBLIC_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const MIN_MOVEMENT_FOR_BEARING = 3;
const HEADING_SMOOTH_ALPHA = 0.3;
// Off-route threshold in meters
const OFF_ROUTE_THRESHOLD = 80;
// Minimum distance change to trigger off-route recalculation
const OFF_ROUTE_CHECK_INTERVAL = 5000; // ms

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
  fitRoute: (geometry: GeoJSON.LineString) => void;
  setRoute: (geometry: GeoJSON.LineString | null) => void;
  setAlternativeRoutes: (routes: RouteAlternative[], selectedIndex: number) => void;
  selectRoute: (index: number, routes: RouteAlternative[]) => void;
  setDestinationMarker: (coords: [number, number] | null) => void;
  setPinMarker: (coords: [number, number] | null) => void;
  setUserMarker: (coords: [number, number] | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  locateUser: () => void;
  setMapStyle: (style: MapStyle) => void;
}

const DESTINATION_MARKER_SOURCE = 'destination-marker-source';
const PIN_MARKER_SOURCE = 'pin-marker-source';
const USER_MARKER_SOURCE = 'user-marker-source';
const DESTINATION_LAYER = 'destination-marker-layer';
const PIN_LAYER = 'pin-marker-layer';
const USER_LAYER = 'user-marker-layer';
const USER_ACCURACY_LAYER = 'user-accuracy-layer';
const USER_ARROW_LAYER = 'user-arrow-layer';
const USER_ARROW_SOURCE = 'user-arrow-source';

// Alternative route sources/layers
const ALT_ROUTE_SOURCE_PREFIX = 'geonav-alt-route-';
const ALT_ROUTE_CASING_PREFIX = 'geonav-alt-casing-';
const ALT_ROUTE_LINE_PREFIX = 'geonav-alt-line-';
const MAX_ALT_ROUTES = 3;

// Traffic layer IDs from Mapbox
const TRAFFIC_SOURCE = 'mapbox-traffic';
const TRAFFIC_LAYER_IDS = [
  'traffic-street-low',
  'traffic-street-case',
  'traffic-street',
  'traffic-main-low',
  'traffic-main-case',
  'traffic-main',
  'traffic-motorway-low',
  'traffic-motorway-case',
  'traffic-motorway',
];

const ARROW_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="18" fill="#1a73e8" fill-opacity="0.18" stroke="#1a73e8" stroke-width="1.5" stroke-opacity="0.5"/>
  <polygon points="20,4 28,30 20,24 12,30" fill="#1a73e8" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="20" cy="24" r="4" fill="#ffffff" stroke="#1a73e8" stroke-width="2"/>
</svg>
`;

function createArrowImage(): HTMLImageElement {
  const img = new Image(40, 40);
  const blob = new Blob([ARROW_SVG], { type: 'image/svg+xml' });
  img.src = URL.createObjectURL(blob);
  return img;
}

// Compute minimum distance from a point to a route geometry
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
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const watchIdRef = useRef<number>(-1);
    const isMapReadyRef = useRef(false);
    const destinationMarkerRef = useRef<[number, number] | null>(null);
    const userLocationRef = useRef<[number, number] | null>(null);
    const hasInitialLocationRef = useRef(false);
    const currentHeadingRef = useRef<number>(0);
    const prevPositionRef = useRef<[number, number] | null>(null);
    const isStyleChangingRef = useRef(false);
    const currentStyleRef = useRef<MapStyle>(mapStyle);
    const followModeRef = useRef(followMode);
    const onFollowDisabledRef = useRef(onFollowDisabled);
    const arrowImageLoadedRef = useRef(false);
    const trafficEnabledRef = useRef(trafficEnabled);
    const onMapTapRef = useRef(onMapTap);
    const onOffRouteRef = useRef(onOffRoute);
    const activeRouteGeometryRef = useRef<Array<[number, number]> | null>(null);
    const lastOffRouteCheckRef = useRef<number>(0);
    const isDraggingRef = useRef(false);
    const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

    // Keep refs in sync with props
    followModeRef.current = followMode;
    onFollowDisabledRef.current = onFollowDisabled;
    trafficEnabledRef.current = trafficEnabled;
    onMapTapRef.current = onMapTap;
    onOffRouteRef.current = onOffRoute;

    const getLabelLayer = useCallback((map: mapboxgl.Map): string | undefined => {
      const candidates = [
        'road-label', 'road-label-simple', 'road-number-shield',
        'road-exit-shield', 'waterway-label', 'natural-line-label',
        'natural-point-label', 'water-line-label', 'water-point-label',
        'poi-label', 'transit-label', 'airport-label',
        'settlement-subdivision-label', 'settlement-label',
        'state-label', 'country-label',
      ];
      const existingIds = new Set((map.getStyle()?.layers ?? []).map((l) => l.id));
      return candidates.find((id) => existingIds.has(id));
    }, []);

    const addArrowImage = useCallback((map: mapboxgl.Map, cb?: () => void) => {
      if (map.hasImage('vehicle-arrow')) {
        arrowImageLoadedRef.current = true;
        cb?.();
        return;
      }
      const img = createArrowImage();
      img.onload = () => {
        if (!map.hasImage('vehicle-arrow')) {
          map.addImage('vehicle-arrow', img, { sdf: false });
        }
        arrowImageLoadedRef.current = true;
        cb?.();
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        arrowImageLoadedRef.current = false;
        cb?.();
      };
    }, []);

    // Apply traffic layer visibility
    const applyTrafficVisibility = useCallback((map: mapboxgl.Map, enabled: boolean) => {
      if (!map || !isMapReadyRef.current) return;
      const style = map.getStyle();
      if (!style) return;
      const existingLayerIds = new Set(style.layers.map((l) => l.id));

      // Check if Mapbox traffic source is available in the current style
      const hasTrafficSource = !!style.sources?.[TRAFFIC_SOURCE];

      if (!hasTrafficSource) {
        // For styles without built-in traffic, add the traffic source and layers
        if (enabled) {
          try {
            if (!map.getSource(TRAFFIC_SOURCE)) {
              map.addSource(TRAFFIC_SOURCE, {
                type: 'vector',
                url: 'mapbox://mapbox.mapbox-traffic-v1',
              });
            }
            // Add a simple congestion layer
            if (!map.getLayer('geonav-traffic-congestion')) {
              map.addLayer({
                id: 'geonav-traffic-congestion',
                type: 'line',
                source: TRAFFIC_SOURCE,
                'source-layer': 'traffic',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                  'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    8, 1.5,
                    14, 4,
                    20, 8,
                  ],
                  'line-color': [
                    'match',
                    ['get', 'congestion'],
                    'low', '#4CAF50',
                    'moderate', '#FFC107',
                    'heavy', '#FF5722',
                    'severe', '#B71C1C',
                    '#4CAF50',
                  ],
                  'line-opacity': 0.85,
                },
              });
            } else {
              map.setLayoutProperty('geonav-traffic-congestion', 'visibility', 'visible');
            }
          } catch (e) {
            console.warn('[traffic] Could not add traffic layer:', e);
          }
        } else {
          if (map.getLayer('geonav-traffic-congestion')) {
            map.setLayoutProperty('geonav-traffic-congestion', 'visibility', 'none');
          }
        }
        return;
      }

      // For styles with built-in traffic layers (navigation styles)
      const visibility = enabled ? 'visible' : 'none';
      TRAFFIC_LAYER_IDS.forEach((layerId) => {
        if (existingLayerIds.has(layerId)) {
          try {
            map.setLayoutProperty(layerId, 'visibility', visibility);
          } catch (e) {
            // Layer may not support visibility toggle
          }
        }
      });
    }, []);

    const ensureSourceAndLayer = useCallback((map: mapboxgl.Map) => {
      const beforeLayer = getLabelLayer(map);

      // Alternative route layers (behind main route)
      for (let i = 0; i < MAX_ALT_ROUTES; i++) {
        const srcId = `${ALT_ROUTE_SOURCE_PREFIX}${i}`;
        const casingId = `${ALT_ROUTE_CASING_PREFIX}${i}`;
        const lineId = `${ALT_ROUTE_LINE_PREFIX}${i}`;
        if (!map.getSource(srcId)) {
          map.addSource(srcId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer(
            {
              id: casingId,
              type: 'line',
              source: srcId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#37474f', 'line-width': 10, 'line-opacity': 0.7 },
            },
            beforeLayer
          );
          map.addLayer(
            {
              id: lineId,
              type: 'line',
              source: srcId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#607d8b', 'line-width': 5, 'line-opacity': 0.85 },
            },
            beforeLayer
          );
        }
      }

      // Main route (on top of alternatives)
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer(
          {
            id: ROUTE_CASING_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#0d47a1', 'line-width': 12, 'line-opacity': 0.9 },
          },
          beforeLayer
        );
        map.addLayer(
          {
            id: ROUTE_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1a73e8', 'line-width': 7, 'line-opacity': 1 },
          },
          beforeLayer
        );
      }

      // Destination marker
      if (!map.getSource(DESTINATION_MARKER_SOURCE)) {
        map.addSource(DESTINATION_MARKER_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: DESTINATION_LAYER,
          type: 'circle',
          source: DESTINATION_MARKER_SOURCE,
          paint: {
            'circle-radius': 12,
            'circle-color': '#e53935',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
            'circle-opacity': 1,
          },
        });
      }

      // Pin marker (tap-to-navigate)
      if (!map.getSource(PIN_MARKER_SOURCE)) {
        map.addSource(PIN_MARKER_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: PIN_LAYER,
          type: 'circle',
          source: PIN_MARKER_SOURCE,
          paint: {
            'circle-radius': 14,
            'circle-color': '#FF6F00',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
            'circle-opacity': 1,
          },
        });
      }

      // User location accuracy circle + dot
      if (!map.getSource(USER_MARKER_SOURCE)) {
        map.addSource(USER_MARKER_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: USER_ACCURACY_LAYER,
          type: 'circle',
          source: USER_MARKER_SOURCE,
          paint: {
            'circle-radius': 22,
            'circle-color': '#1a73e8',
            'circle-opacity': 0.15,
            'circle-stroke-color': '#1a73e8',
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.4,
          },
        });
        map.addLayer({
          id: USER_LAYER,
          type: 'circle',
          source: USER_MARKER_SOURCE,
          paint: {
            'circle-radius': 8,
            'circle-color': '#1a73e8',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.5,
            'circle-opacity': 1,
          },
        });
      }

      // Vehicle direction arrow
      if (!map.getSource(USER_ARROW_SOURCE)) {
        map.addSource(USER_ARROW_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }

      addArrowImage(map, () => {
        if (!map.getLayer(USER_ARROW_LAYER) && arrowImageLoadedRef.current) {
          map.addLayer({
            id: USER_ARROW_LAYER,
            type: 'symbol',
            source: USER_ARROW_SOURCE,
            layout: {
              'icon-image': 'vehicle-arrow',
              'icon-size': 1,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotation-alignment': 'map',
              'icon-rotate': ['get', 'heading'],
            },
          });
        }
      });

      // Apply traffic visibility after layers are set up
      applyTrafficVisibility(map, trafficEnabledRef.current);
    }, [getLabelLayer, addArrowImage, applyTrafficVisibility]);

    const updateArrowPosition = useCallback(
      (coords: [number, number], heading: number) => {
        const map = mapRef.current;
        if (!map || !isMapReadyRef.current) return;
        const source = map.getSource(USER_ARROW_SOURCE) as mapboxgl.GeoJSONSource;
        if (!source) return;
        source.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { heading },
              geometry: { type: 'Point', coordinates: coords },
            },
          ],
        });
      },
      []
    );

    const applyFollowMode = useCallback(
      (coords: [number, number], heading: number) => {
        const map = mapRef.current;
        if (!map || !followModeRef.current) return;
        map.easeTo({
          center: coords,
          bearing: heading,
          duration: 300,
          easing: (t) => t,
        });
      },
      []
    );

    // Handle map style changes without recreating the map instance
    const applyMapStyle = useCallback((style: MapStyle) => {
      const map = mapRef.current;
      if (!map || !isMapReadyRef.current) return;
      if (currentStyleRef.current === style) return;
      currentStyleRef.current = style;
      isStyleChangingRef.current = true;
      arrowImageLoadedRef.current = false;

      map.setStyle(MAP_STYLES[style]);

      map.once('style.load', () => {
        ensureSourceAndLayer(map);
        isStyleChangingRef.current = false;

        // Restore user position
        if (userLocationRef.current) {
          const src = map.getSource(USER_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (src) src.setData(buildPointGeoJSON(userLocationRef.current));
          updateArrowPosition(userLocationRef.current, currentHeadingRef.current);
        }
        // Restore destination
        if (destinationMarkerRef.current) {
          const src = map.getSource(DESTINATION_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (src) src.setData(buildPointGeoJSON(destinationMarkerRef.current));
        }
      });
    }, [ensureSourceAndLayer, updateArrowPosition]);

    // Watch for mapStyle prop changes
    useEffect(() => {
      if (isMapReadyRef.current) {
        applyMapStyle(mapStyle);
      }
    }, [mapStyle, applyMapStyle]);

    // Watch for trafficEnabled prop changes
    useEffect(() => {
      if (isMapReadyRef.current && mapRef.current) {
        applyTrafficVisibility(mapRef.current, trafficEnabled);
      }
    }, [trafficEnabled, applyTrafficVisibility]);

    useEffect(() => {
      if (!containerRef.current || !MAPBOX_PUBLIC_TOKEN) return;

      mapboxgl.accessToken = MAPBOX_PUBLIC_TOKEN;

      const initialStyle = MAP_STYLES[mapStyle] || MAP_STYLES[DEFAULT_MAP_STYLE];
      currentStyleRef.current = mapStyle;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: initialStyle,
        center: GEORGIA_CENTER,
        zoom: 7,
        minZoom: 3,
        maxZoom: 20,
        attributionControl: false,
        logoPosition: 'bottom-left',
        antialias: false,
        preserveDrawingBuffer: false,
        trackResize: true,
        refreshExpiredTiles: false,
        fadeDuration: 0,
        crossSourceCollisions: false,
        localIdeographFontFamily: false,
      });

      mapRef.current = map;

      map.on('load', () => {
        ensureSourceAndLayer(map);
        isMapReadyRef.current = true;
        onMapReady();
      });

      map.on('zoom', () => {
        onZoomChange(Math.round(map.getZoom()));
      });

      // Detect manual drag — disable follow mode
      map.on('dragstart', () => {
        isDraggingRef.current = true;
        if (followModeRef.current) {
          onFollowDisabledRef.current();
        }
      });

      map.on('dragend', () => {
        // Small delay so tap handler doesn't fire after drag
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      });

      // Tap-to-navigate: track mousedown/touchstart position to detect drag vs tap
      const handlePointerDown = (e: MouseEvent | TouchEvent) => {
        const pos = 'touches' in e
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : { x: e.clientX, y: e.clientY };
        dragStartPosRef.current = pos;
      };

      // Map click for tap-to-navigate
      map.on('click', (e) => {
        if (!onMapTapRef.current) return;
        if (isDraggingRef.current) return;

        // Check if click was on a UI element (not the map canvas)
        const target = e.originalEvent.target as HTMLElement;
        if (target && target.closest('[data-no-map-tap]')) return;

        // Verify it's a genuine tap (not a drag)
        const start = dragStartPosRef.current;
        if (start) {
          const dx = Math.abs(e.originalEvent.clientX - start.x);
          const dy = Math.abs(e.originalEvent.clientY - start.y);
          if (dx > 8 || dy > 8) return; // Was a drag, not a tap
        }

        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        onMapTapRef.current(coords);
      });

      map.getCanvas().addEventListener('mousedown', handlePointerDown);
      map.getCanvas().addEventListener('touchstart', handlePointerDown, { passive: true });

      map.on('error', (e) => {
        console.error('[MapCanvas] Map error:', e.error?.message);
      });

      // Watch user location
      watchIdRef.current = watchPosition(
        (location) => {
          onUserLocationUpdate(location);
          const coords: [number, number] = [location.lng, location.lat];
          const prev = userLocationRef.current;
          userLocationRef.current = coords;

          if (!map || !isMapReadyRef.current || isStyleChangingRef.current) return;

          // Update accuracy/dot marker
          const src = map.getSource(USER_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (src) src.setData(buildPointGeoJSON(coords));

          // Determine heading
          let newHeading: number | null = null;

          if (
            location.heading != null &&
            !isNaN(location.heading) &&
            location.heading >= 0
          ) {
            newHeading = location.heading;
          }

          if (newHeading === null && prev !== null) {
            const dist = haversineDistance(prev, coords);
            if (dist >= MIN_MOVEMENT_FOR_BEARING) {
              newHeading = calculateBearing(prev, coords);
            }
          }

          if (newHeading !== null) {
            currentHeadingRef.current = smoothHeading(
              currentHeadingRef.current,
              newHeading,
              HEADING_SMOOTH_ALPHA
            );
          }

          updateArrowPosition(coords, currentHeadingRef.current);

          // Off-route detection
          if (activeRouteGeometryRef.current && activeRouteGeometryRef.current.length > 0) {
            const now = Date.now();
            if (now - lastOffRouteCheckRef.current > OFF_ROUTE_CHECK_INTERVAL) {
              lastOffRouteCheckRef.current = now;
              const dist = distanceToRoute(coords, activeRouteGeometryRef.current);
              if (dist > OFF_ROUTE_THRESHOLD) {
                onOffRouteRef.current?.();
              }
            }
          }

          // Follow mode: center + rotate map
          if (followModeRef.current) {
            applyFollowMode(coords, currentHeadingRef.current);
          } else if (!hasInitialLocationRef.current) {
            hasInitialLocationRef.current = true;
            map.flyTo({
              center: coords,
              zoom: 14,
              duration: 1200,
              essential: true,
            });
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

      return () => {
        clearWatch(watchIdRef.current);
        map.getCanvas().removeEventListener('mousedown', handlePointerDown);
        map.getCanvas().removeEventListener('touchstart', handlePointerDown);
        map.remove();
        mapRef.current = null;
        isMapReadyRef.current = false;
        arrowImageLoadedRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        flyTo(coords: [number, number], zoom = 15) {
          if (!mapRef.current) return;
          mapRef.current.flyTo({
            center: coords,
            zoom,
            bearing: 0,
            duration: 800,
            essential: true,
          });
        },

        fitRoute(geometry: GeoJSON.LineString) {
          if (!mapRef.current) return;
          const coords = geometry.coordinates as [number, number][];
          if (coords.length === 0) return;
          const bounds = coords.reduce(
            (b, c) => b.extend(c as mapboxgl.LngLatLike),
            new mapboxgl.LngLatBounds(coords[0], coords[0])
          );
          mapRef.current.fitBounds(bounds, {
            padding: { top: 120, bottom: 220, left: 60, right: 80 },
            bearing: 0,
            duration: 1000,
            essential: true,
          });
        },

        setRoute(geometry: GeoJSON.LineString | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          const source = mapRef.current.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource;
          if (!source) return;
          if (geometry) {
            source.setData(buildRouteGeoJSON(geometry));
            activeRouteGeometryRef.current = geometry.coordinates as [number, number][];
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
            activeRouteGeometryRef.current = null;
          }
        },

        setAlternativeRoutes(routes: RouteAlternative[], selectedIndex: number) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          const map = mapRef.current;

          // Clear all alt route sources first
          for (let i = 0; i < MAX_ALT_ROUTES; i++) {
            const srcId = `${ALT_ROUTE_SOURCE_PREFIX}${i}`;
            const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
          }

          // Draw non-selected routes as alternatives
          let altIdx = 0;
          routes.forEach((route) => {
            if (route.index === selectedIndex) return; // skip selected (drawn as main)
            if (altIdx >= MAX_ALT_ROUTES) return;
            const srcId = `${ALT_ROUTE_SOURCE_PREFIX}${altIdx}`;
            const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
            if (src) {
              src.setData(buildRouteGeoJSON(route.geometry as GeoJSON.LineString));
            }
            altIdx++;
          });

          // Draw selected route as main
          const selected = routes.find((r) => r.index === selectedIndex);
          if (selected) {
            const mainSrc = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource;
            if (mainSrc) {
              mainSrc.setData(buildRouteGeoJSON(selected.geometry as GeoJSON.LineString));
              activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
            }
          }
        },

        selectRoute(index: number, routes: RouteAlternative[]) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          const map = mapRef.current;

          // Clear alt routes
          for (let i = 0; i < MAX_ALT_ROUTES; i++) {
            const srcId = `${ALT_ROUTE_SOURCE_PREFIX}${i}`;
            const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
          }

          let altIdx = 0;
          routes.forEach((route) => {
            if (route.index === index) return;
            if (altIdx >= MAX_ALT_ROUTES) return;
            const srcId = `${ALT_ROUTE_SOURCE_PREFIX}${altIdx}`;
            const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
            if (src) src.setData(buildRouteGeoJSON(route.geometry as GeoJSON.LineString));
            altIdx++;
          });

          const selected = routes.find((r) => r.index === index);
          if (selected) {
            const mainSrc = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource;
            if (mainSrc) {
              mainSrc.setData(buildRouteGeoJSON(selected.geometry as GeoJSON.LineString));
              activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
            }
          }
        },

        setDestinationMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          destinationMarkerRef.current = coords;
          const source = mapRef.current.getSource(DESTINATION_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (!source) return;
          if (coords) {
            source.setData(buildPointGeoJSON(coords));
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
        },

        setPinMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          const source = mapRef.current.getSource(PIN_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (!source) return;
          if (coords) {
            source.setData(buildPointGeoJSON(coords));
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
        },

        setUserMarker(coords: [number, number] | null) {
          if (!mapRef.current || !isMapReadyRef.current) return;
          const source = mapRef.current.getSource(USER_MARKER_SOURCE) as mapboxgl.GeoJSONSource;
          if (!source) return;
          if (coords) {
            source.setData(buildPointGeoJSON(coords));
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
        },

        zoomIn() {
          if (!mapRef.current) return;
          mapRef.current.zoomIn({ duration: 200 });
        },

        zoomOut() {
          if (!mapRef.current) return;
          mapRef.current.zoomOut({ duration: 200 });
        },

        locateUser() {
          if (!mapRef.current || !userLocationRef.current) return;
          mapRef.current.easeTo({
            center: userLocationRef.current,
            bearing: currentHeadingRef.current,
            zoom: 15,
            duration: 800,
            essential: true,
          });
        },

        setMapStyle(style: MapStyle) {
          applyMapStyle(style);
        },
      }),
      [applyMapStyle]
    );

    return <div ref={containerRef} className="map-container" />;
  }
);

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;