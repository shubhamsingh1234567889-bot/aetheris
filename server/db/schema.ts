/**
 * Idempotent schema, applied on startup when DATABASE_URL is set.
 * Plain lat/lon columns keep this portable. On PostGIS-enabled databases you can add a
 * `geography(Point,4326)` column + GiST index and swap the haversine in domain/waste.ts for ST_DWithin.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS waste_listings (
  id            uuid PRIMARY KEY,
  org_id        text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('offer','need')),
  material      text NOT NULL,
  ewc_code      text,
  quantity_kg   double precision NOT NULL CHECK (quantity_kg > 0),
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waste_listings_open_idx ON waste_listings (kind, status);
CREATE INDEX IF NOT EXISTS waste_listings_org_idx ON waste_listings (org_id);

CREATE TABLE IF NOT EXISTS food_surplus (
  id            uuid PRIMARY KEY,
  org_id        text NOT NULL,
  item          text NOT NULL,
  category      text NOT NULL,
  quantity_kg   double precision NOT NULL CHECK (quantity_kg > 0),
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  packed_at     timestamptz NOT NULL,
  refrigerated  boolean NOT NULL DEFAULT true,
  storage_temp_c double precision,
  status        text NOT NULL DEFAULT 'available' CHECK (status IN ('available','dispatched','expired')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_surplus_status_idx ON food_surplus (status);
CREATE INDEX IF NOT EXISTS food_surplus_org_idx ON food_surplus (org_id);

CREATE TABLE IF NOT EXISTS carbon_entries (
  id          uuid PRIMARY KEY,
  org_id      text NOT NULL,
  label       text NOT NULL,
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carbon_entries_org_idx ON carbon_entries (org_id, created_at DESC);
`;
