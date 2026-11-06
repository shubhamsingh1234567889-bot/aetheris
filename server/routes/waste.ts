import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { EWC_CHAPTERS, findMatches } from '../domain/waste.js';
import { forbidden, notFound } from '../lib/errors.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';

const ListingBody = z.object({
  kind: z.enum(['offer', 'need']),
  material: z.string().trim().min(2).max(160),
  ewcCode: z.string().regex(/^\d{2}( ?\d{2}){0,2}\*?$/, 'EWC code like "10 01 02"').optional(),
  quantityKg: z.number().positive().max(1e9),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  description: z.string().max(1000).optional(),
});

export function wasteRouter(ctx: Ctx): Router {
  const r = Router();

  /** GET /api/waste/codes - EWC chapters for the material picker */
  r.get('/waste/codes', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ chapters: Object.entries(EWC_CHAPTERS).map(([code, title]) => ({ code, title })) });
  });

  /** GET /api/waste/listings?kind=offer&limit=50 - open listings (public marketplace view) */
  r.get(
    '/waste/listings',
    ah(async (req, res) => {
      const q = z
        .object({ kind: z.enum(['offer', 'need']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(req.query);
      res.json({ listings: await ctx.store.listWasteListings({ kind: q.kind, status: 'open', limit: q.limit }) });
    }),
  );

  /** POST /api/waste/listings - create an offer or need (owned by the caller's organisation) */
  r.post(
    '/waste/listings',
    requireAuth,
    ah(async (req, res) => {
      const b = ListingBody.parse(req.body);
      res.status(201).json(await ctx.store.addWasteListing({ ...b, orgId: req.auth!.orgId }));
    }),
  );

  /** GET /api/waste/matches?listingId=... - ranked counterparties (material + distance + quantity) */
  r.get(
    '/waste/matches',
    ah(async (req, res) => {
      const q = z
        .object({
          listingId: z.string().uuid(),
          minScore: z.coerce.number().min(0).max(1).default(0.35),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        })
        .parse(req.query);
      const source = await ctx.store.getWasteListing(q.listingId);
      if (!source) throw notFound('Listing not found');
      const pool = await ctx.store.listWasteListings({ kind: source.kind === 'offer' ? 'need' : 'offer', status: 'open', limit: 500 });
      res.json({ listing: source, matches: findMatches(source, pool, q.minScore, q.limit) });
    }),
  );

  /** PATCH /api/waste/listings/:id/status - close or mark as matched (owner only) */
  r.patch(
    '/waste/listings/:id/status',
    requireAuth,
    ah(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      const { status } = z.object({ status: z.enum(['open', 'matched', 'closed']) }).parse(req.body);
      const existing = await ctx.store.getWasteListing(id);
      if (!existing) throw notFound('Listing not found');
      if (existing.orgId !== req.auth!.orgId) throw forbidden('Only the owning organisation can change this listing');
      res.json(await ctx.store.setWasteStatus(id, req.auth!.orgId, status));
    }),
  );
  return r;
}
