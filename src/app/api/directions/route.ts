import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Google Routes API (v2)
// Uses GOOGLE_MAPS_SERVER_KEY (no referrer restrictions) or falls back to NEXT_PUBLIC key
const GOOGLE_API_KEY =
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
    return NextResponse.json(
      { error: 'Google Maps API key not configured' },
      { status: 500 }
    );
  }

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
      languageCode: 'ka',
      units: 'METRIC',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[directions] Routes API error:', response.status, errText);
      throw new Error(`Routes API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return NextResponse.json(
        { error: 'No routes found', status: 'ZERO_RESULTS' },
        { status: 422 }
      );
    }

    const routes = data.routes.map((route: {
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
    }) => {
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
    console.error('[directions] Error:', message);
    return NextResponse.json(
      { error: 'Directions failed', detail: message },
      { status: 500 }
    );
  }
}