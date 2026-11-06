/**
 * Typed client for the Aetheris backend (/api/*).
 *
 * Use this instead of calling TinyFish / WAQI / Gemini directly from the browser: those calls now
 * happen on the server, so no API key is shipped in the JavaScript bundle. Point
 * src/services/tinyFishApi.ts and src/services/aqiApi.ts at the functions below.
 */

let tokenProvider: (() => Promise<string | null> | string | null) | null = null;

/** Register how to get the signed-in user's JWT (e.g. Clerk's getToken, Auth0's getAccessTokenSilently). */
export function setAuthTokenProvider(fn: typeof tokenProvider): void {
  tokenProvider = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  const token = tokenProvider ? await tokenProvider() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  return `?${p}`;
};
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

/* ---------------- environment ---------------- */
export interface AqiReading {
  source: 'waqi' | 'open-meteo';
  location: string;
  lat?: number;
  lon?: number;
  aqi: number;
  category: { level: string; label: string };
  dominantPollutant?: string;
  pollutants: Record<string, number>;
  updatedAt?: string;
}
export const getAqi = (q: { city?: string; lat?: number; lon?: number }) => request<AqiReading>(`/aqi${qs(q)}`);

export interface SearchResponse {
  query: string;
  via: 'sdk' | 'rest';
  results: { position?: number; title: string; url: string; snippet?: string; siteName?: string }[];
}
export const webSearch = (q: string, opts: { location?: string; language?: string } = {}) =>
  request<SearchResponse>(`/search${qs({ q, ...opts })}`);

/* ---------------- carbon ---------------- */
export interface CarbonItemInput {
  label?: string;
  method: 'activity' | 'spend';
  category: string;
  scope?: 1 | 2 | 3;
  quantity?: number;
  unit?: string;
  spendUsd?: number;
  factorKgPerUnit?: number;
  gridKgPerKwh?: number;
}
export const calculateCarbon = (items: CarbonItemInput[], save?: { label: string }) =>
  post<{
    items: unknown[];
    byScope: { scope1: number; scope2: number; scope3: number };
    totalKgCo2e: number;
    rangeKg: { low: number; high: number };
    methodology: string;
  }>('/carbon/calculate', { items, save });
export const getGridIntensity = (region: string) =>
  request<{ region: string; gCo2PerKwh: number; kgCo2PerKwh: number; source: string }>(
    `/carbon/grid-intensity${qs({ region })}`,
  );
export const importSuppliers = (csv: string) =>
  post<{ rows: unknown[]; issues: { row: number; problem: string }[]; duplicatesRemoved: number }>(
    '/carbon/suppliers/import',
    { csv },
  );

/* ---------------- greenwashing ---------------- */
export const analyzeClaim = (b: {
  company: string;
  claim: string;
  ticker?: string;
  location?: { lat: number; lon: number; radiusKm?: number };
}) =>
  post<{
    assessment: { riskScore: number; level: 'low' | 'medium' | 'high'; flags: { code: string; message: string; weight: number }[]; recommendations: string[] };
    aiAssessment?: { verdict: string; contradictions: string[]; supportingPoints: string[]; confidence: number };
    evidence: { source: string; title: string; snippet?: string; url?: string }[];
    satelliteJobId?: string;
    warnings: string[];
  }>('/greenwash/analyze', b);
export const getFilings = (ticker: string) => request<{ company: string; filings: unknown[] }>(`/greenwash/filings${qs({ ticker })}`);

export interface Job<T = unknown> {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: T;
  error?: string;
}
export const getJob = <T = unknown>(id: string) => request<Job<T>>(`/jobs/${id}`);

/** Poll a background job until it finishes (default: every 2 s, up to 2 min). */
export async function waitForJob<T = unknown>(id: string, intervalMs = 2000, timeoutMs = 120_000): Promise<Job<T>> {
  const stop = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob<T>(id);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    if (Date.now() > stop) throw new Error('Timed out waiting for job');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ---------------- energy ---------------- */
export const getEnergyForecast = (q: { lat: number; lon: number; solarKw?: number; windKw?: number; avgDemandKw?: number }) =>
  request<{ hours: { time: string; solarKw: number; windKw: number; generationKw: number; demandKw: number }[] }>(
    `/energy/forecast${qs(q)}`,
  );
export const dispatchEnergy = (b: {
  generationKw: number[];
  demandKw: number[];
  battery?: { capacityKwh: number; maxChargeKw: number; maxDischargeKw: number; socPct?: number };
  exportLimitKw?: number;
}) => post<{ schedule: unknown[]; totals: Record<string, number>; notes: string[] }>('/energy/dispatch', b);

/* ---------------- waste marketplace ---------------- */
export const listWaste = (kind?: 'offer' | 'need') => request<{ listings: unknown[] }>(`/waste/listings${qs({ kind })}`);
export const createWasteListing = (b: {
  kind: 'offer' | 'need';
  material: string;
  ewcCode?: string;
  quantityKg: number;
  lat: number;
  lon: number;
  description?: string;
}) => post<{ id: string }>('/waste/listings', b);
export const getWasteMatches = (listingId: string) => request<{ matches: unknown[] }>(`/waste/matches${qs({ listingId })}`);

/* ---------------- food waste ---------------- */
export const getSpoilageRisk = (q: { category: string; ageHours: number; tempC?: number; lat?: number; lon?: number }) =>
  request<{ risk: number; level: 'low' | 'medium' | 'high' | 'expired'; remainingHours: number }>(`/food/spoilage-risk${qs(q)}`);
export const listSurplus = () => request<{ items: unknown[] }>('/food/surplus');
export const createSurplus = (b: {
  item: string;
  category: string;
  quantityKg: number;
  lat: number;
  lon: number;
  packedAt: string;
  refrigerated?: boolean;
  storageTempC?: number;
}) => post<{ id: string }>('/food/surplus', b);
export const dispatchSurplus = (surplusId: string) => post<{ recommended: unknown; options: unknown[] }>('/food/dispatch', { surplusId });
