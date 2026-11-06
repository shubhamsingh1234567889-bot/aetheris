import { config } from '../config.js';
import { NotConfiguredError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';

/**
 * Thin pass-through to Climatiq's estimate endpoint, so the API key stays server-side.
 * Body follows https://www.climatiq.io/docs (emission_factor + parameters); validate it in the route.
 */
export async function climatiqEstimate(body: {
  emission_factor: { activity_id?: string; id?: string; data_version?: string; source?: string; region?: string };
  parameters: Record<string, string | number>;
}): Promise<unknown> {
  if (!config.keys.climatiq) throw new NotConfiguredError('Climatiq (CLIMATIQ_API_KEY)');
  return fetchJson('https://api.climatiq.io/data/v1/estimate', {
    service: 'climatiq',
    method: 'POST',
    headers: { Authorization: `Bearer ${config.keys.climatiq}` },
    body,
    retries: 1,
  });
}
