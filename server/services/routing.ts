import { haversineKm } from '../lib/geo.js';
import { fetchJson } from '../lib/http.js';
import { remember, type Cache } from '../lib/cache.js';

export interface Recipient {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  distanceKm: number;
}

/** Food banks / food-sharing points near a location, from OpenStreetMap via Overpass. */
export async function nearbyRecipients(cache: Cache, lat: number, lon: number, radiusKm: number): Promise<Recipient[]> {
  const r = Math.round(radiusKm * 1000);
  const key = `overpass:${lat.toFixed(2)}:${lon.toFixed(2)}:${r}`;
  return remember(cache, key, 6 * 3600, async () => {
    const query = `[out:json][timeout:20];(
      nwr["social_facility"="food_bank"](around:${r},${lat},${lon});
      nwr["amenity"="food_sharing"](around:${r},${lat},${lon});
      nwr["social_facility"="soup_kitchen"](around:${r},${lat},${lon});
    );out center 50;`;
    return fetchOverpass(query, lat, lon);
  });
}

async function fetchOverpass(query: string, lat: number, lon: number): Promise<Recipient[]> {
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) throw new Error(`overpass: HTTP ${resp.status}`);
  const json = (await resp.json()) as {
    elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
  };
  return json.elements
    .map((e) => {
      const la = e.lat ?? e.center?.lat;
      const lo = e.lon ?? e.center?.lon;
      if (la === undefined || lo === undefined) return null;
      return {
        id: `${e.type}/${e.id}`,
        name: e.tags?.name ?? 'Unnamed food-aid point',
        type: e.tags?.social_facility ?? e.tags?.amenity ?? 'unknown',
        lat: la,
        lon: lo,
        distanceKm: Math.round(haversineKm(lat, lon, la, lo) * 10) / 10,
      } satisfies Recipient;
    })
    .filter((x): x is Recipient => x !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  source: 'osrm' | 'straight-line-estimate';
}

/** Driving distance/time via the public OSRM demo server; falls back to a straight-line estimate. */
export async function driveRoute(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<RouteInfo> {
  try {
    const res = await fetchJson<{ routes?: { distance: number; duration: number }[] }>(
      `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`,
      { service: 'osrm', retries: 1, timeoutMs: 6000 },
    );
    const r = res.routes?.[0];
    if (r) return { distanceKm: Math.round(r.distance / 100) / 10, durationMin: Math.round(r.duration / 60), source: 'osrm' };
  } catch {
    /* use estimate */
  }
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon) * 1.3; // detour factor
  return { distanceKm: Math.round(km * 10) / 10, durationMin: Math.round((km / 40) * 60), source: 'straight-line-estimate' };
}
