import { bboxAround } from '../lib/geo.js';
import { fetchJson } from '../lib/http.js';

export interface SceneSummary {
  id: string;
  datetime: string;
  cloudCoverPct?: number;
}

export interface SatelliteReport {
  provider: 'copernicus-data-space-stac';
  collection: 'sentinel-2-l2a';
  bbox: [number, number, number, number];
  from: string;
  to: string;
  sceneCount: number;
  usableScenes: number;
  latest?: SceneSummary;
  clearest?: SceneSummary;
  scenes: SceneSummary[];
  note: string;
}

/**
 * Finds recent Sentinel-2 L2A scenes over a site via the Copernicus Data Space STAC API.
 * This confirms *observation coverage and image quality* (cloud cover) - the first step of
 * corroborating a claim. Pixel-level analysis (NDVI change, built-up area, ...) is a follow-up
 * job that would download bands via Sentinel Hub / openEO.
 */
export async function sentinelScenes(opts: {
  lat: number;
  lon: number;
  radiusKm: number;
  from: string;
  to: string;
  maxCloudPct: number;
}): Promise<SatelliteReport> {
  const bbox = bboxAround(opts.lat, opts.lon, opts.radiusKm);
  const res = await fetchJson<{
    features?: { id: string; properties: { datetime: string; 'eo:cloud_cover'?: number } }[];
  }>('https://stac.dataspace.copernicus.eu/v1/search', {
    service: 'copernicus-stac',
    method: 'POST',
    timeoutMs: 20_000,
    body: {
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: `${opts.from}T00:00:00Z/${opts.to}T23:59:59Z`,
      limit: 100,
    },
  });
  const scenes: SceneSummary[] = (res.features ?? [])
    .map((f) => ({ id: f.id, datetime: f.properties.datetime, cloudCoverPct: f.properties['eo:cloud_cover'] }))
    .sort((a, b) => b.datetime.localeCompare(a.datetime));
  const usable = scenes.filter((s) => s.cloudCoverPct === undefined || s.cloudCoverPct <= opts.maxCloudPct);
  const clearest = [...scenes]
    .filter((s) => s.cloudCoverPct !== undefined)
    .sort((a, b) => a.cloudCoverPct! - b.cloudCoverPct!)[0];
  return {
    provider: 'copernicus-data-space-stac',
    collection: 'sentinel-2-l2a',
    bbox,
    from: opts.from,
    to: opts.to,
    sceneCount: scenes.length,
    usableScenes: usable.length,
    latest: scenes[0],
    clearest,
    scenes: scenes.slice(0, 20),
    note: 'Coverage and cloud-cover check only; no pixel-level analysis performed.',
  };
}
