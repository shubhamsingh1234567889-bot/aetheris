import 'dotenv/config';
import { z } from 'zod';

/** Treat empty strings (KEY="") as "not set". */
const opt = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.string().default('info'),
  /** comma-separated list of allowed browser origins; empty = same-origin only */
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_HEAVY_PER_MIN: z.coerce.number().int().positive().default(20),

  /* integrations - all optional; routes degrade gracefully or return 503 */
  TINYFISH_API_KEY: opt,
  WAQI_API_KEY: opt,
  GEMINI_API_KEY: opt,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  CLIMATIQ_API_KEY: opt,
  ELECTRICITY_MAPS_API_KEY: opt,
  /** SEC requires a descriptive User-Agent with contact info */
  SEC_USER_AGENT: z.string().default('Aetheris Climate OS (set SEC_USER_AGENT=you@example.com)'),

  /* infrastructure */
  DATABASE_URL: opt,
  REDIS_URL: opt,

  /* auth (any OIDC provider: Clerk, Auth0, Supabase, ...) */
  AUTH_JWKS_URL: opt,
  AUTH_ISSUER: opt,
  AUTH_AUDIENCE: opt,
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  rateLimit: { perMin: env.RATE_LIMIT_PER_MIN, heavyPerMin: env.RATE_LIMIT_HEAVY_PER_MIN },
  keys: {
    tinyfish: env.TINYFISH_API_KEY,
    waqi: env.WAQI_API_KEY,
    gemini: env.GEMINI_API_KEY,
    climatiq: env.CLIMATIQ_API_KEY,
    electricityMaps: env.ELECTRICITY_MAPS_API_KEY,
  },
  geminiModel: env.GEMINI_MODEL,
  secUserAgent: env.SEC_USER_AGENT,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  auth: {
    jwksUrl: env.AUTH_JWKS_URL,
    issuer: env.AUTH_ISSUER,
    audience: env.AUTH_AUDIENCE,
    enabled: Boolean(env.AUTH_JWKS_URL),
  },
} as const;

export type Config = typeof config;
