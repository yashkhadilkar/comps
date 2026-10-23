// SEC retrieval for an audit: reuses get_financials (through executeTool, so it gets the same timeout + one retry)
// and its citation registry. Failures come back as `error`, never as an empty successful result.
import { filingUrl, findByTicker, getCompanyFacts, type XbrlFact } from "../agent/sec";
import { createToolContext, executeTool } from "../agent/tools";
import { nonUsdUnits, TAGS } from "../agent/tools/getFinancials";
import type { FilingMeta } from "../agent/tools/types";
import { REPORTED_METRICS, type CompanyData, type FactRow, type ReportedMetric } from "./engine";
import type { PriorReport, ShortPeriod } from "./integrity";

const empty = (): Record<ReportedMetric, FactRow[]> => ({ revenue: [], operating_income: [], net_income: [] });

type GaapFacts = Record<string, { units: Record<string, XbrlFact[]> }>;
const DAY_MS = 24 * 60 * 60 * 1000;
const span = (f: { start?: string; end: string }) => (f.start ? Math.round((Date.parse(f.end) - Date.parse(f.start)) / DAY_MS) : NaN);
const ANNUAL_FORMS = new Set(["10-K", "10-K/A"]);
const TRANSITION_FORMS = new Set(["10-K", "10-K/A", "10-KT", "10-KT/A", "10-QT"]);

// Audit-only period metadata. The start of each selected annual fact (same tag, accession and end that
// get_financials chose; its selection is not changed), earlier filings of that concept and exact period (revision
// candidates), and sub-annual periods that sit in a gap between two annual windows: a fiscal year-end transition.
// Quarters inside an annual window are not transitions and are ignored.
export function periodMetadata(usGaap: GaapFacts, metrics: Record<ReportedMetric, FactRow[]>, cik: number) {
  const withStarts = empty();
  for (const m of REPORTED_METRICS) {
    withStarts[m] = metrics[m].map((r) => {
      const facts = usGaap[r.tag]?.units?.USD ?? [];
      const f = facts.find((x) => x.accn === r.citationKey && x.end === r.periodEnd && ANNUAL_FORMS.has(x.form) && span(x) >= 350 && span(x) <= 380);
      if (!f?.start) return { ...r };
      const prior = new Map<string, PriorReport>();
      for (const x of facts) {
        if (x.start !== f.start || x.end !== r.periodEnd || !ANNUAL_FORMS.has(x.form) || x.accn === r.citationKey || x.filed > r.filed) continue;
        if (!prior.has(x.accn)) prior.set(x.accn, { accession: x.accn, filed: x.filed, form: x.form, value: x.val, url: filingUrl(cik, x.accn) });
      }
      return { ...r, periodStart: f.start, priorReports: [...prior.values()] };
    });
  }
  const windows = [...new Map(REPORTED_METRICS.flatMap((m) => withStarts[m]).filter((r) => r.periodStart).map((r) => [r.periodEnd, { start: r.periodStart!, end: r.periodEnd }])).values()].sort((a, b) =>
    a.end < b.end ? -1 : 1,
  );
  const short = new Map<string, ShortPeriod>();
  const filed = new Map<string, string>(); // keep the latest-filed report of each period
  for (const tag of [...TAGS.revenue, ...TAGS.net_income]) {
    for (const f of usGaap[tag]?.units?.USD ?? []) {
      const d = span(f);
      if (!f.start || !TRANSITION_FORMS.has(f.form) || !(d >= 27 && d < 349)) continue;
      const inGap = windows.some((w, i) => i > 0 && f.start! > windows[i - 1].end && f.end < w.start);
      if (!inGap) continue;
      const key = `${f.start}|${f.end}`;
      if (f.filed > (filed.get(key) ?? "")) {
        filed.set(key, f.filed);
        short.set(key, { start: f.start, end: f.end, days: d + 1, accession: f.accn, form: f.form, url: filingUrl(cik, f.accn) });
      }
    }
  }
  return { metrics: withStarts, shortPeriods: [...short.values()] };
}

export async function fetchCompanyData(ticker: string, signal?: AbortSignal): Promise<CompanyData> {
  let company;
  try {
    company = await findByTicker(ticker);
  } catch (err) {
    console.error("[audit] ticker lookup failed:", err instanceof Error ? err.message : err);
    return { company: { ticker, name: ticker, cik: 0 }, metrics: empty(), nonUsdUnits: {}, filings: {}, error: "SEC ticker lookup failed" };
  }
  if (!company) {
    return { company: { ticker, name: ticker, cik: 0 }, metrics: empty(), nonUsdUnits: {}, filings: {}, error: `Ticker ${ticker} is not in the SEC company list` };
  }
  const base = { company: { ticker: company.ticker, name: company.name, cik: company.cik } };

  const ctx = createToolContext();
  const result = await executeTool(
    "get_financials",
    { thought: "Comparability audit retrieval.", ticker: company.ticker, metrics: REPORTED_METRICS, years: 10 },
    ctx,
    signal,
  );
  if (!result.ok) return { ...base, metrics: empty(), nonUsdUnits: {}, filings: {}, error: result.error };

  const data = result.data as { metrics: { metric: ReportedMetric; values: FactRow[] }[] };
  const metrics = empty();
  for (const m of data.metrics) metrics[m.metric] = m.values;

  const filings: CompanyData["filings"] = {};
  for (const c of ctx.citations.values()) {
    if (c.type === "filing") filings[c.key] = { url: (c as FilingMeta).url, form: c.form, filed: c.filed };
  }

  // Distinguish "not reported" from "reported in another currency", and add period starts and transitions.
  // Company facts are cached by get_financials' call above, so this is free.
  const nonUsd: CompanyData["nonUsdUnits"] = {};
  try {
    const usGaap = (await getCompanyFacts(company.cik)).facts?.["us-gaap"];
    for (const m of REPORTED_METRICS.filter((x) => !metrics[x].length)) {
      const units = nonUsdUnits(usGaap, TAGS[m]);
      if (units.length) nonUsd[m] = units;
    }
    if (usGaap) {
      const meta = periodMetadata(usGaap, metrics, company.cik);
      return { ...base, metrics: meta.metrics, nonUsdUnits: nonUsd, filings, shortPeriods: meta.shortPeriods };
    }
  } catch (err) {
    // Only loses the currency hint and period starts: length and continuity checks then say NOT_ASSESSED.
    console.error("[audit] period metadata unavailable:", err instanceof Error ? err.message : err);
  }
  return { ...base, metrics, nonUsdUnits: nonUsd, filings };
}
