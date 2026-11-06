import { randomUUID } from 'node:crypto';
import type { CarbonEntry, FoodSurplus, WasteListing } from '../domain/types.js';

export type NewWasteListing = Omit<WasteListing, 'id' | 'createdAt' | 'status'>;
export type NewFoodSurplus = Omit<FoodSurplus, 'id' | 'createdAt' | 'status'>;

export interface Store {
  readonly kind: 'memory' | 'postgres';
  init(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;

  addWasteListing(l: NewWasteListing): Promise<WasteListing>;
  getWasteListing(id: string): Promise<WasteListing | undefined>;
  listWasteListings(f: { kind?: 'offer' | 'need'; status?: WasteListing['status']; limit: number }): Promise<WasteListing[]>;
  setWasteStatus(id: string, orgId: string, status: WasteListing['status']): Promise<WasteListing | undefined>;

  addFoodSurplus(s: NewFoodSurplus): Promise<FoodSurplus>;
  getFoodSurplus(id: string): Promise<FoodSurplus | undefined>;
  listFoodSurplus(f: { status?: FoodSurplus['status']; limit: number }): Promise<FoodSurplus[]>;
  setFoodStatus(id: string, orgId: string, status: FoodSurplus['status']): Promise<FoodSurplus | undefined>;

  addCarbonEntry(orgId: string, label: string, result: unknown): Promise<CarbonEntry>;
  listCarbonEntries(orgId: string, limit: number): Promise<CarbonEntry[]>;
}

/** Default store: in-memory, lost on restart. Set DATABASE_URL to use Postgres. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private waste = new Map<string, WasteListing>();
  private food = new Map<string, FoodSurplus>();
  private carbon = new Map<string, CarbonEntry>();

  async init() {}
  async ping() { return true; }
  async close() {}

  async addWasteListing(l: NewWasteListing) {
    const row: WasteListing = { ...l, id: randomUUID(), status: 'open', createdAt: new Date().toISOString() };
    this.waste.set(row.id, row);
    return row;
  }
  async getWasteListing(id: string) { return this.waste.get(id); }
  async listWasteListings(f: { kind?: 'offer' | 'need'; status?: WasteListing['status']; limit: number }) {
    return [...this.waste.values()]
      .filter((l) => (!f.kind || l.kind === f.kind) && (!f.status || l.status === f.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, f.limit);
  }
  async setWasteStatus(id: string, orgId: string, status: WasteListing['status']) {
    const row = this.waste.get(id);
    if (!row || row.orgId !== orgId) return undefined;
    row.status = status;
    return row;
  }

  async addFoodSurplus(s: NewFoodSurplus) {
    const row: FoodSurplus = { ...s, id: randomUUID(), status: 'available', createdAt: new Date().toISOString() };
    this.food.set(row.id, row);
    return row;
  }
  async getFoodSurplus(id: string) { return this.food.get(id); }
  async listFoodSurplus(f: { status?: FoodSurplus['status']; limit: number }) {
    return [...this.food.values()]
      .filter((s) => !f.status || s.status === f.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, f.limit);
  }
  async setFoodStatus(id: string, orgId: string, status: FoodSurplus['status']) {
    const row = this.food.get(id);
    if (!row || row.orgId !== orgId) return undefined;
    row.status = status;
    return row;
  }

  async addCarbonEntry(orgId: string, label: string, result: unknown) {
    const row: CarbonEntry = { id: randomUUID(), orgId, label, result, createdAt: new Date().toISOString() };
    this.carbon.set(row.id, row);
    return row;
  }
  async listCarbonEntries(orgId: string, limit: number) {
    return [...this.carbon.values()]
      .filter((e) => e.orgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
