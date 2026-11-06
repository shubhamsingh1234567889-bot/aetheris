export interface Evidence {
  source: 'search' | 'edgar' | 'satellite';
  title: string;
  snippet?: string;
  url?: string;
}

export interface ClaimAssessment {
  riskScore: number; // 0-100, higher = more likely misleading
  level: 'low' | 'medium' | 'high';
  flags: { code: string; message: string; weight: number }[];
  recommendations: string[];
}

const VAGUE = [
  'eco-friendly', 'eco friendly', 'green', 'sustainable', 'natural', 'planet-friendly',
  'earth-friendly', 'clean', 'responsible', 'environmentally friendly', 'conscious',
];
const ABSOLUTE = ['100%', 'zero', 'carbon neutral', 'carbon-neutral', 'net zero', 'net-zero', 'carbon negative', 'climate positive', 'fully'];
const VERIFICATION = [
  'verified', 'audited', 'assured', 'third-party', 'third party', 'sbti', 'science-based', 'science based',
  'iso 14064', 'iso 14001', 'ghg protocol', 'cdp', 'csrd', 'tcfd', 'issb', 'b corp',
];
const OFFSET = ['offset', 'credits', 'compensat'];
const NEGATIVE_EVIDENCE = [
  'greenwash', 'misleading', 'fined', 'lawsuit', 'sued', 'deceptive', 'violation', 'ruling',
  'investigation', 'penalty', 'banned advert', 'class action',
];

const has = (text: string, words: string[]) => words.filter((w) => text.includes(w));

/**
 * Transparent heuristic screen (not a legal finding). Every flag carries a weight so the UI can
 * show *why* a claim scored as it did.
 */
export function assessClaim(claim: string, evidence: Evidence[] = []): ClaimAssessment {
  const text = claim.toLowerCase();
  const flags: ClaimAssessment['flags'] = [];
  const add = (code: string, message: string, weight: number) => flags.push({ code, message, weight });

  const vague = has(text, VAGUE);
  if (vague.length) add('vague_terms', `Vague, unqualified wording: ${vague.join(', ')}`, Math.min(30, vague.length * 15));

  const absolute = has(text, ABSOLUTE);
  const hasYear = /\b20[2-9]\d\b/.test(text);
  if (absolute.length && !hasYear) add('absolute_no_timeline', `Absolute claim without a target year: ${absolute.join(', ')}`, 15);

  if (!/\d/.test(text)) add('no_quantification', 'No numbers: no baseline, scope or measurable target', 15);

  if (has(text, VERIFICATION).length === 0) add('no_verification', 'No reference to third-party verification or a recognised standard', 20);

  if (has(text, OFFSET).length) add('offset_reliance', 'Relies on offsets/credits rather than direct reductions', 10);

  const negative = evidence.filter((e) => {
    const t = `${e.title} ${e.snippet ?? ''}`.toLowerCase();
    return has(t, NEGATIVE_EVIDENCE).length > 0;
  });
  if (negative.length) add('adverse_evidence', `${negative.length} source(s) mention regulatory action or greenwashing allegations`, 15);

  const riskScore = Math.min(100, flags.reduce((s, f) => s + f.weight, 0));
  const level = riskScore < 30 ? 'low' : riskScore < 60 ? 'medium' : 'high';

  const recommendations: string[] = [];
  if (flags.some((f) => f.code === 'no_verification')) recommendations.push('Look for an independent assurance statement or SBTi / CDP disclosure.');
  if (flags.some((f) => f.code === 'no_quantification' || f.code === 'absolute_no_timeline')) recommendations.push('Compare against the company\'s CSRD / SEC climate disclosures for baseline year, scope coverage and interim targets.');
  if (negative.length) recommendations.push('Review the cited regulatory / press items for the specific finding.');

  return { riskScore, level, flags, recommendations };
}
