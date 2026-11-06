import { Router } from 'express';
import { config } from '../config.js';
import type { Ctx } from '../context.js';
import { ah } from '../middleware/errors.js';

export function healthRouter(ctx: Ctx): Router {
  const r = Router();

  /** Liveness: the process is up. Used by Docker / Render health checks. */
  r.get('/healthz', (_req, res) => {
    res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
  });

  /** Readiness: dependencies reachable. Reports which integrations are configured (never the keys). */
  r.get(
    '/readyz',
    ah(async (_req, res) => {
      const dbOk = await ctx.store.ping();
      res.status(dbOk ? 200 : 503).json({
        ok: dbOk,
        store: ctx.store.kind,
        auth: config.auth.enabled ? 'jwt' : 'disabled',
        integrations: {
          tinyfish: Boolean(config.keys.tinyfish),
          waqi: Boolean(config.keys.waqi),
          gemini: Boolean(config.keys.gemini),
          climatiq: Boolean(config.keys.climatiq),
          electricityMaps: Boolean(config.keys.electricityMaps),
        },
      });
    }),
  );
  return r;
}
