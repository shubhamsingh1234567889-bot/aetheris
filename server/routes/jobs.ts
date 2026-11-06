import { Router } from 'express';
import type { Ctx } from '../context.js';
import { notFound } from '../lib/errors.js';

export function jobsRouter(ctx: Ctx): Router {
  const r = Router();

  /** GET /api/jobs/:id - poll a background job (only its creator can read it) */
  r.get('/jobs/:id', (req, res, next) => {
    const job = ctx.jobs.get(String(req.params.id));
    // same 404 for "missing" and "someone else's" so job ids cannot be probed
    if (!job || job.ownerId !== req.auth!.sub) return next(notFound('Job not found (it may have expired)'));
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
    });
  });
  return r;
}
