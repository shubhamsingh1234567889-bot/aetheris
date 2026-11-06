import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { calculate, normalizeSupplierRows } from '../domain/carbon.js';
import { generateJson, geminiAvailable } from '../services/gemini.js';
import { remember } from '../lib/cache.js';
import { parseCsvRecords } from '../lib/csv.js';
import { badRequest } from '../lib/errors.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { climatiqEstimate } from '../services/climatiq.js';
import { gridIntensity } from '../services/gridIntensity.js';

const Item = z.object({
  label: z.string().max(120).optional(),
  method: z.enum(['activity', 'spend']),
  category: z.string().trim().min(1).max(60),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  quantity: z.number().nonnegative().finite().optional(),
  unit: z.string().max(20).optional(),
  spendUsd: z.number().nonnegative().finite().optional(),
  factorKgPerUnit: z.number().nonnegative().finite().optional(),
  gridKgPerKwh: z.number().nonnegative().finite().optional(),
});
const CalcBody = z.object({
  items: z.array(Item).min(1).max(500),
  /** save the result to the organisation's ledger */
  save: z.object({ label: z.string().trim().min(1).max(120) }).optional(),
});

const ImportBody = z
  .object({ csv: z.string().max(2_000_000).optional(), rows: z.array(z.record(z.string())).max(5000).optional() })
  .refine((b) => b.csv || b.rows, 'Provide csv text or rows[]');

const ClimatiqBody = z.object({
  emission_factor: z.object({
    activity_id: z.string().optional(),
    id: z.string().optional(),
    data_version: z.string().optional(),
    source: z.string().optional(),
    region: z.string().optional(),
  }),
  parameters: z.record(z.union([z.string(), z.number()])),
});

export function carbonRouter(ctx: Ctx): Router {
  const r = Router();

  /** POST /api/carbon/calculate - Scope 1/2/3 totals with uncertainty ranges */
  r.post(
    '/carbon/calculate',
    ah(async (req, res) => {
      const body = CalcBody.parse(req.body);
      let summary;
      try {
        summary = calculate(body.items);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Invalid items');
      }
      if (body.save) {
        // saving needs a signed-in user when auth is configured
        await new Promise<void>((resolve, reject) => requireAuth(req, res, (err) => (err ? reject(err) : resolve())));
        const entry = await ctx.store.addCarbonEntry(req.auth!.orgId, body.save.label, summary);
        return void res.status(201).json({ ...summary, saved: { id: entry.id, createdAt: entry.createdAt } });
      }
      res.json(summary);
    }),
  );

  /** GET /api/carbon/ledger - saved calculations for the caller's organisation */
  r.get(
    '/carbon/ledger',
    requireAuth,
    ah(async (req, res) => {
      const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
      res.json({ entries: await ctx.store.listCarbonEntries(req.auth!.orgId, limit) });
    }),
  );

  /** GET /api/carbon/grid-intensity?region=GB - Scope 2 location-based factor, cached 15 min */
  r.get(
    '/carbon/grid-intensity',
    ah(async (req, res) => {
      const { region } = z.object({ region: z.string().trim().min(2).max(20) }).parse(req.query);
      res.json(await remember(ctx.cache, `grid:${region.toUpperCase()}`, 900, () => gridIntensity(region)));
    }),
  );

  /**
   * POST /api/carbon/suppliers/import - reconcile messy supplier data.
   * Accepts CSV text or JSON rows; returns cleaned rows, issues, duplicates removed.
   * With GEMINI_API_KEY set, unrecognised categories get suggested mappings.
   */
  r.post(
    '/carbon/suppliers/import',
    requireAuth,
    ah(async (req, res) => {
      const body = ImportBody.parse(req.body);
      const records = body.csv
        ? parseCsvRecords(body.csv)
        : body.rows!.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, '_'), v])));
      const report = normalizeSupplierRows(records);

      let categorySuggestions: Record<string, string> | undefined;
      if (geminiAvailable()) {
        const known = ['natural_gas', 'diesel', 'petrol', 'electricity', 'road_freight', 'air_freight', 'business_flight', 'waste_landfill', 'purchased_goods', 'services', 'electronics', 'construction', 'transport', 'food'];
        const unknown = [...new Set(report.rows.map((x) => x.category))].filter((c) => !known.includes(c)).slice(0, 40);
        if (unknown.length) {
          try {
            categorySuggestions = await generateJson<Record<string, string>>(
              ctx.cache,
              `Map each input category to the closest value from this list, or "unknown" if none fits. ` +
                `List: ${JSON.stringify(known)}. Input categories: ${JSON.stringify(unknown)}. ` +
                `Respond with a JSON object whose keys are the input categories and values are list items.`,
            );
          } catch {
            /* suggestions are optional */
          }
        }
      }
      res.json({ ...report, categorySuggestions });
    }),
  );

  /** POST /api/carbon/climatiq-estimate - proxy to Climatiq (reporting-grade emission factors) */
  r.post(
    '/carbon/climatiq-estimate',
    requireAuth,
    ah(async (req, res) => {
      res.json(await climatiqEstimate(ClimatiqBody.parse(req.body)));
    }),
  );
  return r;
}
