import { config } from '../config.js';
import { NotConfiguredError, UpstreamError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';

export interface SearchHit {
  position?: number;
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
}
export interface SearchResponse {
  query: string;
  via: 'sdk' | 'rest';
  results: SearchHit[];
}
export interface SearchParams {
  query: string;
  location?: string;
  language?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let sdkClient: any | null | undefined; // undefined = not tried, null = unavailable

/**
 * Official SDK (`@tiny-fish/sdk`). It reads TINYFISH_API_KEY from the environment.
 * Loaded lazily so the server still boots if the package is missing; the REST fallback
 * (GET https://api.search.tinyfish.ai, header X-API-Key) is used in that case.
 */
async function getSdk(): Promise<any | null> {
  if (sdkClient !== undefined) return sdkClient;
  try {
    const name = '@tiny-fish/sdk';
    const mod: any = await import(name);
    sdkClient = new mod.TinyFish();
  } catch {
    sdkClient = null;
  }
  return sdkClient;
}

const normalize = (r: any): SearchHit => ({
  position: r.position,
  title: String(r.title ?? ''),
  url: String(r.url ?? ''),
  snippet: r.snippet ?? undefined,
  siteName: r.site_name ?? r.siteName ?? undefined,
});

export async function tinyfishSearch(p: SearchParams): Promise<SearchResponse> {
  if (!config.keys.tinyfish) throw new NotConfiguredError('TinyFish (TINYFISH_API_KEY)');

  const sdk = await getSdk();
  if (sdk) {
    try {
      const res = await sdk.search.query({
        query: p.query,
        ...(p.location ? { location: p.location } : {}),
        ...(p.language ? { language: p.language } : {}),
      });
      const list: any[] = res?.results ?? [];
      return { query: p.query, via: 'sdk', results: list.map(normalize) };
    } catch (err) {
      // fall through to REST so a transient SDK problem does not take search down
      if (!(err instanceof Error)) throw new UpstreamError('tinyfish', String(err));
    }
  }

  const qs = new URLSearchParams({ query: p.query });
  if (p.location) qs.set('location', p.location);
  if (p.language) qs.set('language', p.language);
  const res = await fetchJson<{ results?: any[] }>(`https://api.search.tinyfish.ai?${qs}`, {
    service: 'tinyfish',
    headers: { 'X-API-Key': config.keys.tinyfish },
    timeoutMs: 10_000,
  });
  return { query: p.query, via: 'rest', results: (res.results ?? []).map(normalize) };
}
