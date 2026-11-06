import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { spoilageRisk } from '../domain/food.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { currentTempC } from '../services/openMeteo.js';
import { driveRoute, nearbyRecipients } from '../services/routing.js';

const SurplusBody = z.object({
  item: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(40),
  quantityKg: z.number().positive().max(1e6),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  packedAt: z.string().datetime({ offset: true }),
  refrigerated: z.boolean().default(true),
  storageTempC: z.number().min(-40).max(60).optional(),
});

const RiskQuery = z.object({
  category: z.string().trim().min(2).max(40),
  ageHours: z.coerce.number().min(0).max(24 * 400),
  tempC: z.coerce.number().min(-40).max(60).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  shelfLifeDays: z.coerce.number().positive().max(1000).optional(),
});

export function foodRouter(ctx: Ctx): Router {
  const r = Router();

  /**
   * GET /api/food/spoilage-risk?category=dairy&ageHours=40&tempC=8
   * No tempC? Pass lat & lon and the current outdoor temperature is used (for unrefrigerated storage).
   */
  r.get(
    '/food/spoilage-risk',
    ah(async (req, res) => {
      const q = RiskQuery.parse(req.query);
      let tempC = q.tempC;
      let tempSource = 'provided';
      if (tempC === undefined) {
        if (q.lat === undefined || q.lon === undefined) throw badRequest('Provide tempC, or lat & lon to use local weather');
        tempC = await currentTempC(q.lat, q.lon);
        tempSource = 'open-meteo-current';
      }
      res.json({ tempC, tempSource, ...spoilageRisk({ category: q.category, ageHours: q.ageHours, tempC, shelfLifeDays: q.shelfLifeDays }) });
    }),
  );

  /** GET /api/food/surplus - the dispatch board (available items with live spoilage risk) */
  r.get(
    '/food/surplus',
    ah(async (req, res) => {
      const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
      const items = await ctx.store.listFoodSurplus({ status: 'available', limit });
      const now = Date.now();
      res.json({
        items: items.map((s) => ({
          ...s,
          spoilage: spoilageRisk({
            category: s.category,
            ageHours: (now - Date.parse(s.packedAt)) / 3_600_000,
            tempC: s.storageTempC ?? (s.refrigerated ? 4 : 20),
          }),
        })),
      });
    }),
  );

  /** POST /api/food/surplus - post surplus food */
  r.post(
    '/food/surplus',
    requireAuth,
    ah(async (req, res) => {
      const b = SurplusBody.parse(req.body);
      res.status(201).json(await ctx.store.addFoodSurplus({ ...b, orgId: req.auth!.orgId }));
    }),
  );

  /**
   * POST /api/food/dispatch { surplusId } - pick the nearest food-aid recipient that can be reached
   * before the item spoils. Recipients come from OpenStreetMap; routing from OSRM.
   */
  r.post(
    '/food/dispatch',
    requireAuth,
    ah(async (req, res) => {
      const { surplusId, radiusKm } = z
        .object({ surplusId: z.string().uuid(), radiusKm: z.number().min(1).max(100).default(25) })
        .parse(req.body);
      const s = await ctx.store.getFoodSurplus(surplusId);
      if (!s) throw notFound('Surplus item not found');
      if (s.orgId !== req.auth!.orgId) throw forbidden('Only the owning organisation can dispatch this item');
      if (s.status !== 'available') throw badRequest(`Item is already ${s.status}`);

      const risk = spoilageRisk({
        category: s.category,
        ageHours: (Date.now() - Date.parse(s.packedAt)) / 3_600_000,
        tempC: s.storageTempC ?? (s.refrigerated ? 4 : 20),
      });
      if (risk.level === 'expired') {
        await ctx.store.setFoodStatus(s.id, s.orgId, 'expired');
        throw badRequest('Item is past its estimated shelf life and cannot be redistributed');
      }

      const candidates = (await nearbyRecipients(ctx.cache, s.lat, s.lon, radiusKm)).slice(0, 5);
      const options = [];
      for (const c of candidates) {
        const route = await driveRoute(s, c);
        // require a safety margin: arrival (+30 min handling) must be within the remaining shelf life
        const feasible = route.durationMin + 30 <= risk.remainingHours * 60;
        options.push({ recipient: c, route, feasible });
      }
      const best = options.filter((o) => o.feasible).sort((a, b) => a.route.durationMin - b.route.durationMin)[0];
      res.json({ surplus: s, spoilage: risk, recommended: best ?? null, options });
    }),
  );

  /** POST /api/food/surplus/:id/dispatched - mark an item as handed over (owner only) */
  r.post(
    '/food/surplus/:id/dispatched',
    requireAuth,
    ah(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      const s = await ctx.store.getFoodSurplus(id);
      if (!s) throw notFound('Surplus item not found');
      if (s.orgId !== req.auth!.orgId) throw forbidden('Only the owning organisation can change this item');
      res.json(await ctx.store.setFoodStatus(id, s.orgId, 'dispatched'));
    }),
  );
  return r;
}
