// Financial comparability audit contract (docs/COMPS_AUDIT_SPRINT.md section 2). An evidence-backed comparability
// review of two companies' reported metrics, NOT a statutory audit. Every number here comes from SEC XBRL facts or
// from the calculate engine; the model never supplies a figure, an adjustment or a status.

export const COMPARABILITY_STATUSES = [
  "COMPARABLE",
  "ADJUSTED",
  "PARTIALLY_COMPARABLE",
  "NOT_COMPARABLE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type ComparabilityStatus = (typeof COMPARABILITY_STATUSES)[number];

export const EVIDENCE_QUALITIES = ["VERIFIED", "PARTIAL", "UNVERIFIED"] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITIES)[number];

export const AUDIT_METRICS = ["revenue", "operating_income", "operating_margin", "net_income"] as const;
export type AuditMetricId = (typeof AUDIT_METRICS)[number];

export type AuditCompany = { ticker: string; name: string; cik: number };

// One SEC filing that reports a value. `sourceId` is the accession number.
export type AuditEvidence = {
  sourceId: string;
  ticker: string;
  documentTitle: string; // e.g. "NIKE, Inc. 10-K (filed 2024-07-25)"
  documentUrl: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
  xbrlConcept: string | null; // us-gaap tag the value was reported under; null for computed values
};

export type AuditValue = {
  ticker: string;
  reportedValue: number | null; // as filed; null when not reported
  normalizedValue: number | null; // only set when a documented transformation produced it (derived metrics)
  display: string | null;
  currency: string | null; // ISO code; null when nothing was retrieved
  unit: string; // "USD" or "percent"
  fiscalYear: number | null;
  periodEnd: string | null;
  periodType: "annual";
  reportingBasis: "US GAAP (as reported, XBRL)" | "Derived from US GAAP inputs";
  evidence: AuditEvidence[];
};

// A reproducible transformation. `formula` is the exact expression the calculate engine evaluated (or a description
// of a selection rule), and `inputSourceIds` must all be evidence present in the same metric.
export type AuditAdjustment = {
  kind: "derivation" | "period_realignment";
  ticker: string;
  description: string;
  formula: string;
  inputSourceIds: string[];
  outputValue: number | null;
  outputDisplay: string | null;
};

export type AuditCheck = {
  id: "evidence" | "period" | "currency" | "definition" | "calculation";
  passed: boolean;
  detail: string;
};

export type MetricAudit = {
  metricId: AuditMetricId;
  label: string;
  definition: string;
  values: AuditValue[]; // one per company, A then B
  adjustments: AuditAdjustment[];
  checks: AuditCheck[];
  status: ComparabilityStatus;
  evidenceQuality: EvidenceQuality;
  caveats: string[];
  explanation: string;
  requiresHumanReview: boolean;
  aiNotes: string[]; // bounded model interpretation, already validated; never changes status or figures
};

export type ComparabilityAudit = {
  auditId: string;
  generatedAt: string;
  companies: [AuditCompany, AuditCompany];
  requestedPeriod: number | "latest";
  metrics: MetricAudit[];
  overallStatus: ComparabilityStatus;
  overallAssessment: string; // deterministic
  aiInterpretation: string | null; // validated model summary, labeled as such in the UI
  limitations: string[];
  reviewChecklist: string[];
  partial: boolean; // true when at least one metric could not be audited
  requiresHumanReview: boolean;
};

// ---- Runtime validation -------------------------------------------------------------------------------------------
// Hand-rolled (no schema library in the project). Run on every audit before it leaves the server.

const isStr = (v: unknown): v is string => typeof v === "string";
const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const isIn = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => isStr(v) && list.includes(v);

export function validateAudit(a: unknown): string[] {
  const errors: string[] = [];
  const audit = a as ComparabilityAudit;
  if (!audit || typeof audit !== "object") return ["audit is not an object"];
  if (!isStr(audit.auditId) || !isStr(audit.generatedAt)) errors.push("missing auditId/generatedAt");
  if (!Array.isArray(audit.companies) || audit.companies.length !== 2) errors.push("companies must have 2 entries");
  if (!isIn(COMPARABILITY_STATUSES, audit.overallStatus)) errors.push("bad overallStatus");
  if (!Array.isArray(audit.metrics)) return [...errors, "metrics is not an array"];

  for (const m of audit.metrics) {
    const where = `metric ${m?.metricId}`;
    if (!isIn(AUDIT_METRICS, m.metricId)) errors.push(`${where}: unknown metricId`);
    if (!isIn(COMPARABILITY_STATUSES, m.status)) errors.push(`${where}: bad status`);
    if (!isIn(EVIDENCE_QUALITIES, m.evidenceQuality)) errors.push(`${where}: bad evidenceQuality`);
    if (!Array.isArray(m.values) || m.values.length !== 2) {
      errors.push(`${where}: needs one value per company`);
      continue;
    }
    const evidenceIds = new Set(m.values.flatMap((v) => v.evidence.map((e) => e.sourceId)));
    for (const v of m.values) {
      if (!isNumOrNull(v.reportedValue) || !isNumOrNull(v.normalizedValue)) errors.push(`${where}: non-finite value`);
      // Invariant 1: a reported number needs a traceable source.
      if (v.reportedValue !== null && v.evidence.length === 0) errors.push(`${where}/${v.ticker}: reported value without evidence`);
      if (v.reportedValue !== null && !v.periodEnd) errors.push(`${where}/${v.ticker}: reported value without period`);
      // Invariant 2: a normalized number needs a reproducible calculation.
      if (v.normalizedValue !== null && !m.adjustments.some((ad) => ad.ticker === v.ticker && ad.outputValue === v.normalizedValue)) {
        errors.push(`${where}/${v.ticker}: normalized value without adjustment`);
      }
    }
    for (const ad of m.adjustments) {
      if (!ad.inputSourceIds.length || ad.inputSourceIds.some((id) => !evidenceIds.has(id))) {
        errors.push(`${where}: adjustment cites evidence not in this metric`);
      }
    }
    // Missing evidence must never be presented as a comparison.
    const missing = m.values.some((v) => (v.reportedValue ?? v.normalizedValue) === null);
    if (missing && m.status !== "INSUFFICIENT_EVIDENCE" && m.status !== "NOT_COMPARABLE") {
      errors.push(`${where}: missing value but status ${m.status}`);
    }
  }
  return errors;
}

// ---- Request validation -------------------------------------------------------------------------------------------

export type AuditRequest = { tickerA: string; tickerB: string; period: number | "latest" };

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function parseAuditRequest(body: unknown): { ok: true; value: AuditRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const norm = (v: unknown) => (isStr(v) ? v.trim().toUpperCase() : "");
  const tickerA = norm(b.tickerA);
  const tickerB = norm(b.tickerB);
  if (!TICKER_RE.test(tickerA) || !TICKER_RE.test(tickerB)) {
    return { ok: false, error: "Enter two valid tickers, for example NKE and LULU." };
  }
  if (tickerA === tickerB) return { ok: false, error: "Choose two different companies." };
  let period: number | "latest" = "latest";
  if (b.period != null && b.period !== "" && b.period !== "latest") {
    const y = Number(b.period);
    const max = new Date().getUTCFullYear();
    if (!Number.isInteger(y) || y < 2009 || y > max) {
      return { ok: false, error: `Reporting period must be "latest" or a fiscal year from 2009 to ${max}.` };
    }
    period = y;
  }
  return { ok: true, value: { tickerA, tickerB, period } };
}

// ---- Research enrichment ------------------------------------------------------------------------------------------
// A compact, deterministic summary of the audit attached to a research answer (never part of final_answer). Built
// from ComparabilityAudit results; saved in runs.trace.audit and sent as the optional `audit` stream event.

export type ResearchAuditFinding = {
  pair: string; // "NKE vs UAA"
  metricId: AuditMetricId;
  metric: string;
  status: ComparabilityStatus;
  explanation: string;
  evidenceUrls: string[];
  requiresHumanReview: boolean;
};

export type ResearchAuditSummary = {
  status: "completed" | "partial" | "unavailable";
  companies: string[];
  auditedPeriod: string; // "FY2024" or "Latest fiscal year"
  periodDetails: string[]; // per pair, the exact period ends compared
  multiYear: boolean; // the research spans more years than the one audited
  checkedMetrics: string[];
  uncheckedMetrics: string[];
  findings: ResearchAuditFinding[];
  limitations: string[];
};

const RA_STATUSES = ["completed", "partial", "unavailable"] as const;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

// Tolerant reader for persisted or streamed summaries: anything malformed is dropped rather than shown.
export function toResearchAudit(v: unknown): ResearchAuditSummary | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isIn(RA_STATUSES, o.status) || !isStr(o.auditedPeriod)) return null;
  const findings = (Array.isArray(o.findings) ? o.findings : []).flatMap((f): ResearchAuditFinding[] => {
    const x = f as Record<string, unknown>;
    if (!x || !isIn(AUDIT_METRICS, x.metricId) || !isIn(COMPARABILITY_STATUSES, x.status) || !isStr(x.metric) || !isStr(x.explanation)) return [];
    return [
      {
        pair: isStr(x.pair) ? x.pair : "",
        metricId: x.metricId,
        metric: x.metric,
        status: x.status,
        explanation: x.explanation,
        evidenceUrls: strs(x.evidenceUrls).filter((u) => /^https:\/\/www\.sec\.gov\//.test(u)),
        requiresHumanReview: x.requiresHumanReview === true,
      },
    ];
  });
  return {
    status: o.status,
    companies: strs(o.companies),
    auditedPeriod: o.auditedPeriod,
    periodDetails: strs(o.periodDetails),
    multiYear: o.multiYear === true,
    checkedMetrics: strs(o.checkedMetrics),
    uncheckedMetrics: strs(o.uncheckedMetrics),
    findings,
    limitations: strs(o.limitations),
  };
}
