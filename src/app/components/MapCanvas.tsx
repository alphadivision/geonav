'use client';

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import type { UserLocation, MapStyle, RouteAlternative, TrafficSegment } from '@/types';
import type { Language } from '@/lib/i18n';
import {
  GEORGIA_CENTER,
  calculateBearing,
  haversineDistance,
  destinationPoint,
} from '@/lib/mapbox';
import { watchPosition, clearWatch } from '@/lib/geolocation';
import { getPerformanceMode } from '@/lib/performanceMode';
import { DEFAULT_CURSOR_ID, getCursorOption, type CursorId, type CursorOption } from '@/lib/cursors';

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

// Pin placement requires a press-and-hold of this length (a normal quick tap
// no longer drops a pin) — see the mousedown/mouseup/dragstart handling in
// the map-init effect below.
const LONG_PRESS_DURATION_MS = 1500;
// Same threshold already used elsewhere to tell a real drag from a
// stationary click — reused here to cancel a pending long-press if the
// pointer moves meaningfully before the hold completes.
const LONG_PRESS_MOVE_CANCEL_PX = 8;


// Google's vector-map "color scheme" (dark/light cloud-configured style
// variant for the SAME Map ID — see the setup notes near GOOGLE_MAPS_MAP_ID
// below). Only meaningful on a vector map; ignored otherwise.
const MAP_COLOR_SCHEME: Record<MapStyle, 'DARK' | 'LIGHT'> = {
  dark: 'DARK',
  standard: 'LIGHT',
  satellite: 'LIGHT',
  streets: 'LIGHT',
};

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
// (created in Google Cloud Console — this can't be done from code).
//
// IMPORTANT: a Map ID and the `styles` array are mutually exclusive — Google
// ignores `styles` whenever a mapId is set. Vector-map custom appearance is
// instead controlled two ways, BOTH configured against this Map ID in Cloud
// Console (Maps Platform > Map Management > this Map ID > Map Styles),
// neither of which is achievable from application code:
//   1. Author a "dark mode" and a "light mode" style for this Map ID using
//      Cloud Console's style editor (or the Styling Wizard at
//      mapstyle.withgoogle.com) — paste in the exact same styler rules as
//      DARK_STYLES / STANDARD_STYLES below so the vector map matches the
//      previous custom raster design instead of Google's generic default.
//   2. The app then picks which of those two authored styles is active via
//      the standard `colorScheme` MapOptions field (see MAP_COLOR_SCHEME
//      and recreateMapForStyle below) — 'DARK' or 'LIGHT'.
// Without a Map ID configured, none of this applies and the app stays on
// raster (no rotation), styled via the JS `styles` array as before.
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;
const USE_VECTOR_MAP = !!GOOGLE_MAPS_MAP_ID;

// "Show Places" (native map POI visibility) — same constraint as above:
// there is no documented runtime JS API to toggle POI visibility on an
// already-created vector map, only a per-Map-ID Cloud Console style setting.
// So this is a SECOND Map ID, configured in Cloud Console with its own
// dark+POI and light+POI style pair that otherwise matches the base Map ID's
// design exactly. Toggling "Show Places" recreates the map (see
// recreateMapForStyle) switching only which Map ID is active — never
// touches the JS `styles` array, never queries the Places API, never
// creates a marker per place. Optional: the app works identically to before
// if this isn't set, just without the toggle having any visible effect.
const GOOGLE_MAPS_MAP_ID_POI = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_POI || undefined;

function resolveMapId(placesEnabled: boolean): string | undefined {
  return placesEnabled && GOOGLE_MAPS_MAP_ID_POI ? GOOGLE_MAPS_MAP_ID_POI : GOOGLE_MAPS_MAP_ID;
}

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
// Exhaustive POI/transit hiding — the bare parent featureType ('poi',
// 'transit') is documented to cascade to every subtype in the classic JS
// styles array, but Cloud-based map styling has been reported (Google's own
// issue tracker, community reports) to not always cascade the same way. So
// every documented subtype is listed explicitly here too, belt-and-suspenders:
// this is the array applied both as the classic raster `styles` option AND
// as the corrective fallback (see applyPoiVisibilityFallback) if a vector
// map with a Map ID silently falls back to raster, where Cloud styling no
// longer applies at all. Never touches colors/hierarchy — visibility only.
const POI_HIDDEN_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.government', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.line', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station.airport', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station.bus', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station.rail', stylers: [{ visibility: 'off' }] },
];

// Colors/hierarchy only — no POI/transit visibility rules — kept separate
// from POI_HIDDEN_STYLES so the "Places ON" raster-fallback case can reuse
// the exact same visual design without the hiding rules (see
// MAP_STYLES_CONFIG_POI_VISIBLE below). Never changed by the POI fix.
const DARK_BASE_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#232323' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0c0c0c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#242424' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#383838' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8c8c8c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#202020' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a3a' }] },
];
const DARK_STYLES = [...DARK_BASE_STYLES, ...POI_HIDDEN_STYLES];

// Was an empty array (plain default Google look) — stays empty as the base;
// POI hiding is layered on top the same way as dark.
const STANDARD_BASE_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [];
const STANDARD_STYLES = [...STANDARD_BASE_STYLES, ...POI_HIDDEN_STYLES];

const STREETS_STYLES: Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }> = [
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
];

// Default (Places OFF): POIs hidden, per style's normal design.
const MAP_STYLES_CONFIG: Record<MapStyle, Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }>> = {
  dark: DARK_STYLES,
  standard: STANDARD_STYLES,
  satellite: [],
  streets: STREETS_STYLES,
};

// Places ON: same visual design, POI/transit hiding rules simply omitted so
// Google's native POIs render normally. Only used by the raster-fallback
// corrective path (applyPoiVisibilityFallback) — on working vector
// rendering, "Places ON" is handled by switching to the POI Map ID instead.
const MAP_STYLES_CONFIG_POI_VISIBLE: Record<MapStyle, Array<{ elementType?: string; featureType?: string; stylers: Array<Record<string, string>>; }>> = {
  dark: DARK_BASE_STYLES,
  standard: STANDARD_BASE_STYLES,
  satellite: [],
  streets: [],
};

// Cloud Console's Map-ID-associated style (dark/light + POI on/off) only
// ever applies while the map is ACTUALLY rendering as vector — confirmed via
// Google's own console warning ("Attempted to load a Vector Map, but failed.
// Falling back to Raster") that this can happen silently even with a valid
// Map ID and API key, depending on the browser/GPU's WebGL support. When
// that fallback occurs, the Map ID technically stays assigned to the map
// instance, but the Cloud-configured POI visibility no longer applies —
// Google just renders its own default (POI-visible) raster tiles. The
// classic `styles` option is normally rejected outright whenever `mapId` is
// present, but that rule exists specifically to protect Cloud-based styling
// on vector rendering; once we're already degraded to plain raster, this
// re-applies our own known-correct style (including exhaustive POI hiding)
// as the only remaining lever, so Places OFF still reliably hides POIs even
// in the fallback case. No-op (and harmless) if the map is actually
// rendering as vector — Cloud styling is left in full control there.
function applyPoiVisibilityFallback(map: google.maps.Map, style: MapStyle, placesEnabled: boolean) {
  if (!USE_VECTOR_MAP) return; // no Map ID at all — normal raster styling path already handles this
  const renderingType = map.getRenderingType ? map.getRenderingType() : undefined;
  if (renderingType !== google.maps.RenderingType.RASTER) return;
  const styles = placesEnabled ? MAP_STYLES_CONFIG_POI_VISIBLE[style] : MAP_STYLES_CONFIG[style];
  map.setOptions({ styles });
}

// Vehicle/location marker asset (provided PNGs, tip pointing up/north by
// design — a CSS rotate(heading deg) therefore maps directly to compass
// bearing with no offset needed). The actual asset/size list lives in
// src/lib/cursors.ts (CURSOR_OPTIONS) so the Settings "Cursor" selector and
// this renderer share one source of truth.

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
    private cursorOption: CursorOption;

    constructor(position: google.maps.LatLngLiteral, heading: number, cursorOption: CursorOption) {
      super();
      this.position = position;
      this.heading = heading;
      this.cursorOption = cursorOption;
    }

    onAdd() {
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';

      const arrowEl = document.createElement('div');
      arrowEl.style.willChange = 'transform';
      arrowEl.style.transformOrigin = '50% 50%';
      arrowEl.style.backgroundSize = 'contain';
      arrowEl.style.backgroundRepeat = 'no-repeat';
      arrowEl.style.backgroundPosition = 'center';

      container.appendChild(arrowEl);
      this.container = container;
      this.arrowEl = arrowEl;
      this.applyCursorOption();
      this.applyHeading();

      // IMPORTANT: markerLayer, not overlayLayer. Route polylines render in
      // overlayLayer; Google's own documented pane stacking puts markerLayer
      // above it unconditionally. Using the same pane as the route (as this
      // used to) made the arrow's stacking depend on fragile DOM-append
      // ordering relative to the route's own canvas/SVG repaints — which is
      // exactly why the vehicle cursor could end up rendered underneath the
      // route line. markerLayer guarantees it's always on top, the same way
      // a native google.maps.Marker (used for destination/pin) already is.
      this.getPanes()?.markerLayer.appendChild(container);
    }

    draw() {
      if (!this.container) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;
      const size = this.cursorOption.displaySize;
      this.container.style.left = `${point.x - size / 2}px`;
      this.container.style.top = `${point.y - size / 2}px`;
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

    // Swaps which cursor asset/size is displayed on the EXISTING marker —
    // no recreation, so there's never a moment with two markers on screen
    // and switching is a single, cheap DOM style update (image is already
    // browser-cached from the Settings selector's own preview thumbnails).
    setCursorOption(cursorOption: CursorOption) {
      this.cursorOption = cursorOption;
      this.applyCursorOption();
      this.draw(); // display size may have changed — recompute the anchor offset
    }

    private applyCursorOption() {
      if (!this.container || !this.arrowEl) return;
      const { assetUrl, displaySize } = this.cursorOption;
      this.container.style.width = `${displaySize}px`;
      this.container.style.height = `${displaySize}px`;
      this.arrowEl.style.width = `${displaySize}px`;
      this.arrowEl.style.height = `${displaySize}px`;
      this.arrowEl.style.backgroundImage = `url(${assetUrl})`;
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

// Shared closest-point-on-polyline projection, used both to snap the
// rendered vehicle position onto the route (closestPointOnRoute) and, in
// animateFrame, to trim the traveled section off the route every frame —
// one projection implementation instead of two copies that could drift out
// of sync (and, since it's computed once and reused for both, no wasted
// duplicate work for a feature that already needs it per frame).
function projectOntoRoute(
  route: Array<[number, number]>,
  pos: [number, number]
): { point: [number, number]; segIdx: number } {
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

  return { point: bestProj, segIdx: bestIdx };
}

// Snaps a raw (GPS-smoothed) position onto the active route's geometry —
// the same "puck sits on the road" behavior as any turn-by-turn nav app.
// Only meaningful while actively navigating a known route; callers fall
// back to the raw position when there's no route to snap to.
function closestPointOnRoute(
  route: Array<[number, number]>,
  pos: [number, number]
): [number, number] {
  if (route.length < 2) return route[0] ?? pos;
  return projectOntoRoute(route, pos).point;
}

// Re-expresses traffic segments (index ranges into a route's coordinate
// array) after the vehicle's route projection has dropped `consumedIdx`
// original points off the front (see animateFrame's per-frame trimming).
// Segments fully behind the new index 0 are dropped; the segment straddling
// the cut is clamped to start at the new index 0.
function shiftTrafficSegments(
  segments: TrafficSegment[] | null,
  consumedIdx: number
): TrafficSegment[] | null {
  if (!segments || consumedIdx <= 0) return segments;
  const shifted: TrafficSegment[] = [];
  for (const seg of segments) {
    const endIdx = seg.endIdx - consumedIdx;
    if (endIdx <= 0) continue; // fully behind the vehicle now
    const startIdx = Math.max(0, seg.startIdx - consumedIdx);
    shifted.push({ startIdx, endIdx, category: seg.category });
  }
  return shifted;
}

// Renders the active A→B route as one or more colored polylines drawn from
// a fixed, bounded pool — never creates/destroys map objects per update.
// Each segment's coordinate range is disjoint from its neighbors (only the
// shared boundary point overlaps), so a yellow/red segment always fully
// REPLACES the blue route for that stretch — there is no separate "blue
// underneath" layer for it to hide behind. Real per-segment traffic data
// (from the Routes API) renders as BLUE (normal), YELLOW (slow), or RED
// (heavy/congested) — never green. When no traffic data is available at
// all for this route, the whole thing renders as a single plain BLUE
// segment (the route's default color).
function renderRouteWithTraffic(
  pool: google.maps.Polyline[],
  coordinates: Array<[number, number]>,
  segments: TrafficSegment[] | null | undefined
) {
  const path = coordinates.map(([lng, lat]) => ({ lat, lng }));

  if (!segments || segments.length === 0) {
    if (path.length >= 2 && pool.length > 0) {
      pool[0].setPath(path);
      pool[0].setOptions({ strokeColor: ROUTE_DEFAULT_COLOR });
    }
    for (let i = path.length >= 2 ? 1 : 0; i < pool.length; i++) {
      pool[i].setPath([]);
    }
    return;
  }

  let used = 0;
  for (const seg of segments) {
    if (used >= pool.length) break;
    const start = Math.max(0, seg.startIdx);
    const end = Math.min(coordinates.length - 1, seg.endIdx);
    const segPath = path.slice(start, end + 1);
    if (segPath.length < 2) continue;
    const poly = pool[used];
    poly.setPath(segPath);
    poly.setOptions({ strokeColor: TRAFFIC_SEGMENT_COLOR[seg.category] });
    used++;
  }
  for (let i = used; i < pool.length; i++) {
    pool[i].setPath([]);
  }
}

interface MapCanvasProps {
  language: Language;
  mapStyle: MapStyle;
  trafficEnabled: boolean;
  /** Native map POI (places) visibility — see GOOGLE_MAPS_MAP_ID_POI /
   * resolveMapId. Defaults to false (POIs off, the normal nav experience). */
  placesEnabled?: boolean;
  /** Which vehicle cursor asset to render — see src/lib/cursors.ts. Defaults
   * to DEFAULT_CURSOR_ID (the original arrow), so omitting this prop keeps
   * existing behavior identical. */
  cursorId?: CursorId;
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
  /** Compass view mode while following: 'northUp' keeps the camera heading
   * at 0 (map fixed, arrow rotates freely); 'headingUp' eases the camera
   * heading to match the vehicle's true heading (map rotates underneath a
   * screen-fixed arrow — only visually rotates on a vector map, see
   * USE_VECTOR_MAP). Defaults to 'northUp' — North-Up is the default mode. */
  mapViewMode?: 'northUp' | 'headingUp';
  /** Fires only when the map's current camera-heading crosses into a new
   * 45°-wide compass bucket (N/NE/E/SE/S/SW/W/NW) — not on every fractional
   * degree of the per-frame easing — so the compass button can display the
   * live geographic direction in Heading-Up mode without triggering a
   * React re-render on every animation frame. */
  onHeadingChange?: (cardinal: CompassLabel) => void;
}

export type CompassLabel = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const COMPASS_LABELS: readonly CompassLabel[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function headingToCardinal(heading: number): CompassLabel {
  const normalized = ((heading % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % COMPASS_LABELS.length;
  return COMPASS_LABELS[index];
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

// Bounded pool of polylines used to render the active A→B route as
// contiguous traffic-colored segments (see renderRouteWithTraffic). Real
// routes from the Routes API rarely carry more than a handful of distinct
// speedReadingIntervals; this cap just guards against a pathological
// response creating unbounded map objects.
const MAX_ROUTE_SEGMENTS = 24;

// The route's default color when no real per-segment traffic data exists
// for it at all (e.g. the legacy server-side /api/directions fallback path).
const ROUTE_DEFAULT_COLOR = '#1a73e8';

// Real traffic-condition colors — BLUE/YELLOW/RED only per spec. NORMAL is
// intentionally the same blue as ROUTE_DEFAULT_COLOR (normal road stays
// blue, whether that's because real data says so or because no data exists
// at all) — never green, per spec.
const TRAFFIC_SEGMENT_COLOR: Record<TrafficSegment['category'], string> = {
  NORMAL: ROUTE_DEFAULT_COLOR,
  SLOW: '#fbbc04',
  TRAFFIC_JAM: '#ea4335',
};

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  (
    {
      language,
      mapStyle,
      trafficEnabled,
      placesEnabled = false,
      cursorId = DEFAULT_CURSOR_ID,
      onMapReady,
      onUserLocationUpdate,
      onLocationError,
      onZoomChange,
      followMode,
      onFollowDisabled,
      onMapTap,
      onOffRoute,
      navigationMode = false,
      mapViewMode = 'northUp',
      onHeadingChange,
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
    const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Route polylines
    const mainRouteSegmentPolylinesRef = useRef<google.maps.Polyline[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
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
    const mapViewModeRef = useRef(mapViewMode);
    const onFollowDisabledRef = useRef(onFollowDisabled);
    const trafficEnabledRef = useRef(trafficEnabled);
    const placesEnabledRef = useRef(placesEnabled);
    const cursorIdRef = useRef(cursorId);
    const onMapTapRef = useRef(onMapTap);
    const onOffRouteRef = useRef(onOffRoute);
    const onHeadingChangeRef = useRef(onHeadingChange);
    const lastReportedCardinalRef = useRef<CompassLabel | null>(null);
    const activeRouteGeometryRef = useRef<Array<[number, number]> | null>(null);
    const activeRouteSegmentsRef = useRef<TrafficSegment[] | null>(null);
    const lastOffRouteCheckRef = useRef<number>(0);
    const lastPositionWriteRef = useRef<number>(0);
    const isDraggingRef = useRef(false);
    const isZoomingRef = useRef(false);
    const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Keep refs in sync with props
    followModeRef.current = followMode;
    navigationModeRef.current = navigationMode;
    mapViewModeRef.current = mapViewMode;
    onFollowDisabledRef.current = onFollowDisabled;
    trafficEnabledRef.current = trafficEnabled;
    placesEnabledRef.current = placesEnabled;
    cursorIdRef.current = cursorId;
    onMapTapRef.current = onMapTap;
    onOffRouteRef.current = onOffRoute;
    onHeadingChangeRef.current = onHeadingChange;

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

    // All the map-level event listeners the app needs, factored out of the
    // mount effect so recreateMapForStyle (below) can re-register them on a
    // freshly-created map instance without duplicating this code.
    const attachMapListeners = useCallback((map: google.maps.Map) => {
      // Vector rendering can fall back to raster asynchronously, after the
      // map is already constructed — this is the only reliable way to catch
      // that and apply the POI-visibility corrective fallback (see
      // applyPoiVisibilityFallback) the moment it actually happens, not just
      // once at creation time.
      map.addListener('renderingtype_changed', () => {
        applyPoiVisibilityFallback(map, currentStyleRef.current, placesEnabledRef.current);
      });

      map.addListener('zoom_changed', () => {
        onZoomChange(Math.round(map.getZoom() ?? 12));
        isZoomingRef.current = true;
        if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = setTimeout(() => {
          isZoomingRef.current = false;
        }, 300);
      });

      map.addListener('dragstart', () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
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

      map.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        const domE = e.domEvent as (MouseEvent | TouchEvent) | undefined;
        if (domE) {
          const pos = 'touches' in domE
            ? { x: (domE as TouchEvent).touches[0].clientX, y: (domE as TouchEvent).touches[0].clientY }
            : { x: (domE as MouseEvent).clientX, y: (domE as MouseEvent).clientY };
          dragStartPosRef.current = pos;

          const target = domE.target as HTMLElement;
          if (target && target.closest('[data-no-map-tap]')) return;
        }

        if (!onMapTapRef.current || !e.latLng) return;
        const coords: [number, number] = [e.latLng.lng(), e.latLng.lat()];
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          onMapTapRef.current?.(coords);
        }, LONG_PRESS_DURATION_MS);
      });

      map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
        if (!longPressTimerRef.current) return;
        const domE = e.domEvent as (MouseEvent | TouchEvent) | undefined;
        const start = dragStartPosRef.current;
        if (!domE || !start) return;
        const point = 'touches' in domE
          ? (domE as TouchEvent).touches[0]
          : (domE as MouseEvent);
        if (!point) return;
        const dx = Math.abs(point.clientX - start.x);
        const dy = Math.abs(point.clientY - start.y);
        if (dx > LONG_PRESS_MOVE_CANCEL_PX || dy > LONG_PRESS_MOVE_CANCEL_PX) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      });

      map.addListener('mouseup', () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      });
    }, [onZoomChange]);

    // Vector maps can't change their `colorScheme` after creation (Google's
    // documented behavior — setOptions has no effect on it post-init), so a
    // real Dark/Light toggle on a vector map requires recreating the
    // google.maps.Map instance itself with the new colorScheme. This does
    // NOT touch any of the app's own state/overlays: every existing
    // polyline/marker/overlay is just re-attached (.setMap(newMap)) rather
    // than recreated, and the previous camera position/heading/tilt is
    // preserved so the switch doesn't visually reset the view.
    //
    // The same recreation also carries whichever Map ID is currently active
    // (see resolveMapId) — so toggling "Show Places" uses this exact same
    // path, just switching mapId instead of (or alongside) colorScheme.
    const recreateMapForStyle = useCallback((style: MapStyle) => {
      const oldMap = mapRef.current;
      if (!oldMap || !containerRef.current) return;

      const center = oldMap.getCenter();
      const zoom = oldMap.getZoom() ?? NAV_ZOOM;
      const tilt = navigationModeRef.current ? NAV_MODE_TILT : 0;

      google.maps.event.clearInstanceListeners(oldMap);

      const newMap = new google.maps.Map(containerRef.current, {
        center: center ? { lat: center.lat(), lng: center.lng() } : { lat: GEORGIA_CENTER[1], lng: GEORGIA_CENTER[0] },
        zoom,
        heading: cameraHeadingRef.current,
        tilt,
        minZoom: 3,
        maxZoom: 20,
        mapTypeId: GOOGLE_MAP_TYPE[style],
        mapId: resolveMapId(placesEnabledRef.current),
        colorScheme: MAP_COLOR_SCHEME[style],
        backgroundColor: MAP_BACKGROUND_COLOR[style],
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,
        scaleControl: false,
        rotateControl: false,
        headingInteractionEnabled: false,
        tiltInteractionEnabled: false,
      } as google.maps.MapOptions);

      // Re-attach every existing overlay to the new map instance — nothing
      // here is recreated, just repointed.
      mainRouteCasingRef.current?.setMap(newMap);
      mainRouteSegmentPolylinesRef.current.forEach((poly) => poly.setMap(newMap));
      altRoutePolylinesRef.current.forEach(({ casing, line }) => {
        casing.setMap(newMap);
        line.setMap(newMap);
      });
      if (trafficEnabledRef.current) {
        trafficLayerRef.current?.setMap(newMap);
      }
      destinationMarkerRef.current?.setMap(newMap);
      pinMarkerRef.current?.setMap(newMap);
      userArrowMarkerRef.current?.setMap(newMap);

      attachMapListeners(newMap);
      applyPoiVisibilityFallback(newMap, style, placesEnabledRef.current);

      mapRef.current = newMap;
      currentStyleRef.current = style;
      // Force the next animateFrame tick to resync the camera against the
      // new map instance rather than assuming it already matches.
      lastCameraStateRef.current = null;
    }, [attachMapListeners]);

    const applyMapStyleToMap = useCallback((style: MapStyle) => {
      const map = mapRef.current;
      if (!map) return;
      if (USE_VECTOR_MAP) {
        recreateMapForStyle(style);
        return;
      }
      map.setMapTypeId(GOOGLE_MAP_TYPE[style]);
      map.setOptions({ backgroundColor: MAP_BACKGROUND_COLOR[style] });
      map.setOptions({ styles: style !== 'satellite' ? MAP_STYLES_CONFIG[style] : [] });
      currentStyleRef.current = style;
    }, [recreateMapForStyle]);

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
        const overlay = new ArrowOverlayClassRef.current(position, heading, getCursorOption(cursorIdRef.current));
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

        // While actively navigating a known route, the DISPLAYED position
        // (arrow + camera center) is snapped onto the route geometry — GPS
        // noise is first smoothed above, then any remaining perpendicular
        // offset from the road is corrected here so the cursor visually
        // sits on the route rather than beside it. The underlying
        // renderedPositionRef trajectory above stays unsnapped so off-route
        // detection and future interpolation keep tracking the real fix.
        //
        // This projection is computed ONCE per frame and reused below for
        // route trimming too, so the cursor's position and the route
        // polyline's trimmed start point are always derived from the exact
        // same value in the exact same frame — they cannot visually diverge
        // into a "tail" behind the cursor.
        const hasActiveRoute = navigationModeRef.current && !!activeRouteGeometryRef.current && activeRouteGeometryRef.current.length > 1;
        const routeProjection = hasActiveRoute ? projectOntoRoute(activeRouteGeometryRef.current!, nextPosition) : null;
        const displayPosition = routeProjection ? routeProjection.point : nextPosition;

        const headingGap = Math.abs(angleDiff(currentHeadingRef.current, targetHeadingRef.current));
        currentHeadingRef.current = currentHeadingRef.current + angleDiff(currentHeadingRef.current, targetHeadingRef.current) * ARROW_HEADING_LERP_ALPHA;

        // Camera heading target depends on the compass view mode: North-Up
        // keeps the camera fixed at 0 (map never rotates, arrow rotates
        // freely); Heading-Up eases the camera toward the vehicle's true
        // heading (map rotates underneath a screen-fixed arrow). angleDiff
        // always takes the shortest circular path, so switching modes (or
        // the heading crossing 0°/360°) animates smoothly, never a hard cut
        // or a near-full-circle spin.
        const cameraHeadingTarget = mapViewModeRef.current === 'northUp' ? 0 : targetHeadingRef.current;
        cameraHeadingRef.current = cameraHeadingRef.current + angleDiff(cameraHeadingRef.current, cameraHeadingTarget) * CAMERA_BEARING_ALPHA;

        // Compass label: reflects whatever direction is currently at the top
        // of the screen (the camera's actual heading), bucketed into 8
        // compass points so it only fires — and only triggers a React
        // re-render in the parent — when the DISPLAYED letter would actually
        // change, not on every fractional degree of easing. In North-Up
        // mode the button always shows a fixed "N" regardless of this value
        // (see RecenterButton), so this only visibly matters in Heading-Up.
        if (onHeadingChangeRef.current) {
          const cardinal = headingToCardinal(cameraHeadingRef.current);
          if (cardinal !== lastReportedCardinalRef.current) {
            lastReportedCardinalRef.current = cardinal;
            onHeadingChangeRef.current(cardinal);
          }
        }

        // The arrow's ON-SCREEN rotation is relative to the camera's actual
        // rotation, not the raw compass heading — but ONLY on a vector map,
        // where moveCamera({heading}) really does rotate the map visually.
        // On raster (no Map ID configured — see USE_VECTOR_MAP), the map
        // never visually rotates regardless of mode, so the arrow must keep
        // showing the true heading directly; making it screen-relative there
        // would freeze the arrow while the (unrotated) map still shows the
        // vehicle driving in a different direction. On a vector map this
        // formula is what makes North-Up (camera heading ~0) show the arrow
        // rotating freely, and Heading-Up (camera heading ~= true heading)
        // show the arrow fixed pointing up while the map rotates under it.
        const arrowScreenHeading = USE_VECTOR_MAP
          ? angleDiff(cameraHeadingRef.current, currentHeadingRef.current)
          : currentHeadingRef.current;
        updateArrowMarker(displayPosition, arrowScreenHeading);

        if (followModeRef.current) {
          const navMode = navigationModeRef.current;
          const zoom = navMode ? NAV_MODE_ZOOM : NAV_ZOOM;
          // In navigation mode, bias the camera center ahead of the user along
          // their heading — since moveCamera has no native "padding" concept,
          // this is how we get the user/arrow to render lower on screen with
          // the road and destination visible ahead, like a real nav app.
          const center = navMode
            ? destinationPoint(displayPosition, cameraHeadingRef.current, NAV_MODE_LOOKAHEAD_M)
            : displayPosition;
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

        // Route progress ("Pac-Man" consumption): trim the traveled section
        // off the back of the route polyline as the vehicle advances, so
        // only the remaining road ahead stays drawn. This runs every single
        // frame (no timer throttle, no "did the point count change" gate) —
        // both of those previously let the polyline's start point sit still
        // for up to ~200ms, or for the vehicle's entire traversal of a
        // single route segment, while the cursor kept moving every frame,
        // which is exactly what produced the visible blue "tail" behind it.
        // Reusing routeProjection (computed above for the cursor) means this
        // costs nothing extra to project — just an array slice + setPath.
        if (routeProjection) {
          const { point, segIdx } = routeProjection;
          const trimmed = [point, ...activeRouteGeometryRef.current!.slice(segIdx + 1)];
          activeRouteGeometryRef.current = trimmed;
          activeRouteSegmentsRef.current = shiftTrafficSegments(activeRouteSegmentsRef.current, segIdx);
          const path = trimmed.map(([lng, lat]) => ({ lat, lng }));
          mainRouteCasingRef.current?.setPath(path);
          renderRouteWithTraffic(mainRouteSegmentPolylinesRef.current, trimmed, activeRouteSegmentsRef.current);
        }

        const posGap = haversineDistance(nextPosition, target);
        // Camera-heading convergence is checked separately from the arrow's
        // own heading gap above: in North-Up mode they chase different
        // targets (0 vs true heading), so relying only on the arrow's gap
        // could report "settled" — and stop the animation loop — while the
        // camera is still mid-rotation after a compass mode switch.
        const cameraHeadingGap = Math.abs(angleDiff(cameraHeadingRef.current, cameraHeadingTarget));
        settled =
          posGap < CONVERGED_POS_EPSILON_M &&
          headingGap < CONVERGED_HEADING_EPSILON_DEG &&
          cameraHeadingGap < CONVERGED_HEADING_EPSILON_DEG;
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

    // "Show Places" changed — on a vector map this means a different Map ID
    // is now active (see resolveMapId), which (like the Dark/Light toggle)
    // requires recreating the map instance. No-op on raster (no Map ID at
    // all) since there's nothing to recreate against.
    useEffect(() => {
      if (isMapReadyRef.current && USE_VECTOR_MAP) {
        recreateMapForStyle(currentStyleRef.current);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [placesEnabled, recreateMapForStyle]);

    useEffect(() => {
      if (isMapReadyRef.current) {
        applyTrafficVisibility(trafficEnabled);
      }
    }, [trafficEnabled, applyTrafficVisibility]);

    // Cursor selection changed — update the existing marker's asset/size in
    // place (see ArrowOverlay.setCursorOption). Never recreates the marker,
    // so there's no window where two markers could exist at once.
    useEffect(() => {
      userArrowMarkerRef.current?.setCursorOption(getCursorOption(cursorId));
    }, [cursorId]);

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
          // whenever mapId is set) — only send one or the other. colorScheme
          // picks between the Cloud Console-authored dark/light style
          // variants for this Map ID (see MAP_COLOR_SCHEME above); it can
          // only be set here, at creation — recreateMapForStyle is what
          // lets the Dark/Light toggle change it after the fact. mapId is
          // resolved via resolveMapId so an initial placesEnabled=true
          // (e.g. restored from localStorage before this effect ran) is
          // honored from the very first paint, not just after a toggle.
          ...(USE_VECTOR_MAP
            ? { mapId: resolveMapId(placesEnabledRef.current), colorScheme: MAP_COLOR_SCHEME[mapStyle] }
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
        // Fixed pool of segment polylines for the active A→B route — real
        // per-segment traffic coloring (see renderRouteWithTraffic), never
        // created/destroyed at runtime.
        for (let i = 0; i < MAX_ROUTE_SEGMENTS; i++) {
          mainRouteSegmentPolylinesRef.current.push(
            new google.maps.Polyline({
              map,
              path: [],
              strokeColor: ROUTE_DEFAULT_COLOR,
              strokeWeight: 7,
              strokeOpacity: 1,
              zIndex: 2,
            })
          );
        }

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

        attachMapListeners(map);
        applyPoiVisibilityFallback(map, mapStyle, placesEnabledRef.current);

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
                map.panTo({ lat: rawCoords[1], lng: rawCoords[0] });
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
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        // Clean up markers
        destinationMarkerRef.current?.setMap(null);
        pinMarkerRef.current?.setMap(null);
        userArrowMarkerRef.current?.setMap(null);
        trafficLayerRef.current?.setMap(null);
        mainRouteSegmentPolylinesRef.current.forEach((poly) => poly.setMap(null));
        mainRouteSegmentPolylinesRef.current = [];
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
    // Also re-kicks on a North-Up/Heading-Up compass toggle — that changes
    // cameraHeadingRef's target without any new GPS fix, so the interpolation
    // loop needs waking up to actually animate the rotation instead of
    // sitting settled until the next unrelated GPS tick.
    useEffect(() => {
      if (followMode) kickAnimationRef.current();
    }, [followMode, navigationMode, mapViewMode]);

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
            activeRouteGeometryRef.current = geometry.coordinates as [number, number][];
            activeRouteSegmentsRef.current = null;
            renderRouteWithTraffic(mainRouteSegmentPolylinesRef.current, activeRouteGeometryRef.current, null);
          } else {
            mainRouteCasingRef.current?.setPath([]);
            mainRouteSegmentPolylinesRef.current.forEach((poly) => poly.setPath([]));
            activeRouteGeometryRef.current = null;
            activeRouteSegmentsRef.current = null;
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
            activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
            activeRouteSegmentsRef.current = selected.trafficSegments ?? null;
            renderRouteWithTraffic(mainRouteSegmentPolylinesRef.current, activeRouteGeometryRef.current, activeRouteSegmentsRef.current);
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
            activeRouteGeometryRef.current = selected.geometry.coordinates as [number, number][];
            activeRouteSegmentsRef.current = selected.trafficSegments ?? null;
            renderRouteWithTraffic(mainRouteSegmentPolylinesRef.current, activeRouteGeometryRef.current, activeRouteSegmentsRef.current);
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