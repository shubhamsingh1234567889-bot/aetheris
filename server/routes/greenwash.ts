import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { assessClaim, type Evidence } from '../domain/greenwash.js';
import { remember } from '../lib/cache.js';
import { ah } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { recentFilings, searchFilingText } from '../services/edgar.js';
import { generateJson, geminiAvailable } from '../services/gemini.js';
import { sentinelScenes } from '../services/satellite.js';
import { tinyfishSearch } from '../services/tinyfish.js';

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const AnalyzeBody = z.object({
  company: z.string().trim().min(1).max(120),
  claim: z.string().trim().min(5).max(2000),
  ticker: z.string().trim().min(1).max(10).optional(),
  /** facility location: starts an async Sentinel-2 coverage job */
  location: z.object({ lat, lon, radiusKm: z.number().min(0.5).max(50).default(5) }).optional(),
});

const SatelliteBody = z.object({
  lat,
  lon,
  radiusKm: z.number().min(0.5).max(50).default(5),
  from: isoDate,
  to: isoDate,
  maxCloudPct: z.number().min(0).max(100).default(30),
});

interface AiAssessment {
  verdict: 'supported' | 'partly_supported' | 'unsupported' | 'insufficient_evidence';
  contradictions: string[];
  supportingPoints: string[];
  confidence: number;
}

export function greenwashRouter(ctx: Ctx): Router {
  const r = Router();

  /**
   * POST /api/greenwash/analyze
   * Transparent rule-based screen + corroborating evidence (web search, SEC filings, optional
   * satellite job) + optional Gemini cross-check. Each source fails independently into `warnings`.
   */
  r.post(
    '/greenwash/analyze',
    ah(async (req, res) => {
      const b = AnalyzeBody.parse(req.body);
      const warnings: string[] = [];
      const evidence: Evidence[] = [];
      let filings: Awaited<ReturnType<typeof recentFilings>> | undefined;

      const [web, sec] = await Promise.allSettled([
        remember(ctx.cache, `gw:search:${b.company}:${b.claim}`.toLowerCase().slice(0, 300), 900, () =>
          tinyfishSearch({ query: `"${b.company}" ${b.claim.slice(0, 120)} greenwashing OR misleading OR fined` }),
        ),
        b.ticker ? recentFilings(ctx.cache, b.ticker, ['10-K', '20-F', '10-K/A'], 3) : Promise.resolve(undefined),
      ]);

      if (web.status === 'fulfilled') {
        for (const h of web.value.results.slice(0, 8)) {
          evidence.push({ source: 'search', title: h.title, snippet: h.snippet, url: h.url });
        }
      } else warnings.push(`web search unavailable: ${web.reason instanceof Error ? web.reason.message : 'error'}`);

      if (sec.status === 'fulfilled' && sec.value) {
        filings = sec.value;
        for (const f of filings.filings) {
          evidence.push({ source: 'edgar', title: `${filings.company} ${f.form} (${f.filingDate})`, url: f.url });
        }
      } else if (sec.status === 'rejected') {
        warnings.push(`SEC EDGAR unavailable: ${sec.reason instanceof Error ? sec.reason.message : 'error'}`);
      }

      let satelliteJobId: string | undefined;
      if (b.location) {
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
        const loc = b.location;
        satelliteJobId = ctx.jobs.enqueue('satellite', req.auth!.sub, () =>
          sentinelScenes({ lat: loc.lat, lon: loc.lon, radiusKm: loc.radiusKm, from, to, maxCloudPct: 30 }),
        ).id;
      }

      const heuristic = assessClaim(b.claim, evidence);

      let ai: AiAssessment | undefined;
      if (geminiAvailable()) {
        try {
          ai = await generateJson<AiAssessment>(
            ctx.cache,
            `You are a careful sustainability-claims analyst. Assess whether the company claim is supported ` +
              `by the evidence. Use ONLY the evidence given; if it is thin, say "insufficient_evidence". ` +
              `Respond as JSON: {"verdict": "supported"|"partly_supported"|"unsupported"|"insufficient_evidence", ` +
              `"contradictions": string[], "supportingPoints": string[], "confidence": number between 0 and 1}.\n` +
              `Company: ${b.company}\nClaim: ${b.claim}\nEvidence: ${JSON.stringify(evidence.slice(0, 12))}`,
          );
        } catch (e) {
          warnings.push(`AI cross-check unavailable: ${e instanceof Error ? e.message : 'error'}`);
        }
      }

      res.json({
        company: b.company,
        claim: b.claim,
        assessment: heuristic,
        aiAssessment: ai,
        evidence,
        satelliteJobId,
        warnings,
        disclaimer: 'Automated screening to prioritise review. It is not a legal or regulatory finding.',
      });
    }),
  );

  /** GET /api/greenwash/filings?ticker=AAPL[&forms=10-K,8-K] - recent SEC filings (cached 1 h) */
  r.get(
    '/greenwash/filings',
    ah(async (req, res) => {
      const q = z
        .object({
          ticker: z.string().trim().min(1).max(10),
          forms: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(25).default(10),
        })
        .parse(req.query);
      const forms = q.forms?.split(',').map((f) => f.trim()).filter(Boolean);
      res.json(await recentFilings(ctx.cache, q.ticker, forms, q.limit));
    }),
  );

  /** GET /api/greenwash/filing-search?phrase=net zero[&cik=...] - phrase search inside filings */
  r.get(
    '/greenwash/filing-search',
    ah(async (req, res) => {
      const q = z
        .object({
          phrase: z.string().trim().min(3).max(120),
          cik: z.string().regex(/^\d{1,10}$/).optional(),
          limit: z.coerce.number().int().min(1).max(20).default(10),
        })
        .parse(req.query);
      res.json({
        hits: await remember(ctx.cache, `edgar:fts:${q.phrase}:${q.cik ?? ''}`, 3600, () =>
          searchFilingText(q.phrase, q.cik, q.limit),
        ),
      });
    }),
  );

  /** POST /api/greenwash/satellite - starts an async job, poll GET /api/jobs/:id */
  r.post(
    '/greenwash/satellite',
    requireAuth,
    ah(async (req, res) => {
      const b = SatelliteBody.parse(req.body);
      const job = ctx.jobs.enqueue('satellite', req.auth!.sub, () => sentinelScenes(b));
      res.status(202).json({ jobId: job.id, status: job.status, poll: `/api/jobs/${job.id}` });
    }),
  );
  return r;
}
