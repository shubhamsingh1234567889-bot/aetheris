import { BreakerOpenError, CircuitBreaker } from './breaker.js';
import { UpstreamError } from './errors.js';

const breakers = new Map<string, CircuitBreaker>();
function breakerFor(service: string): CircuitBreaker {
  let b = breakers.get(service);
  if (!b) {
    b = new CircuitBreaker(service);
    breakers.set(service, b);
  }
  return b;
}

export interface FetchOptions {
  /** logical provider name, used for the circuit breaker and error messages */
  service: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** extra attempts after the first (default 2) */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class NonRetryable extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function attempt<T>(url: string, o: FetchOptions): Promise<T> {
  const res = await fetch(url, {
    method: o.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...o.headers,
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    const msg = `HTTP ${res.status}${text ? ` - ${text}` : ''}`;
    // 4xx (except 429) will not get better by retrying
    if (res.status < 500 && res.status !== 429) throw new NonRetryable(msg, res.status);
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/**
 * JSON fetch with timeout, retry (exponential backoff + jitter on network
 * errors, 429 and 5xx) and a per-service circuit breaker.
 */
export async function fetchJson<T>(url: string, o: FetchOptions): Promise<T> {
  const retries = o.retries ?? 2;
  const breaker = breakerFor(o.service);
  try {
    return await breaker.exec(async () => {
      let lastErr: unknown;
      for (let i = 0; i <= retries; i++) {
        try {
          return await attempt<T>(url, o);
        } catch (err) {
          lastErr = err;
          if (err instanceof NonRetryable) throw err;
          if (i < retries) await sleep(250 * 2 ** i + Math.random() * 100);
        }
      }
      throw lastErr;
    });
  } catch (err) {
    if (err instanceof BreakerOpenError) {
      throw new UpstreamError(o.service, 'temporarily unavailable (circuit open)', 503);
    }
    if (err instanceof NonRetryable) {
      // client-side problems with the upstream request are surfaced as 502 for the caller
      throw new UpstreamError(o.service, err.message, err.status === 404 ? 404 : 502);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(o.service, msg);
  }
}
