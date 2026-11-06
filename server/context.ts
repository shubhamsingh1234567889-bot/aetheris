import type { Cache } from './lib/cache.js';
import type { JobQueue } from './lib/jobs.js';
import type { Store } from './db/store.js';

/** Shared dependencies handed to every router (makes routes easy to test with fakes). */
export interface Ctx {
  cache: Cache;
  store: Store;
  jobs: JobQueue;
}
