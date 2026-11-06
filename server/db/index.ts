import { config } from '../config.js';
import { logger } from '../logger.js';
import { MemoryStore, type Store } from './store.js';

export async function createStore(): Promise<Store> {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set: using in-memory store (data is lost on restart)');
    return new MemoryStore();
  }
  const { PgStore } = await import('./pgStore.js');
  return new PgStore(config.databaseUrl);
}

export type { Store } from './store.js';
