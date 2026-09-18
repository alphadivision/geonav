import { NextRequest, NextResponse } from 'next/server';
import { buildTrafficSegments } from '@/lib/traffic';

// Server-side Google Routes API handler.
// Requires an UNRESTRICTED server API key (no HTTP referrer restrictions).
// GOOGLE_MAPS_SERVER_API_KEY or GOOGLE_MAPS_SERVER_KEY must be set to an unrestricted key.
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is a browser-restricted key and will be REJECTED by Google
// when called from a Node.js server (no real browser Referer).
const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_SERVER_API_KEY ||
  process.env.GOOGLE_MAPS_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Decode Google's encoded polyline format into [lng, lat] coordinate pairs
function decodePolyline(encoded: string): Array<[number, number]> {
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

// Parse Routes API duration string like "165s" or "3600.5s" to seconds integer
function parseDurationSeconds(durationStr: string): number {
  if (!durationStr) return 0;
  const match = durationStr.match(/^(\d+(?:\.\d+)?)s$/);
  if (match) return Math.round(parseFloat(match[1]));
  return 0;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const originLng = searchParams.get('olng');
  const originLat = searchParams.get('olat');
  const destLng = searchParams.get('dlng');
  const destLat = searchParams.get('dlat');

  if (!originLng || !originLat || !destLng || !destLat) {
    return NextResponse.json(
      { error: 'Origin and destination coordinates required' },
      { status: 400 }
    );
  }

  if (!GOOGLE_API_KEY) {
    console.error('[directions] No API key configured. Set GOOGLE_MAPS_SERVER_API_KEY (unrestricted server key).');
    return NextResponse.json(
      { error: 'Google Maps API key not configured. Set GOOGLE_MAPS_SERVER_API_KEY.' },
      { status: 500 }
    );
  }

  const keySource = process.env.GOOGLE_MAPS_SERVER_API_KEY
    ? 'GOOGLE_MAPS_SERVER_API_KEY'
    : process.env.GOOGLE_MAPS_SERVER_KEY
    ? 'GOOGLE_MAPS_SERVER_KEY' :'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (browser-restricted — may fail)';

  console.log(`[directions] Using key from: ${keySource}`);
  console.log(`[directions] Route: [${originLng},${originLat}] → [${destLng},${destLat}]`);

  try {
    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    const requestBody = {
      origin: {
        location: {
          latLng: {
            latitude: parseFloat(originLat),
            longitude: parseFloat(originLng),
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: parseFloat(destLat),
            longitude: parseFloat(destLng),
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: true,
      // Required for the response to populate travelAdvisory.speedReadingIntervals
      // (per-segment traffic speed data) below — see src/lib/traffic.ts.
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      languageCode: 'ka',
      units: 'METRIC',
    };

    console.log('[directions] Sending to Routes API:', JSON.stringify(requestBody));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.travelAdvisory.speedReadingIntervals',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000),
    });

    const responseText = await response.text();
    console.log(`[directions] Routes API HTTP status: ${response.status}`);
    console.log(`[directions] Routes API response body: ${responseText}`);

    if (!response.ok) {
      console.error(`[directions] Routes API FAILED — HTTP ${response.status}: ${responseText}`);
      return NextResponse.json(
        {
          error: `Routes API error: HTTP ${response.status}`,
          googleError: responseText,
          keySource,
        },
        { status: response.status >= 400 && response.status < 500 ? 422 : 502 }
      );
    }

    let data: {
      routes?: Array<{
        distanceMeters: number;
        duration: string;
        staticDuration?: string;
        polyline: { encodedPolyline: string };
        legs: Array<{
          distanceMeters: number;
          duration: string;
          steps: Array<{
            distanceMeters: number;
            staticDuration?: string;
            navigationInstruction?: {
              instructions: string;
              maneuver: string;
            };
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

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[directions] Failed to parse Routes API response as JSON:', responseText);
      return NextResponse.json(
        { error: 'Invalid JSON from Routes API', raw: responseText },
        { status: 502 }
      );
    }

    if (!data.routes || data.routes.length === 0) {
      console.warn('[directions] Routes API returned no routes. Body:', responseText);
      return NextResponse.json(
        { error: 'No routes found', status: 'ZERO_RESULTS' },
        { status: 422 }
      );
    }

    console.log(`[directions] Got ${data.routes.length} route(s). First polyline length: ${data.routes[0]?.polyline?.encodedPolyline?.length ?? 0}`);

    const routes = data.routes.map((route) => {
      const totalDistance = route.distanceMeters;
      const totalDuration = parseDurationSeconds(route.duration || route.staticDuration || '0s');
      const overviewCoords = decodePolyline(route.polyline.encodedPolyline);

      const leg = route.legs?.[0];
      const steps = (leg?.steps || []).map((step) => ({
        maneuver: {
          instruction: step.navigationInstruction?.instructions || '',
          type: step.navigationInstruction?.maneuver?.toLowerCase() || 'straight',
        },
        distance: step.distanceMeters || 0,
        duration: parseDurationSeconds(step.staticDuration || '0s'),
        intersections: [{ classes: [] }],
      }));

      const trafficSegments = buildTrafficSegments(route.travelAdvisory?.speedReadingIntervals, overviewCoords.length);

      return {
        distance: totalDistance,
        duration: totalDuration,
        geometry: {
          type: 'LineString',
          coordinates: overviewCoords,
        },
        legs: [
          {
            distance: leg?.distanceMeters ?? totalDistance,
            duration: parseDurationSeconds(leg?.duration ?? route.duration ?? '0s'),
            steps,
          },
        ],
        trafficSegments,
      };
    });

    const transformed = {
      routes,
      waypoints: [
        { name: 'origin', location: [parseFloat(originLng), parseFloat(originLat)] as [number, number] },
        { name: 'destination', location: [parseFloat(destLng), parseFloat(destLat)] as [number, number] },
      ],
      code: 'Ok',
    };

    return NextResponse.json(transformed, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[directions] Unexpected error:', message);
    return NextResponse.json(
      { error: 'Directions failed', detail: message },
      { status: 500 }
    );
  }
}