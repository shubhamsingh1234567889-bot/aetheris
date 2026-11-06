export interface WasteListing {
  id: string;
  orgId: string;
  kind: 'offer' | 'need';
  material: string;
  /** European Waste Catalogue code, e.g. "10 01 02" (optional) */
  ewcCode?: string;
  quantityKg: number;
  lat: number;
  lon: number;
  description?: string;
  status: 'open' | 'matched' | 'closed';
  createdAt: string;
}

export interface FoodSurplus {
  id: string;
  orgId: string;
  item: string;
  category: string;
  quantityKg: number;
  lat: number;
  lon: number;
  /** ISO timestamp when the item was produced / packed */
  packedAt: string;
  refrigerated: boolean;
  storageTempC?: number;
  status: 'available' | 'dispatched' | 'expired';
  createdAt: string;
}

export interface CarbonEntry {
  id: string;
  orgId: string;
  label: string;
  result: unknown;
  createdAt: string;
}
