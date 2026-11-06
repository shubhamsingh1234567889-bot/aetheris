import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { remember } from '../lib/cache.js';
import { ah } from '../middleware/errors.js';
import { getAqi } from '../services/aqi.js';
import { tinyfishSearch } from '../services/tinyfish.js';

const lat = z.coerce.number().min(-90).max(90);
const lon = z.coerce.number().min(-180).max(180);

const AqiQuery = z
  .object({ city: z.string().trim().min(1).max(100).optional(), lat: lat.optional(), lon: lon.optional() })
  .refine((q) => q.city || (q.lat !== undefined && q.lon !== undefined), 'Provide city, or both lat and lon');

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(300),
  location: z.string().trim().max(10).optional(),
  language: z.string().trim().max(10).optional(),
});

export function environmentRouter(ctx: Ctx): Router {
  const r = Router();

  /** GET /api/aqi?city=Delhi  |  /api/aqi?lat=28.6&lon=77.2  - cached 10 min */
  r.get(
    '/aqi',
    ah(async (req, res) => {
      const q = AqiQuery.parse(req.query);
      const key = `aqi:${q.city?.toLowerCase() ?? `${q.lat},${q.lon}`}`;
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await remember(ctx.cache, key, 600, () => getAqi(q)));
    }),
  );

  /** GET /api/search?q=...  - TinyFish web search proxy (key stays on the server), cached 15 min */
  r.get(
    '/search',
    ah(async (req, res) => {
      const q = SearchQuery.parse(req.query);
      const key = `search:${q.q.toLowerCase()}:${q.location ?? ''}:${q.language ?? ''}`;
      res.json(
        await remember(ctx.cache, key, 900, () =>
          tinyfishSearch({ query: q.q, location: q.location, language: q.language }),
        ),
      );
    }),
  );
  return r;
}
