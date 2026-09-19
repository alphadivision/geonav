import { NextRequest, NextResponse } from 'next/server';
import { parseChargingStations, CHARGING_STATION_FIELD_MASK, type RawPlace } from '@/lib/chargers';

// Server-side fallback proxy over Google Places API (New) — Nearby Search,
// scoped to electric_vehicle_charging_station. Same role as /api/directions'
// server fallback: MapCanvas calls Places directly from the browser first
// (works because the browser sets the real Referer the API key expects —
// see fetchChargingStations), and only falls back to this route if that
// fails. Uses the SAME Google Maps API key already configured for the rest
// of the app — no second key.
const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_SERVER_API_KEY ||
  process.env.GOOGLE_MAPS_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Hard caps, independent of whatever the client asks for — this is the
// actual guarantee against "load hundreds of chargers at once" / an
// overly-broad radius, not just a convention the client is trusted to follow.
const MAX_RADIUS_M = 8000;
const MIN_RADIUS_M = 200;
const MAX_RESULTS = 20; // also Google's own hard cap for this endpoint

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');
  const requestedRadius = parseFloat(searchParams.get('radius') || '');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }
  if (!GOOGLE_API_KEY) {
    return NextResponse.json({ error: 'Google Maps API key not configured' }, { status: 500 });
  }

  const radius = Math.min(
    MAX_RADIUS_M,
    Math.max(MIN_RADIUS_M, Number.isFinite(requestedRadius) ? requestedRadius : MAX_RADIUS_M)
  );

  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const requestBody = {
      includedTypes: ['electric_vehicle_charging_station'],
      maxResultCount: MAX_RESULTS,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius,
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': CHARGING_STATION_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Places API (New) searchNearby error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const places: RawPlace[] = data.places || [];
    const stations = parseChargingStations(places);

    return NextResponse.json(
      { stations },
      { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=60' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[charging-stations] Error:', message);
    return NextResponse.json({ error: 'Charging station search failed', detail: message }, { status: 500 });
  }
}
