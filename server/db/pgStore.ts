import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { CarbonEntry, FoodSurplus, WasteListing } from '../domain/types.js';
import { SCHEMA_SQL } from './schema.js';
import type { NewFoodSurplus, NewWasteListing, Store } from './store.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/* eslint-disable @typescript-eslint/no-explicit-any */
const toWaste = (r: any): WasteListing => ({
  id: r.id, orgId: r.org_id, kind: r.kind, material: r.material, ewcCode: r.ewc_code ?? undefined,
  quantityKg: Number(r.quantity_kg), lat: Number(r.lat), lon: Number(r.lon),
  description: r.description ?? undefined, status: r.status, createdAt: iso(r.created_at),
});
const toFood = (r: any): FoodSurplus => ({
  id: r.id, orgId: r.org_id, item: r.item, category: r.category, quantityKg: Number(r.quantity_kg),
  lat: Number(r.lat), lon: Number(r.lon), packedAt: iso(r.packed_at), refrigerated: r.refrigerated,
  storageTempC: r.storage_temp_c === null ? undefined : Number(r.storage_temp_c),
  status: r.status, createdAt: iso(r.created_at),
});
const toCarbon = (r: any): CarbonEntry => ({
  id: r.id, orgId: r.org_id, label: r.label, result: r.result, createdAt: iso(r.created_at),
});

export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // managed providers (Render, Neon, Supabase) require TLS; enable with ?sslmode=require in the URL
    });
  }

  async init() { await this.pool.query(SCHEMA_SQL); }
  async ping() {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }
  async close() { await this.pool.end(); }

  async addWasteListing(l: NewWasteListing) {
    const { rows } = await this.pool.query(
      `INSERT INTO waste_listings (id, org_id, kind, material, ewc_code, quantity_kg, lat, lon, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [randomUUID(), l.orgId, l.kind, l.material, l.ewcCode ?? null, l.quantityKg, l.lat, l.lon, l.description ?? null],
    );
    return toWaste(rows[0]);
  }
  async getWasteListing(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM waste_listings WHERE id = $1', [id]);
    return rows[0] ? toWaste(rows[0]) : undefined;
  }
  async listWasteListings(f: { kind?: 'offer' | 'need'; status?: WasteListing['status']; limit: number }) {
    const { rows } = await this.pool.query(
      `SELECT * FROM waste_listings
       WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [f.kind ?? null, f.status ?? null, f.limit],
    );
    return rows.map(toWaste);
  }
  async setWasteStatus(id: string, orgId: string, status: WasteListing['status']) {
    const { rows } = await this.pool.query(
      'UPDATE waste_listings SET status = $3 WHERE id = $1 AND org_id = $2 RETURNING *',
      [id, orgId, status],
    );
    return rows[0] ? toWaste(rows[0]) : undefined;
  }

  async addFoodSurplus(s: NewFoodSurplus) {
    const { rows } = await this.pool.query(
      `INSERT INTO food_surplus (id, org_id, item, category, quantity_kg, lat, lon, packed_at, refrigerated, storage_temp_c)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomUUID(), s.orgId, s.item, s.category, s.quantityKg, s.lat, s.lon, s.packedAt, s.refrigerated, s.storageTempC ?? null],
    );
    return toFood(rows[0]);
  }
  async getFoodSurplus(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM food_surplus WHERE id = $1', [id]);
    return rows[0] ? toFood(rows[0]) : undefined;
  }
  async listFoodSurplus(f: { status?: FoodSurplus['status']; limit: number }) {
    const { rows } = await this.pool.query(
      `SELECT * FROM food_surplus WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`,
      [f.status ?? null, f.limit],
    );
    return rows.map(toFood);
  }
  async setFoodStatus(id: string, orgId: string, status: FoodSurplus['status']) {
    const { rows } = await this.pool.query(
      'UPDATE food_surplus SET status = $3 WHERE id = $1 AND org_id = $2 RETURNING *',
      [id, orgId, status],
    );
    return rows[0] ? toFood(rows[0]) : undefined;
  }

  async addCarbonEntry(orgId: string, label: string, result: unknown) {
    const { rows } = await this.pool.query(
      'INSERT INTO carbon_entries (id, org_id, label, result) VALUES ($1,$2,$3,$4::jsonb) RETURNING *',
      [randomUUID(), orgId, label, JSON.stringify(result)],
    );
    return toCarbon(rows[0]);
  }
  async listCarbonEntries(orgId: string, limit: number) {
    const { rows } = await this.pool.query(
      'SELECT * FROM carbon_entries WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2',
      [orgId, limit],
    );
    return rows.map(toCarbon);
  }
}
