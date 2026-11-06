/**
 * Scope 1/2/3 screening calculator.
 *
 * IMPORTANT: the built-in factors are approximate *screening* values so the app
 * works offline. For reporting, pass `factorKgPerUnit` per item (e.g. from
 * Climatiq / EPA / DEFRA) - the result then carries that factor and a tighter
 * uncertainty range.
 */
export type Scope = 1 | 2 | 3;
export type Method = 'activity' | 'spend';

export interface CarbonItemInput {
  label?: string;
  method: Method;
  category: string;
  scope?: Scope;
  /** activity method */
  quantity?: number;
  unit?: string;
  /** spend method (USD) */
  spendUsd?: number;
  /** override: kgCO2e per unit (activity) or per USD (spend) */
  factorKgPerUnit?: number;
  /** electricity only: grid intensity in kgCO2e/kWh (e.g. from /api/carbon/grid-intensity) */
  gridKgPerKwh?: number;
}

export interface CarbonItemResult {
  label: string;
  scope: Scope;
  method: Method;
  category: string;
  kgCo2e: number;
  lowKg: number;
  highKg: number;
  uncertaintyPct: number;
  factor: number | null;
  factorSource: 'user' | 'grid' | 'default-screening';
  warnings: string[];
}

export const ACTIVITY_FACTORS: Record<string, { unit: string; kg: number; scope: Scope }> = {
  natural_gas: { unit: 'kwh', kg: 0.183, scope: 1 },
  diesel: { unit: 'litre', kg: 2.68, scope: 1 },
  petrol: { unit: 'litre', kg: 2.31, scope: 1 },
  electricity: { unit: 'kwh', kg: 0.445, scope: 2 },
  road_freight: { unit: 'tkm', kg: 0.105, scope: 3 },
  air_freight: { unit: 'tkm', kg: 0.6, scope: 3 },
  business_flight: { unit: 'pkm', kg: 0.15, scope: 3 },
  waste_landfill: { unit: 'kg', kg: 0.46, scope: 3 },
};

export const SPEND_FACTORS_KG_PER_USD: Record<string, number> = {
  purchased_goods: 0.4,
  services: 0.15,
  electronics: 0.35,
  construction: 0.45,
  transport: 0.6,
  food: 0.9,
  default: 0.4,
};

const UNIT_ALIASES: Record<string, string> = {
  kwh: 'kwh', 'kw-h': 'kwh', mwh: 'mwh',
  l: 'litre', litre: 'litre', liter: 'litre', litres: 'litre', liters: 'litre',
  kg: 'kg', t: 'tonne', tonne: 'tonne', tonnes: 'tonne',
  tkm: 'tkm', pkm: 'pkm', m3: 'm3',
};

export const normalizeUnit = (u?: string): string | undefined =>
  u ? (UNIT_ALIASES[u.trim().toLowerCase()] ?? u.trim().toLowerCase()) : undefined;

/** Convert quantity into the factor's unit where a simple conversion exists. */
function convert(qty: number, from: string | undefined, to: string): number | null {
  if (!from || from === to) return qty;
  if (from === 'mwh' && to === 'kwh') return qty * 1000;
  if (from === 'tonne' && to === 'kg') return qty * 1000;
  if (from === 'kg' && to === 'tonne') return qty / 1000;
  return null;
}

const key = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

export function calculateItem(input: CarbonItemInput): CarbonItemResult {
  const category = key(input.category);
  const warnings: string[] = [];
  const label = input.label ?? category;

  if (input.method === 'spend') {
    if (input.spendUsd === undefined || input.spendUsd < 0) {
      throw new Error(`"${label}": spendUsd is required for the spend method`);
    }
    let factor = input.factorKgPerUnit;
    let source: CarbonItemResult['factorSource'] = 'user';
    if (factor === undefined) {
      source = 'default-screening';
      factor = SPEND_FACTORS_KG_PER_USD[category];
      if (factor === undefined) {
        factor = SPEND_FACTORS_KG_PER_USD.default!;
        warnings.push(`No spend factor for "${category}"; used generic purchased-goods factor`);
      }
    }
    const kg = input.spendUsd * factor;
    const u = 0.5; // spend-based EEIO factors are coarse
    warnings.push('Spend-based estimate: prefer supplier activity data where available');
    return {
      label, scope: input.scope ?? 3, method: 'spend', category,
      kgCo2e: kg, lowKg: kg * (1 - u), highKg: kg * (1 + u), uncertaintyPct: u * 100,
      factor, factorSource: source, warnings,
    };
  }

  // activity method
  if (input.quantity === undefined || input.quantity < 0) {
    throw new Error(`"${label}": quantity is required for the activity method`);
  }
  const def = ACTIVITY_FACTORS[category];
  let factor = input.factorKgPerUnit;
  let source: CarbonItemResult['factorSource'] = 'user';
  let qty = input.quantity;
  let scope: Scope = input.scope ?? def?.scope ?? 3;
  let u = 0.1;

  if (factor === undefined) {
    if (category === 'electricity' && input.gridKgPerKwh !== undefined) {
      factor = input.gridKgPerKwh;
      source = 'grid';
      const q = convert(qty, normalizeUnit(input.unit) ?? 'kwh', 'kwh');
      if (q === null) throw new Error(`"${label}": electricity unit must be kWh or MWh`);
      qty = q;
      u = 0.1;
    } else if (def) {
      factor = def.kg;
      source = 'default-screening';
      const q = convert(qty, normalizeUnit(input.unit) ?? def.unit, def.unit);
      if (q === null) {
        throw new Error(`"${label}": unit "${input.unit}" not supported for ${category} (expected ${def.unit})`);
      }
      qty = q;
      u = 0.2;
      warnings.push('Default screening factor used; supply factorKgPerUnit for reporting-grade results');
    } else {
      throw new Error(
        `"${label}": no built-in factor for "${category}". Provide factorKgPerUnit or use the spend method`,
      );
    }
  }

  if (category === 'electricity') scope = input.scope ?? 2;
  const kg = qty * factor;
  return {
    label, scope, method: 'activity', category,
    kgCo2e: kg, lowKg: kg * (1 - u), highKg: kg * (1 + u), uncertaintyPct: u * 100,
    factor, factorSource: source, warnings,
  };
}

export interface CarbonSummary {
  items: CarbonItemResult[];
  byScope: Record<'scope1' | 'scope2' | 'scope3', number>;
  totalKgCo2e: number;
  /** 95% range: independent item uncertainties combined in quadrature */
  rangeKg: { low: number; high: number };
  methodology: string;
}

export function calculate(inputs: CarbonItemInput[]): CarbonSummary {
  const items = inputs.map(calculateItem);
  const byScope = { scope1: 0, scope2: 0, scope3: 0 };
  let total = 0;
  let sumSq = 0;
  for (const it of items) {
    byScope[`scope${it.scope}` as keyof typeof byScope] += it.kgCo2e;
    total += it.kgCo2e;
    sumSq += ((it.highKg - it.lowKg) / 2) ** 2;
  }
  const half = Math.sqrt(sumSq);
  return {
    items,
    byScope,
    totalKgCo2e: total,
    rangeKg: { low: Math.max(0, total - half), high: total + half },
    methodology:
      'kgCO2e = activity x factor, or spend(USD) x EEIO factor. Item uncertainty: 10% (supplied/grid factor), 20% (default activity), 50% (spend). Totals combine item uncertainties in quadrature (assumes independence).',
  };
}

/* ---------- supplier data reconciliation ---------- */

export interface SupplierRowClean {
  supplier: string;
  category: string;
  quantity?: number;
  unit?: string;
  spendUsd?: number;
  country?: string;
  period?: string;
}
export interface SupplierImportReport {
  rows: SupplierRowClean[];
  issues: { row: number; problem: string }[];
  duplicatesRemoved: number;
}

const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const cleaned = s.replace(/[^0-9.,-]/g, '');
  if (!cleaned) return undefined;
  // "1.234,56" (EU) vs "1,234.56" (US)
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normalized =
    lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
};

/** Clean messy supplier rows: trim, normalise units/numbers/categories, flag gaps, drop duplicates. */
export function normalizeSupplierRows(records: Record<string, string>[]): SupplierImportReport {
  const rows: SupplierRowClean[] = [];
  const issues: SupplierImportReport['issues'] = [];
  const seen = new Set<string>();
  let dup = 0;

  records.forEach((r, idx) => {
    const line = idx + 2; // header is line 1
    const supplier = (r.supplier ?? r.vendor ?? r.name ?? '').trim();
    const category = key(r.category ?? r.type ?? '');
    if (!supplier) return void issues.push({ row: line, problem: 'missing supplier' });
    if (!category) return void issues.push({ row: line, problem: 'missing category' });

    const quantity = num(r.quantity ?? r.qty ?? r.amount);
    const spendUsd = num(r.spend_usd ?? r.spend ?? r.cost);
    const unit = normalizeUnit(r.unit);
    if (quantity === undefined && spendUsd === undefined) {
      return void issues.push({ row: line, problem: 'needs quantity or spend' });
    }
    if (quantity !== undefined && quantity < 0) {
      return void issues.push({ row: line, problem: 'negative quantity' });
    }
    if (r.currency && r.currency.toUpperCase() !== 'USD' && spendUsd !== undefined) {
      issues.push({ row: line, problem: `spend is in ${r.currency.toUpperCase()}; treated as USD - convert first` });
    }
    const period = r.period || r.year || undefined;
    const dedupe = [supplier.toLowerCase(), category, period ?? '', quantity ?? '', spendUsd ?? ''].join('|');
    if (seen.has(dedupe)) {
      dup++;
      return;
    }
    seen.add(dedupe);
    rows.push({ supplier, category, quantity, unit, spendUsd, country: r.country || undefined, period });
  });
  return { rows, issues, duplicatesRemoved: dup };
}
