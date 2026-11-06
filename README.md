# Aetheris Climate & Sustainability OS

Sustainability intelligence platform: React + TypeScript + Tailwind frontend, **Express + TypeScript backend**.

## 5 Core Modules
1. **Scope 1, 2, & 3 Carbon Tracking** – activity vs spend methods, uncertainty ranges, supplier-data reconciliation, live grid intensity.
2. **Greenwashing Detection Engine** – transparent claim screen, corroborated with web search, SEC EDGAR filings and Copernicus Sentinel-2 coverage.
3. **Waste-to-Resource Marketplace** – industrial symbiosis matching (material + distance + quantity).
4. **Energy Grid Optimization** – 24 h solar/wind forecast, battery dispatch, curtailment detection.
5. **Food Waste Reduction** – spoilage-risk model, surplus board, nearest-recipient dispatch.

---

## Architecture

```
browser ──► /api/*  (Express: server/)  ──► TinyFish · WAQI · Open-Meteo · SEC EDGAR · Copernicus
   │                  │  helmet · CORS · rate limits · zod validation · JWT auth
   │                  │  cache (memory/Redis) · circuit breakers · background jobs
   │                  └► Postgres (or in-memory store)
   └──► static React build (dist/) served by the same process
```

**API keys never reach the browser.** Do not use `VITE_`-prefixed variables for secrets – Vite inlines them
into the public JavaScript bundle. All keys are read by the server only.

```
server/
  index.ts · app.ts · config.ts · logger.ts · context.ts
  lib/         cache (LRU/Redis) · circuit breaker · http (timeout+retry) · job queue · geo · csv · errors
  middleware/  auth (JWT/JWKS) · errors
  domain/      pure, unit-tested logic: carbon · energy dispatch · food spoilage · waste matching · greenwash · aqi
  services/    TinyFish (official SDK) · Open-Meteo · WAQI · grid intensity · EDGAR · Sentinel STAC · Gemini · Climatiq · OSRM/Overpass
  routes/      one router per module
  db/          store interface · in-memory store · Postgres store + schema
src/services/apiClient.ts   typed browser client for the API
tests/                      node:test suites (npm test)
```

## Run locally

```bash
cp .env.example .env        # add the keys you have; all are optional
npm install
npm run dev:server          # API on :8080 (auto-reload)
npm run dev                 # Vite on :3000, proxies /api -> :8080
npm test                    # unit tests
```

Production: `npm run build && npm start` (one process serves the API and the React build).

## Wiring the existing frontend

The browser should call your own `/api` instead of the providers:

* `src/services/tinyFishApi.ts` → `webSearch()` from `apiClient.ts`
* `src/services/aqiApi.ts` → `getAqi()` from `apiClient.ts`
* Delete `VITE_TINY_FISH_API_KEY`, `VITE_AQI_API_KEY` (and any client-side Gemini key) and **rotate** any key that was ever deployed that way.

## API reference

| Method & path | Purpose | Auth |
|---|---|---|
| `GET /healthz` · `GET /readyz` | Liveness · readiness + which integrations are configured | – |
| `GET /api/aqi?city=` or `?lat=&lon=` | AQI: WAQI stations → Open-Meteo fallback (cached 10 min) | – |
| `GET /api/search?q=&location=&language=` | TinyFish web search proxy (cached 15 min) | – |
| `POST /api/carbon/calculate` | Scope 1/2/3 totals + 95 % range; `save:{label}` stores it | save only |
| `GET /api/carbon/ledger` | Saved calculations for your org | ✔ |
| `GET /api/carbon/grid-intensity?region=GB` | Scope 2 grid factor (GB free; others need Electricity Maps key) | – |
| `POST /api/carbon/suppliers/import` | Clean/dedupe supplier CSV or rows; optional Gemini category mapping | ✔ |
| `POST /api/carbon/climatiq-estimate` | Key-safe proxy to Climatiq | ✔ |
| `POST /api/greenwash/analyze` | Claim screen + evidence (+ optional satellite job id, + optional Gemini cross-check) | – |
| `GET /api/greenwash/filings?ticker=` | Recent SEC filings | – |
| `GET /api/greenwash/filing-search?phrase=` | Phrase search inside filings (EDGAR FTS) | – |
| `POST /api/greenwash/satellite` | Start Sentinel-2 coverage job → `202 {jobId}` | ✔ |
| `GET /api/jobs/:id` | Poll a background job (creator only) | – |
| `GET /api/energy/forecast?lat=&lon=&solarKw=&windKw=&avgDemandKw=` | Hourly solar/wind/demand forecast (Open-Meteo) | – |
| `POST /api/energy/dispatch` | Battery dispatch + curtailment summary | – |
| `GET /api/waste/codes` · `GET /api/waste/listings` | EWC chapters · open listings | – |
| `POST /api/waste/listings` · `PATCH /api/waste/listings/:id/status` | Create / close (owner only) | ✔ |
| `GET /api/waste/matches?listingId=` | Ranked counterparties | – |
| `GET /api/food/spoilage-risk?category=&ageHours=&tempC=` | Spoilage risk (or `lat&lon` for local temp) | – |
| `GET /api/food/surplus` · `POST /api/food/surplus` | Dispatch board · post surplus | – · ✔ |
| `POST /api/food/dispatch` | Nearest reachable recipient before spoilage (OSM + OSRM) | ✔ |

"✔" = requires a JWT **when `AUTH_JWKS_URL` is set**; without it the API runs open (local dev only).
Errors are always `{ "error": { "code", "message", "details?" } }`.

## Configuration

See `.env.example`. Everything is optional: without keys, endpoints that need them return `503 not_configured`
and the rest keep working (AQI falls back to Open-Meteo; weather, grid GB, EDGAR, Sentinel need no key).

* **Postgres** – set `DATABASE_URL`; tables are created automatically (`server/db/schema.ts`). Unset = in-memory (lost on restart).
* **Redis** – set `REDIS_URL` for a cache shared by several instances.
* **Auth** – set `AUTH_JWKS_URL` (+ `AUTH_ISSUER`, `AUTH_AUDIENCE`) from Clerk / Auth0 / Supabase. Data is isolated by the token's `org_id` (falls back to `sub`).
* **TinyFish** – uses the official `@tiny-fish/sdk` (`client.search.query`), reading `TINYFISH_API_KEY`; falls back to the REST endpoint if the SDK cannot load.

## Deploy to Render

1. Push to GitHub (commands below), then **New + → Blueprint** and select the repo. `render.yaml` provisions one web
   service with `/healthz` health checks.
2. Fill in the secrets Render prompts for (all optional).
3. The free plan sleeps when idle; use `starter` for always-on.

Docker: `docker build -t aetheris . && docker run -p 8080:8080 --env-file .env aetheris`.

```bash
git init && git add . && git commit -m "feat: aetheris backend"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## Known limitations (be aware before relying on the numbers)

* Built-in emission factors are **screening values**; for reporting pass `factorKgPerUnit` or use the Climatiq proxy.
* Greenwash scoring is a rule-based screen plus optional AI cross-check – a triage aid, not a legal finding.
* Satellite job reports Sentinel-2 *coverage and cloud cover*; it does not do pixel-level analysis yet.
* Energy dispatch is a greedy heuristic (no prices or look-ahead). Swap in an LP/MILP for cost-optimal schedules.
* The job queue is in-process (jobs are lost on restart); move to BullMQ + Redis when you scale out.
* Spoilage uses a Q10 rule of thumb – not a food-safety determination.
