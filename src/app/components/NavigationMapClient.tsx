'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { LineString } from 'geojson';
import type { Language } from '@/lib/i18n';
import type { MapStyle } from '@/types';
import { getStoredLanguage, setStoredLanguage, getTranslations, TRAFFIC_KEY } from '@/lib/i18n';
import type {
  SearchResult,
  RouteInfo,
  RouteAlternative,
  PinDestination,
  UserLocation,
  AppState,
  ErrorType,
  DirectionsResponse,
} from '@/types';
import SearchBar from './SearchBar';
import LanguageSwitcher from './LanguageSwitcher';
import ZoomControls from './ZoomControls';
import LocationButton from './LocationButton';
import DestinationCard from './DestinationCard';
import ErrorToast from './ErrorToast';
import LoadingOverlay from './LoadingOverlay';
import MapStyleSwitcher, { getStoredMapStyle, setStoredMapStyle } from './MapStyleSwitcher';
import TrafficButton from './TrafficButton';
import RouteAlternativesPanel from './RouteAlternativesPanel';
import PinDestinationCard from './PinDestinationCard';
import type { MapCanvasHandle } from './MapCanvas';

const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full spinner" />
        <p className="text-muted-foreground text-sm font-medium">GeoNav</p>
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

export default function NavigationMapClient() {
  const [language, setLanguage] = useState<Language>('ka');
  const [appState, setAppState] = useState<AppState>('idle');
  const [selectedDestination, setSelectedDestination] = useState<SearchResult | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternative[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(12);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [followMode, setFollowMode] = useState(false);
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  // Tap-to-navigate state
  const [pinDestination, setPinDestination] = useState<PinDestination | null>(null);
  const [isPinCalculating, setIsPinCalculating] = useState(false);
  const [showReplacePrompt, setShowReplacePrompt] = useState<[number, number] | null>(null);

  const mapRef = useRef<MapCanvasHandle | null>(null);
  const userLocationRef = useRef<UserLocation | null>(null);
  const routeAlternativesRef = useRef<RouteAlternative[]>([]);

  // Keep refs in sync
  userLocationRef.current = userLocation;
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
  }, []);

  const t = getTranslations(language);

  const handleLanguageChange = useCallback((lang: Language) => {
    setLanguage(lang);
    setStoredLanguage(lang);
  }, []);

  const handleMapReady = useCallback(() => {
    setIsMapReady(true);
  }, []);

  const handleUserLocationUpdate = useCallback((location: UserLocation) => {
    setUserLocation(location);
    if (mapRef.current) {
      mapRef.current.setUserMarker([location.lng, location.lat]);
    }
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
  const fetchRoutes = useCallback(
    async (
      origin: UserLocation,
      destCoords: [number, number]
    ): Promise<RouteAlternative[] | null> => {
      const params = new URLSearchParams({
        olng: origin.lng.toString(),
        olat: origin.lat.toString(),
        dlng: destCoords[0].toString(),
        dlat: destCoords[1].toString(),
      });

      const res = await fetch(`/api/directions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: DirectionsResponse = await res.json();
      if (!data.routes || data.routes.length === 0) throw new Error('No routes returned');

      return buildRouteAlternatives(data);
    },
    []
  );

  const handleDestinationSelect = useCallback(
    (result: SearchResult) => {
      setSelectedDestination(result);
      setRouteInfo(null);
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setAppState('destinationSelected');
      setPinDestination(null);
      setShowReplacePrompt(null);
      // Do NOT disable follow mode here — it will auto-enable when route is active
      if (mapRef.current) {
        mapRef.current.flyTo(result.coordinates, 15);
        mapRef.current.setDestinationMarker(result.coordinates);
        mapRef.current.setPinMarker(null);
        mapRef.current.setRoute(null);
        mapRef.current.setAlternativeRoutes([], 0);
      }
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
      // Auto-enable follow mode when navigation starts
      setFollowMode(true);

      if (mapRef.current) {
        mapRef.current.setAlternativeRoutes(alternatives, fastestIdx);
        mapRef.current.fitRoute(alternatives[fastestIdx].geometry as LineString);
      }
    } catch (err) {
      console.error('[route] Error:', err);
      setAppState('destinationSelected');
      setErrorType('route_error');
      setErrorMessage(t.routeError);
    }
  }, [selectedDestination, t, fetchRoutes]);

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
    if (mapRef.current) {
      mapRef.current.setDestinationMarker(null);
      mapRef.current.setPinMarker(null);
      mapRef.current.setRoute(null);
      mapRef.current.setAlternativeRoutes([], 0);
    }
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
      // Auto-enable follow mode when navigation starts
      setFollowMode(true);

      if (mapRef.current) {
        mapRef.current.setPinMarker(null);
        mapRef.current.setDestinationMarker(pinDestination.coordinates);
        mapRef.current.setAlternativeRoutes(alternatives, fastestIdx);
        mapRef.current.fitRoute(alternatives[fastestIdx].geometry as LineString);
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
    setMapZoom((z) => Math.min(z + 1, 20));
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomOut();
    setMapZoom((z) => Math.max(z - 1, 1));
  }, []);

  // Location button: restore follow mode + fly to user
  const handleLocateMe = useCallback(() => {
    setFollowMode(true);
    if (mapRef.current) mapRef.current.locateUser();
  }, []);

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
    appState === 'routeActive' && routeAlternatives.length > 0 && selectedDestination;

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
          onZoomChange={setMapZoom}
          followMode={followMode}
          onFollowDisabled={handleFollowDisabled}
          onMapTap={handleMapTap}
          onOffRoute={handleOffRoute}
        />
      </div>

      {/* Top overlay: search bar + language switcher */}
      <div className="fixed top-0 left-0 right-0 z-panel pointer-events-none">
        <div className="flex items-start gap-3 p-3 sm:p-4 pointer-events-auto" data-no-map-tap>
          <div className="flex-1 min-w-0">
            <SearchBar
              language={language}
              t={t}
              onSelectResult={handleDestinationSelect}
              disabled={!isMapReady}
            />
          </div>
          <div className="flex-shrink-0 mt-0.5">
            <LanguageSwitcher
              language={language}
              onChange={handleLanguageChange}
            />
          </div>
        </div>
      </div>

      {/* Right side controls: zoom + traffic + map style + locate */}
      <div
        className="fixed right-3 sm:right-5 bottom-4 z-panel flex flex-col gap-2"
        data-no-map-tap
      >
        <ZoomControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          t={t}
        />
        <div className="h-2" />
        <TrafficButton
          trafficEnabled={trafficEnabled}
          onToggle={handleTrafficToggle}
          t={t}
        />
        <MapStyleSwitcher
          currentStyle={mapStyle}
          onStyleChange={handleMapStyleChange}
          t={t}
        />
        <div className="h-1" />
        <LocationButton
          onLocate={handleLocateMe}
          t={t}
          followMode={followMode}
        />
      </div>

      {/* Replace destination prompt */}
      {showReplacePrompt && (
        <div
          className="fixed bottom-0 left-0 right-0 z-panel bottom-sheet-enter"
          data-no-map-tap
        >
          <div
            className="mx-3 mb-3 rounded-2xl shadow-2xl shadow-black/70 px-4 py-4"
            style={{ backdropFilter: 'blur(16px)', background: 'rgba(18,18,24,0.88)', border: '1px solid rgba(255,255,255,0.10)' }}
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
          className="fixed bottom-0 left-0 right-0 z-panel bottom-sheet-enter"
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
          className="fixed bottom-0 left-0 right-0 z-panel bottom-sheet-enter"
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
          className="fixed bottom-0 left-0 right-0 z-panel bottom-sheet-enter"
          data-no-map-tap
        >
          <RouteAlternativesPanel
            routes={routeAlternatives}
            selectedIndex={selectedRouteIndex}
            language={language}
            t={t}
            onSelectRoute={handleSelectRoute}
            onClear={handleClearDestination}
            destinationName={selectedDestination!.name}
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