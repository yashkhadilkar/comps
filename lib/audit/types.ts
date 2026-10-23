// Financial comparability audit contract (docs/COMPS_AUDIT_SPRINT.md section 2). An evidence-backed comparability
// review of two companies' reported metrics, NOT a statutory audit. Every number here comes from SEC XBRL facts or
// from the calculate engine; the model never supplies a figure, an adjustment or a status.
import { checkSeverity, reduceReadiness, sourceBasisOf } from "./readiness";

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

// ---- Comparison integrity (V2, docs/COMPS_COMPARISON_INTEGRITY_V2.md) -------------------------------------------
// A second, independent dimension next to the comparability status: whether the analyst's comparative conclusion
// can be drawn. Every value is set by lib/audit/integrity.ts from deterministic checks; optional on every type so
// audits and research summaries saved before V2 still parse and render.

export const READINESS = ["READY", "REVIEW", "BLOCKED"] as const;
export type Readiness = (typeof READINESS)[number];

export const CHECK_STATUSES = ["PASS", "INFO", "CAUTION", "FAIL", "NOT_ASSESSED", "NOT_APPLICABLE"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const SOURCE_BASES = ["DIRECT_REPORTED", "DERIVED", "UNAVAILABLE"] as const;
export type SourceBasis = (typeof SOURCE_BASES)[number];

export type CheckSeverity = "informational" | "material" | "blocking";

export const INTEGRITY_CHECK_IDS = [
  "evidence",
  "currency",
  "period_alignment",
  "period_duration",
  "definition",
  "formula",
  "provenance",
  "series_continuity",
  "tag_lineage",
  "revisions",
  "accounting_policy",
] as const;
export type IntegrityCheckId = (typeof INTEGRITY_CHECK_IDS)[number];

// A filing that supports a finding but is not one of the metric's value sources (an earlier year, a transition report).
export type CheckReference = { label: string; url: string; accession: string };

export type IntegrityCheck = {
  id: IntegrityCheckId;
  scope: "comparison" | "history"; // cross-company check vs one company's own multi-year series
  ticker: string | null; // set for single-company (history) checks
  critical: boolean; // a critical check that is not assessed prevents READY
  status: CheckStatus;
  severity: CheckSeverity; // derived from status + critical, never set independently
  title: string;
  finding: string; // the fact
  implication: string; // what it means for the conclusion
  evidenceIds: string[]; // sourceIds of this metric's evidence; empty when the finding is about missing evidence
  references?: CheckReference[];
  action: string | null;
};

export type MetricIntegrity = {
  version: 2;
  readiness: Readiness; // for the single-period cross-company comparison of this metric
  checks: IntegrityCheck[];
  coverage: { assessed: string[]; notAssessed: string[]; notApplicable: string[] };
  sourceBasis: Record<string, SourceBasis>; // ticker -> basis
  analystAction: string;
  allowableConclusion: string | null;
  withheldConclusionReason: string | null;
  trend: { readiness: Readiness; summary: string } | null; // only when a multi-year series is in scope
};

export type AuditIntegrity = {
  version: 2;
  readinessByMetric: Partial<Record<AuditMetricId, Readiness>>;
  verdict: string;
  coverage: string[];
};

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
  periodStart?: string | null; // V2: from the XBRL fact's context; null when not retrieved
  periodType: "annual";
  reportingBasis: "US GAAP (as reported, XBRL)" | "Derived from US GAAP inputs";
  sourceBasis?: SourceBasis; // V2
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
  integrity?: MetricIntegrity; // V2; absent on audits built before it
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
  integrity?: AuditIntegrity; // V2
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
    if (m.integrity) errors.push(...validateIntegrity(m, evidenceIds, missing).map((e) => `${where}: ${e}`));
  }
  return errors;
}

// V2 invariants: readiness is exactly what the reducer derives from the checks (so neither the model nor a later
// edit can upgrade it), severities follow statuses, and every evidence ID / reference is real.
function validateIntegrity(m: MetricAudit, evidenceIds: Set<string>, missing: boolean): string[] {
  const errors: string[] = [];
  const g = m.integrity!;
  if (!isIn(READINESS, g.readiness)) return ["bad readiness"];
  for (const c of g.checks) {
    if (!isIn(INTEGRITY_CHECK_IDS, c.id) || !isIn(CHECK_STATUSES, c.status)) errors.push(`bad check ${c.id}/${c.status}`);
    else if (c.severity !== checkSeverity(c.status, c.critical)) errors.push(`check ${c.id}: severity does not match status`);
    if (c.evidenceIds.some((id) => !evidenceIds.has(id))) errors.push(`check ${c.id} cites evidence not in this metric`);
    if ((c.references ?? []).some((r) => !/^https:\/\/www\.sec\.gov\//.test(r.url))) errors.push(`check ${c.id}: non-SEC reference`);
  }
  if (g.readiness !== reduceReadiness(g.checks.filter((c) => c.scope === "comparison"))) errors.push("readiness does not follow from its checks");
  if ((missing || m.status === "INSUFFICIENT_EVIDENCE" || m.status === "NOT_COMPARABLE") && g.readiness !== "BLOCKED") {
    errors.push(`status ${m.status} must be BLOCKED`);
  }
  for (const v of m.values) if (g.sourceBasis[v.ticker] !== sourceBasisOf(v)) errors.push(`${v.ticker}: source basis does not match its value`);
  if (g.readiness === "BLOCKED" ? !g.withheldConclusionReason : !g.allowableConclusion) errors.push("conclusion text missing");
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

// One check outcome as carried in a research summary (compact: no implication text or evidence IDs).
export type ResearchFindingCheck = { id: IntegrityCheckId; status: CheckStatus; title: string; finding: string; ticker: string | null };

export type ResearchAuditFinding = {
  pair: string; // "NKE vs UAA"
  metricId: AuditMetricId;
  metric: string;
  status: ComparabilityStatus;
  explanation: string;
  evidenceUrls: string[];
  requiresHumanReview: boolean;
  // V2, absent on summaries saved before it (the panel then falls back to the comparability status alone)
  readiness?: Readiness;
  conclusion?: string; // allowable conclusion, or why it is withheld
  analystAction?: string;
  sourceBasis?: Record<string, SourceBasis>;
  checks?: ResearchFindingCheck[]; // every check that did not plainly pass
  passed?: string[]; // titles of checks that passed
  notAssessed?: string[];
  trend?: { readiness: Readiness; summary: string } | null;
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

// V2 fields are all-or-nothing: without a valid readiness none are kept, so a damaged summary renders as legacy.
function readV2Finding(x: Record<string, unknown>): Partial<ResearchAuditFinding> {
  if (!isIn(READINESS, x.readiness)) return {};
  const checks = (Array.isArray(x.checks) ? x.checks : []).flatMap((c): ResearchFindingCheck[] => {
    const o = c as Record<string, unknown>;
    if (!o || !isIn(INTEGRITY_CHECK_IDS, o.id) || !isIn(CHECK_STATUSES, o.status) || !isStr(o.title) || !isStr(o.finding)) return [];
    return [{ id: o.id, status: o.status, title: o.title, finding: o.finding, ticker: isStr(o.ticker) ? o.ticker : null }];
  });
  const basis = (x.sourceBasis ?? {}) as Record<string, unknown>;
  const t = x.trend as Record<string, unknown> | null | undefined;
  return {
    readiness: x.readiness,
    conclusion: isStr(x.conclusion) ? x.conclusion : undefined,
    analystAction: isStr(x.analystAction) ? x.analystAction : undefined,
    sourceBasis: Object.fromEntries(Object.entries(basis).filter(([, v]) => isIn(SOURCE_BASES, v))) as Record<string, SourceBasis>,
    checks,
    passed: strs(x.passed),
    notAssessed: strs(x.notAssessed),
    trend: t && isIn(READINESS, t.readiness) && isStr(t.summary) ? { readiness: t.readiness, summary: t.summary } : null,
  };
}
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
        ...readV2Finding(x),
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
