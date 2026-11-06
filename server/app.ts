import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import type { Ctx } from './context.js';
import { logger } from './logger.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { carbonRouter } from './routes/carbon.js';
import { energyRouter } from './routes/energy.js';
import { environmentRouter } from './routes/environment.js';
import { foodRouter } from './routes/food.js';
import { greenwashRouter } from './routes/greenwash.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';
import { wasteRouter } from './routes/waste.js';

export function createApp(ctx: Ctx): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Render / most PaaS sit behind one proxy: needed for correct client IPs (rate limiting) and https
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(compression());
  if (config.corsOrigins.length) {
    app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'PATCH'], maxAge: 600 }));
  }

  // health endpoints stay outside auth + rate limiting so orchestrators can always probe them
  app.use(healthRouter(ctx));

  const api = Router();
  api.use(express.json({ limit: '3mb' }));
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimit.perMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Too many requests, slow down' } },
    }),
  );
  // stricter limit for routes that fan out to paid / slow upstreams
  api.use(
    ['/search', '/greenwash', '/carbon/suppliers', '/carbon/climatiq-estimate', '/food/dispatch'],
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimit.heavyPerMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Rate limit for this endpoint exceeded' } },
    }),
  );
  api.use(authenticate);
  api.use(environmentRouter(ctx));
  api.use(carbonRouter(ctx));
  api.use(greenwashRouter(ctx));
  api.use(energyRouter(ctx));
  api.use(wasteRouter(ctx));
  api.use(foodRouter(ctx));
  api.use(jobsRouter(ctx));
  api.use(notFoundHandler);
  app.use('/api', api);

  // ---- static frontend (production build) ----
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, file) => {
          // hashed Vite assets never change; everything else must revalidate
          res.setHeader(
            'Cache-Control',
            file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ name: 'aetheris-api', note: 'Frontend build not found; run `npm run build` or use Vite dev server.' });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
