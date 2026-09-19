import type { UserLocation } from '@/types';

export type GeolocationCallback = (location: UserLocation) => void;
export type GeolocationErrorCallback = (error: GeolocationPositionError) => void;

// Maximum acceptable accuracy in metres.
const MAX_ACCEPTABLE_ACCURACY = 200;

// Minimum accuracy improvement required to replace a previously accepted fix.
const MIN_ACCURACY_IMPROVEMENT = 50;

// Internal map from stable handle → real browser watchId.
// This lets clearWatch always cancel whichever stage is currently active.
const _watchHandles = new Map<number, number>();
let _nextHandle = 1;

export function getCurrentPosition(): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

export function watchPosition(
  onSuccess: GeolocationCallback,
  onError: GeolocationErrorCallback
): number {
  if (!navigator.geolocation) return -1;

  // Stable handle returned to the caller — never changes even when the real
  // browser watchId is replaced during the Stage 2 fallback.
  const handle = _nextHandle++;
  let bestAccuracy: number | null = null;

  const successHandler = (position: GeolocationPosition) => {
    const { latitude, longitude, accuracy, heading, speed, altitudeAccuracy } = position.coords;
    const timestamp = position.timestamp;

    // Verbose per-fix logging is dev-only — this fires on every single GPS
    // update for the entire drive, and the string formatting/Date work below
    // is pure overhead in production (especially on constrained hardware).
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[GeoNav GPS]',
        `lat=${latitude.toFixed(7)}`,
        `lng=${longitude.toFixed(7)}`,
        `accuracy=${accuracy != null ? accuracy.toFixed(1) + 'm' : 'n/a'}`,
        `heading=${heading != null ? heading.toFixed(1) + '°' : 'n/a'}`,
        `speed=${speed != null ? speed.toFixed(2) + 'm/s' : 'n/a'}`,
        `altAccuracy=${altitudeAccuracy != null ? altitudeAccuracy.toFixed(1) + 'm' : 'n/a'}`,
        `age=${((Date.now() - timestamp) / 1000).toFixed(1)}s ago`,
        `ts=${new Date(timestamp).toISOString()}`
      );
    }

    if (accuracy != null && accuracy > MAX_ACCEPTABLE_ACCURACY) {
      console.warn(
        `[GeoNav GPS] Discarding inaccurate fix: accuracy=${accuracy.toFixed(1)}m > threshold=${MAX_ACCEPTABLE_ACCURACY}m`
      );
      return;
    }

    if (
      bestAccuracy !== null &&
      accuracy != null &&
      accuracy > bestAccuracy + MIN_ACCURACY_IMPROVEMENT
    ) {
      console.warn(
        `[GeoNav GPS] Discarding degraded fix: accuracy=${accuracy.toFixed(1)}m, best so far=${bestAccuracy.toFixed(1)}m`
      );
      return;
    }

    if (accuracy != null) {
      bestAccuracy = accuracy;
    }

    onSuccess({
      lat: latitude,
      lng: longitude,
      accuracy: accuracy ?? undefined,
      heading: heading ?? undefined,
      speed: speed ?? undefined,
    });
  };

  const errorHandler = (error: GeolocationPositionError) => {
    if (error.code === 3 /* TIMEOUT */) {
      // Stage 1 (high-accuracy) timed out.
      // Fall back to network/WiFi location — responds in milliseconds on Tesla
      // and mobile browsers, eliminating the timeout entirely.
      console.warn(
        '[GeoNav GPS locate] Stage 2 fallback: high-accuracy timed out (Code 3), retrying with network location'
      );

      // Cancel the timed-out Stage 1 watcher
      const oldBrowserId = _watchHandles.get(handle);
      if (oldBrowserId !== undefined) {
        navigator.geolocation.clearWatch(oldBrowserId);
      }

      // Start Stage 2 — low-accuracy (network/WiFi), generous timeout
      const stage2Id = navigator.geolocation.watchPosition(
        successHandler,
        (fallbackError) => {
          console.warn(
            `[GeoNav GPS locate] Stage 2 error. Code: ${fallbackError.code} ${fallbackError.message}`
          );
          onError(fallbackError);
        },
        {
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 30000,
        }
      );

      // Update the handle map so clearWatch cancels Stage 2
      _watchHandles.set(handle, stage2Id);
    } else {
      onError(error);
    }
  };

  // Stage 1: high-accuracy GPS.
  // maximumAge: 30000 — accept a cached position up to 30 s old to avoid cold-start timeouts.
  // timeout: 30000   — give the GPS chip 30 s before falling back to Stage 2.
  const stage1Id = navigator.geolocation.watchPosition(successHandler, errorHandler, {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 30000,
  });

  _watchHandles.set(handle, stage1Id);
  return handle;
}

export function clearWatch(handle: number): void {
  if (handle === -1) return;
  const browserId = _watchHandles.get(handle);
  if (browserId !== undefined && navigator.geolocation) {
    navigator.geolocation.clearWatch(browserId);
    _watchHandles.delete(handle);
  }
}

export function formatDistance(meters: number, lang: 'ka' | 'en'): string {
  const kmLabel = lang === 'ka' ? 'კმ' : 'km';
  const mLabel = lang === 'ka' ? 'მ' : 'm';

  if (meters >= 1000) {
    const km = (meters / 1000).toFixed(1);
    return `${km} ${kmLabel}`;
  }
  return `${Math.round(meters)} ${mLabel}`;
}

export function formatDuration(seconds: number, lang: 'ka' | 'en'): string {
  const minLabel = lang === 'ka' ? 'წთ' : 'min';
  const hrLabel = lang === 'ka' ? 'სთ' : 'hr';

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} ${minLabel}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (mins === 0) return `${hours} ${hrLabel}`;
  return `${hours} ${hrLabel} ${mins} ${minLabel}`;
}