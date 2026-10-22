// SEC EDGAR client: tickers file, company facts, filing URLs, with in-memory caching.
// SEC requires a User-Agent with a name and email on every request (about 10 req/s max).

import { NonRetryableError } from "./errors";

export type SecCompany = { cik: number; ticker: string; name: string };

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 30; // a parsed company-facts file is several MB; keep the most recently used
const TICKERS_KEY = "tickers";

function evict() {
  for (const key of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break;
    if (key !== TICKERS_KEY) cache.delete(key); // Map iterates oldest first
  }
}

// TTL cache. Concurrent callers for the same key share one request, and a failed load is not cached.
export async function getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    cache.delete(key); // re-insert so this key counts as recently used
    cache.set(key, hit);
    return hit.value as T;
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = loader()
    .then((value) => {
      cache.delete(key);
      cache.set(key, { at: Date.now(), value });
      evict();
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function cacheStats() {
  return { entries: cache.size, inflight: inflight.size, max: MAX_ENTRIES };
}

export function clearCacheForTests() {
  cache.clear();
  inflight.clear();
}

export async function secFetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new NonRetryableError("SEC_USER_AGENT is not set.");

  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 403) {
    throw new NonRetryableError("SEC EDGAR returned 403. Check that SEC_USER_AGENT has a name and email.");
  }
  if (res.status === 404) throw new NonRetryableError(`SEC EDGAR returned 404 for ${url}`);
  if (!res.ok) throw new Error(`SEC EDGAR returned ${res.status} for ${url}`);
  return (await res.json()) as T;
}

type TickersFile = Record<string, { cik_str: number; ticker: string; title: string }>;

export function getTickers(): Promise<SecCompany[]> {
  return getCached("tickers", 24 * 60 * 60 * 1000, async () => {
    const raw = await secFetchJson<TickersFile>(
      "https://www.sec.gov/files/company_tickers.json",
      15_000,
    );
    return Object.values(raw).map((r) => ({ cik: r.cik_str, ticker: r.ticker, name: r.title }));
  });
}

export async function findByTicker(ticker: string): Promise<SecCompany | null> {
  const t = ticker.trim().toLowerCase();
  const all = await getTickers();
  return all.find((c) => c.ticker.toLowerCase() === t) ?? null;
}

export type XbrlFact = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
};

export type CompanyFacts = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, XbrlFact[]> }>>;
};

export function getCompanyFacts(cik: number): Promise<CompanyFacts> {
  return getCached(`facts:${cik}`, 6 * 60 * 60 * 1000, () =>
    secFetchJson<CompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`,
      15_000,
    ),
  );
}

// Links to the 10-K document itself when its file name is known, else the filing's EDGAR index page.
export function filingUrl(cik: number, accession: string, primaryDocument?: string): string {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  return primaryDocument ? `${folder}/${primaryDocument}` : `${folder}/${accession}-index.htm`;
}

type Submissions = {
  filings: { recent: { accessionNumber: string[]; primaryDocument: string[]; form: string[] } };
};

// accession -> primary document file name, for 10-K filings in the company's recent filing list.
export function getAnnualFilingDocs(cik: number): Promise<Map<string, string>> {
  return getCached(`filings:${cik}`, 6 * 60 * 60 * 1000, async () => {
    const raw = await secFetchJson<Submissions>(
      `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`,
      15_000,
    );
    const { accessionNumber, primaryDocument, form } = raw.filings.recent;
    const docs = new Map<string, string>();
    accessionNumber.forEach((acc, i) => {
      if (form[i]?.startsWith("10-K") && primaryDocument[i]) docs.set(acc, primaryDocument[i]);
    });
    return docs;
  });
}
