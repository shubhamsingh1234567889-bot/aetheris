import { fetchJson } from '../lib/http.js';
import { notFound } from '../lib/errors.js';

export interface GeoPoint {
  name: string;
  country?: string;
  lat: number;
  lon: number;
}

export async function geocode(name: string): Promise<GeoPoint> {
  const qs = new URLSearchParams({ name, count: '1', language: 'en', format: 'json' });
  const res = await fetchJson<{ results?: { name: string; country?: string; latitude: number; longitude: number }[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?${qs}`,
    { service: 'open-meteo-geo' },
  );
  const hit = res.results?.[0];
  if (!hit) throw notFound(`Could not find a place called "${name}"`);
  return { name: hit.name, country: hit.country, lat: hit.latitude, lon: hit.longitude };
}

export interface HourlyWeather {
  /** local time strings, e.g. "2026-10-31T14:00" */
  time: string[];
  hourOfDay: number[];
  ghiWm2: number[];
  windMs100m: number[];
  tempC: number[];
}

/** Next `hours` hours of irradiance, 100 m wind and temperature (no API key needed). */
export async function hourlyWeather(lat: number, lon: number, hours = 24): Promise<HourlyWeather> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'temperature_2m,shortwave_radiation,wind_speed_100m',
    wind_speed_unit: 'ms',
    forecast_days: String(Math.ceil(hours / 24) + 1),
    timezone: 'auto',
  });
  const res = await fetchJson<{
    hourly: { time: string[]; temperature_2m: number[]; shortwave_radiation: number[]; wind_speed_100m: number[] };
    utc_offset_seconds?: number;
  }>(`https://api.open-meteo.com/v1/forecast?${qs}`, { service: 'open-meteo' });

  // start from the current local hour: Open-Meteo returns whole days starting at 00:00 local
  const nowLocal = new Date(Date.now() + (res.utc_offset_seconds ?? 0) * 1000).toISOString().slice(0, 13);
  let start = res.hourly.time.findIndex((t) => t.slice(0, 13) >= nowLocal);
  if (start < 0) start = 0;
  const end = Math.min(start + hours, res.hourly.time.length);
  const slice = <T>(a: T[]) => a.slice(start, end);
  const time = slice(res.hourly.time);
  return {
    time,
    hourOfDay: time.map((t) => Number(t.slice(11, 13))),
    ghiWm2: slice(res.hourly.shortwave_radiation).map((v) => v ?? 0),
    windMs100m: slice(res.hourly.wind_speed_100m).map((v) => v ?? 0),
    tempC: slice(res.hourly.temperature_2m).map((v) => v ?? 15),
  };
}

export async function currentTempC(lat: number, lon: number): Promise<number> {
  const qs = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m' });
  const res = await fetchJson<{ current: { temperature_2m: number } }>(
    `https://api.open-meteo.com/v1/forecast?${qs}`,
    { service: 'open-meteo' },
  );
  return res.current.temperature_2m;
}

export interface AirQualityNow {
  usAqi: number;
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  so2?: number;
  co?: number;
  time: string;
}

export async function airQualityNow(lat: number, lon: number): Promise<AirQualityNow> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
  });
  const res = await fetchJson<{ current: Record<string, number | string> }>(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${qs}`,
    { service: 'open-meteo-aq' },
  );
  const c = res.current;
  return {
    usAqi: Number(c.us_aqi),
    pm25: c.pm2_5 as number, pm10: c.pm10 as number, o3: c.ozone as number,
    no2: c.nitrogen_dioxide as number, so2: c.sulphur_dioxide as number, co: c.carbon_monoxide as number,
    time: String(c.time),
  };
}
