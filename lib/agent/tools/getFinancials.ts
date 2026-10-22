// get_financials: annual figures from SEC XBRL company facts.
//
// Gotcha: in companyfacts, `fy`/`fp` describe the FILING, not the data point. A FY2024 10-K
// also reports FY2023 and FY2022 values, all tagged fy=2024. So we dedupe by period END date
// and derive the fiscal year label from that date instead.
import { filingUrl, findByTicker, getAnnualFilingDocs, getCompanyFacts, type XbrlFact } from "../sec";
import type { ToolDef } from "./types";

export const METRICS = [
  "revenue",
  "cost_of_revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "operating_cash_flow",
  "inventory",
] as const;
export type Metric = (typeof METRICS)[number];

// Companies switch tags over time, so we merge across tags (in priority order), never stop at the first.
export const TAGS: Record<Metric, string[]> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueGoodsNet",
  ],
  cost_of_revenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  gross_profit: ["GrossProfit"],
  operating_income: ["OperatingIncomeLoss"],
  net_income: ["NetIncomeLoss", "ProfitLoss"],
  operating_cash_flow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  inventory: ["InventoryNet", "InventoryFinishedGoodsNetOfReserves"], // Nike only tags the latter
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

// Retailers end in late Jan / early Feb (Lululemon: ~Feb 2): that is the PRIOR fiscal year.
function fiscalYearOf(end: string): number {
  const [y, m, d] = end.split("-").map(Number);
  if (m === 1 || (m === 2 && d <= 10)) return y - 1;
  return y;
}

export function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

const isAnnualForm = (f: XbrlFact) => f.form === "10-K" || f.form === "10-K/A";

type GaapFacts = Record<string, { units: Record<string, XbrlFact[]> }>;

function usdFacts(facts: GaapFacts, tag: string) {
  return facts?.[tag]?.units?.USD ?? [];
}

// Non-USD units a metric's tags are reported in, so "no data" is not confused with "not in dollars".
export function nonUsdUnits(facts: GaapFacts, tags: string[]): string[] {
  const units = new Set<string>();
  for (const tag of tags) {
    for (const unit of Object.keys(facts?.[tag]?.units ?? {})) if (unit !== "USD") units.add(unit);
  }
  return [...units];
}

const STALE_AFTER_DAYS = 460; // a little over 15 months: the next annual report is overdue

// Flags a company whose newest annual figure is old (delisted, stopped filing, or the new 10-K is not in the data).
export function staleNote(latestEnd: string, now = Date.now()): string | undefined {
  const ageDays = Math.floor((now - Date.parse(latestEnd)) / DAY_MS);
  if (ageDays <= STALE_AFTER_DAYS) return undefined;
  return `The latest annual figure here ends ${latestEnd}, over 15 months ago. The company may no longer file, or its newest 10-K is not in the data. Say so; do not present this as current.`;
}

// period end -> best (latest filed) annual duration fact for one tag
function annualDurationFacts(list: XbrlFact[]): Map<string, XbrlFact> {
  const out = new Map<string, XbrlFact>();
  for (const f of list) {
    if (!isAnnualForm(f) || !f.start) continue;
    const days = dayDiff(f.start, f.end);
    if (days < 350 || days > 380) continue; // drops quarters and transition periods
    const prev = out.get(f.end);
    if (!prev || f.filed > prev.filed) out.set(f.end, f);
  }
  return out;
}

type ValueRow = {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  display: string;
  form: string;
  filed: string;
  tag: string;
  citationKey: string;
};

type Input = { thought: string; ticker: string; metrics: Metric[]; years: number };

export const getFinancials: ToolDef<Input> = {
  name: "get_financials",
  timeoutMs: 20_000,
  definition: {
    name: "get_financials",
    description:
      "Annual figures from a company's 10-K filings via SEC XBRL data. Request several metrics in one call. " +
      "Each value comes with fiscal year, period end date, a display string (use it as written), and a " +
      "citationKey to cite. Requires an exact ticker from lookup_ticker. Metrics: revenue, cost_of_revenue, " +
      "gross_profit, operating_income, net_income, operating_cash_flow, inventory. If gross_profit is " +
      "unavailable, fetch revenue and cost_of_revenue and compute it with calculate.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: "One short sentence: what you need and why you are calling this tool.",
        },
        ticker: { type: "string", description: "Exact ticker from lookup_ticker, e.g. 'NKE'." },
        metrics: {
          type: "array",
          items: { type: "string", enum: [...METRICS] },
          description: "Metrics to fetch for this company.",
        },
        years: {
          type: "integer",
          description: "How many of the most recent fiscal years to return (1 to 10). Use 5 unless asked otherwise.",
        },
      },
      required: ["thought", "ticker", "metrics", "years"],
      additionalProperties: false,
    },
  },
  label: (input) => `Pulling ${input.metrics.join(", ").replace(/_/g, " ")} for ${input.ticker}`,
  async run(input, ctx) {
    const metrics = (Array.isArray(input.metrics) ? input.metrics : []).filter((m): m is Metric =>
      (METRICS as readonly string[]).includes(m),
    );
    if (!metrics.length) return { ok: false, error: `Pass at least one metric from: ${METRICS.join(", ")}.` };
    const years = Math.min(10, Math.max(1, Math.round(Number(input.years) || 5)));

    const company = await findByTicker(input.ticker);
    if (!company) {
      return {
        ok: false,
        error: `Ticker ${input.ticker} not found in the SEC list. Call lookup_ticker first.`,
      };
    }

    // The 10-K document file names (best effort): without them, sources link to the EDGAR index page.
    const [all, filingDocs] = await Promise.all([
      getCompanyFacts(company.cik),
      getAnnualFilingDocs(company.cik).catch((err) => {
        console.error("[get_financials] filing document lookup failed:", err instanceof Error ? err.message : err);
        return new Map<string, string>();
      }),
    ]);
    const usGaap = all.facts?.["us-gaap"];
    if (!usGaap) {
      return {
        ok: false,
        error: `No US-GAAP financial data for ${company.name} (it may file under IFRS or not file annual reports with the SEC).`,
      };
    }

    // Annual period ends, taken from revenue-ish facts first, used to filter instant (balance sheet) facts.
    const annualEnds = new Set<string>();
    for (const tag of [...TAGS.revenue, ...TAGS.net_income, ...TAGS.operating_income]) {
      for (const end of annualDurationFacts(usdFacts(usGaap, tag)).keys()) annualEnds.add(end);
    }

    const result = metrics.map((metric) => {
      const merged = new Map<string, { fact: XbrlFact; tag: string }>();
      for (const tag of TAGS[metric]) {
        const list = usdFacts(usGaap, tag);
        if (metric === "inventory") {
          const byEnd = new Map<string, XbrlFact>();
          for (const f of list) {
            if (!isAnnualForm(f) || f.start || !annualEnds.has(f.end)) continue;
            const prev = byEnd.get(f.end);
            if (!prev || f.filed > prev.filed) byEnd.set(f.end, f);
          }
          for (const [end, fact] of byEnd) if (!merged.has(end)) merged.set(end, { fact, tag });
        } else {
          for (const [end, fact] of annualDurationFacts(list)) if (!merged.has(end)) merged.set(end, { fact, tag });
        }
      }

      const picked = [...merged.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, years);

      const values: ValueRow[] = picked.map(([end, { fact, tag }]) => ({
        fiscalYear: fiscalYearOf(end),
        periodEnd: end,
        value: fact.val,
        display: formatMoney(fact.val),
        form: fact.form,
        filed: fact.filed,
        tag,
        citationKey: fact.accn,
      }));

      for (const v of values) ctx.registerFigure(v.display, v.citationKey);

      // One 10-K covers several years, so register each accession under the latest year it supports.
      const latestByAccession = new Map<string, ValueRow>();
      for (const v of values) {
        const prev = latestByAccession.get(v.citationKey);
        if (!prev || v.periodEnd > prev.periodEnd) latestByAccession.set(v.citationKey, v);
      }
      for (const v of latestByAccession.values()) {
        ctx.registerFiling({
          key: v.citationKey,
          company: company.name,
          ticker: company.ticker,
          cik: company.cik,
          form: v.form,
          fiscalYear: v.fiscalYear,
          periodEnd: v.periodEnd,
          filed: v.filed,
          accession: v.citationKey,
          url: filingUrl(company.cik, v.citationKey, filingDocs.get(v.citationKey)),
        });
      }

      const labels = values.map((v) => v.fiscalYear);
      const missingFiscalYears: number[] = [];
      if (labels.length) {
        for (let y = Math.min(...labels); y <= Math.max(...labels); y++) {
          if (!labels.includes(y)) missingFiscalYears.push(y);
        }
      }

      let note: string | undefined;
      const otherUnits = values.length ? [] : nonUsdUnits(usGaap, TAGS[metric]);
      if (!values.length && otherUnits.length) {
        note = `This company reports ${metric.replace(/_/g, " ")} in ${otherUnits.join(", ")}, not USD. Only USD figures are supported; say so.`;
      } else if (!values.length) {
        note =
          metric === "gross_profit"
            ? "No GrossProfit tag reported. Fetch revenue and cost_of_revenue and compute gross profit with calculate."
            : metric === "operating_income"
              ? "This company does not report an operating income line in its filings (Nike, for example). Say so; do not estimate it."
              : `No annual ${metric.replace(/_/g, " ")} data found in 10-K filings.`;
      } else if (values.length < years) {
        note = `Only ${values.length} fiscal year(s) available (asked for ${years}).`;
      } else if (missingFiscalYears.length) {
        note = `Fiscal year(s) ${missingFiscalYears.join(", ")} missing: often a change in fiscal year end (transition period) or a gap in the company's filings.`;
      }

      const stale = values.length ? staleNote(values[0].periodEnd) : undefined;
      if (stale) note = note ? `${note} ${stale}` : stale;

      return { metric, values, missingFiscalYears, ...(note ? { note } : {}) };
    });

    const filled = result.filter((r) => r.values.length).length;
    return {
      ok: true,
      summary: `${company.ticker}: ${filled}/${result.length} metrics found`,
      data: { company: company.name, ticker: company.ticker, cik: company.cik, metrics: result },
    };
  },
};
