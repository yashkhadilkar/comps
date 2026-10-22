// SEC retrieval for an audit: reuses get_financials (through executeTool, so it gets the same timeout + one retry)
// and its citation registry. Failures come back as `error`, never as an empty successful result.
import { findByTicker, getCompanyFacts } from "../agent/sec";
import { createToolContext, executeTool } from "../agent/tools";
import { nonUsdUnits, TAGS } from "../agent/tools/getFinancials";
import type { FilingMeta } from "../agent/tools/types";
import { REPORTED_METRICS, type CompanyData, type FactRow, type ReportedMetric } from "./engine";

const empty = (): Record<ReportedMetric, FactRow[]> => ({ revenue: [], operating_income: [], net_income: [] });

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

  // Distinguish "not reported" from "reported in another currency". Company facts are cached, so this is free.
  const nonUsd: CompanyData["nonUsdUnits"] = {};
  const missing = REPORTED_METRICS.filter((m) => !metrics[m].length);
  if (missing.length) {
    try {
      const usGaap = (await getCompanyFacts(company.cik)).facts?.["us-gaap"];
      for (const m of missing) {
        const units = nonUsdUnits(usGaap, TAGS[m]);
        if (units.length) nonUsd[m] = units;
      }
    } catch {
      // Already fetched once above; a failure here only loses the currency hint.
    }
  }
  return { ...base, metrics, nonUsdUnits: nonUsd, filings };
}
