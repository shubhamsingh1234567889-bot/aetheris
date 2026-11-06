import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCache, remember } from '../server/lib/cache.js';
import { CircuitBreaker, BreakerOpenError } from '../server/lib/breaker.js';
import { JobQueue } from '../server/lib/jobs.js';
import { haversineKm, bboxAround } from '../server/lib/geo.js';
import { parseCsv, parseCsvRecords } from '../server/lib/csv.js';
import { calculate, calculateItem, normalizeSupplierRows } from '../server/domain/carbon.js';
import { dispatch, solarKw, windKw, demandKw } from '../server/domain/energy.js';
import { spoilageRisk } from '../server/domain/food.js';
import { findMatches, scoreMatch } from '../server/domain/waste.js';
import { assessClaim } from '../server/domain/greenwash.js';
import { aqiCategory } from '../server/domain/aqi.js';
import type { WasteListing } from '../server/domain/types.js';

/* ---------------- lib ---------------- */

test('MemoryCache expires entries and evicts least-recently-used', async () => {
  let now = 0;
  const c = new MemoryCache(2, () => now);
  await c.set('a', 1, 10);
  await c.set('b', 2, 10);
  await c.get('a'); // a is now most recent
  await c.set('c', 3, 10); // evicts b
  assert.equal(await c.get('b'), undefined);
  assert.equal(await c.get('a'), 1);
  now = 11_000;
  assert.equal(await c.get('a'), undefined);
});

test('remember() de-duplicates concurrent loads', async () => {
  const c = new MemoryCache();
  let calls = 0;
  const loader = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return 42;
  };
  const [a, b, d] = await Promise.all([
    remember(c, 'k', 60, loader),
    remember(c, 'k', 60, loader),
    remember(c, 'k', 60, loader),
  ]);
  assert.deepEqual([a, b, d], [42, 42, 42]);
  assert.equal(calls, 1);
  assert.equal(await remember(c, 'k', 60, loader), 42);
  assert.equal(calls, 1);
});

test('CircuitBreaker opens after threshold, then half-opens after cooldown', async () => {
  let now = 0;
  const b = new CircuitBreaker('x', { threshold: 2, cooldownMs: 1000, now: () => now });
  const fail = () => b.exec(async () => { throw new Error('boom'); });
  await assert.rejects(fail, /boom/);
  await assert.rejects(fail, /boom/);
  assert.equal(b.state, 'open');
  await assert.rejects(() => b.exec(async () => 1), BreakerOpenError);
  now = 1500;
  assert.equal(b.state, 'half-open');
  assert.equal(await b.exec(async () => 'ok'), 'ok');
  assert.equal(b.state, 'closed');
});

test('JobQueue runs jobs and records results/errors', async () => {
  const q = new JobQueue(1);
  const ok = q.enqueue('t', 'u1', async () => 'done');
  const bad = q.enqueue('t', 'u1', async () => { throw new Error('nope'); });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(q.get(ok.id)?.status, 'succeeded');
  assert.equal(q.get(ok.id)?.result, 'done');
  assert.equal(q.get(bad.id)?.status, 'failed');
  assert.equal(q.get(bad.id)?.error, 'nope');
});

test('haversine: London-Paris is ~344 km; bbox contains its centre', () => {
  const d = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
  assert.ok(d > 340 && d < 348, String(d));
  const [w, s, e, n] = bboxAround(10, 20, 50);
  assert.ok(w < 20 && e > 20 && s < 10 && n > 10);
});

test('CSV parser handles quotes, commas, CRLF and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  assert.deepEqual(parseCsvRecords('Spend USD,Name\n5,Foo'), [{ spend_usd: '5', name: 'Foo' }]);
});

/* ---------------- carbon ---------------- */

test('carbon: activity with default factor, unit conversion and scope', () => {
  const r = calculateItem({ method: 'activity', category: 'diesel', quantity: 100, unit: 'L' });
  assert.equal(r.scope, 1);
  assert.ok(Math.abs(r.kgCo2e - 268) < 1e-9);
  const e = calculateItem({ method: 'activity', category: 'electricity', quantity: 2, unit: 'MWh', gridKgPerKwh: 0.2 });
  assert.equal(e.scope, 2);
  assert.equal(e.factorSource, 'grid');
  assert.ok(Math.abs(e.kgCo2e - 400) < 1e-9);
});

test('carbon: spend method is wider than activity; totals and quadrature range', () => {
  const s = calculate([
    { method: 'activity', category: 'natural_gas', quantity: 1000, unit: 'kWh', label: 'boiler' },
    { method: 'spend', category: 'services', spendUsd: 10_000, label: 'consulting' },
  ]);
  assert.ok(Math.abs(s.byScope.scope1 - 183) < 1e-9);
  assert.ok(Math.abs(s.byScope.scope3 - 1500) < 1e-9);
  assert.ok(Math.abs(s.totalKgCo2e - 1683) < 1e-9);
  const half = Math.sqrt((183 * 0.2) ** 2 + (1500 * 0.5) ** 2);
  assert.ok(Math.abs(s.rangeKg.high - (1683 + half)) < 1e-6);
});

test('carbon: unknown category without a factor throws helpful error', () => {
  assert.throws(() => calculateItem({ method: 'activity', category: 'unicorn_dust', quantity: 1 }), /no built-in factor/);
  assert.throws(() => calculateItem({ method: 'spend', category: 'x' }), /spendUsd is required/);
});

test('supplier import: cleans numbers, flags problems, removes duplicates', () => {
  const rep = normalizeSupplierRows(
    parseCsvRecords(
      [
        'Supplier,Category,Qty,Unit,Spend,Currency,Country',
        'Acme Ltd, Natural Gas ,"1,200.5",kWh,,,UK',
        'Acme Ltd,natural gas,1200.5,kwh,,,UK',
        ',diesel,10,L,,,',
        'Beta,services,,,"1.234,56",EUR,DE',
        'Gamma,diesel,,,,,',
      ].join('\n'),
    ),
  );
  assert.equal(rep.rows.length, 2);
  assert.equal(rep.rows[0]!.quantity, 1200.5);
  assert.equal(rep.rows[0]!.category, 'natural_gas');
  assert.equal(rep.rows[1]!.spendUsd, 1234.56);
  assert.equal(rep.duplicatesRemoved, 1);
  const probs = rep.issues.map((i) => i.problem);
  assert.ok(probs.includes('missing supplier'));
  assert.ok(probs.includes('needs quantity or spend'));
  assert.ok(probs.some((p) => p.includes('EUR')));
});

/* ---------------- energy ---------------- */

test('solar/wind models behave sensibly', () => {
  assert.equal(solarKw(0, 100), 0);
  assert.ok(solarKw(1000, 100) > 60 && solarKw(1000, 100) < 80);
  assert.equal(windKw(2, 100), 0);
  assert.equal(windKw(12, 100), 100);
  assert.equal(windKw(30, 100), 0);
  assert.ok(windKw(8, 100) > 0 && windKw(8, 100) < 100);
  const avg = Array.from({ length: 24 }, (_, h) => demandKw(h, 50)).reduce((a, b) => a + b, 0) / 24;
  assert.ok(Math.abs(avg - 50) < 1e-9);
});

test('dispatch: energy balance holds every step and SOC stays within bounds', () => {
  const gen = [0, 0, 80, 120, 150, 100, 20, 0];
  const dem = [40, 40, 50, 60, 60, 60, 70, 70];
  const res = dispatch({
    generationKw: gen,
    demandKw: dem,
    battery: { capacityKwh: 100, maxChargeKw: 40, maxDischargeKw: 40, socPct: 50, roundTripEff: 0.81 },
    exportLimitKw: 20,
  });
  for (const s of res.schedule) {
    const supply = s.generationKw + s.dischargeKw + s.importKw;
    const use = s.demandKw + s.chargeKw + s.exportKw + s.curtailedKw;
    assert.ok(Math.abs(supply - use) < 0.05, `step ${s.step}: ${supply} vs ${use}`);
    assert.ok(s.socKwh >= 10 - 1e-6 && s.socKwh <= 100 + 1e-6);
  }
  assert.ok(res.totals.curtailedKwh > 0, 'tight export limit should curtail');
  assert.ok(res.notes.some((n) => n.includes('curtailed')));
});

test('dispatch: no battery means deficits are imported', () => {
  const res = dispatch({ generationKw: [0, 0], demandKw: [10, 20] });
  assert.equal(res.totals.importKwh, 30);
  assert.equal(res.totals.renewableCoveragePct, 0);
  assert.throws(() => dispatch({ generationKw: [1], demandKw: [] }));
});

/* ---------------- food ---------------- */

test('spoilage: warmer storage shortens shelf life; thresholds and expiry', () => {
  const cold = spoilageRisk({ category: 'dairy', ageHours: 48, tempC: 4 });
  const warm = spoilageRisk({ category: 'dairy', ageHours: 48, tempC: 24 });
  assert.ok(warm.risk > cold.risk);
  assert.equal(cold.level, 'low');
  assert.ok(Math.abs(cold.adjustedShelfLifeHours - 168) < 0.2);
  assert.equal(spoilageRisk({ category: 'fish', ageHours: 100, tempC: 4 }).level, 'expired');
  assert.equal(spoilageRisk({ category: 'canned', ageHours: 24 * 100, tempC: 20 }).level, 'low');
  assert.equal(spoilageRisk({ category: 'frozen', ageHours: 24 * 30, tempC: -18 }).level, 'low');
  assert.notEqual(spoilageRisk({ category: 'frozen', ageHours: 24 * 30, tempC: 5 }).level, 'low');
});

/* ---------------- waste ---------------- */

const L = (o: Partial<WasteListing>): WasteListing => ({
  id: 'x', orgId: 'a', kind: 'offer', material: 'fly ash', quantityKg: 1000, lat: 51.5, lon: -0.12,
  status: 'open', createdAt: '', ...o,
});

test('waste matching: opposite kind, other org, material + proximity ranking', () => {
  const offer = L({ id: 'o', ewcCode: '10 01 02', material: 'coal fly ash' });
  const pool = [
    L({ id: 'n1', kind: 'need', orgId: 'b', material: 'fly ash for cement', ewcCode: '10 01 02', lat: 51.6, lon: -0.1 }),
    L({ id: 'n2', kind: 'need', orgId: 'c', material: 'fly ash', lat: 40.7, lon: -74 }),
    L({ id: 'n3', kind: 'need', orgId: 'd', material: 'used cooking oil', lat: 51.5, lon: -0.12 }),
    L({ id: 'same', kind: 'need', orgId: 'a', material: 'fly ash' }),
    L({ id: 'off', kind: 'offer', orgId: 'e', material: 'fly ash' }),
    L({ id: 'closed', kind: 'need', orgId: 'f', material: 'fly ash', status: 'closed' }),
  ];
  const m = findMatches(offer, pool);
  assert.deepEqual(m.map((x) => x.listing.id), ['n1', 'n2']);
  assert.ok(m[0]!.score > m[1]!.score);
  assert.equal(scoreMatch(offer, pool[0]!).breakdown.material, 1);
});

/* ---------------- greenwash + aqi ---------------- */

test('greenwash: vague claim scores high, specific verified claim scores low', () => {
  const vague = assessClaim('Our eco-friendly, sustainable packaging is 100% green');
  assert.equal(vague.level, 'high');
  const solid = assessClaim(
    'We cut Scope 1 and 2 emissions 42% vs a 2019 baseline, verified by third-party assurance and validated by SBTi',
  );
  assert.equal(solid.level, 'low');
  const withEvidence = assessClaim('Net zero by 2040, verified 30%', [
    { source: 'search', title: 'Regulator fined firm over misleading green ad' },
  ]);
  assert.ok(withEvidence.flags.some((f) => f.code === 'adverse_evidence'));
});

test('aqi categories', () => {
  assert.equal(aqiCategory(42).level, 'good');
  assert.equal(aqiCategory(101).level, 'unhealthy_sensitive');
  assert.equal(aqiCategory(420).level, 'hazardous');
});
