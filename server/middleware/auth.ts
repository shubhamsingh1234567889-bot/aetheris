import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthInfo {
  /** user id */
  sub: string;
  /** organisation id used for data isolation (falls back to the user id) */
  orgId: string;
  authenticated: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

const ANON: AuthInfo = { sub: 'anonymous', orgId: 'public', authenticated: false };
const jwks = config.auth.jwksUrl ? createRemoteJWKSet(new URL(config.auth.jwksUrl)) : null;

/**
 * Attaches req.auth. With AUTH_JWKS_URL set, a valid Bearer JWT is verified (signature, issuer,
 * audience, expiry). Without it, everyone is "anonymous" - fine for local dev, but set
 * AUTH_JWKS_URL before exposing write endpoints publicly.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!jwks || !header?.startsWith('Bearer ')) {
      req.auth = ANON;
      return next();
    }
    const { payload } = await jwtVerify(header.slice(7), jwks, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
    const sub = String(payload.sub ?? '');
    if (!sub) throw new Error('token has no subject');
    const org = payload.org_id ?? payload.org ?? payload['https://aetheris.app/org'] ?? sub;
    req.auth = { sub, orgId: String(org), authenticated: true };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

/** Require a signed-in user when auth is configured; open when it is not (dev). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (config.auth.enabled && !req.auth?.authenticated) return next(unauthorized());
  next();
}
