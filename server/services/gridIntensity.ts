import { config } from '../config.js';
import { NotConfiguredError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';

export interface GridIntensity {
  source: 'uk-carbon-intensity' | 'electricity-maps';
  region: string;
  gCo2PerKwh: number;
  kgCo2PerKwh: number;
  index?: string;
  type: 'actual' | 'forecast' | 'latest';
  asOf?: string;
}

/**
 * Scope 2 (location-based) grid intensity.
 *  - "GB": UK National Grid Carbon Intensity API (free, no key)
 *  - any Electricity Maps zone (e.g. "DE", "US-CAL-CISO", "IN-NO"): needs ELECTRICITY_MAPS_API_KEY
 */
export async function gridIntensity(region: string): Promise<GridIntensity> {
  const zone = region.trim().toUpperCase();

  if (zone === 'GB' || zone === 'UK') {
    const res = await fetchJson<{
      data: { from: string; intensity: { forecast: number; actual: number | null; index: string } }[];
    }>('https://api.carbonintensity.org.uk/intensity', { service: 'uk-carbon-intensity' });
    const i = res.data[0]!;
    const g = i.intensity.actual ?? i.intensity.forecast;
    return {
      source: 'uk-carbon-intensity',
      region: 'GB',
      gCo2PerKwh: g,
      kgCo2PerKwh: g / 1000,
      index: i.intensity.index,
      type: i.intensity.actual !== null ? 'actual' : 'forecast',
      asOf: i.from,
    };
  }

  if (!config.keys.electricityMaps) {
    throw new NotConfiguredError('Electricity Maps (ELECTRICITY_MAPS_API_KEY) - only region "GB" works without it');
  }
  const res = await fetchJson<{ carbonIntensity: number; datetime: string }>(
    `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${encodeURIComponent(zone)}`,
    { service: 'electricity-maps', headers: { 'auth-token': config.keys.electricityMaps } },
  );
  return {
    source: 'electricity-maps',
    region: zone,
    gCo2PerKwh: res.carbonIntensity,
    kgCo2PerKwh: res.carbonIntensity / 1000,
    type: 'latest',
    asOf: res.datetime,
  };
}
