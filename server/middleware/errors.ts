import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../logger.js';

/** Express 4 does not catch rejected promises; wrap async handlers with this. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.warn({ err, path: req.path }, 'request failed');
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // body-parser errors carry a status (e.g. 413 too large, 400 malformed JSON)
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: (err as Error).message } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
}
