import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Google Directions API
// Env: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (also readable server-side)

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

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
    const origin = `${originLat},${originLng}`;
    const destination = `${destLat},${destLng}`;

    const url = [
      `https://maps.googleapis.com/maps/api/directions/json`,
      `?origin=${origin}`,
      `&destination=${destination}`,
      `&mode=driving`,
      `&alternatives=true`,
      `&key=${GOOGLE_API_KEY}`,
      `&language=ka`,
    ].join('');

    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Google Directions error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      return NextResponse.json(
        { error: data.error_message || 'Route calculation failed', status: data.status },
        { status: 422 }
      );
    }

    // Transform Google Directions response to match existing DirectionsResponse shape
    const routes = (data.routes || []).map((route: {
      legs: Array<{
        distance: { value: number };
        duration: { value: number };
        steps: Array<{
          distance: { value: number };
          duration: { value: number };
          html_instructions: string;
          maneuver?: string;
          polyline: { points: string };
        }>;
      }>;
      overview_polyline: { points: string };
    }) => {
      const leg = route.legs[0];
      const totalDistance = leg.distance.value; // meters
      const totalDuration = leg.duration.value; // seconds
      const overviewCoords = decodePolyline(route.overview_polyline.points);

      const steps = leg.steps.map((step) => ({
        maneuver: {
          instruction: step.html_instructions.replace(/<[^>]+>/g, ''),
          type: step.maneuver || 'straight',
        },
        distance: step.distance.value,
        duration: step.duration.value,
        intersections: [
          {
            // Map Google step maneuver to road class approximation
            classes: step.maneuver?.includes('highway') ? ['motorway'] : [],
          },
        ],
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
            distance: totalDistance,
            duration: totalDuration,
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
      headers: {
        'Cache-Control': 'public, max-age=120',
      },
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