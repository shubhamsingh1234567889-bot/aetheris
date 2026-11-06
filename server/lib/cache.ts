/**
 * Cache abstraction. MemoryCache is the default (single instance).
 * Set REDIS_URL to share the cache across instances (see RedisCache).
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh recency (Map keeps insertion order -> LRU)
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

/** Minimal surface of an ioredis client that we rely on. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisCache implements Cache {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'aetheris:',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.client.get(this.prefix + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined; // cache failures must never break requests
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(this.prefix + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* ignore */
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(this.prefix + key);
    } catch {
      /* ignore */
    }
  }
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * Read-through cache with in-flight de-duplication: concurrent callers for the
 * same key share one upstream request ("single flight").
 */
export async function remember<T>(
  cache: Cache,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await loader();
      await cache.set(key, value, ttlSeconds);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
