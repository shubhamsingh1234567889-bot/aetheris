export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** PV output (kW). Simple model: irradiance x performance ratio with a cell-temperature derate. */
export function solarKw(ghiWm2: number, capacityKw: number, tempC = 25, pr = 0.8): number {
  if (ghiWm2 <= 0 || capacityKw <= 0) return 0;
  const cellTemp = tempC + 0.025 * ghiWm2;
  const derate = 1 - 0.004 * Math.max(0, cellTemp - 25);
  return capacityKw * (ghiWm2 / 1000) * pr * clamp(derate, 0.5, 1);
}

/** Wind turbine output (kW): cubic ramp between cut-in and rated speed, cut-out for storms. */
export function windKw(speedMs: number, capacityKw: number, cutIn = 3, rated = 12, cutOut = 25): number {
  if (capacityKw <= 0 || speedMs < cutIn || speedMs >= cutOut) return 0;
  if (speedMs >= rated) return capacityKw;
  return capacityKw * ((speedMs ** 3 - cutIn ** 3) / (rated ** 3 - cutIn ** 3));
}

/** Typical commercial/residential mixed daily shape, index = hour of day, mean ~= 1. */
const SHAPE = [
  0.7, 0.65, 0.62, 0.6, 0.62, 0.7, 0.85, 1.05, 1.15, 1.15, 1.12, 1.1,
  1.1, 1.08, 1.08, 1.1, 1.18, 1.3, 1.35, 1.25, 1.1, 0.95, 0.82, 0.74,
];
const SHAPE_MEAN = SHAPE.reduce((a, b) => a + b, 0) / SHAPE.length;

export const demandKw = (hourOfDay: number, avgKw: number) =>
  (avgKw * SHAPE[((hourOfDay % 24) + 24) % 24]!) / SHAPE_MEAN;

export interface Battery {
  capacityKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  /** starting state of charge, 0-100 */
  socPct?: number;
  minSocPct?: number;
  maxSocPct?: number;
  /** round-trip efficiency 0-1 (split evenly between charge and discharge) */
  roundTripEff?: number;
}

export interface DispatchInput {
  generationKw: number[];
  demandKw: number[];
  battery?: Battery;
  /** max power exported to the grid, kW (default: unlimited) */
  exportLimitKw?: number;
  /** step length in hours (default 1) */
  stepHours?: number;
}

export interface DispatchStep {
  step: number;
  generationKw: number;
  demandKw: number;
  chargeKw: number;
  dischargeKw: number;
  exportKw: number;
  importKw: number;
  curtailedKw: number;
  socKwh: number;
}

export interface DispatchResult {
  schedule: DispatchStep[];
  totals: {
    generationKwh: number;
    demandKwh: number;
    importKwh: number;
    exportKwh: number;
    curtailedKwh: number;
    curtailmentPct: number;
    renewableCoveragePct: number;
    batteryCyclesEquivalent: number;
  };
  notes: string[];
}

/**
 * Greedy rule-based dispatch: surplus -> charge battery -> export up to the limit -> curtail;
 * deficit -> discharge battery -> import. It is a heuristic, not an optimiser (no prices or
 * forecast look-ahead); replace with an LP/MILP if you need cost-optimal dispatch.
 */
export function dispatch(input: DispatchInput): DispatchResult {
  const n = input.generationKw.length;
  if (n === 0 || input.demandKw.length !== n) {
    throw new Error('generationKw and demandKw must be non-empty arrays of equal length');
  }
  const dt = input.stepHours ?? 1;
  const b = input.battery;
  const cap = b?.capacityKwh ?? 0;
  const eta = Math.sqrt(clamp(b?.roundTripEff ?? 0.9, 0.01, 1));
  const minSoc = cap * clamp((b?.minSocPct ?? 10) / 100, 0, 1);
  const maxSoc = cap * clamp((b?.maxSocPct ?? 100) / 100, 0, 1);
  let soc = clamp(cap * ((b?.socPct ?? 50) / 100), minSoc, maxSoc);
  const exportLimit = input.exportLimitKw ?? Infinity;

  const schedule: DispatchStep[] = [];
  const t = { gen: 0, dem: 0, imp: 0, exp: 0, cur: 0, charged: 0 };

  for (let i = 0; i < n; i++) {
    const gen = Math.max(0, input.generationKw[i]!);
    const dem = Math.max(0, input.demandKw[i]!);
    const net = gen - dem;
    let charge = 0, discharge = 0, exp = 0, imp = 0, cur = 0;

    if (net >= 0) {
      if (cap > 0) {
        charge = Math.min(net, b!.maxChargeKw, Math.max(0, (maxSoc - soc) / (dt * eta)));
        soc += charge * dt * eta;
        t.charged += charge * dt;
      }
      const rest = net - charge;
      exp = Math.min(rest, exportLimit);
      cur = rest - exp;
    } else {
      const deficit = -net;
      if (cap > 0) {
        discharge = Math.min(deficit, b!.maxDischargeKw, Math.max(0, ((soc - minSoc) * eta) / dt));
        soc -= (discharge * dt) / eta;
      }
      imp = deficit - discharge;
    }

    t.gen += gen * dt; t.dem += dem * dt; t.imp += imp * dt; t.exp += exp * dt; t.cur += cur * dt;
    schedule.push({
      step: i, generationKw: r(gen), demandKw: r(dem), chargeKw: r(charge), dischargeKw: r(discharge),
      exportKw: r(exp), importKw: r(imp), curtailedKw: r(cur), socKwh: r(soc),
    });
  }

  const notes: string[] = [];
  if (t.cur > 0) {
    notes.push(
      `${r(t.cur)} kWh would be curtailed. Options: add storage, raise the export limit, or shift flexible load (EV charging, heat, cold storage) into surplus hours.`,
    );
  }
  if (t.imp > 0 && cap === 0) notes.push('No battery configured; all deficits are met from the grid.');

  return {
    schedule,
    totals: {
      generationKwh: r(t.gen), demandKwh: r(t.dem), importKwh: r(t.imp), exportKwh: r(t.exp),
      curtailedKwh: r(t.cur),
      curtailmentPct: t.gen > 0 ? r((t.cur / t.gen) * 100) : 0,
      renewableCoveragePct: t.dem > 0 ? r(((t.dem - t.imp) / t.dem) * 100) : 0,
      batteryCyclesEquivalent: cap > 0 ? r(t.charged / cap) : 0,
    },
    notes,
  };
}

function r(x: number): number {
  return Math.round(x * 100) / 100;
}
