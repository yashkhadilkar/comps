// Comparability enrichment for research answers. Runs after the agent has produced a validated answer and never
// changes it. Trigger, companies, metrics and period all come from the run's own structured trace and tables, so
// there is no keyword matching on the question and no extra model call.
import type { AgentResult, TraceStep } from "../agent/types";
import { buildAudit, type CompanyData } from "./engine";
import { validateAudit, type AuditMetricId, type ComparabilityAudit, type ResearchAuditFinding, type ResearchAuditSummary } from "./types";

export const RESEARCH_AUDIT_TIMEOUT_MS = 6_000;
export const MAX_AUDITED_COMPANIES = 3; // first company is the anchor, so at most two pairs

const LABEL: Record<string, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  operating_margin: "Operating margin",
  net_income: "Net income",
  cost_of_revenue: "Cost of revenue",
  gross_profit: "Gross profit",
  operating_cash_flow: "Operating cash flow",
  inventory: "Inventory",
};
const SUPPORTED_FETCHED = new Set(["revenue", "operating_income", "net_income"]);

// Calculated metrics the audit does not cover, recognized from calculate labels.
const CALC_CATEGORIES: [RegExp, string][] = [
  [/growth|cagr|yoy|year[- ]over[- ]year|change/i, "Growth rates"],
  [/gross margin/i, "Gross margin"],
  [/net (profit )?margin/i, "Net margin"],
  [/cash/i, "Cash flow ratios"],
  [/inventory|turnover|days/i, "Inventory ratios"],
];

export type ResearchAuditPlan = {
  tickers: string[];
  metrics: AuditMetricId[]; // audit metrics relevant to this research
  uncheckedMetrics: string[];
  period: number | "latest";
  multiYear: boolean;
  yearsInResearch: number[];
};

type Action = Extract<TraceStep, { type: "action" }>;

export function planResearchAudit(result: AgentResult): ResearchAuditPlan | null {
  if (result.status !== "success" || result.answer.kind !== "answer") return null;
  const okIds = new Set(result.trace.filter((s) => s.type === "observation" && s.ok).map((s) => (s as { id: string }).id));
  const actions = result.trace.filter((s): s is Action => s.type === "action" && okIds.has(s.id));

  const tickers: string[] = [];
  const fetched = new Set<string>();
  let maxYearsRequested = 1;
  for (const a of actions.filter((x) => x.tool === "get_financials")) {
    const input = (a.input ?? {}) as { ticker?: unknown; metrics?: unknown; years?: unknown };
    if (typeof input.ticker !== "string") continue;
    const t = input.ticker.trim().toUpperCase();
    if (t && !tickers.includes(t)) tickers.push(t);
    if (Array.isArray(input.metrics)) for (const m of input.metrics) if (typeof m === "string") fetched.add(m);
    maxYearsRequested = Math.max(maxYearsRequested, Number(input.years) || 1);
  }
  if (tickers.length < 2) return null; // single-company research is not a comparison

  const calcLabels = actions
    .filter((x) => x.tool === "calculate")
    .flatMap((x) => {
      const calcs = (x.input as { calculations?: unknown })?.calculations;
      return Array.isArray(calcs) ? calcs.map((c) => String((c as { label?: unknown })?.label ?? "")) : [];
    });

  const metrics: AuditMetricId[] = [];
  if (fetched.has("revenue")) metrics.push("revenue");
  if (fetched.has("operating_income")) metrics.push("operating_income");
  if (fetched.has("revenue") && (fetched.has("operating_income") || calcLabels.some((l) => /operating margin/i.test(l)))) metrics.push("operating_margin");
  if (fetched.has("net_income")) metrics.push("net_income");
  if (!metrics.length) return null; // nothing the audit engine supports

  const unchecked = new Set<string>();
  for (const m of fetched) if (!SUPPORTED_FETCHED.has(m)) unchecked.add(LABEL[m] ?? m.replace(/_/g, " "));
  for (const label of calcLabels) {
    if (/operating margin/i.test(label)) continue;
    const cat = CALC_CATEGORIES.find(([re]) => re.test(label));
    unchecked.add(cat ? cat[1] : "Other calculated ratios");
  }

  // Years the answer actually shows (table headers and cells, and prose), e.g. "FY2024" or "2024".
  const text = [
    ...result.answer.tables.flatMap((t) => [t.title, ...t.columns, ...t.rows.map((r) => r[0] ?? "")]),
    result.answer.answerMarkdown,
  ].join(" ");
  const thisYear = new Date().getUTCFullYear();
  const rowYears = result.answer.tables.flatMap((t) => t.rows.map((r) => /^\s*(?:FY\s?)?(\d{4})\b/i.exec(r[0] ?? "")?.[1]).filter(Boolean));
  const years = [...new Set([...(text.match(/\bFY\s?'?(\d{4})\b/gi) ?? []), ...(rowYears as string[])].map((m) => Number(m.replace(/\D/g, ""))))]
    .filter((y) => y >= 2009 && y <= thisYear)
    .sort((a, b) => b - a);

  return {
    tickers: tickers.slice(0, MAX_AUDITED_COMPANIES),
    metrics,
    uncheckedMetrics: [...unchecked],
    period: years[0] ?? "latest", // the most recent year the research shows; latest only when it names none
    multiYear: years.length > 1 || (years.length === 0 && maxYearsRequested > 1),
    yearsInResearch: years,
  };
}

export function summarize(plan: ResearchAuditPlan, audits: ComparabilityAudit[], extraLimits: string[] = []): ResearchAuditSummary {
  const findings: ResearchAuditFinding[] = audits.flatMap((a) =>
    a.metrics
      .filter((m) => plan.metrics.includes(m.metricId))
      .map((m) => ({
        pair: `${a.companies[0].ticker} vs ${a.companies[1].ticker}`,
        metricId: m.metricId,
        metric: m.label,
        status: m.status,
        explanation: m.caveats[0] ?? m.explanation,
        evidenceUrls: [...new Set(m.values.flatMap((v) => v.evidence.map((e) => e.documentUrl)))],
        requiresHumanReview: m.requiresHumanReview,
      })),
  );
  const periodDetails = audits.map((a) => a.overallAssessment.split(":")[0]);
  const auditedPeriod = plan.period === "latest" ? "Latest fiscal year" : `FY${plan.period}`;
  const limitations = [...extraLimits];
  if (plan.multiYear) {
    const others = plan.yearsInResearch.filter((y) => y !== plan.period);
    limitations.push(
      `This research covers ${others.length ? `other years (${others.map((y) => `FY${y}`).join(", ")})` : "several years"}; only ${auditedPeriod} was audited. Multi-year trends and growth rates were not checked.`,
    );
  }
  const insufficient = findings.some((f) => f.status === "INSUFFICIENT_EVIDENCE");
  return {
    status: insufficient ? "partial" : "completed",
    companies: plan.tickers,
    auditedPeriod,
    periodDetails,
    multiYear: plan.multiYear,
    checkedMetrics: plan.metrics.map((m) => LABEL[m]),
    uncheckedMetrics: plan.uncheckedMetrics,
    findings,
    limitations,
  };
}

export function unavailable(plan: ResearchAuditPlan, reason: string): ResearchAuditSummary {
  return {
    status: "unavailable",
    companies: plan.tickers,
    auditedPeriod: plan.period === "latest" ? "Latest fiscal year" : `FY${plan.period}`,
    periodDetails: [],
    multiYear: plan.multiYear,
    checkedMetrics: [],
    uncheckedMetrics: plan.uncheckedMetrics,
    findings: [],
    limitations: [reason],
  };
}

// Never throws. Bounded by `timeoutMs`; no model call. SEC facts were just fetched by get_financials for the same
// companies, so retrieval is normally served by the in-memory SEC cache.
export async function runResearchAudit(
  result: AgentResult,
  fetchCompany: (ticker: string, signal: AbortSignal) => Promise<CompanyData>,
  opts: { signal?: AbortSignal; timeoutMs?: number; now?: Date } = {},
): Promise<ResearchAuditSummary | null> {
  const plan = planResearchAudit(result);
  if (!plan) return null;
  const deadline = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline.signal]) : deadline.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        deadline.abort();
        reject(new Error("timed out"));
      }, opts.timeoutMs ?? RESEARCH_AUDIT_TIMEOUT_MS);
      opts.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
    const data = await Promise.race([Promise.all(plan.tickers.map((t) => fetchCompany(t, signal))), timeout]);
    const [anchor, ...others] = data;
    // The newest year an answer shows may exist for only some companies (one has filed its next 10-K, the other
    // not yet). Audit the newest year in the research that every company reports, so the panel does not say
    // "insufficient evidence" for figures the research does have. The year actually audited is what is labeled.
    const has = (d: CompanyData, y: number) => d.metrics.revenue.some((r) => r.fiscalYear === y) || d.metrics.net_income.some((r) => r.fiscalYear === y);
    const common = plan.yearsInResearch.find((y) => data.every((d) => has(d, y)));
    if (typeof plan.period === "number" && common !== undefined && common !== plan.period) plan.period = common;
    const audits = others.map((o, i) => buildAudit(anchor, o, plan.period, { auditId: `research-${i}`, now: opts.now ?? new Date() }));
    for (const a of audits) {
      const errors = validateAudit(a);
      if (errors.length) throw new Error(`contract violation: ${errors[0]}`);
    }
    const limits = data.filter((d) => d.error).map((d) => `${d.company.ticker}: ${d.error}`);
    return summarize(plan, audits, limits);
  } catch (err) {
    console.error("[research-audit]", err instanceof Error ? err.message : err);
    return unavailable(plan, "The comparability check could not be completed for this answer.");
  } finally {
    clearTimeout(timer);
  }
}
