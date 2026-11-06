import { createApp } from './app.js';
import { config } from './config.js';
import { createStore } from './db/index.js';
import { MemoryCache, RedisCache, type Cache, type RedisLike } from './lib/cache.js';
import { JobQueue } from './lib/jobs.js';
import { logger } from './logger.js';

async function createCache(): Promise<Cache> {
  if (!config.redisUrl) return new MemoryCache(2000);
  try {
    // loaded lazily so Redis stays optional
    const name = 'ioredis';
    const mod = (await import(name)) as { default: new (url: string, opts?: object) => RedisLike & { quit(): Promise<unknown> } };
    const client = new mod.default(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    logger.info('Using Redis cache');
    return new RedisCache(client);
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable, falling back to in-memory cache');
    return new MemoryCache(2000);
  }
}

async function main() {
  const store = await createStore();
  await store.init();
  const ctx = { cache: await createCache(), store, jobs: new JobQueue(2) };
  const app = createApp(ctx);

  if (!config.auth.enabled) {
    logger.warn('AUTH_JWKS_URL not set: all requests are treated as anonymous (set it before going public)');
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, env: config.env, store: store.kind }, 'Aetheris server listening');
  });
  // keep-alive slightly above typical proxy idle timeouts (avoids sporadic 502s behind load balancers)
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await store.close().catch(() => undefined);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
