import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { demandKw, dispatch, solarKw, windKw } from '../domain/energy.js';
import { badRequest } from '../lib/errors.js';
import { remember } from '../lib/cache.js';
import { ah } from '../middleware/errors.js';
import { hourlyWeather } from '../services/openMeteo.js';

const Battery = z.object({
  capacityKwh: z.number().positive().max(1e7),
  maxChargeKw: z.number().positive().max(1e6),
  maxDischargeKw: z.number().positive().max(1e6),
  socPct: z.number().min(0).max(100).optional(),
  minSocPct: z.number().min(0).max(100).optional(),
  maxSocPct: z.number().min(0).max(100).optional(),
  roundTripEff: z.number().min(0.5).max(1).optional(),
});

const ForecastQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  solarKw: z.coerce.number().min(0).max(1e6).default(0),
  windKw: z.coerce.number().min(0).max(1e6).default(0),
  avgDemandKw: z.coerce.number().min(0).max(1e6).default(0),
  hours: z.coerce.number().int().min(1).max(48).default(24),
});

const DispatchBody = z.object({
  generationKw: z.array(z.number().min(0)).min(1).max(168),
  demandKw: z.array(z.number().min(0)).min(1).max(168),
  battery: Battery.optional(),
  exportLimitKw: z.number().min(0).optional(),
  stepHours: z.number().positive().max(24).optional(),
});

export function energyRouter(ctx: Ctx): Router {
  const r = Router();

  /**
   * GET /api/energy/forecast?lat=&lon=&solarKw=&windKw=&avgDemandKw=
   * Hourly solar + wind generation (and demand profile) for the next 24-48 h. Weather cached 30 min.
   */
  r.get(
    '/energy/forecast',
    ah(async (req, res) => {
      const q = ForecastQuery.parse(req.query);
      const w = await remember(
        ctx.cache,
        `wx:${q.lat.toFixed(2)}:${q.lon.toFixed(2)}:${q.hours}`,
        1800,
        () => hourlyWeather(q.lat, q.lon, q.hours),
      );
      const hours = w.time.map((time, i) => {
        const solar = solarKw(w.ghiWm2[i]!, q.solarKw, w.tempC[i]!);
        const wind = windKw(w.windMs100m[i]!, q.windKw);
        return {
          time,
          ghiWm2: w.ghiWm2[i],
          windMs100m: w.windMs100m[i],
          tempC: w.tempC[i],
          solarKw: Math.round(solar * 100) / 100,
          windKw: Math.round(wind * 100) / 100,
          generationKw: Math.round((solar + wind) * 100) / 100,
          demandKw: Math.round(demandKw(w.hourOfDay[i]!, q.avgDemandKw) * 100) / 100,
        };
      });
      res.json({ source: 'open-meteo', hours });
    }),
  );

  /** POST /api/energy/dispatch - battery dispatch + curtailment check for given generation/demand series */
  r.post(
    '/energy/dispatch',
    ah(async (req, res) => {
      const b = DispatchBody.parse(req.body);
      if (b.generationKw.length !== b.demandKw.length) {
        throw badRequest('generationKw and demandKw must have the same length');
      }
      res.json(dispatch(b));
    }),
  );
  return r;
}
