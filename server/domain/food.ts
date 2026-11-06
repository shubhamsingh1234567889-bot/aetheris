/** Reference shelf life in days at 4C (refrigerated) or ambient-stable for shelf goods. */
export const SHELF_LIFE_DAYS: Record<string, number> = {
  dairy: 7,
  meat: 4,
  poultry: 3,
  fish: 2,
  produce: 7,
  bakery: 4,
  prepared_meals: 3,
  frozen: 90,
  canned: 365,
  dry_goods: 270,
  default: 7,
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'expired';

export interface SpoilageInput {
  category: string;
  /** hours since the product was produced/packed */
  ageHours: number;
  /** actual storage temperature in C */
  tempC: number;
  /** override reference shelf life (days at 4C) */
  shelfLifeDays?: number;
}

export interface SpoilageResult {
  risk: number; // 0..1
  level: RiskLevel;
  adjustedShelfLifeHours: number;
  remainingHours: number;
  assumptions: string[];
}

/**
 * Q10 rule of thumb: for every +10C, microbial/chemical spoilage roughly doubles, so shelf life
 * halves. Frozen / canned / dry goods are kept stable unless stored warm. This is a screening model;
 * calibrate Q10 and shelf lives against your own product data.
 */
export function spoilageRisk(input: SpoilageInput): SpoilageResult {
  const key = input.category.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const stable = key === 'canned' || key === 'dry_goods';
  // thawed "frozen" goods behave like fresh refrigerated product (~7 days at 4C)
  const thawed = key === 'frozen' && input.tempC > -5;
  const base = input.shelfLifeDays ?? (thawed ? 7 : (SHELF_LIFE_DAYS[key] ?? SHELF_LIFE_DAYS.default!));

  let factor: number;
  if (stable) factor = input.tempC > 30 ? 0.5 : 1;
  else if (key === 'frozen' && !thawed) factor = 1;
  else factor = 2 ** ((4 - input.tempC) / 10);
  factor = Math.min(Math.max(factor, 0.02), 4);

  const adjustedHours = base * 24 * factor;
  const remaining = adjustedHours - input.ageHours;
  const risk = Math.min(1, Math.max(0, input.ageHours / adjustedHours));
  const level: RiskLevel = remaining <= 0 ? 'expired' : risk >= 0.75 ? 'high' : risk >= 0.4 ? 'medium' : 'low';

  return {
    risk: Math.round(risk * 1000) / 1000,
    level,
    adjustedShelfLifeHours: Math.round(adjustedHours * 10) / 10,
    remainingHours: Math.round(remaining * 10) / 10,
    assumptions: [
      `Reference shelf life ${base} d at 4C for "${key in SHELF_LIFE_DAYS ? key : 'default'}"`,
      'Q10 = 2 temperature acceleration',
      'Screening estimate only - not a food-safety determination',
    ],
  };
}
