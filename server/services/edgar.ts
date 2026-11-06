import { config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';
import { remember, type Cache } from '../lib/cache.js';

const headers = () => ({ 'User-Agent': config.secUserAgent, 'Accept-Encoding': 'gzip, deflate' });

type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

async function resolveCik(cache: Cache, ticker: string): Promise<{ cik: string; title: string }> {
  const map = await remember(cache, 'edgar:tickers', 24 * 3600, () =>
    fetchJson<TickerMap>('https://www.sec.gov/files/company_tickers.json', { service: 'sec', headers: headers() }),
  );
  const t = ticker.trim().toUpperCase();
  const hit = Object.values(map).find((e) => e.ticker === t);
  if (!hit) throw notFound(`No SEC registrant found for ticker "${ticker}"`);
  return { cik: String(hit.cik_str).padStart(10, '0'), title: hit.title };
}

export interface Filing {
  form: string;
  filingDate: string;
  reportDate?: string;
  accession: string;
  description?: string;
  url: string;
}

const CLIMATE_RELEVANT = new Set(['10-K', '10-K/A', '20-F', '40-F', '8-K', 'DEF 14A', '10-Q']);

export async function recentFilings(
  cache: Cache,
  ticker: string,
  forms: string[] | undefined,
  limit: number,
): Promise<{ company: string; cik: string; filings: Filing[] }> {
  const { cik, title } = await resolveCik(cache, ticker);
  const sub = await remember(cache, `edgar:sub:${cik}`, 3600, () =>
    fetchJson<{
      filings: {
        recent: {
          form: string[];
          filingDate: string[];
          reportDate: string[];
          accessionNumber: string[];
          primaryDocument: string[];
          primaryDocDescription: string[];
        };
      };
    }>(`https://data.sec.gov/submissions/CIK${cik}.json`, { service: 'sec', headers: headers() }),
  );
  const r = sub.filings.recent;
  const wanted = forms?.length ? new Set(forms.map((f) => f.toUpperCase())) : CLIMATE_RELEVANT;
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    if (!wanted.has(r.form[i]!.toUpperCase())) continue;
    const acc = r.accessionNumber[i]!;
    out.push({
      form: r.form[i]!,
      filingDate: r.filingDate[i]!,
      reportDate: r.reportDate[i] || undefined,
      accession: acc,
      description: r.primaryDocDescription[i] || undefined,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`,
    });
  }
  return { company: title, cik, filings: out };
}

export interface FilingHit {
  form: string;
  company: string;
  filedAt: string;
  url: string;
}

/** Full-text search inside filings (EDGAR FTS) - e.g. check whether a "net zero" claim appears in a 10-K. */
export async function searchFilingText(phrase: string, ciks: string | undefined, limit: number): Promise<FilingHit[]> {
  const qs = new URLSearchParams({ q: `"${phrase}"`, forms: '10-K,20-F,8-K' });
  if (ciks) qs.set('ciks', ciks);
  const res = await fetchJson<{
    hits?: { hits?: { _id: string; _source: { form: string; display_names?: string[]; file_date: string; ciks?: string[]; adsh: string } }[] };
  }>(`https://efts.sec.gov/LATEST/search-index?${qs}`, { service: 'sec-fts', headers: headers() });
  return (res.hits?.hits ?? []).slice(0, limit).map((h) => {
    const [adsh, file] = h._id.split(':');
    const cik = h._source.ciks?.[0] ?? '';
    return {
      form: h._source.form,
      company: h._source.display_names?.[0] ?? '',
      filedAt: h._source.file_date,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${(adsh ?? h._source.adsh).replace(/-/g, '')}/${file ?? ''}`,
    };
  });
}
