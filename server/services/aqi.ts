import { config } from '../config.js';
import { aqiCategory, type AqiCategory } from '../domain/aqi.js';
import { badRequest } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';
import { airQualityNow, geocode } from './openMeteo.js';

export interface AqiReading {
  source: 'waqi' | 'open-meteo';
  location: string;
  lat?: number;
  lon?: number;
  aqi: number;
  category: AqiCategory;
  dominantPollutant?: string;
  pollutants: Record<string, number>;
  updatedAt?: string;
}

interface WaqiResponse {
  status: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function fromWaqi(target: string): Promise<AqiReading | null> {
  if (!config.keys.waqi) return null;
  const res = await fetchJson<WaqiResponse>(
    `https://api.waqi.info/feed/${encodeURIComponent(target)}/?token=${encodeURIComponent(config.keys.waqi)}`,
    { service: 'waqi', retries: 1 },
  );
  const d = res.data;
  if (res.status !== 'ok' || typeof d !== 'object' || typeof d.aqi !== 'number') return null;
  const pollutants: Record<string, number> = {};
  for (const [k, v] of Object.entries<{ v: number }>(d.iaqi ?? {})) {
    if (typeof v?.v === 'number') pollutants[k] = v.v;
  }
  return {
    source: 'waqi',
    location: d.city?.name ?? target,
    lat: d.city?.geo?.[0],
    lon: d.city?.geo?.[1],
    aqi: d.aqi,
    category: aqiCategory(d.aqi),
    dominantPollutant: d.dominentpol,
    pollutants,
    updatedAt: d.time?.iso,
  };
}

/** WAQI (real stations) first; Open-Meteo modelled data as keyless fallback. */
export async function getAqi(q: { city?: string; lat?: number; lon?: number }): Promise<AqiReading> {
  if (!q.city && (q.lat === undefined || q.lon === undefined)) {
    throw badRequest('Provide either city or lat & lon');
  }
  const hasPoint = q.lat !== undefined && q.lon !== undefined;

  try {
    const waqi = await fromWaqi(hasPoint ? `geo:${q.lat};${q.lon}` : q.city!);
    if (waqi) return waqi;
  } catch {
    /* fall back below */
  }

  const point = hasPoint ? { name: `${q.lat}, ${q.lon}`, lat: q.lat!, lon: q.lon! } : await geocode(q.city!);
  const om = await airQualityNow(point.lat, point.lon);
  const pollutants: Record<string, number> = {};
  const map = { pm25: om.pm25, pm10: om.pm10, o3: om.o3, no2: om.no2, so2: om.so2, co: om.co };
  for (const [k, v] of Object.entries(map)) if (typeof v === 'number') pollutants[k] = v;
  return {
    source: 'open-meteo',
    location: point.name,
    lat: point.lat,
    lon: point.lon,
    aqi: om.usAqi,
    category: aqiCategory(om.usAqi),
    pollutants,
    updatedAt: om.time,
  };
}
