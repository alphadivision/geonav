import type { UserLocation } from '@/types';

export type GeolocationCallback = (location: UserLocation) => void;
export type GeolocationErrorCallback = (error: GeolocationPositionError) => void;

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
        maximumAge: 5000,
      }
    );
  });
}

export function watchPosition(
  onSuccess: GeolocationCallback,
  onError: GeolocationErrorCallback
): number {
  if (!navigator.geolocation) return -1;

  return navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
      });
    },
    onError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000,
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