import type { UserLocation } from '@/types';

export type GeolocationCallback = (location: UserLocation) => void;
export type GeolocationErrorCallback = (error: GeolocationPositionError) => void;

// Maximum acceptable accuracy in metres.
// Readings worse than this are logged but discarded so the marker
// does not teleport to an obviously wrong location (e.g. WiFi-based
// cemetery fix while the user is elsewhere in Tbilisi).
const MAX_ACCEPTABLE_ACCURACY = 200;

// Minimum accuracy improvement required to replace a previously accepted fix.
// Prevents constant jitter between two mediocre readings.
const MIN_ACCURACY_IMPROVEMENT = 50;

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
        // maximumAge: 0 — never use a cached position; always request a fresh fix
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

  // Track the best accuracy seen so far so we can reject degraded readings
  let bestAccuracy: number | null = null;

  return navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy, heading, speed, altitudeAccuracy } = position.coords;
      const timestamp = position.timestamp;

      // ── Dev logging ────────────────────────────────────────────────────────
      // These logs help diagnose whether the browser itself is returning wrong
      // coordinates or whether the app is modifying them.
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

      // ── Accuracy gate ──────────────────────────────────────────────────────
      // If accuracy is worse than our threshold AND we already have a good fix,
      // discard this reading to avoid teleporting the marker.
      if (accuracy != null && accuracy > MAX_ACCEPTABLE_ACCURACY) {
        console.warn(
          `[GeoNav GPS] Discarding inaccurate fix: accuracy=${accuracy.toFixed(1)}m > threshold=${MAX_ACCEPTABLE_ACCURACY}m`
        );
        return; // keep the last reliable position
      }

      // If we have a previous best and this reading is significantly worse, skip it
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

      // Accept this fix — update best accuracy
      if (accuracy != null) {
        bestAccuracy = accuracy;
      }

      onSuccess({
        lat: latitude,
        lng: longitude,
        accuracy: accuracy ?? undefined,
        heading: heading ?? undefined,
      });
    },
    onError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      // maximumAge: 0 — always request a fresh fix; never serve a stale cached position
      maximumAge: 0,
    }
  );
}

export function clearWatch(watchId: number): void {
  if (watchId !== -1 && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
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