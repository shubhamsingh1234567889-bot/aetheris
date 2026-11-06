import { haversineKm } from '../lib/geo.js';
import type { WasteListing } from './types.js';

/** European Waste Catalogue chapters (2-digit), used for category matching and the UI picker. */
export const EWC_CHAPTERS: Record<string, string> = {
  '01': 'Mining and quarrying wastes',
  '02': 'Agriculture, horticulture, aquaculture, food preparation',
  '03': 'Wood processing, paper, pulp, furniture',
  '04': 'Leather, fur and textile industries',
  '05': 'Petroleum refining, natural gas purification, coal pyrolysis',
  '06': 'Inorganic chemical processes',
  '07': 'Organic chemical processes',
  '08': 'Paints, coatings, adhesives, inks',
  '09': 'Photographic industry',
  '10': 'Thermal processes (e.g. power plants, metallurgy)',
  '11': 'Chemical surface treatment and coating of metals',
  '12': 'Shaping and surface treatment of metals and plastics',
  '13': 'Oil wastes and liquid fuel wastes',
  '14': 'Organic solvents, refrigerants, propellants',
  '15': 'Waste packaging, absorbents, wiping cloths',
  '16': 'Wastes not otherwise specified',
  '17': 'Construction and demolition wastes',
  '18': 'Human or animal health care wastes',
  '19': 'Waste and water treatment facilities',
  '20': 'Municipal wastes',
};

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );

export function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const ewcDigits = (c?: string) => (c ?? '').replace(/\D/g, '');

export function materialSimilarity(a: WasteListing, b: WasteListing): number {
  const ea = ewcDigits(a.ewcCode), eb = ewcDigits(b.ewcCode);
  if (ea.length >= 6 && ea === eb) return 1;
  const text = jaccard(a.material, b.material);
  if (ea.length >= 2 && eb.length >= 2 && ea.slice(0, 2) === eb.slice(0, 2)) return Math.max(text, 0.6);
  return text;
}

export interface Match {
  listing: WasteListing;
  score: number;
  distanceKm: number;
  breakdown: { material: number; distance: number; quantity: number };
}

/** score = 0.5*material + 0.3*proximity + 0.2*quantity-fit; proximity decays with a 200 km scale. */
export function scoreMatch(source: WasteListing, candidate: WasteListing): Match {
  const distanceKm = haversineKm(source.lat, source.lon, candidate.lat, candidate.lon);
  const material = materialSimilarity(source, candidate);
  const distance = Math.exp(-distanceKm / 200);
  const hi = Math.max(source.quantityKg, candidate.quantityKg);
  const quantity = hi > 0 ? Math.min(source.quantityKg, candidate.quantityKg) / hi : 0;
  const score = 0.5 * material + 0.3 * distance + 0.2 * quantity;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    listing: candidate,
    score: r(score),
    distanceKm: Math.round(distanceKm * 10) / 10,
    breakdown: { material: r(material), distance: r(distance), quantity: r(quantity) },
  };
}

export function findMatches(source: WasteListing, pool: WasteListing[], minScore = 0.35, limit = 10): Match[] {
  const wanted = source.kind === 'offer' ? 'need' : 'offer';
  return pool
    .filter((c) => c.id !== source.id && c.kind === wanted && c.status === 'open' && c.orgId !== source.orgId)
    .map((c) => scoreMatch(source, c))
    // material must be at least loosely related, otherwise proximity alone would create noise
    .filter((m) => m.breakdown.material >= 0.2 && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
